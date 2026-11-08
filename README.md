# agent

Dockerized coding-agent environment: a Node 24 image with git, gh, pnpm,
Playwright, and the [Pi Coding Agent](https://github.com/earendil-works/pi)
preinstalled, plus a baked-in `setup-agent` script that provisions GitHub
authentication (PAT → SSH key → repository clone) inside the container.

The repository is the single source of truth for two independently
distributed, versioned components:

| Component | Distributed via | Role |
| --- | --- | --- |
| Docker image | GHCR (`ghcr.io/wichtigtuer/agent:<version>`) | Runtime environment and installed tools |
| Makefile + `agent-wichtigtuer` wrapper | [GitHub Releases](https://github.com/wichtigtuer/agent/releases) | Host-side interface for managing agent containers |

## Install the tool (from a release)

Download the installer from a release, inspect it, and run it:

```sh
curl -fsSL https://github.com/wichtigtuer/agent/releases/download/v1.0.0/install.sh -o install.sh
less install.sh   # inspect before executing
bash install.sh
```

This installs the centrally maintained Makefile to
`~/.config/agent/Makefile` and the `agent-wichtigtuer` wrapper to
`~/.local/bin/agent-wichtigtuer` (make sure `~/.local/bin` is on your `PATH` —
the installer warns if it is not). The installer verifies both files
against the release's `checksums.txt` before installing anything, and it
is idempotent: re-running it from a newer release updates the
installation. No Makefile needs to be committed to any consuming
repository.

Then, from any project:

```sh
agent-wichtigtuer run NAME=myproject
agent-wichtigtuer setup NAME=myproject
agent-wichtigtuer pi NAME=myproject
agent-wichtigtuer shell NAME=myproject
agent-wichtigtuer stop NAME=myproject
```

or equivalently `make -f ~/.config/agent/Makefile run NAME=myproject`.

Each release publishes these assets:

```text
https://github.com/wichtigtuer/agent/releases/download/v1.0.0/Makefile
https://github.com/wichtigtuer/agent/releases/download/v1.0.0/agent-wichtigtuer
https://github.com/wichtigtuer/agent/releases/download/v1.0.0/install.sh
https://github.com/wichtigtuer/agent/releases/download/v1.0.0/checksums.txt
```

The released Makefile defaults to the matching image tag
(`ghcr.io/wichtigtuer/agent:v1.0.0`); overrides are passed on the
command line, e.g. `agent-wichtigtuer run NAME=x VERSION=main` or a different
registry entirely via `IMAGE=...`. `run` pulls the image before
starting so updates need no thought; skip the pull with
`agent-wichtigtuer run NAME=x SKIP_PULL=1` for offline use or faster repeat
runs.

## Prerequisites

- Docker
- A GitHub Personal Access Token (fine-grained `github_pat_...` or classic
  `ghp_...`) with permission to manage Git SSH keys
- `PI_AGENT_API_KEY` in your host environment (for the `pi` / `shell` targets)
- SSH keys mounted from `./secrets` into the container (see `make run`)

## Developing this repository

The following targets use the repo's own `makefile` (development workflow).
End users should install the distributed Makefile from a release instead.

## Install

Build the image (tags it `wichtigtuer-agent:latest`):

```sh
make build
# or a specific revision:
make build REVISION=v1.0.0
```

Equivalent without make:

```sh
docker build --no-cache --pull -t wichtigtuer-agent:latest -f Dockerfile.agent .
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
(`wichtigtuer-gh-config`, `wichtigtuer-pi-config`, `wichtigtuer-app-<name>`)
persist your gh/pi config and `/app` repositories across rebuilds.

## Use

Every container action takes a `NAME` (e.g. the repository name). It names
the container (`wichtigtuer-agent-<name>`) and its dedicated `/app` volume
(`wichtigtuer-app-<name>`), so containers started with different names run
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
  optionally clones a repository directly into `/app` as a regular checkout of
  the default branch.
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

## Releasing

Releases are cut by pushing a semantic version tag:

```sh
git tag v1.0.0
git push origin v1.0.0
```

Two workflows run for the tag:

1. `docker-publish.yml` builds and pushes the multi-arch image to GHCR,
   tagged `v1.0.0` (and `latest`).
2. `release.yml` substitutes the version into the files in `dist/`,
   generates `checksums.txt`, and creates a GitHub Release with the
   `Makefile`, `agent-wichtigtuer`, `install.sh`, and `checksums.txt` assets,
   then verifies the uploaded assets against the checksums.

This keeps the Makefile version and the Docker image version in lockstep.

### Release asset layout

```text
agent-v1.0.0/
├── Makefile
├── agent-wichtigtuer
├── install.sh
└── checksums.txt
```

The sources for the release assets live in `dist/` in this repository.
Edit them there — never a copy installed on a workstation.
