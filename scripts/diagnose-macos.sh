#!/usr/bin/env bash
set -euo pipefail

extension_id="${1:-}"
failed=0

pass() {
  printf '✅ %s\n' "$1"
  [[ "${2:-}" ]] && printf '   %s\n' "$2"
}

fail() {
  failed=$((failed + 1))
  printf '❌ %s\n' "$1"
  printf '   %s\n' "$2"
  printf '   下一步：%s\n' "$3"
}

warn() {
  printf '⚠️ %s\n' "$1"
  printf '   %s\n' "$2"
  printf '   建议：%s\n' "$3"
}

json_get() {
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const path=process.argv[2].split('.'); let v=data; for (const key of path) v=v?.[key]; if (Array.isArray(v)) console.log(v.join(', ')); else if (v != null) console.log(v);" "$1" "$2"
}

check_native_handshake() {
  local label="$1"
  local launcher_path="$2"
  if [[ -z "$launcher_path" || ! -x "$launcher_path" ]]; then
    return
  fi

  local output
  if output="$(
    node - "$launcher_path" <<'NODE'
const { spawnSync } = require("node:child_process");

function encodeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

const launcher = process.argv[2];
const result = spawnSync(launcher, {
  input: encodeNativeMessage({ type: "get-config" }),
  maxBuffer: 1024 * 1024,
  timeout: 5_000
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

const stdout = result.stdout || Buffer.alloc(0);
if (stdout.length < 4) {
  console.error(`No native response frame. stderr=${(result.stderr || "").toString("utf8").trim()}`);
  process.exit(1);
}

const length = stdout.readUInt32LE(0);
if (stdout.length < 4 + length) {
  console.error("Incomplete native response frame");
  process.exit(1);
}

const response = JSON.parse(stdout.subarray(4, 4 + length).toString("utf8"));
if (!response || response.ok !== true || !response.config) {
  console.error(JSON.stringify(response));
  process.exit(1);
}

console.log(JSON.stringify(response.config));
NODE
  )"; then
    pass "$label Native Messaging handshake" "$output"
  else
    fail "$label Native Messaging handshake" "launcher 未在 5 秒内返回有效 get-config 响应。" "检查 Node>=24、重新运行 install-native-host-macos.sh，并查看 ~/Library/Application Support/ObsidianWebClipperLocal/native-host.log。"
  fi
}

echo "移山安装诊断 / Yishan diagnostics"
echo "=================================="

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_path="$repo_root/package.json"
extension_manifest_path="$repo_root/extension/manifest.json"
config_path="$HOME/.obsidian-web-clipper-local/config.json"
chrome_manifest="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.local.obsidian_web_clipper.json"
edge_manifest="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.local.obsidian_web_clipper.json"

if command -v node >/dev/null 2>&1; then
  node_version="$(node --version)"
  node_major="${node_version#v}"
  node_major="${node_major%%.*}"
  if [[ "$node_major" -ge 24 ]]; then
    pass "Node" "$node_version at $(command -v node)"
  else
    fail "Node 版本" "当前 $node_version，package.json engines 要求 Node >=24。" "安装 Node.js 24 或更高版本。"
  fi
else
  fail "Node" "未找到 node 命令。" "安装 Node.js 24+，然后重新打开终端。"
fi

if [[ -f "$package_path" ]]; then
  pass "项目版本" "package.json version=$(json_get "$package_path" version), engines.node=$(json_get "$package_path" engines.node)"
else
  fail "项目文件" "未找到 $package_path。" "请在 yishan 仓库中运行本脚本。"
fi

if [[ -f "$extension_manifest_path" ]]; then
  pass "浏览器扩展 manifest" "name=$(json_get "$extension_manifest_path" name), version=$(json_get "$extension_manifest_path" version)"
else
  fail "浏览器扩展 manifest" "未找到 extension/manifest.json。" "确认仓库完整。"
fi

check_native_manifest() {
  local label="$1"
  local manifest_path="$2"
  if [[ ! -f "$manifest_path" ]]; then
    warn "$label manifest" "未找到 $manifest_path。" "如使用该浏览器，请运行 scripts/install-native-host-macos.sh --extension-id <扩展ID>。"
    return
  fi

  pass "$label Native Host manifest" "$manifest_path"
  local launcher_path
  launcher_path="$(json_get "$manifest_path" path || true)"
  if [[ -n "$launcher_path" && -x "$launcher_path" ]]; then
    pass "$label native-host launcher executable" "$launcher_path"
    check_native_handshake "$label" "$launcher_path"
  else
    fail "$label native-host launcher executable" "manifest path 不存在或不可执行：$launcher_path" "重跑 scripts/install-native-host-macos.sh。"
  fi

  local origins
  origins="$(json_get "$manifest_path" allowed_origins || true)"
  if [[ -z "$origins" ]]; then
    fail "$label allowed_origins" "manifest 缺少 allowed_origins。" "重跑 scripts/install-native-host-macos.sh。"
  elif [[ -n "$extension_id" && "$origins" != *"$extension_id"* ]]; then
    fail "$label allowed_origins" "当前 allowed_origins=$origins，未匹配传入 ExtensionId=$extension_id。" "用正确扩展 ID 重跑安装脚本。"
  else
    pass "$label allowed_origins" "$origins"
  fi
}

check_native_manifest "Chrome" "$chrome_manifest"
check_native_manifest "Microsoft Edge" "$edge_manifest"

if [[ -f "$config_path" ]]; then
  pass "config.json" "$config_path"
  vault_path="$(json_get "$config_path" vaultPath || true)"
  inbox_dir="$(json_get "$config_path" inboxDir || true)"
  attachments_dir="$(json_get "$config_path" attachmentsDir || true)"
  inbox_dir="${inbox_dir:-Inbox}"
  attachments_dir="${attachments_dir:-Inbox/attachments}"

  if [[ -n "$vault_path" && -d "$vault_path" ]]; then
    pass "vaultPath" "$vault_path"
    inbox_path="$vault_path/$inbox_dir"
    attachments_path="$vault_path/$attachments_dir"
    if mkdir -p "$inbox_path"; then
      pass "Inbox" "$inbox_path"
    else
      fail "Inbox" "无法创建 $inbox_path。" "检查 Vault 权限。"
    fi
    if mkdir -p "$attachments_path"; then
      pass "attachments" "$attachments_path"
    else
      fail "attachments" "无法创建 $attachments_path。" "检查 Vault 权限。"
    fi
    test_file="$inbox_path/.yishan-diagnose-test.md"
    if printf 'Test write from yishan diagnose %s\n' "$(date -Iseconds)" > "$test_file"; then
      rm -f "$test_file"
      pass "Test write" "可以写入并删除测试 Markdown。"
    else
      fail "Test write" "无法写入 $test_file。" "检查 Vault、Inbox、attachments 权限和路径。"
    fi
  else
    fail "vaultPath" "config.json 中 vaultPath 不存在或路径无效：$vault_path" "在插件选项页重新选择 Vault 并保存。"
  fi
else
  fail "config.json" "未找到 $config_path。" "打开插件选项页，填写 Vault 路径并保存。"
fi

if [[ "$failed" -eq 0 ]]; then
  echo
  echo "诊断结果：安装状态正常"
  exit 0
fi

echo
echo "诊断结果：发现 $failed 个问题，请按上方下一步建议处理。"
exit 1
