#!/bin/bash
set -e

# Install the globally available npm tools pinned in package.json.
# Dependabot updates package.json (and package-lock.json); this script is
# executed during the Docker build so the image always contains the pinned
# versions.
MANIFEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/package.json"

node -e '
const packages = require(process.argv[1]).dependencies;

for (const [name, version] of Object.entries(packages)) {
  console.log(`${name}@${version}`);
}
' "$MANIFEST" | while read -r package; do
  npm install -g "$package" --ignore-scripts
done
