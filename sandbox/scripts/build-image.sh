#!/usr/bin/env bash
# Build the Recowork sandbox image.
#
# Assumes OrbStack (or another docker-compatible daemon) is running. The
# Dockerfile lives in sandbox/ but the build context is the repo root so we
# can COPY the agent-core dist + package.json from there.

set -euo pipefail

cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"
IMAGE_NAME="${RECOWORK_IMAGE:-recowork-agent:latest}"

echo "▸ building ${IMAGE_NAME} from ${REPO_ROOT}"

# Ensure the sidecar bundle exists before building — docker COPY would fail
# silently with a confusing error otherwise.
if [ ! -f "${REPO_ROOT}/agent-core/dist/sidecar.mjs" ]; then
  echo "  agent-core/dist/sidecar.mjs missing — running sidecar build first"
  (cd desktop && node scripts/build-sidecar.mjs)
fi

docker build \
  -f sandbox/Dockerfile \
  -t "${IMAGE_NAME}" \
  "${REPO_ROOT}"

echo "▸ image ${IMAGE_NAME} built."
docker image inspect "${IMAGE_NAME}" --format '  digest: {{.Id}}{{"\n"}}  size:   {{.Size}} bytes'
