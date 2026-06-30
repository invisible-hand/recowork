FROM node:20-alpine AS base

# Alpine = musl libc, matches the libc the Claude Code native binary is
# linked against. The SDK's Bash tool requires a POSIX shell (bash) on PATH
# and a handful of standard userland utilities. node:20-alpine ships busybox
# but no bash, so we install the minimum here. Keep this list deliberately
# small — anything we add is something the agent can invoke at runtime.
RUN apk add --no-cache \
    bash \
    coreutils \
    ca-certificates \
    git

# node:20-alpine ships a non-root `node` user at uid 1000. Reuse it.
WORKDIR /opt/recowork
COPY agent-core/package.json /opt/recowork/package.json
# Install runtime deps. The SDK's platform-specific optional dep
# (@anthropic-ai/claude-agent-sdk-linux-arm64) ships a musl-linked binary,
# which is why this base image must be Alpine.
RUN npm install --omit=dev --omit=peer && npm cache clean --force

COPY agent-core/dist/sidecar.mjs /opt/recowork/sidecar.mjs
RUN chown -R node:node /opt/recowork

# The agent operates against a bind-mounted workspace.
RUN mkdir -p /workspace && chown node:node /workspace
WORKDIR /workspace

USER node

ENV NODE_ENV=production \
    NODE_NO_WARNINGS=1 \
    NO_PROXY=localhost,127.0.0.1

ENTRYPOINT ["node", "/opt/recowork/sidecar.mjs"]
