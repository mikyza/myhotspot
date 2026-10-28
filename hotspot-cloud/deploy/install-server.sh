#!/bin/bash
# Installs Hotspot Cloud + the ngrok tunnel as services on Ubuntu/Debian.   sudo bash deploy/install-server.sh
set -e
[ "$(id -u)" = "0" ] || { echo "Run with sudo"; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"; D=/opt/hotspot-cloud
command -v node >/dev/null || { echo "Install Node.js 18+ first:  sudo apt install -y nodejs npm"; exit 1; }
mkdir -p $D && cp -r "$SRC"/server.js "$SRC"/lib "$SRC"/public "$SRC"/package.json $D/
[ -f $D/.env ] || { cp "$SRC/.env" $D/.env 2>/dev/null || cp "$SRC/.env.example" $D/.env; echo ">> Edit $D/.env now (passwords, MongoDB, PayHero), then: systemctl restart hotspot-cloud"; }
chmod 600 $D/.env; (cd $D && npm install --omit=dev)
cat > /etc/systemd/system/hotspot-cloud.service <<UNIT
[Unit]
Description=Hotspot Cloud website
After=network-online.target
[Service]
WorkingDirectory=$D
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
if command -v ngrok >/dev/null; then
cat > /etc/systemd/system/hotspot-cloud-ngrok.service <<UNIT
[Unit]
Description=ngrok tunnel for Hotspot Cloud
After=network-online.target hotspot-cloud.service
[Service]
# If your ngrok is older, replace --url= with --domain=
ExecStart=$(command -v ngrok) http --url=linwood-feudalistic-lorenzo.ngrok-free.dev 3000
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
else echo ">> ngrok not found. Install it, run:  ngrok config add-authtoken <token>  then re-run this script."; fi
systemctl daemon-reload; systemctl enable --now hotspot-cloud
systemctl enable --now hotspot-cloud-ngrok 2>/dev/null || true
sleep 2; systemctl --no-pager --lines=3 status hotspot-cloud || true
echo; echo "Website: https://linwood-feudalistic-lorenzo.ngrok-free.dev   Logs: journalctl -u hotspot-cloud -f"
