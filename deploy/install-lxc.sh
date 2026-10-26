#!/usr/bin/env bash
# Install Duplo Track Planner in a Debian 12/13 or Ubuntu LXC container (no Docker needed).
# Run as root inside the container, from the unpacked project folder:
#   bash deploy/install-lxc.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "Installing Node.js from the distribution packages..."
  apt-get update
  apt-get install -y nodejs
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "Node.js 18 or newer is needed; this distribution ships $(node -v). Use Debian 12+ or Ubuntu 24.04+." >&2
  exit 1
fi

id duplo >/dev/null 2>&1 || useradd --system --home /var/lib/duplo-track-planner --shell /usr/sbin/nologin duplo
install -d -o duplo -g duplo /var/lib/duplo-track-planner
install -d /opt/duplo-track-planner
cp -r server.js package.json public /opt/duplo-track-planner/
cp deploy/duplo-track-planner.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now duplo-track-planner
sleep 1
systemctl --no-pager --lines=3 status duplo-track-planner || true
IP=$(hostname -I | awk '{print $1}')
echo
echo "Duplo Track Planner is running: http://${IP}:8080"
echo "Saved data lives in /var/lib/duplo-track-planner (include it in your Proxmox backups)."
