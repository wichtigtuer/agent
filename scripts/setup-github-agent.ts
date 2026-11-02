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
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SSH_CONFIG_PATH = join(homedir(), ".ssh", "config");
const BASHRC_PATH = join(homedir(), ".bashrc");
// Repositories are cloned directly under /app/<repo> as regular checkouts
// of the default branch; additional branch worktrees are added inside the
// checkout at /app/<repo>/<branch>.
const REPOS_DIR = "/app";
// The agent name (usually the repository name) scopes the SSH key both
// locally (~/.ssh/agent_key_<name>) and on GitHub (title "agent_key_<name>"),
// so containers started for different repos each own a distinct key pair in
// the same GitHub account. The makefile passes its NAME through this
// environment variable.
const AGENT_NAME_ENV = "AGENT_NAME";
const AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
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
 *
 * @param key - Name-scoped agent key.
 */
const configureGitSshCommand = async (key: AgentKey): Promise<void> => {
  await run("git", [
    "config",
    "--global",
    "core.sshCommand",
    `ssh -i ${key.path} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
  ]);
  log.success(`Configured git to use ${key.path} for SSH`);
};

/**
 * Ensure ~/.ssh/config routes github.com through the agent key so plain
 * ssh (e.g. `ssh -T git@github.com`) authenticates without extra flags.
 * Appends the host block unless the key is already referenced.
 *
 * @param key - Name-scoped agent key.
 */
const configureSshConfig = (key: AgentKey): void => {
  const hostBlock = [
    `Host github.com`,
    `  IdentityFile ${key.path}`,
    `  IdentitiesOnly yes`,
  ].join("\n");
  const existing = existsSync(SSH_CONFIG_PATH)
    ? readFileSync(SSH_CONFIG_PATH, "utf8")
    : "";
  if (existing.includes(key.path)) {
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
 * Check whether a repository holds at least one ref, i.e. its clone
 * completed. A clone killed mid-fetch leaves a directory with no refs.
 *
 * @param repoDir - Path of the repository checkout.
 * @returns True when the repository has refs.
 */
const repoHasRefs = async (repoDir: string): Promise<boolean> => {
  try {
    await run("git", ["-C", repoDir, "show-ref", "-q"]);
    return true;
  } catch {
    return false;
  }
};

/**
 * Clone the repository into /app/<repo> as a regular checkout of the
 * default branch, reusing the clone when it already exists. Additional
 * branch worktrees are added later inside the checkout at
 * /app/<repo>/<branch>.
 *
 * @param slug - Repository to clone.
 * @returns Path of the checkout.
 */
const cloneRepo = async (slug: RepoSlug): Promise<string> => {
  const repoDir = repoDirOf(slug);
  if (existsSync(join(repoDir, ".git"))) {
    if (await repoHasRefs(repoDir)) {
      log.info(`Reusing existing repository at ${repoDir}`);
      return repoDir;
    }
    log.warn(`Removing incomplete repository at ${repoDir}`);
    rmSync(repoDir, { recursive: true, force: true });
  } else if (existsSync(repoDir) && readdirSync(repoDir).length > 0) {
    throw new Error(
      `${repoDir} exists but is not a git repository; move it aside or remove it`,
    );
  }
  await run("git", ["clone", `git@github.com:${slug}.git`, repoDir]);
  log.success(`Cloned ${slug} into ${repoDir}`);
  return repoDir;
};

/**
 * Per-agent SSH key identity. The name scopes the local key files and the
 * GitHub key title, so containers for different repos each get their own
 * key pair in the same GitHub account.
 */
type AgentKey = Readonly<{
  /** Agent name, e.g. the repository name. */
  name: string;
  /** GitHub SSH key title, unique per agent name. */
  title: string;
  /** Local private key path; the public key sits at `${path}.pub`. */
  path: string;
}>;

/**
 * Build the name-scoped key identity: local files at
 * ~/.ssh/agent_key_<name>(.pub), GitHub title "agent_key_<name>".
 *
 * @param name - Validated agent name.
 * @returns The key identity.
 */
const agentKeyFor = (name: string): AgentKey => ({
  name,
  title: `agent_key_${name}`,
  path: join(homedir(), ".ssh", `agent_key_${name}`),
});

/**
 * Resolve the agent name from AGENT_NAME (set by the makefile from its
 * NAME variable), falling back to an interactive prompt when unset.
 *
 * @returns The validated agent name.
 */
const resolveAgentName = async (): Promise<string> => {
  const fromEnv = process.env[AGENT_NAME_ENV]?.trim();
  if (fromEnv !== undefined && fromEnv !== "") {
    if (!AGENT_NAME_PATTERN.test(fromEnv)) {
      throw new Error(
        `${AGENT_NAME_ENV}="${fromEnv}" is invalid; expected ${AGENT_NAME_PATTERN}`,
      );
    }
    log.info(`Using agent name "${fromEnv}" from ${AGENT_NAME_ENV}`);
    return fromEnv;
  }
  const name = await text({
    message: "Name for this agent (usually the repository name)",
    placeholder: "myrepo",
    validate: (nameInput: string | undefined): string | undefined => {
      if (nameInput === undefined || !AGENT_NAME_PATTERN.test(nameInput)) {
        return "Expected a name like \"myrepo\" (letters, digits, dots, dashes, underscores)";
      }
      return undefined;
    },
  });
  if (isCancel(name)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }
  return name;
};

/**
 * A public SSH key registered on the GitHub account.
 */
type RemoteSshKey = Readonly<{
  id: number;
  key: string;
}>;

/**
 * Look up the account's SSH key with the given title via gh.
 *
 * @param title - Key title to find.
 * @returns The remote key (id + public key material), or undefined.
 */
const findRemoteKey = async (
  title: string,
): Promise<RemoteSshKey | undefined> => {
  const raw = await run("gh", ["api", "user/keys", "--paginate"]);
  const entries = JSON.parse(raw) as ReadonlyArray<{
    id: number;
    title: string;
    key: string;
  }>;
  const match = entries.find((entry) => entry.title === title);
  return match === undefined
    ? undefined
    : { id: match.id, key: match.key };
};

/**
 * Delete an SSH key from the GitHub account by its id.
 *
 * @param id - Numeric id of the key to delete.
 */
const deleteRemoteKey = async (id: number): Promise<void> => {
  await run("gh", ["api", "-X", "DELETE", `user/keys/${id}`]);
};

/**
 * The comparable part of an OpenSSH public key: type + base64 material,
 * without any comment.
 *
 * @param publicKey - Full public key line.
 * @returns The key material.
 */
const keyMaterialOf = (publicKey: string): string =>
  publicKey.trim().split(/\s+/).slice(0, 2).join(" ");

/**
 * Derive the public key of a local private key via ssh-keygen.
 *
 * @param keyPath - Path of the private key.
 * @returns The public key line.
 */
const localPublicKeyOf = async (keyPath: string): Promise<string> =>
  run("ssh-keygen", ["-y", "-f", keyPath]);

/**
 * Generate a new ed25519 key pair for the agent key, replacing any
 * existing files. Callers decide when replacement is appropriate.
 *
 * @param key - Name-scoped agent key.
 */
const generateKeyPair = async (key: AgentKey): Promise<void> => {
  mkdirSync(join(homedir(), ".ssh"), { recursive: true, mode: 0o700 });
  rmSync(key.path, { force: true });
  rmSync(`${key.path}.pub`, { force: true });
  await run("ssh-keygen", [
    "-t",
    "ed25519",
    "-f",
    key.path,
    "-N",
    "",
    "-C",
    key.title,
  ]);
  log.success(`Generated ed25519 key pair at ${key.path}`);
};

/**
 * Upload the agent's public key to GitHub via gh, enriching permission
 * errors with token-fixing guidance.
 *
 * @param key - Name-scoped agent key.
 */
const uploadKey = async (key: AgentKey): Promise<void> => {
  try {
    await run("gh", [
      "ssh-key",
      "add",
      `${key.path}.pub`,
      "--title",
      key.title,
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
  log.success(`Uploaded public key to GitHub as "${key.title}"`);
};

/**
 * Ensure the GitHub account holds this agent name's public key, uploading
 * or replacing as needed. An existing local key pair is reused and
 * re-uploaded when GitHub has no (or a different) key under the title;
 * otherwise a fresh pair is generated, replacing any stale remote key
 * left over from a previous container. GitHub stores only public keys,
 * so the remote side is always written, never read back.
 *
 * @param key - Name-scoped agent key.
 */
const ensureAgentKey = async (key: AgentKey): Promise<void> => {
  const remote = await findRemoteKey(key.title);

  if (existsSync(key.path)) {
    if (
      remote !== undefined &&
      keyMaterialOf(await localPublicKeyOf(key.path)) ===
        keyMaterialOf(remote.key)
    ) {
      log.success(
        `Reusing key pair at ${key.path} (on GitHub as "${key.title}")`,
      );
      return;
    }
    if (remote !== undefined) {
      await deleteRemoteKey(remote.id);
      log.info(`Replaced outdated GitHub key "${key.title}"`);
    }
    await uploadKey(key);
    return;
  }

  if (remote !== undefined) {
    await deleteRemoteKey(remote.id);
    log.info(`Replaced stale GitHub key "${key.title}"`);
  }
  await generateKeyPair(key);
  await uploadKey(key);
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
  const key = agentKeyFor(await resolveAgentName());

  const wantsClone = await confirm({
    message: "Clone a repository into /app (default branch checked out)?",
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

  progress.message(`Ensuring SSH key pair "${key.title}"`);
  await ensureAgentKey(key);

  progress.message("Configuring git identity");
  await configureGitIdentity(identity);

  progress.message("Persisting git identity environment variables");
  configureGitEnvVars(identity);

  progress.message("Configuring git SSH command");
  await configureGitSshCommand(key);

  progress.message("Configuring ~/.ssh/config");
  configureSshConfig(key);

  if (slug !== undefined) {
    progress.message(`Cloning ${slug}`);
    await cloneRepo(slug);
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
