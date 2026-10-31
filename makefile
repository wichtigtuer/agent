REVISION ?= latest
IMAGE_AGENT := penfold-agent:$(REVISION)
CONTAINER_AGENT := penfold-agent

DOCKER_RUN_ARGS := \
	-dit \
	--rm \
	-v penfold-gh-config:/home/node/.config \
	-v penfold-pi-config:/home/node/.pi \
	-v penfold-worktrees:/app \
	-v "$$(pwd)/secrets:/home/node/.ssh" \
	--name $(CONTAINER_AGENT)

DOCKER_EXEC_ARGS := \
	-it \
	-e TERM=xterm-256color

.PHONY: help build run setup pi shell stop

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | \
	awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

build: ## Build agent Docker image (bakes in the setup-agent script)
	docker build \
		--no-cache \
		--pull \
		-t $(IMAGE_AGENT) \
		-f Dockerfile .

run: ## Start agent container (no host code mounted; provision inside via setup-agent)
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
