param(
  [string]$ExtensionId = ""
)

$ErrorActionPreference = "Continue"
$script:Failed = 0

function Pass($Name, $Detail = "") {
  Write-Host "✅ $Name" -ForegroundColor Green
  if ($Detail) { Write-Host "   $Detail" }
}

function Fail($Name, $Detail, $NextStep) {
  $script:Failed += 1
  Write-Host "❌ $Name" -ForegroundColor Red
  Write-Host "   $Detail"
  Write-Host "   下一步：$NextStep"
}

function Warn($Name, $Detail, $NextStep) {
  Write-Host "⚠️ $Name" -ForegroundColor Yellow
  Write-Host "   $Detail"
  Write-Host "   建议：$NextStep"
}

function Test-JsonFile($Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try {
    return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  } catch {
    Fail "JSON 解析" "$Path 不是合法 JSON：$($_.Exception.Message)" "重新运行安装脚本或修正 JSON 文件。"
    return $null
  }
}

Write-Host "移山安装诊断 / Yishan diagnostics"
Write-Host "=================================="

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packagePath = Join-Path $repoRoot "package.json"
$manifestPath = Join-Path $env:LOCALAPPDATA "ObsidianWebClipperLocal\com.local.obsidian_web_clipper.json"
$configPath = Join-Path $HOME ".obsidian-web-clipper-local\config.json"

try {
  $node = Get-Command node -ErrorAction Stop
  $nodeVersion = (& $node.Source --version).Trim()
  $major = [int]($nodeVersion.TrimStart("v").Split(".")[0])
  if ($major -ge 24) {
    Pass "Node" "$nodeVersion at $($node.Source)"
  } else {
    Fail "Node 版本" "当前 $nodeVersion，package.json engines 要求 Node >=24。" "安装 Node.js 24 或更高版本。"
  }
} catch {
  Fail "Node" "未找到 node 命令。" "安装 Node.js 24+，然后重新打开终端。"
}

if (Test-Path -LiteralPath $packagePath) {
  $package = Test-JsonFile $packagePath
  if ($package) {
    Pass "项目版本" "package.json version=$($package.version), engines.node=$($package.engines.node)"
  }
} else {
  Fail "项目文件" "未找到 $packagePath。" "请在 yishan 仓库中运行本脚本。"
}

if (Test-Path -LiteralPath (Join-Path $repoRoot "extension\manifest.json")) {
  $extensionManifest = Test-JsonFile (Join-Path $repoRoot "extension\manifest.json")
  if ($extensionManifest) {
    Pass "浏览器扩展 manifest" "name=$($extensionManifest.name), version=$($extensionManifest.version)"
  }
} else {
  Fail "浏览器扩展 manifest" "未找到 extension\manifest.json。" "确认仓库完整。"
}

$nativeManifest = Test-JsonFile $manifestPath
if ($nativeManifest) {
  Pass "Native Host manifest" $manifestPath
  if ($nativeManifest.allowed_origins -and $nativeManifest.allowed_origins.Count -gt 0) {
    $origins = $nativeManifest.allowed_origins -join ", "
    if ($ExtensionId -and $origins -notmatch [regex]::Escape($ExtensionId)) {
      Fail "allowed_origins" "manifest 中为 $origins，未匹配传入 ExtensionId=$ExtensionId。" "用正确扩展 ID 重跑 scripts\install-native-host.ps1。"
    } else {
      Pass "allowed_origins" $origins
    }
  } else {
    Fail "allowed_origins" "manifest 缺少 allowed_origins。" "重跑 scripts\install-native-host.ps1。"
  }

  if ($nativeManifest.path -and (Test-Path -LiteralPath $nativeManifest.path)) {
    Pass "Native Host launcher executable" $nativeManifest.path
  } else {
    Fail "Native Host launcher executable" "manifest path 不存在：$($nativeManifest.path)" "重跑 scripts\install-native-host.ps1。"
  }
} else {
  Fail "Native Host manifest" "未找到 $manifestPath。" "运行 powershell -ExecutionPolicy Bypass -File scripts\install-native-host.ps1 -ExtensionId <扩展ID>。"
}

foreach ($browser in @(
  @{ Name = "Chrome NativeMessagingHosts"; Path = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.local.obsidian_web_clipper" },
  @{ Name = "Edge NativeMessagingHosts"; Path = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.local.obsidian_web_clipper" }
)) {
  try {
    $value = (Get-Item -LiteralPath $browser.Path -ErrorAction Stop).GetValue("")
    if ($value -eq $manifestPath) {
      Pass $browser.Name $value
    } else {
      Warn $browser.Name "注册表值为 $value，期望 $manifestPath。" "重跑安装脚本刷新注册表。"
    }
  } catch {
    Warn $browser.Name "未找到注册表项。" "如使用该浏览器，请重跑安装脚本。"
  }
}

$config = Test-JsonFile $configPath
if ($config) {
  Pass "config.json" $configPath
  if ($config.vaultPath -and (Test-Path -LiteralPath $config.vaultPath)) {
    Pass "vaultPath" $config.vaultPath
    $inboxDir = if ($config.inboxDir) { $config.inboxDir } else { "Inbox" }
    $attachmentsDir = if ($config.attachmentsDir) { $config.attachmentsDir } else { "Inbox\attachments" }
    $inboxPath = Join-Path $config.vaultPath $inboxDir
    $attachmentsPath = Join-Path $config.vaultPath $attachmentsDir
    try {
      New-Item -ItemType Directory -Force -Path $inboxPath | Out-Null
      Pass "Inbox" $inboxPath
      New-Item -ItemType Directory -Force -Path $attachmentsPath | Out-Null
      Pass "attachments" $attachmentsPath
      $testPath = Join-Path $inboxPath ".yishan-diagnose-test.md"
      "Test write from yishan diagnose $(Get-Date -Format o)" | Set-Content -LiteralPath $testPath -Encoding UTF8
      Remove-Item -LiteralPath $testPath -Force
      Pass "Test write" "可以写入并删除测试 Markdown。"
    } catch {
      Fail "Test write" $_.Exception.Message "检查 Vault、Inbox、attachments 权限和路径。"
    }
  } else {
    Fail "vaultPath" "config.json 中 vaultPath 不存在或路径无效：$($config.vaultPath)" "在插件选项页重新选择 Vault 并保存。"
  }
} else {
  Fail "config.json" "未找到 $configPath。" "打开插件选项页，填写 Vault 路径并保存。"
}

if ($script:Failed -eq 0) {
  Write-Host ""
  Write-Host "诊断结果：安装状态正常" -ForegroundColor Green
  exit 0
}

Write-Host ""
Write-Host "诊断结果：发现 $script:Failed 个问题，请按上方下一步建议处理。" -ForegroundColor Red
exit 1
