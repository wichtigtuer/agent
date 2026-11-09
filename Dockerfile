# Use the official Node.js LTS runtime
FROM node:lts-slim

LABEL org.opencontainers.image.source="https://github.com/wichtigtuer/agent"

# Install global tools (if really needed)
RUN apt-get update && apt-get install -y git curl jq wget vim fd-find ripgrep tmux && rm -rf /var/lib/apt/lists/*

RUN mkdir -p -m 755 /etc/apt/keyrings \
	&& out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
	&& cat $out | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
	&& chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
	&& mkdir -p -m 755 /etc/apt/sources.list.d \
	&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
	&& apt update \
	&& apt install gh -y

# Install global npm tools — including pnpm — pinned in package.json
# (managed by Dependabot, see scripts/install-npm-tools.ts), and set up
# pnpm's global bin dir
ENV PNPM_HOME="/pnpm"
ENV PATH="/pnpm:$PATH"
COPY package.json scripts/install-npm-tools.ts /opt/npm-tools/
RUN node --experimental-strip-types /opt/npm-tools/install-npm-tools.ts

# Set working directory
WORKDIR /app

# Install Playwright system dependencies and browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /ms-playwright
RUN pnpm dlx playwright install --with-deps
RUN chown -R node:node /ms-playwright

RUN chown -R node:node /app

# Make the node user own its home directory
RUN mkdir -p /home/node/.config /home/node/.pi && \
    chown -R node:node /home/node

# Bake the GitHub agent setup script into the image and expose it on PATH as
# `setup-agent`, ready to run by anyone who enters the container
RUN mkdir -p /opt/wichtigtuer
WORKDIR /opt/wichtigtuer
RUN pnpm init && pnpm add @clack/prompts@$(node -p "require('/opt/npm-tools/package.json').dependencies['@clack/prompts']")
COPY scripts/setup-github-agent.ts /opt/wichtigtuer/setup-github-agent.ts
RUN printf '#!/bin/sh\nexec node --experimental-strip-types /opt/wichtigtuer/setup-github-agent.ts "$@"\n' > /usr/local/bin/setup-agent \
	&& chmod +x /usr/local/bin/setup-agent \
	&& chown -R node:node /opt/wichtigtuer

WORKDIR /app

# Bake agent skills into the node user's home directory
COPY .agents/skills /home/node/.agents/skills
RUN chown -R node:node /home/node/.agents

USER node

ENV PATH="/home/node/.local/bin:${PATH}"

# Idle by default; the agent environment is provisioned via `setup-agent`
CMD ["bash"]
