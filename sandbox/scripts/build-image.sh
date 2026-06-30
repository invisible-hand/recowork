#!/usr/bin/env bash
# Build the Recowork sandbox image using Apple's native container framework.
#
# Requires `container` (apple/container) to be installed and running:
#   brew install container && container system start
#
# The Dockerfile lives in sandbox/ but the build context is the repo root so
# we can COPY the agent-core dist + package.json from there.

set -euo pipefail

cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"
IMAGE_NAME="${RECOWORK_IMAGE:-recowork-agent:latest}"

echo "▸ building ${IMAGE_NAME} from ${REPO_ROOT}"

if ! command -v container >/dev/null 2>&1; then
  echo "  ERROR: \`container\` CLI not found. Install with: brew install container"
  exit 1
fi

if ! container system status 2>/dev/null | grep -q running; then
  echo "  container system not running — starting it now"
  container system start --enable-kernel-install
fi

# ALWAYS rebuild the sidecar bundle before baking it into the image. Skipping
# this when the file exists was a real bug: edits to agent-core/src/ never
# made it into the running container until the user manually deleted the
# bundle and re-ran. Cheap to rebuild (~1s) so just do it.
echo "▸ rebuilding sidecar bundle"
(cd desktop && node scripts/build-sidecar.mjs)

container build \
  -f sandbox/Dockerfile \
  -t "${IMAGE_NAME}" \
  --dns 8.8.8.8 \
  --dns 1.1.1.1 \
  "${REPO_ROOT}"

echo "▸ image ${IMAGE_NAME} built."
container image inspect "${IMAGE_NAME}" 2>&1 | head -20 || true
