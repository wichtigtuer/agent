#!/usr/bin/env node

import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  outro,
  password,
  spinner,
  text,
} from "@clack/prompts";
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEY_TITLE = "agent_key";
const KEY_PATH = join(homedir(), ".ssh", KEY_TITLE);
const SSH_CONFIG_PATH = join(homedir(), ".ssh", "config");
const BASHRC_PATH = join(homedir(), ".bashrc");
// Repositories live in their own folder under /app/<repo>: the bare clone at
// /app/<repo>/<repo>.git and the worktrees for the default and additional
// branches as siblings of the bare clone, e.g. /app/<repo>/<branch>.
const REPOS_DIR = "/app";
// clack leaves several keypress listeners attached across prompts and the
// spinner; raise the limit to avoid a noisy MaxListenersExceededWarning in
// this short-lived CLI.
const MAX_STDIN_LISTENERS = 20;
const SIGINT_EXIT_CODE = 130;
const FINE_GRAINED_PAT_PREFIX = "github_pat_";
const CLASSIC_PAT_PREFIX = "ghp_";
const PAT_PREFIXES: ReadonlyArray<string> = [
  FINE_GRAINED_PAT_PREFIX,
  CLASSIC_PAT_PREFIX,
];

/**
 * A GitHub Personal Access Token (fine-grained or classic), validated by prefix.
 */
type GitHubPat = string & { readonly __brand: "GitHubPat" };

/**
 * Validate that the pasted token looks like a fine-grained or classic PAT.
 *
 * @param tokenInput - Raw user input from the prompt.
 * @returns True when the input carries a known PAT prefix.
 */
const isGitHubPat = (tokenInput: string): tokenInput is GitHubPat =>
  PAT_PREFIXES.some((prefix) => tokenInput.startsWith(prefix));

/**
 * Run a command and resolve with its stdout, or reject with stderr context.
 *
 * @param command - Executable name.
 * @param args - Argument list.
 * @param stdin - Optional data piped to stdin (never passed as an arg).
 * @returns Trimmed stdout.
 */
const run = (
  command: string,
  args: ReadonlyArray<string>,
  stdin?: string,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });

    if (!child.stdout || !child.stderr) {
      reject(new Error(`Failed to open stdio for ${command}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    child.on("error", (error: Error) =>
      reject(new Error(`Failed to start ${command}: ${error.message}`)),
    );
    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code}\n${stderr.trim()}`,
        ),
      );
    });

    if (stdin !== undefined && child.stdin) {
      child.stdin.write(`${stdin}\n`);
      child.stdin.end();
    }
  });

/**
 * A GitHub repository slug in `owner/repo` form, validated by pattern.
 */
type RepoSlug = string & { readonly __brand: "RepoSlug" };

const REPO_SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Validate that the input looks like an `owner/repo` slug.
 *
 * @param slugInput - Raw user input from the prompt.
 * @returns True when the input matches the slug pattern.
 */
const isRepoSlug = (slugInput: string): slugInput is RepoSlug =>
  REPO_SLUG_PATTERN.test(slugInput);

/**
 * Parse a GitHub repository link into an `owner/repo` slug. Accepts
 * https URLs, ssh URLs, scp-style `git@github.com:` links, and bare slugs,
 * with optional `.git` suffix and trailing slash.
 *
 * @param linkInput - Raw user input from the prompt.
 * @returns The validated slug, or undefined when the link is not parseable.
 */
const parseRepoLink = (linkInput: string): RepoSlug | undefined => {
  const withoutPrefix = linkInput
    .trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^ssh:\/\/git@github\.com\//, "")
    .replace(/^git@github\.com:/, "");
  const slugCandidate = withoutPrefix.replace(/\.git$/, "").replace(/\/$/, "");
  return isRepoSlug(slugCandidate) ? slugCandidate : undefined;
};

/**
 * Prompt for a GitHub PAT without echoing it.
 *
 * @returns The validated token.
 */
