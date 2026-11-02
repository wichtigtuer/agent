---
name: git-worktrees
description: Work with Git repositories using worktrees added to a regular clone — the default branch stays checked out in the repository directory and additional branches get their own working directories inside it. Use when setting up parallel branches, isolated agent working directories, or adding/removing worktrees in an existing checkout. Covers cloning, the per-repo folder layout, creating/removing worktrees, fetching, and branch checkout constraints.
---

# Git Worktrees in a Regular Clone

The repository is cloned **normally** into `/app`: the clone directory
is the working directory for the default branch, and additional branches
are added as worktrees **inside** that directory. The default branch
checkout is the hub of the repository — all worktrees share its objects
and refs.

## Per-repo layout

Clone the repository directly into `/app`; that directory *is* the
default-branch checkout. Worktrees for additional branches live inside
it, so everything for the repo stays self-contained:

```text
/app/                                # The repository clone: default branch (main) checked out
├── .git/                            # Repository metadata (shared with all worktrees)
├── feature/                         # Worktree: additional branch
└── ...                              # Working files of the default branch
```

This is the layout the container setup script creates: the clone of the
repo (e.g. `owner/my-project`) lives directly at `/app/`, and branch
worktrees live inside it at `/app/<branch>`.

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/user/my-project.git /app
```

The clone checks out the default branch automatically; no further step is
needed for it.

### 2. Update the default branch before creating new worktrees

**Always** bring the default branch up to date with the remote before
branching a new worktree off it. Otherwise the new branch starts from
a stale commit and needs an immediate rebase or merge:

```bash
cd /app
git pull --ff-only
```

Only after the default branch is current should you create the new worktree.

### 3. Create additional worktrees

Worktrees are added from inside the clone, with the branch name as the
directory name so they stay inside the repo directory:

```bash
cd /app
```

Existing branch:

```bash
git worktree add feature feature
```

New branch (branched from the freshly updated `main`):

```bash
git worktree add -b feature-new feature-new main
```

## Day-to-day commands

Inside the clone or any worktree, ordinary Git commands work as usual
(`git status`, `git add`, `git commit`, `git push`). Switching "branches"
means changing directories, not running `git checkout`.

| Task                          | Command                        |
| ----------------------------- | ------------------------------ |
| List registered worktrees     | `git worktree list`            |
| Remove a finished worktree    | `git worktree remove feature`  |
| Prune stale worktree metadata | `git worktree prune`           |

`git worktree remove` deletes the working directory but **not** the branch.

## Fetching and pulling

Fetch and pull inside the relevant working directory:

```bash
cd /app
git fetch origin
git pull
```

A `git fetch` in any worktree updates the shared remote-tracking references
for the whole repository; every other worktree sees them immediately.

## Key facts and constraints

- All worktrees share the repository's objects and references; each
  worktree has its **own index and working files**.
- The clone directory itself is a worktree (the "main worktree") holding
  the default-branch checkout; it is listed first by `git worktree list`.
- A given local branch **cannot be checked out in multiple worktrees
  simultaneously** — this is the most common cause of
  `fatal: '<branch>' is already checked out at ...` errors. Create a
  separate branch (or use `--detach`) for the second working directory
  instead.
- Worktrees nested inside the clone directory appear as untracked
  directories to the default-branch checkout. Ignore them via
  `.git/info/exclude` (local, not committed) if the noise bothers you.
- Never run `git worktree remove` on a worktree with uncommitted changes
  you intend to keep; check `git status` in that directory first.
- Never create a worktree from the default branch without first fetching
  and fast-forwarding it to the latest remote state; branching off a stale
  commit causes avoidable conflicts and rebases later.
- Keep worktrees inside the clone at `/app`; since `/app` holds a single
  repository, worktree directory names are branch names and stay unique.

## Minimal workflow

```bash
# Clone once; the default branch is checked out immediately
git clone https://github.com/user/my-project.git /app
cd /app

# Always update the default branch from the remote before branching off it
git pull --ff-only

# Add a worktree for another branch, inside the checkout
git worktree add -b feature feature main

# List worktrees
git worktree list

# Clean up a finished worktree
git worktree remove feature
```
