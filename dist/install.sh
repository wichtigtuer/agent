#!/usr/bin/env bash
# install.sh — install the agent container management tool from a GitHub Release.
#
# Installs:
#   ~/.config/agent/Makefile   centrally maintained, versioned Makefile
#   ~/.local/bin/agent-wichtigtuer    global wrapper (works from any project)
#
# Usage:
#   curl -fsSL https://github.com/wichtigtuer/agent/releases/download/v1.0.0/install.sh -o install.sh
#   less install.sh            # inspect before executing
#   bash install.sh
#
# For security, download this script first and inspect it rather than piping
# curl directly into bash. The downloaded Makefile and agent-wichtigtuer are
# verified against the release's checksums.txt before installation.
set -euo pipefail

# Substituted with the release tag (e.g. v1.0.0) at release time.
VERSION="@VERSION@"
BASE_URL="https://github.com/wichtigtuer/agent/releases/download/${VERSION}"

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/agent"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"

# Note: split the placeholder so the release-time sed does not substitute it here.
if [[ "$VERSION" == "@VERSI""ON@" ]]; then
	echo "error: this install.sh is a template — download a released copy:" >&2
	echo "  https://github.com/wichtigtuer/agent/releases" >&2
	exit 1
fi

mkdir -p "$CONFIG_DIR" "$BIN_DIR"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading agent $VERSION from $BASE_URL"
curl -fsSL "$BASE_URL/checksums.txt" -o "$tmp/checksums.txt"
curl -fsSL "$BASE_URL/Makefile" -o "$tmp/Makefile"
curl -fsSL "$BASE_URL/agent-wichtigtuer" -o "$tmp/agent-wichtigtuer"

echo "Verifying checksums"
(cd "$tmp" && sha256sum -c checksums.txt)

install -m 644 "$tmp/Makefile" "$CONFIG_DIR/Makefile"
install -m 755 "$tmp/agent-wichtigtuer" "$BIN_DIR/agent-wichtigtuer"

# Warn if the wrapper is not on the PATH (common for ~/.local/bin).
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
	echo
	echo "note: $BIN_DIR is not on your PATH — add it, e.g.:" >&2
	echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.profile" >&2
fi

echo
echo "Installed agent $VERSION:"
echo "  $CONFIG_DIR/Makefile"
echo "  $BIN_DIR/agent-wichtigtuer"
echo
echo "From any project:"
echo "  agent-wichtigtuer run NAME=myproject"
echo "  agent-wichtigtuer setup NAME=myproject"
echo "  agent-wichtigtuer pi NAME=myproject"
echo
echo "To update later, re-run this script from a newer release."
