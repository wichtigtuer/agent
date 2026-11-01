# agent

Dockerized coding-agent environment: a Node 24 image with git, gh, pnpm,
Playwright, and the [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent)
preinstalled, plus a baked-in `setup-agent` script that provisions GitHub
authentication (PAT → SSH key → bare clone + worktree layout) inside the
container.

## Prerequisites

- Docker
- A GitHub Personal Access Token (fine-grained `github_pat_...` or classic
  `ghp_...`) with permission to manage Git SSH keys
- `PI_AGENT_API_KEY` in your host environment (for the `pi` / `shell` targets)
- SSH keys mounted from `./secrets` into the container (see `make run`)

## Install

Build the image (tags it `penfold-agent:latest`):

```sh
make build
# or a specific revision:
make build REVISION=v1.0.0
```

Equivalent without make:

```sh
docker build --no-cache --pull -t penfold-agent:latest -f Dockerfile.agent .
```

## Update

Rebuild with a fresh base image and reinstall all tools, then restart the
container:

```sh
make stop
make build
make run
```

The build uses `--no-cache --pull`, so every rebuild picks up the latest
`node:24-slim` base image, apt packages, pnpm, Playwright browsers, and the
newest `@earendil-works/pi-coding-agent`. Named volumes
(`penfold-gh-config`, `penfold-pi-config`, `penfold-worktrees`) persist your
gh/pi config and `/app` worktrees across rebuilds.

## Use

Typical workflow (see `make help` for all targets):

```sh
make run     # 1. Start the container (detached, --rm, named penfold-agent)
make setup   # 2. Run the baked-in GitHub setup wizard inside the container
make pi      # 3. Launch pi in a tmux session inside the container
```

- `make run` — starts the container with volumes for gh config, pi config,
  worktrees (`/app`), and your `./secrets` SSH keys.
- `make setup` — runs `setup-agent` (from `scripts/setup-github-agent.ts`):
  prompts for a GitHub PAT, generates an ed25519 SSH key, uploads it to
  GitHub, configures git identity + SSH, and optionally clones a repository
  as a bare repo at `/app/<repo>.git` with a default-branch worktree at
  `/app/<branch>`.
- `make pi` — runs the Pi Coding Agent in a tmux session
  (`PI_AGENT_API_KEY` is forwarded from the host).
- `make shell` — opens a bash shell in the container.
- `make stop` — stops the container (it is removed automatically via `--rm`).
