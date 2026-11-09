# Agent — container management Makefile
#
# Distributed as a versioned GitHub Release asset:
#   https://github.com/wichtigtuer/agent/releases
#
# This file is independent of the repository it is invoked from. Install it
# once (see install.sh / agent-wichtigtuer in the same release) and use it from any
# project. Do not edit copies of this file in consuming repositories —
# improvements are maintained centrally in wichtigtuer/agent.

# Configuration
# VERSION is substituted with the release tag (e.g. v1.0.0) at release time;
# override on the command line to use a different image tag (e.g. main).
VERSION ?= @VERSION@
IMAGE   ?= ghcr.io/wichtigtuer/agent:$(VERSION)
# FOLDER is the invoking directory's folder name (e.g. the repo name). All
# containers started from the same folder share it — and therefore share the
# gh-config / pi-config volumes.
FOLDER  := $(notdir $(CURDIR))

# NAME distinguishes containers started from the same folder (each gets its
# own /app volume). Defaults to `main`; override with `make run NAME=feature-x`
# to run additional isolated containers for the same folder.
NAME    ?= main

CONTAINER_AGENT := agent-$(FOLDER)-$(NAME)

# Volumes: gh/pi config are shared per FOLDER (every container started from
# the same directory uses the same ones), /app is isolated per FOLDER+NAME,
# and the container name is unique per FOLDER+NAME. SSH keys are mounted from
# the invoking directory's ./secrets (create it and place your keys there).
DOCKER_RUN_ARGS := \
	-dit \
	--rm \
	-e AGENT_NAME=$(FOLDER)-$(NAME) \
	-v agent-gh-config-$(FOLDER):/home/node/.config \
	-v agent-pi-config-$(FOLDER):/home/node/.pi \
	-v agent-app-$(FOLDER)-$(NAME):/app \
	-v "$(CURDIR)/secrets:/home/node/.ssh" \
	--name $(CONTAINER_AGENT)

DOCKER_EXEC_ARGS := \
	-it \
	-e TERM=xterm-256color

# FOLDER (current directory name) scopes the shared config volumes; NAME
# (default: main) names the container and its dedicated /app volume, so
# containers started with different names from the same folder run in
# parallel: each gets an isolated /app, while gh config, pi config and the
# SSH keys stay shared across all of them.

# Skip the image pull on run (offline use, faster repeat runs):
#   make run SKIP_PULL=1
SKIP_PULL ?=

.PHONY: help pull run setup pi shell stop

help: ## Show available commands
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | \
	awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

pull: ## Pull the agent image
	docker pull $(IMAGE)

run: ## Start agent container for this folder (NAME=<instance> to run extra containers; SKIP_PULL=1 skips the pull)
ifeq ($(strip $(SKIP_PULL)),)
	docker pull $(IMAGE)
endif
	docker run \
		$(DOCKER_RUN_ARGS) \
		$(IMAGE) \
		bash

setup: ## Run the baked-in GitHub agent setup script inside the container
	docker exec $(DOCKER_EXEC_ARGS) $(CONTAINER_AGENT) setup-agent

pi: ## Run pi inside agent container
	docker exec $(DOCKER_EXEC_ARGS) $(CONTAINER_AGENT) \
		env PI_AGENT_API_KEY="$$PI_AGENT_API_KEY" tmux new-session -s pi-main-session 'pi'

shell: ## Open bash shell inside agent container
	docker exec $(DOCKER_EXEC_ARGS) $(CONTAINER_AGENT) \
		env PI_AGENT_API_KEY="$$PI_AGENT_API_KEY" bash

stop: ## Stop agent container
	docker stop $(CONTAINER_AGENT)
