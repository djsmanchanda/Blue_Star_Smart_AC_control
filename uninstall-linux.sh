#!/usr/bin/env bash
set -euo pipefail

plugin_id="djsmanchanda.blue-star-ac"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/ac-control"
plugin_dir="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/plugins/$plugin_id"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
bin_path="${XDG_BIN_HOME:-$HOME/.local/bin}/ac"

systemctl --user disable --now ac-control.service 2>/dev/null || true
rm -f "$unit_dir/ac-control.service" "$bin_path"
rm -rf "$data_dir" "$plugin_dir"
systemctl --user daemon-reload

echo "Removed the Blue Star AC service, CLI, and Omarchy plugin."
echo "Your ~/.config/ac-control configuration and credentials were preserved."
