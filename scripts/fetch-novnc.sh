#!/usr/bin/env bash
# Fetch the noVNC client into apps/web/vnc/ (pinned release).
#
# The vnc/ directory is gitignored and downloaded at build/deploy time to keep
# the repository small (see docs/ARCHITECTURE.md).
#
# Usage:  bash scripts/fetch-novnc.sh
set -euo pipefail

NOVNC_VERSION="${NOVNC_VERSION:-v1.7.0}"
WEB_DIR="$(cd "$(dirname "$0")/.." && pwd)/apps/web"
VNC_DIR="$WEB_DIR/vnc"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Fetching noVNC $NOVNC_VERSION -> $VNC_DIR"

curl -fsSL "https://github.com/novnc/noVNC/archive/refs/tags/${NOVNC_VERSION}.tar.gz" -o "$TMP_DIR/novnc.tar.gz"
tar -xzf "$TMP_DIR/novnc.tar.gz" -C "$TMP_DIR"

rm -rf "$VNC_DIR"
mkdir -p "$VNC_DIR"
# Copy only the runtime files vnc.html needs.
cp -r "$TMP_DIR/noVNC-${NOVNC_VERSION#v}/app"  "$VNC_DIR/"
cp -r "$TMP_DIR/noVNC-${NOVNC_VERSION#v}/core" "$VNC_DIR/"
cp -r "$TMP_DIR/noVNC-${NOVNC_VERSION#v}/vendor" "$VNC_DIR/"
cp "$TMP_DIR/noVNC-${NOVNC_VERSION#v}/vnc.html" "$VNC_DIR/"
cp "$TMP_DIR/noVNC-${NOVNC_VERSION#v}/vnc_lite.html" "$VNC_DIR/"

echo "Done. vnc.html -> $VNC_DIR/vnc.html"
