#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install_dir="${XDG_DATA_HOME:-$HOME/.local/share}/ac-control"
plugin_id="djsmanchanda.blue-star-ac"
plugin_dir="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/plugins/$plugin_id"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

mkdir -p "$install_dir" "$plugin_dir" "$unit_dir"
mkdir -p "${XDG_BIN_HOME:-$HOME/.local/bin}"
rsync -a \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='android/.gradle/' \
  --exclude='android/**/build/' \
  "$repo_dir"/ "$install_dir"/
(cd "$install_dir" && npm install --omit=dev)
cp -a "$repo_dir/omarchy"/. "$plugin_dir"/
sed "s|%h/.local/share/ac-control|$install_dir|g" "$repo_dir/systemd/ac-control.service" > "$unit_dir/ac-control.service"

if [[ ! -f "$install_dir/config.json" ]]; then
  mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/ac-control"
  cp "$repo_dir/config.example.json" "${XDG_CONFIG_HOME:-$HOME/.config}/ac-control/config.json"
fi

mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/ac-control"
ln -sfn "$install_dir/cli.js" "${XDG_BIN_HOME:-$HOME/.local/bin}/ac"
chmod +x "$install_dir/cli.js"
systemctl --user daemon-reload
systemctl --user enable --now ac-control.service
command -v omarchy-shell >/dev/null 2>&1 && omarchy-shell shell rescanPlugins >/dev/null || true
echo "Installed Blue Star AC CLI, service, and Omarchy plugin."
echo "Add $plugin_id to the right/center layout in ~/.config/omarchy/shell.json."
