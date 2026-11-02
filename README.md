# agent

Dockerized coding-agent environment: a Node 24 image with git, gh, pnpm,
Playwright, and the [Pi Coding Agent](https://github.com/earendil-works/pi)
preinstalled, plus a baked-in `setup-agent` script that provisions GitHub
authentication (PAT → SSH key → repository clone) inside the container.

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
make stop NAME=myrepo
make build
make run NAME=myrepo
```

The build uses `--no-cache --pull`, so every rebuild picks up the latest
`node:24-slim` base image, apt packages, pnpm, Playwright browsers, and the
newest `@earendil-works/pi-coding-agent`. Named volumes
(`penfold-gh-config`, `penfold-pi-config`, `penfold-worktrees-<name>`)
persist your gh/pi config and `/app` repositories across rebuilds.

## Use

Every container action takes a `NAME` (e.g. the repository name). It names
the container (`penfold-agent-<name>`) and its dedicated `/app` volume
(`penfold-worktrees-<name>`), so containers started with different names run
in parallel: each gets an isolated `/app`, while gh config, pi config and
the `./secrets` SSH keys stay shared across all of them. Typical workflow
(see `make help` for all targets):

```sh
make run NAME=myrepo    # 1. Start the container (detached, --rm)
make setup NAME=myrepo  # 2. Run the baked-in GitHub setup wizard inside the container
make pi NAME=myrepo     # 3. Launch pi in a tmux session inside the container
```

- `make run NAME=<repo>` — starts the container with volumes for gh config,
  pi config, repositories (`/app`, dedicated to this NAME), and your
  `./secrets` SSH keys.
- `make setup NAME=<repo>` — runs `setup-agent` (from
  `scripts/setup-github-agent.ts`): prompts for a GitHub PAT, ensures a
  per-name ed25519 SSH key (see below), configures git identity + SSH, and
  optionally clones a repository into `/app/<repo>` as a regular checkout of
  the default branch (additional branch worktrees go inside the checkout at
  `/app/<repo>/<branch>`).
- `make pi NAME=<repo>` — runs the Pi Coding Agent in a tmux session
  (`PI_AGENT_API_KEY` is forwarded from the host).
- `make shell NAME=<repo>` — opens a bash shell in the container.
- `make stop NAME=<repo>` — stops the container (it is removed automatically
  via `--rm`).

### Per-name SSH keys

`make run NAME=<name>` passes the name into the container as `AGENT_NAME`.
`setup-agent` scopes the SSH key by that name: the local key pair lives at
`~/.ssh/agent_key_<name>` (inside the shared `./secrets` mount, so it
survives container replacement) and is uploaded to GitHub with the title
`agent_key_<name>`. Running five containers for five repos therefore yields
five distinct keys in the GitHub account.

On startup `setup-agent` uploads/replaces as needed:

- Local key present → it is reused; the public key is uploaded to GitHub
  if the account has no (or a different) key under `agent_key_<name>`.
- Local key missing → a fresh pair is generated and uploaded, replacing
  any stale `agent_key_<name>` left on the account by a previous container.
