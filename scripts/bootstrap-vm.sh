#!/usr/bin/env bash
# bootstrap-vm.sh — prepare a fresh Ubuntu 22.04 VM for SalesAutomation.
#
# Tested on AWS Lightsail $12 plan (2 vCPU, 2 GB RAM, 60 GB SSD, Mumbai).
# Should also work on any vanilla Ubuntu 22.04 host with sudo + internet.
#
# Run as the `ubuntu` user (NOT root). The script is idempotent — safe to re-run.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/sisodiass/WhatsApp_Automation/main/scripts/bootstrap-vm.sh | bash
#   # or after cloning the repo:
#   bash scripts/bootstrap-vm.sh

set -euo pipefail

# Suppress Ubuntu 22.04's interactive "which services to restart" dialog
# that slips past DEBIAN_FRONTEND=noninteractive.
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1
export DEBIAN_FRONTEND=noninteractive

step() { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }

step "1/7  System update"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

step "2/7  Install system packages + Chromium runtime libs"
# Add PostgreSQL's official APT repo so we can get postgresql-client-16
# (Ubuntu 22.04 'jammy' default repos only ship up to pg14).
if [[ ! -f /etc/apt/sources.list.d/pgdg.list ]]; then
  sudo apt-get install -y curl ca-certificates gnupg lsb-release
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
  echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  sudo apt-get update -y
fi

sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential curl git \
  postgresql-client-16 redis-tools \
  nginx certbot python3-certbot-nginx \
  ufw \
  libnss3 libnspr4 libatk-bridge2.0-0 libatk1.0-0 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
  libgbm1 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libasound2 \
  libcups2 libxss1 libxshmfence1 libgtk-3-0 \
  libxext6 libxfixes3 libxrender1 libdbus-1-3 \
  fonts-liberation

step "3/7  Install Docker (for Postgres + Redis containers)"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get install -y docker.io docker-compose-v2
  sudo usermod -aG docker "$USER"
  echo "  (you'll need to log out + back in for the 'docker' group to apply)"
fi
sudo systemctl enable --now docker

step "4/7  Configure 2 GB swap (mandatory on 2 GB RAM box)"
if [[ ! -f /swapfile ]]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
# Tune: keep swap as a backstop, not first-choice memory.
sudo sysctl -w vm.swappiness=10 >/dev/null
sudo sysctl -w vm.vfs_cache_pressure=50 >/dev/null
grep -qxF 'vm.swappiness=10' /etc/sysctl.conf || \
  echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf >/dev/null
grep -qxF 'vm.vfs_cache_pressure=50' /etc/sysctl.conf || \
  echo 'vm.vfs_cache_pressure=50' | sudo tee -a /etc/sysctl.conf >/dev/null

step "5/7  Install nvm + Node.js 20 LTS"
if [[ ! -d "$HOME/.nvm" ]]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
fi
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 20 >/dev/null
nvm alias default 20 >/dev/null

step "6/7  Install PM2 + logrotate"
npm install -g pm2 >/dev/null
pm2 install pm2-logrotate >/dev/null 2>&1 || true
pm2 set pm2-logrotate:max_size 50M >/dev/null
pm2 set pm2-logrotate:retain 30 >/dev/null
pm2 set pm2-logrotate:compress true >/dev/null

step "7/7  UFW firewall (defense in depth — Lightsail FW is primary)"
sudo ufw --force reset >/dev/null
sudo ufw default deny incoming >/dev/null
sudo ufw default allow outgoing >/dev/null
sudo ufw allow 22/tcp >/dev/null
sudo ufw allow 80/tcp >/dev/null
sudo ufw allow 443/tcp >/dev/null
sudo ufw --force enable >/dev/null

printf "\n\033[1;32m==> Bootstrap complete\033[0m\n"
echo   "Node:    $(node --version)"
echo   "npm:     $(npm --version)"
echo   "PM2:     $(pm2 --version)"
echo   "Docker:  $(docker --version | awk '{print $3}' | tr -d ,)"
echo
echo "Memory:"
free -h | awk 'NR==1 || NR==2 || NR==3'
echo
echo "Next:"
echo "  1. log out + back in (so the docker group applies)"
echo "  2. clone the repo to /opt/sa and continue with SETUP.md §5 onward"
echo "  3. point Cloudflare DNS (gray cloud) at this VM, then certbot"
