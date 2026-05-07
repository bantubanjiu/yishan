#!/usr/bin/env bash
set -euo pipefail

snapshot=0
extension_id=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --extension-id)
      extension_id="${2:-}"
      shift 2
      ;;
    --snapshot)
      snapshot=1
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: scripts/install-native-host-macos.sh --extension-id <Chrome extension ID> [--snapshot]

Registers the native messaging host for the current macOS user.
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$extension_id" ]]; then
  echo "Missing required --extension-id <Chrome extension ID>" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_host_dir="$repo_root/src/host"
node_path="$(command -v node)"
manifest_root="$HOME/Library/Application Support/ObsidianWebClipperLocal"
host_install_dir="$manifest_root/host"
active_host_dir="$repo_host_dir"
launcher_path="$manifest_root/native-host"
manifest_name="com.local.obsidian_web_clipper.json"

mkdir -p "$manifest_root"

if [[ "$snapshot" -eq 1 ]]; then
  rm -rf "$host_install_dir"
  mkdir -p "$host_install_dir"
  cp -R "$repo_host_dir/." "$host_install_dir/"
  active_host_dir="$host_install_dir"
fi

cat > "$launcher_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "$node_path" "$active_host_dir/index.ts"
EOF
chmod 755 "$launcher_path"

write_manifest() {
  local manifest_dir="$1"
  mkdir -p "$manifest_dir"
  cat > "$manifest_dir/$manifest_name" <<EOF
{
  "name": "com.local.obsidian_web_clipper",
  "description": "Obsidian Web Clipper Local Native Host",
  "path": "$launcher_path",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$extension_id/"]
}
EOF
}

write_manifest "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
write_manifest "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"

echo "Native host installed for Chrome and Edge:"
echo "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$manifest_name"
echo "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/$manifest_name"
