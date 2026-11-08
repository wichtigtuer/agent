REVISION ?= latest
NAME ?=

IMAGE_AGENT := wichtigtuer-agent:$(REVISION)
CONTAINER_AGENT := wichtigtuer-agent-$(NAME)

# Every container action requires NAME (e.g. the repository name). It names
# the container and its dedicated /app volume, so containers started with
# different names run in parallel: each gets an isolated /app, while gh
# config, pi config and the SSH keys stay shared across all of them.
NAME_REQUIRED_TARGETS := $(filter-out help,$(MAKECMDGOALS))
ifneq ($(NAME_REQUIRED_TARGETS),)
ifeq ($(strip $(NAME)),)
$(error NAME is required, e.g. `make run NAME=myrepo` — it names the container and its dedicated /app volume)
endif
endif

DOCKER_RUN_ARGS := \
	-dit \
	--rm \
	-e AGENT_NAME=$(NAME) \
	-v wichtigtuer-gh-config:/home/node/.config \
	-v wichtigtuer-pi-config:/home/node/.pi \
	-v wichtigtuer-app-$(NAME):/app \
	-v "$$(pwd)/secrets:/home/node/.ssh" \
	--name $(CONTAINER_AGENT)

DOCKER_EXEC_ARGS := \
	-it \
	-e TERM=xterm-256color

.PHONY: help run setup pi shell stop

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | \
	awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

run: ## Start named agent container: make run NAME=<repo> (no host code mounted; provision inside via setup-agent)
	docker run \
		$(DOCKER_RUN_ARGS) \
		$(IMAGE_AGENT) \
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
