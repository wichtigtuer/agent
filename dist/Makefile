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
NAME    ?=

CONTAINER_AGENT := agent-$(NAME)

# Volumes: gh/pi config are shared across all agents, /app and the container
# itself are isolated per NAME. SSH keys are mounted from the invoking
# directory's ./secrets (create it and place your keys there).
DOCKER_RUN_ARGS := \
	-dit \
	--rm \
	-e AGENT_NAME=$(NAME) \
	-v agent-gh-config:/home/node/.config \
	-v agent-pi-config:/home/node/.pi \
	-v agent-app-$(NAME):/app \
	-v "$(CURDIR)/secrets:/home/node/.ssh" \
	--name $(CONTAINER_AGENT)

DOCKER_EXEC_ARGS := \
	-it \
	-e TERM=xterm-256color

# Every container action requires NAME (e.g. the repository name). It names
# the container and its dedicated /app volume, so containers started with
# different names run in parallel: each gets an isolated /app, while gh
# config, pi config and the SSH keys stay shared across all of them.

# Skip the image pull on run (offline use, faster repeat runs):
#   make run NAME=myrepo SKIP_PULL=1
SKIP_PULL ?=

NAME_REQUIRED_TARGETS := $(filter-out help pull,$(MAKECMDGOALS))
ifneq ($(NAME_REQUIRED_TARGETS),)
ifeq ($(strip $(NAME)),)
$(error NAME is required, e.g. `make run NAME=myrepo` — it names the container and its dedicated /app volume)
endif
endif

.PHONY: help pull run setup pi shell stop

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | \
	awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

pull: ## Pull the agent image
	docker pull $(IMAGE)

run: ## Start named agent container: make run NAME=<repo> (auto-pulls the image; SKIP_PULL=1 skips the pull)
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