const promptForToken = async (): Promise<GitHubPat> => {
  const token = await password({
    message: "Paste a GitHub Personal Access Token (fine-grained or classic)",
    mask: "•",
    validate: (tokenInput: string | undefined): string | undefined => {
      if (tokenInput === undefined || !isGitHubPat(tokenInput)) {
        return `Expected a PAT starting with "${FINE_GRAINED_PAT_PREFIX}" (fine-grained) or "${CLASSIC_PAT_PREFIX}" (classic)`;
      }
      return undefined;
    },
  });

  if (isCancel(token)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }
  if (!isGitHubPat(token)) {
    cancel("Token validation failed.");
    process.exit(1);
  }
  return token;
};

/**
 * Authenticated GitHub account identity used to configure git commits.
 */
type GitHubIdentity = Readonly<{
  username: string;
  id: string;
}>;

/**
 * Authenticate gh with the token, piping it via stdin so it never
 * appears in the process argument list. Sets ssh as the git protocol.
 *
 * @param token - GitHub PAT.
 * @returns The authenticated account's username and numeric id.
 */
const authenticateGh = async (token: GitHubPat): Promise<GitHubIdentity> => {
  await run(
    "gh",
    ["auth", "login", "--with-token", "--git-protocol", "ssh"],
    token,
  );
  const username = await run("gh", ["api", "user", "--jq", ".login"]);
  const id = await run("gh", ["api", "user", "--jq", ".id"]);
  log.success(`Authenticated gh as ${username}`);
  return { username, id };
};

/**
 * Derive a noreply commit email from the GitHub id and set the global
 * git identity so commits are attributed to the token's owner.
 *
 * @param identity - Authenticated username and numeric GitHub id.
 */
const configureGitIdentity = async (
  identity: GitHubIdentity,
): Promise<void> => {
  const noreplyEmail = `${identity.id}+${identity.username}@users.noreply.github.com`;
  await run("git", ["config", "--global", "user.name", identity.username]);
  await run("git", ["config", "--global", "user.email", noreplyEmail]);
  log.success(
    `Configured git identity as ${identity.username} <${noreplyEmail}>`,
  );
};

/**
 * Persist the git identity as GIT_AUTHOR_* and GIT_COMMITTER_* environment
 * variables in ~/.bashrc so every future shell (e.g. pi started later)
 * attributes commits to the token's owner, even when git config is not
 * picked up. Existing export lines for these variables are replaced, so
 * re-running setup with a different account updates the values.
 *
 * @param identity - Authenticated username and numeric GitHub id.
 */
const configureGitEnvVars = (identity: GitHubIdentity): void => {
  const noreplyEmail = `${identity.id}+${identity.username}@users.noreply.github.com`;
  const exportsToSet: ReadonlyArray<readonly [string, string]> = [
    ["GIT_AUTHOR_NAME", identity.username],
    ["GIT_COMMITTER_NAME", identity.username],
    ["GIT_AUTHOR_EMAIL", noreplyEmail],
    ["GIT_COMMITTER_EMAIL", noreplyEmail],
  ];
  const existing = existsSync(BASHRC_PATH)
    ? readFileSync(BASHRC_PATH, "utf8")
    : "";
  const keptLines = existing
    .split("\n")
    .filter(
      (line) =>
        !exportsToSet.some(([name]) => line.startsWith(`export ${name}=`)),
    );
  while (keptLines.length > 0 && keptLines[keptLines.length - 1] === "") {
    keptLines.pop();
  }
  const exportLines = exportsToSet
    .map(([name, value]) => `export ${name}="${value}"`)
    .join("\n");
  const prefix = keptLines.length > 0 ? `${keptLines.join("\n")}\n\n` : "";
  writeFileSync(BASHRC_PATH, `${prefix}${exportLines}\n`);
  log.success(`Exported git identity variables in ${BASHRC_PATH}`);
};

/**
 * Prompt for a link to the GitHub repository to clone.
 *
 * @returns The validated `owner/repo` slug parsed from the link.
 */
const promptForRepoLink = async (): Promise<RepoSlug> => {
  const repoLink = await text({
    message: "Link to the GitHub repository to clone",
    placeholder: "https://github.com/octocat/hello-world",
    validate: (linkInput: string | undefined): string | undefined => {
      if (linkInput === undefined || parseRepoLink(linkInput) === undefined) {
        return "Expected a GitHub link like https://github.com/octocat/hello-world or git@github.com:octocat/hello-world.git";
      }
      return undefined;
    },
  });

  if (isCancel(repoLink)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }
  const slug = parseRepoLink(repoLink);
  if (slug === undefined) {
    cancel("Repository link validation failed.");
    process.exit(1);
  }
  return slug;
};

