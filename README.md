<div align="center">
  <img src="extension/icons/icon128.png" alt="移山 icon" width="96" height="96">

# 移山 · Yishan

**把网页里的灵感，右键静默搬进 Obsidian。**

Windows/macOS + Chrome/Edge 本地网页采集器：保存 URL、选中文本、图片、框选截图和当前窗口多标签到 Obsidian 当天 Inbox 日记。

[![Version](https://img.shields.io/badge/version-0.2.3-2563eb)](./版本记录README.md)
[![Platform](https://img.shields.io/badge/platform-Windows%20%2F%20macOS-0078d4)](#系统要求)
[![Browser](https://img.shields.io/badge/browser-Chrome%20%2F%20Edge-22c55e)](#快速安装)
[![Runtime](https://img.shields.io/badge/runtime-Node.js%20%3E%3D%2024-339933)](./package.json)
[![License](https://img.shields.io/badge/license-MIT-111827)](./LICENSE)

</div>

---

## 项目简介

移山是一个本地优先的轻量 Web Clipper：不走云端服务，不弹复杂表单，浏览器扩展通过 Native Messaging 调用本机 Node Host，直接把采集结果追加到 Obsidian Vault 的当天 Inbox Markdown。

适合高频收集：网页链接、选中文本、网页图片、局部截图，以及当前窗口多个普通标签页。保存条目保持稳定格式：

```markdown
- HH:mm [页面标题](页面URL)
```

时间和日记文件名按本机本地时间计算。

## 功能清单

| 能力 | 说明 |
| --- | --- |
| 保存页面 URL | 页面空白处右键、Popup 或快捷键，一键追加当前页面标题和链接。 |
| 保存选中文本 | 选中文本后右键保存；也可启用长按 Alt/Ctrl/Shift/Meta 后拖选自动保存。 |
| 代码块识别 | 优先读取网页代码块语言，并自动识别 JSON/HTML/CSS/JS/TS/Python/Shell/Markdown，失败回退 `text`。 |
| 保存图片 | 图片右键保存；Native Host 校验图片类型、10 秒超时、20MB 上限，失败时仍写入 Markdown 失败原因。 |
| 框选截图 | 右键、Popup 或快捷键触发后拖拽选择可见区域，裁剪为 PNG 附件。 |
| 多标签快速保存 | Popup 或快捷键保存当前窗口全部普通 `http/https/file` 标签页，跳过浏览器内部页。 |
| 拖选生命周期同步 | 启用拖选保存后，扩展会在标签切换、页面刷新、窗口重新聚焦后同步注入状态。 |
| 本地阅读器支持 | 支持保存 `file://` 本地页面/文本链接；Chrome PDF 阅读器可保存文件链接，选区能力受浏览器限制。 |
| Popup 设置 | 配置 Vault、Inbox、附件目录、拖选触发键和是否启用拖选自动保存。 |
| 本地静默写入 | Chrome/Edge 扩展通过 Native Messaging 调用本地 Node Host 写入 Vault。 |
| 请求安全校验 | Host 端统一校验请求 schema，非法请求返回 `{ ok:false, error:"..." }`。 |
| 追加保护 | 写入前处理空行和未闭合代码块，降低破坏当天日记的概率。 |
| 安装诊断 | Windows/macOS 诊断脚本检查 Node、manifest、allowed_origins、config、Vault 和写入权限。 |

## 系统要求

- Windows 10/11 或 macOS（当前用户安装）。
- Chrome 或 Microsoft Edge，Manifest V3 扩展。
- Node.js `>= 24`。
- 一个本地 Obsidian Vault。
- Windows 使用 PowerShell 注册 Native Host；macOS 使用 bash + osascript。

## 快速安装

### 1. 克隆仓库

```powershell
git clone https://github.com/bantubanjiu/yishan.git
cd yishan
```

### 2. 配置 Obsidian Vault

Windows：

```powershell
node .\src\host\configure.ts "D:\path\to\Vault" Inbox Inbox\attachments
```

macOS：

```bash
node ./src/host/configure.ts "$HOME/Obsidian/Vault" Inbox Inbox/attachments
```

默认配置文件位置：

```text
%USERPROFILE%\.obsidian-web-clipper-local\config.json
$HOME/.obsidian-web-clipper-local/config.json
```

### 3. 加载浏览器扩展

1. 打开 Chrome/Edge 扩展管理页。
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库的 `extension/` 目录。
5. 复制扩展 ID。
6. 如需保存 `file://` 本地文件或本地阅读器页面，在扩展详情页开启“允许访问文件网址”。

### 4. 注册 Native Host

Windows：

```powershell
.\scripts\install-native-host.ps1 -ExtensionId "<扩展ID>"
```

macOS：

```bash
bash ./scripts/install-native-host-macos.sh --extension-id "<扩展ID>"
```

默认安装为**源代码联动模式**：浏览器启动 Native Host 时会直接运行当前仓库的 `src/host/handle-json-file.ts`。更新仓库代码后，只要仓库路径不变，Native Host 会自动使用最新 Host 逻辑。

如果想让 Native Host 脱离仓库、固定使用安装当时快照：

```powershell
.\scripts\install-native-host.ps1 -ExtensionId "<扩展ID>" -Snapshot
```

```bash
bash ./scripts/install-native-host-macos.sh --extension-id "<扩展ID>" --snapshot
```

移动仓库目录、换 Node.js 路径，或重装扩展导致扩展 ID 改变后，需要重新执行注册脚本。

## 配置说明

本地配置文件字段：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `vaultPath` | 无 | Obsidian Vault 根目录，必须存在。 |
| `inboxDir` | `Inbox` | 日记 Markdown 写入目录，必须位于 Vault 内。 |
| `attachmentsDir` | `Inbox/attachments` | 图片/截图附件目录，必须位于 Vault 内。 |
| `selectionModifier` | `Alt` | 拖选自动保存触发键，可选 `Alt`/`Ctrl`/`Shift`/`Meta`。 |
| `selectionGestureEnabled` | `false` | 是否启用长按触发键后拖选自动保存。 |

## 使用方式

- 左键点击插件图标：打开 Popup，可保存当前页、保存当前窗口全部普通标签页、框选截图、修改路径和选区触发键。
- 页面空白处右键：保存当前页面 URL。
- 选中文本右键：保存选中文本和来源链接，并插入自动适配语言的代码块。
- 长按 Alt 后拖选文本：需先在 Popup/选项页启用；显示蓝色高亮框，松开鼠标后自动保存选区；触发键可改为 Ctrl/Shift/Meta。
- 图片上右键：下载图片并保存来源；非图片响应、超时或超过 20MB 会记录失败原因，不阻断正文保存。
- 页面右键或快捷键 `Alt+Shift+X`：框选截图并保存。
- 快捷键 `Alt+Shift+S`：保存当前窗口全部普通 `http/https/file` 标签。快捷键可在 `chrome://extensions/shortcuts` 中自定义。
- 修改 Vault 路径时点击“选择文件夹”，Native Host 会弹出系统文件夹选择器。

## 常见问题

### 为什么保存标题必须是 `- HH:mm [标题](URL)`？

这是当前稳定格式，便于当天 Inbox 按时间顺序追加。v0.2.1 起已恢复该格式，并用本机本地时间生成 `HH:mm` 和 `YYYY-MM-DD.md`。

### 拖选自动保存为什么在某些页面不可用？

扩展只能在普通 `http/https/file` 页面注入脚本。`chrome://`、`edge://`、`about:`、商店页面等浏览器内部页会被跳过，避免报错。

### 图片保存失败会丢掉这条记录吗？

不会。Host 会继续写入 Markdown，并在条目里记录 `图片下载失败：...`。常见原因包括 `图片下载超时`、`图片体积超过 20MB`、`响应不是图片内容`、`HTTP xxx` 或 `Invalid data URL`。

### 可以迁移仓库目录吗？

可以，但源代码联动模式下 Native Host manifest 指向当前仓库路径。移动后请重新运行对应安装脚本。

## 故障诊断

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/diagnose.ps1
```

macOS：

```bash
bash ./scripts/diagnose-macos.sh
```

也可以传入扩展 ID 辅助检查 `allowed_origins`：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/diagnose.ps1 -ExtensionId "<扩展ID>"
```

```bash
bash ./scripts/diagnose-macos.sh "<扩展ID>"
```

诊断脚本会检查 Node、项目版本、浏览器扩展 manifest、Native Messaging manifest、allowed_origins、Native Host launcher、config.json、vaultPath、Inbox、attachments 和测试写入权限，并给出 ✅/❌ 与下一步建议。

## 开发说明

项目结构：

```text
.
├─ extension/                 # Chrome/Edge 扩展
│  ├─ background.js            # 右键菜单、Popup 消息、快捷键、批量采集、截图、Native Messaging
│  ├─ popup.html/css/js        # 插件左键 Popup UI
│  ├─ options.html/css/js      # 设置页
│  ├─ screenshot-crop.js       # 截图选区坐标归一化
│  └─ icons/                   # 扩展图标
├─ scripts/
│  ├─ install-native-host.ps1        # Windows 注册 Chrome/Edge Native Host
│  ├─ install-native-host-macos.sh   # macOS 注册 Chrome/Edge Native Host
│  ├─ diagnose.ps1                  # Windows 安装诊断
│  └─ diagnose-macos.sh             # macOS 安装诊断
├─ src/host/                   # Node Native Host
│  ├─ index.ts                 # Native Messaging stdin/stdout 入口
│  ├─ native-protocol.ts       # 4 字节长度头协议编解码
│  ├─ host-request.ts          # 请求 schema 校验与分发
│  ├─ config.ts                # 本地配置读写
│  ├─ markdown.ts              # Markdown 格式化
│  └─ vault-writer.ts          # Vault 写入、附件处理、图片安全边界
├─ tests/                      # 无子进程派生的测试入口和用例
├─ README.md
└─ 版本记录README.md
```

验证命令：

```powershell
npm test
npm run check
```

等价命令：

```powershell
node tests\run-tests.mjs
node --check extension\background.js
```

GitHub Actions 会在 Windows/macOS + Node 24.x 上执行 `npm test` 和 `npm run check`。

## Roadmap

- [ ] 拆分 `extension/background.js` 为更小的功能模块。
- [ ] 拆分 Host 端下载、渲染、诊断等模块。
- [ ] 批量保存改为单次 Native Message 请求，减少 Native Host 启动次数。
- [ ] 增加一键打开当天 Inbox、附件目录、Vault 根目录和配置文件的入口。
- [ ] 增加可选的 Markdown 富文本保存模式。
- [ ] 支持更多截图模式，例如当前视口整页截图、长截图。
- [ ] 改进 Chrome PDF 阅读器的正文文本抽取能力。
- [ ] 打包 release zip 和升级脚本。

## Changelog

- 当前版本：`0.2.3`
- 详细更新历史见 [`版本记录README.md`](./版本记录README.md)。

## License

MIT License。详见 [`LICENSE`](./LICENSE)。
