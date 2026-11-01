---
name: git-worktrees
description: Work with Git repositories using worktrees backed by a bare clone — one central repository with shared history and separate working directories per branch, all scoped to a per-repo folder. Use when setting up parallel branches, isolated agent working directories, or converting a repo to a worktree-only workflow. Covers bare cloning, per-repo folder layout, creating/removing worktrees, fetching through the shared repository, and branch checkout constraints.
---

# Git Worktrees with a Bare Clone

When a repository is used exclusively with worktrees, clone it as a **bare
repository** and create worktrees for the branches to work on. This gives one
central repository with shared history and metadata, plus separate working
directories per branch — no conventional checkout that never gets used.

## Per-repo folder layout

Keep every cloned repository self-contained in its **own folder** named after
the repository. The folder holds the bare clone and all worktrees as siblings,
so multiple repos never share or collide in the parent directory:

```text
/app/                                # Container working directory
├── my-project/                      # One folder per repository
│   ├── my-project.git/              # Bare repository (shared objects + refs)
│   ├── main/                        # Worktree: default branch
│   └── feature/                     # Worktree: additional branch
└── other-repo/                      # A second repository, fully isolated
    ├── other-repo.git/
    └── main/
```

This is the layout the container setup script creates: for a repo
`owner/my-project` everything lives under `/app/my-project/`.

## Setup

### 1. Create the repo folder and clone as a bare repository

```bash
mkdir -p my-project
git clone --bare https://github.com/user/my-project.git my-project/my-project.git
```

The `.git` suffix is a naming convention, not a requirement — it signals that
the directory is repository storage, not a working directory.

### 2. Create the first worktree

```bash
cd my-project/my-project.git
git worktree add ../main main
```

The branch (`main` here) must already exist in the cloned repository. If the
default branch has another name, use that instead.

### 3. Create additional worktrees

Existing branch:

```bash
git worktree add ../feature feature
```

New branch (branched from `main`):

```bash
git worktree add -b feature-new ../feature-new main
```

All worktree paths are relative to the bare repository, so they land inside
the same per-repo folder.

## Day-to-day commands

Inside any worktree, ordinary Git commands work as usual (`git status`,
`git add`, `git commit`, `git push`). Switching "branches" means changing
directories, not running `git checkout`.

| Task                          | Command                            |
| ----------------------------- | ---------------------------------- |
| List registered worktrees     | `git worktree list`                |
| Remove a finished worktree    | `git worktree remove ../feature`   |
| Prune stale worktree metadata | `git worktree prune`               |

`git worktree remove` deletes the working directory but **not** the branch.

## Fetching and pulling

Manage remote updates through the shared (bare) repository, then update
branches inside the relevant worktree:

```bash
cd my-project/my-project.git
git fetch origin

cd ../main
git pull
```

Running `git fetch` from inside a worktree also works — it updates the shared
repository's remote-tracking references.

## Key facts and constraints

- A bare repository has no checked-out branch, but still holds remote-tracking
  references and full history.
- All worktrees share repository objects and references; each worktree has its
  **own index and working files**.
- A given local branch **cannot be checked out in multiple worktrees
  simultaneously** — this is the most common cause of
  `fatal: '<branch>' is already checked out at ...` errors. Create a separate
  branch (or use `--detach`) for the second working directory instead.
- Never run `git worktree remove` on a worktree with uncommitted changes you
  intend to keep; check `git status` in that directory first.
- Keep the bare clone and all its worktrees inside the same per-repo folder;
  never place worktrees from different repos in a shared parent directory,
  or branch names will collide (two repos with a `main` worktree cannot both
  live directly in `/app`).

## Standard clone vs. bare clone + worktrees

| Standard clone                                        | Bare clone + worktrees                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| Repository and initial working directory are combined | Repository storage is separate                                    |
| Additional worktrees can be added                     | All working directories are worktrees                             |
| Default checkout exists in the clone directory        | No initial checkout                                               |
| Useful for conventional development                   | Useful for parallel branches, multiple tasks, and agent workflows |

## Minimal workflow

```bash
# Clone once, inside its own folder
mkdir -p my-project
git clone --bare https://github.com/user/my-project.git my-project/my-project.git

# Create working directories
cd my-project/my-project.git
git worktree add ../main main
git worktree add -b feature ../feature main

# List worktrees
git worktree list

# Clean up a finished worktree
git worktree remove ../feature
```