/**
 * Point git at the agent key so clones and fetches authenticate without
 * relying on ~/.ssh/config entries. `accept-new` trusts new host keys
 * non-interactively (TOFU) so the first clone cannot hang on ssh's
 * host-key confirmation prompt, while changed keys are still rejected.
 */
const configureGitSshCommand = async (): Promise<void> => {
  await run("git", [
    "config",
    "--global",
    "core.sshCommand",
    `ssh -i ${KEY_PATH} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
  ]);
  log.success(`Configured git to use ${KEY_PATH} for SSH`);
};

/**
 * Ensure ~/.ssh/config routes github.com through the agent key so plain
 * ssh (e.g. `ssh -T git@github.com`) authenticates without extra flags.
 * Appends the host block unless the key is already referenced.
 */
const configureSshConfig = (): void => {
  const hostBlock = [
    `Host github.com`,
    `  IdentityFile ${KEY_PATH}`,
    `  IdentitiesOnly yes`,
  ].join("\n");
  const existing = existsSync(SSH_CONFIG_PATH)
    ? readFileSync(SSH_CONFIG_PATH, "utf8")
    : "";
  if (existing.includes(KEY_PATH)) {
    log.info(`Reusing existing github.com entry in ${SSH_CONFIG_PATH}`);
    return;
  }
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  appendFileSync(SSH_CONFIG_PATH, `${separator}${hostBlock}\n`, {
    mode: 0o600,
  });
  log.success(`Added github.com entry to ${SSH_CONFIG_PATH}`);
};

/**
 * Short repository name — the part after the slash in `owner/repo`.
 *
 * @param slug - Validated repository slug.
 * @returns The repository name.
 */
const repoNameOf = (slug: RepoSlug): string => {
  const segments = slug.split("/");
  return segments[segments.length - 1] ?? slug;
};

/**
 * Per-repository folder that keeps every clone self-contained, so
 * different repos never share or collide inside /app.
 *
 * @param slug - Validated repository slug.
 * @returns Absolute path of the repo's folder (/app/<repo>).
 */
const repoDirOf = (slug: RepoSlug): string => join(REPOS_DIR, repoNameOf(slug));

/**
 * Check whether a bare repository holds at least one ref, i.e. its clone
 * completed. A clone killed mid-fetch leaves a directory with no refs.
 *
 * @param barePath - Path of the bare repository.
 * @returns True when the repository has refs.
 */
const bareRepoHasRefs = async (barePath: string): Promise<boolean> => {
  try {
    await run("git", ["-C", barePath, "show-ref", "-q"]);
    return true;
  } catch {
    return false;
  }
};

/**
 * Clone the repository as a bare repository into /app/<name>/<name>.git,
 * reusing the clone when it already exists.
 *
 * @param slug - Repository to clone.
 * @returns Path of the bare repository.
 */
const cloneBareRepo = async (slug: RepoSlug): Promise<string> => {
  const repoDir = repoDirOf(slug);
  const barePath = join(repoDir, `${repoNameOf(slug)}.git`);
  if (existsSync(barePath)) {
    if (await bareRepoHasRefs(barePath)) {
      log.info(`Reusing existing bare repository at ${barePath}`);
      return barePath;
    }
    log.warn(`Removing incomplete bare repository at ${barePath}`);
    rmSync(barePath, { recursive: true, force: true });
  }
  mkdirSync(repoDir, { recursive: true });
  await run("git", ["clone", "--bare", `git@github.com:${slug}.git`, barePath]);
  log.success(`Cloned ${slug} as a bare repository at ${barePath}`);
  return barePath;
};

/**
 * Add a worktree for the repository's default branch as a sibling of the
 * bare clone, reusing the worktree when it already exists.
 *
 * @param slug - Repository whose default branch is resolved via gh.
 * @param barePath - Path of the bare repository.
 */
const addDefaultBranchWorktree = async (
  slug: RepoSlug,
  barePath: string,
): Promise<void> => {
  const defaultBranch = await run("gh", [
    "repo",
    "view",
    slug,
    "--json",
    "defaultBranchRef",
    "--jq",
    ".defaultBranchRef.name",
  ]);
  const worktreePath = join(repoDirOf(slug), defaultBranch);
  if (existsSync(worktreePath)) {
    log.info(`Reusing existing worktree at ${worktreePath}`);
    return;
  }
  await run("git", [
    "-C",
    barePath,
    "worktree",
    "add",
    worktreePath,
    defaultBranch,
  ]);
  log.success(`Added worktree for ${defaultBranch} at ${worktreePath}`);
};

/**
 * Generate a new ed25519 key pair at KEY_PATH, asking before overwriting
 * an existing key.
 *
 * @returns True when a fresh key pair was generated.
 */
const generateKeyPair = async (): Promise<boolean> => {
  mkdirSync(join(homedir(), ".ssh"), { recursive: true, mode: 0o700 });

  if (existsSync(KEY_PATH)) {
    const overwrite = await confirm({
      message: `${KEY_PATH} already exists. Overwrite it?`,
      initialValue: false,
    });
    if (isCancel(overwrite)) {
      cancel("Setup cancelled.");
      process.exit(0);
    }
    if (!overwrite) {
      log.info("Reusing the existing key pair.");
      return false;
    }
    rmSync(KEY_PATH, { force: true });
    rmSync(`${KEY_PATH}.pub`, { force: true });
  }

  await run("ssh-keygen", [
    "-t",
    "ed25519",
    "-f",
    KEY_PATH,
    "-N",
    "",
    "-C",
    KEY_TITLE,
  ]);
  log.success(`Generated ed25519 key pair at ${KEY_PATH}`);
  return true;
};

/**
 * Upload the public key to GitHub via gh, enriching permission errors
 * with token-fixing guidance.
 */
const uploadKey = async (): Promise<void> => {
  try {
    await run("gh", [
      "ssh-key",
      "add",
      `${KEY_PATH}.pub`,
      "--title",
      KEY_TITLE,
      "--type",
      "authentication",
    ]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("HTTP 404") || message.includes("HTTP 403")) {
      throw new Error(
        [
          message,
          "",
          "The token lacks SSH key permission. Fix it and re-run:",
          "- Fine-grained PAT: Account permissions -> Git SSH keys -> Read and write",
          "  (https://github.com/settings/personal-access-tokens)",
          "- Classic PAT: enable the write:public_key scope",
          "  (https://github.com/settings/tokens)",
        ].join("\n"),
      );
    }
    throw error;
  }
  log.success(`Uploaded public key to GitHub as "${KEY_TITLE}"`);
};

const main = async (): Promise<void> => {
  process.stdin.setMaxListeners(MAX_STDIN_LISTENERS);
  // The clack spinner swallows SIGINT (it only cancels the spinner
  // visually), so exit explicitly to keep Ctrl-C working in every phase.
  process.on("SIGINT", () => {
    cancel("Setup cancelled.");
    process.exit(SIGINT_EXIT_CODE);
  });
  intro("GitHub agent key setup");
  const token = await promptForToken();

  const wantsClone = await confirm({
    message:
      "Clone a repository as a bare repo with a default-branch worktree?",
    initialValue: true,
  });
  if (isCancel(wantsClone)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }
  const slug = wantsClone ? await promptForRepoLink() : undefined;

  const progress = spinner();
  progress.start("Authenticating gh");
  const identity = await authenticateGh(token);

  progress.message("Generating SSH key pair");
  await generateKeyPair();

  progress.message("Uploading public key to GitHub");
  await uploadKey();

  progress.message("Configuring git identity");
  await configureGitIdentity(identity);

  progress.message("Persisting git identity environment variables");
  configureGitEnvVars(identity);

  progress.message("Configuring git SSH command");
  await configureGitSshCommand();

  progress.message("Configuring ~/.ssh/config");
  configureSshConfig();

  if (slug !== undefined) {
    progress.message(`Cloning ${slug}`);
    const barePath = await cloneBareRepo(slug);
    progress.message("Adding worktree for the default branch");
    await addDefaultBranchWorktree(slug, barePath);
  }
  progress.stop("All done");

  outro("Setup complete — try: ssh -T git@github.com");
  process.exit(0);
};

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  cancel("Setup failed.");
  process.exit(1);
});
