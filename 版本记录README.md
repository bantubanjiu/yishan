# 版本记录 README

本文档用于记录“移山”项目每个版本更新了什么、为什么这样做，以及核心实现方式。后续每次发布或重要改动后，都建议在这里追加一条记录。

## 追溯依据与版本命名说明

当前目录未检测到 Git 仓库，因此历史版本不是从 Git tag / commit 自动生成的，而是根据以下线索人工还原：

- `.omx/logs/turns-2026-04-29.jsonl`
- `.omx/logs/turns-2026-04-30.jsonl`
- 文件创建/修改时间
- 当前代码快照
- `package.json` 与 `extension/manifest.json` 中的版本号

说明：

- `v0.2.5` 是当前代码中可见的正式版本号。
- `H0.x` 是为了方便回看而整理的“历史迭代记录”，不是正式发布 tag。
- 历史时间按当前工作区显示的本地时间（Asia/Shanghai）整理；日志原始时间为 UTC。
- 涉及个人本机路径的配置只记录能力和行为，不在版本记录中展开具体私有路径。

## 记录模板

```markdown
## vX.Y.Z - YYYY-MM-DD

### 更新内容
- 用户可感知的新功能、修复或体验变化。

### 实现方式
- 关键技术路径。
- 涉及的主要文件。
- 重要设计取舍。

### 验证方式
- 执行过的测试、检查或手工验证。

### 已知限制
- 暂未解决的问题、环境限制或后续计划。
```

---

## 当前正式版本

## v0.2.5 - 2026-05-07

### 更新内容
- 保存页面改为页面剪藏：右键保存当前页面时提取正文 Markdown、尽量本地化页面图片，并生成单独 Markdown 文档，不再写入当天 Inbox 日记。
- 快捷键默认改为 `Ctrl+Shift+S` 保存当前窗口标签、`Ctrl+Shift+X` 框选截图，降低与输入法/系统快捷键冲突的概率；Popup 和设置页会显示快捷键是否未绑定或被占用。
- 启用长按拖选保存后，普通 `http/https` 页面通过内容脚本在浏览器重启后自动请求同步，不再依赖先打开 Popup 才生效；为此扩展重新声明普通 `http/https` 页面访问权限。
- 右键菜单中“框选截图保存到 Obsidian”移动到“保存当前页面剪藏到 Obsidian”上方。
- 除页面剪藏外，URL、文字、富 Markdown、图片和截图改为同日同 URL 聚合：当天 Inbox 内只保留一个 `## [页面标题](页面URL)`，每次材料以 `### HH:mm 类型` 追加在该链接下。
- 选中文本继续保存为安全 fenced code block；富 Markdown 摘录以“富文本摘录”时间标题写入。
- 图片和截图只写入 Obsidian 附件嵌入或下载失败原因，不再追加原始图片来源 URL，并跟随来源网页分组。
- README 同步更新页面剪藏、保存格式、图片保存行为和当前版本说明。

### 实现方式
- `extension/page-clip.js` 注入页面侧提取逻辑，优先读取 `article/main/[role=main]`，移除脚本、导航、表单等噪声，并把常见 DOM 转成 Markdown。
- `extension/manifest.json` 增加 `gesture-content-script.js` 内容脚本、普通 `http/https` host permissions，并更新 Commands 默认键位；`extension/background.js` 新增 `sync-selection-gesture` runtime message，让页面加载后主动同步拖选启用状态。
- `extension/popup.js`、`options.js` 使用 `chrome.commands.getAll()` 展示快捷键绑定状态，空快捷键会提示未绑定或被占用并引导打开快捷键设置。
- `extension/context-menu.js` 调整右键菜单创建顺序，并把 `save-url` 改为发送 `page` 剪藏请求。
- `src/host/request-schema.ts`、`types.ts`、`vault-writer.ts` 支持 `page` 请求；页面图片复用安全下载边界写入附件，再替换为 Obsidian 本地嵌入。
- `src/host/markdown.ts` 输出网页分组标题和按类型命名的时间子标题；`src/host/vault-writer.ts` 在写入当天 Inbox 时查找同 URL 分组并追加到分组尾部。
- 移除 image 条目中的 `来源图片：...` 输出；附件下载、失败兜底和图片安全校验保持不变。
- `tests/run-tests.mjs` 更新格式断言，并增加页面剪藏单独文档、图片本地化、右键菜单顺序、图片条目不包含来源 URL，以及同日同 URL 下 URL/文字/富文本/截图/图片统一聚合的回归断言。
- `package.json` 与 `extension/manifest.json` 版本同步为 `0.2.5`。

### 验证方式
- `npm test`
- `npm run check`
- `npm run release:zip`

### 已知限制
- 页面剪藏使用内置 DOM 转 Markdown 启发式，不新增 Readability/Turndown 依赖；复杂网页可能需要后续继续优化正文抽取质量。
- 本次只调整新写入条目的格式，不迁移或重写既有日记内容。
- 同一链接自动合并/去重仍由后续整理或 Obsidian 侧处理，本轮不改变轻量条目的追加写入模型。
- 已安装用户的既有快捷键可能不会被 Chrome 自动改写；如仍为空或冲突，需要在 `chrome://extensions/shortcuts` 手动重新绑定。`file://` 页面仍需开启“允许访问文件网址”。
---

## v0.2.4 - 2026-05-07

### 更新内容
- 完成优化计划中剩余的 P1/P2 主体事项：扩展端和 Host 端拆分为更小模块，降低后续 Codex/vibe coding 修改风险。
- “保存当前窗口”改为单次 `batch-save-tabs` Native Message，请求一次传递所有普通标签页，并返回 `saved`、`failed`、`failures`。
- Popup 新增打开今天 Inbox、附件目录、Vault 根目录、配置文件的入口，并增加当前视口截图和 PDF 链接保存按钮。
- 选中文本保存新增 `selectionSaveMode`：默认安全纯文本，可切换富 Markdown；富 Markdown 提取失败时回退纯文本。
- 新增 `npm run release:zip` 本地打包脚本；GitHub Actions 增加 Node 26.x 矩阵。
- README 增加“最新更新”摘要，让 GitHub 首页能直接看到本轮优化结果。

### 实现方式
- `extension/background.js` 保留服务工作线程入口和事件注册，功能逻辑拆到 `context-menu.js`、`commands.js`、`native-client.js`、`screenshot.js`、`selection-markdown.js`、`gesture.js`、`batch-save.js`、`config-client.js` 等模块。
- `src/host/host-request.ts` 专注请求分发，请求白名单校验移动到 `request-schema.ts`，图片下载移动到 `image-downloader.ts`，日期/附件名移动到 `filename.ts`，通用错误工具移动到 `errors.ts`。
- `batch-save-tabs` 在 Host 端逐条写入并收集失败明细，单条失败不阻断后续标签写入。
- `open-path` 只允许固定目标枚举，不接受任意路径；路径不存在或越界时返回明确错误。
- `scripts/build-release.mjs` 生成 `dist/yishan-release.zip`，`dist/` 已加入 `.gitignore`。

### 验证方式
- `npm.cmd test`
- `npm.cmd run check`
- `node --check` 覆盖扩展、Host 和 release 脚本模块
- `npm.cmd run release:zip`

### 已知限制
- 本轮未做滚动长截图拼接。
- 本轮未做 PDF 正文文本提取，只实现 PDF 链接保存。
- 未在真实 Chrome/Edge UI 中手动加载扩展验收。

---

## v0.2.3 - 2026-05-07

### 更新内容
- 修复拖选自动保存的注入生命周期：标签切换、页面刷新、窗口重新聚焦后会重新同步启用/停用状态。
- Native Host 增加统一请求 schema 校验，非法 URL、时间戳、图片地址或配置会返回 `{ ok:false, error:"..." }`，空标题回退 `Untitled`，未知字段不进入业务逻辑。
- 图片下载增加 10 秒超时、20MB 体积上限和 `image/*` 类型校验；失败时仍追加 Markdown，并记录明确原因。
- 新增 Windows/macOS 安装诊断脚本，检查 Node、manifest、allowed_origins、config、Vault、Inbox、attachments 和测试写入权限。
- 补充 MIT License、GitHub Actions CI，并清理 README 的安装、诊断、FAQ、Roadmap 和 Changelog 说明。

### 实现方式
- `extension/background.js` 增加 `tabs.onActivated`、`tabs.onUpdated`、`windows.onFocusChanged` 监听，并只对 `http/https/file` 页面同步拖选脚本。
- `src/host/host-request.ts` 对 `url`、`selection`、`image`、`get-config`、`set-config`、`pick-folder` 请求手写白名单校验和字段净化。
- `src/host/vault-writer.ts` 使用 `AbortController` 控制远程图片超时，校验 `Content-Type`、`Content-Length` 和实际字节长度；`data:image/*` 同样校验解码大小。
- 新增 `scripts/diagnose.ps1`、`scripts/diagnose-macos.sh`、`.github/workflows/ci.yml`、`LICENSE`。
- `package.json` 与 `extension/manifest.json` 版本同步为 `0.2.3`。

### 验证方式
- `npm test`
- `npm run check`

### 已知限制
- 批量保存当前仍是扩展端逐个发送 Native Message；后续计划改为单次请求。
- `background.js` 仍未拆分模块，本次只做稳定性修复，避免计划外重构风险。

---

## v0.2.2 - 2026-05-07

### 更新内容
- 增加 macOS Native Host 注册脚本，支持当前用户 Chrome 和 Microsoft Edge。
- Popup/选项页“选择文件夹”在 macOS 下使用系统 `osascript` 文件夹选择器，Windows 继续使用 PowerShell/.NET 选择器。
- README 补充 macOS 配置、注册和 snapshot 安装命令。

### 实现方式
- 新增 `scripts/install-native-host-macos.sh`，在 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts` 和 `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts` 写入 manifest。
- `src/host/host-request.ts` 新增平台分发：`win32` 调用 PowerShell，`darwin` 调用 AppleScript，其它平台返回明确错误。
- `tests/run-tests.mjs` 增加 macOS folder picker 和安装脚本注册路径检查。

### 验证方式
- `npm run check`

---

## v0.2.1 - 2026-05-07

### 更新内容
- 恢复保存条目标题格式为 `- HH:mm [页面标题](页面URL)`，不再把来源写成 `## [标题](URL)` + `来源：URL` 分组。
- 保存时间和当天日记文件名改为按本机本地时间计算，避免 UTC 时间导致小时和日期偏移。
- 保留 0.2.0 的并发写入文件锁、Popup、快捷键、拖选开关和权限收敛等修复。

### 实现方式
- `src/host/markdown.ts` 使用本机 `Date#getHours()` / `getMinutes()` 格式化条目时间。
- `src/host/vault-writer.ts` 恢复逐条追加 `formatCaptureEntry(...)`，日期和附件文件名改用本机本地年月日时分秒。
- `tests/run-tests.mjs`、`tests/markdown.test.ts`、`tests/vault-writer.test.ts` 增加逐条标题格式和本机时间回归用例。

### 验证方式
- `npm run check`
- `git diff --check`
- `node --test tests/markdown.test.ts tests/vault-writer.test.ts`

---

## v0.2.0 - 2026-05-06

### 更新内容
- 插件图标左键改为打开 Popup，新 UI 支持保存当前页、保存当前窗口全部普通标签、框选截图、修改保存路径和修改选区触发键。
- 新增当前窗口多标签快速保存，默认保存 `http/https/file` 普通标签并跳过浏览器内部页。
- 新增快捷键：`Alt+Shift+S` 保存当前窗口标签，`Alt+Shift+X` 进入框选截图；用户可在 Chrome 快捷键设置中自定义。
- 新增长按 Alt 后拖选文本自动保存；默认为关闭，可在 Popup/选项页启用，触发键可改为 Ctrl/Shift/Meta。
- 支持 `file://` 本地页面/阅读器链接保存；Chrome PDF 阅读器先保存文件链接，正文选区抽取仍受浏览器限制。
- URL、文本、图片和截图恢复为逐条追加的 `- HH:mm [标题](URL)` 格式，时间和日记日期按本机本地时间计算。
- 修改 Vault 路径时可通过 Native Host 弹出系统文件夹选择器，不必手动输入完整路径。

### 实现方式
- `extension/manifest.json` 增加 `action.default_popup` 和 `commands`，不再声明全站 `host_permissions`。
- `extension/background.js` 增加 Popup runtime message 分发、当前窗口批量保存、快捷键处理和按需启用的 Alt 拖选内容脚本动态注入。
- 新增 `extension/popup.html/css/js`，并同步升级 `options.html/css/js` 的路径选择、选区触发键和拖选自动保存开关配置。
- `src/host/config.ts` 为旧配置补默认 `selectionModifier: "Alt"` 和 `selectionGestureEnabled: false`。
- `src/host/host-request.ts` 增加 `pick-folder` 请求，Windows 下通过 PowerShell/.NET FolderBrowserDialog 选择目录。
- `src/host/vault-writer.ts` 和 `src/host/markdown.ts` 保持逐条来源链接追加，并用文件锁保护同一天并发写入。
- `tests/run-tests.mjs` 增加逐条来源链接、本机时间、并发写入、旧配置默认值、文件夹选择请求、manifest/popup/快捷键集成检查。

### 验证方式
- `node --check extension\background.js`
- `node --check extension\popup.js`
- `node --check extension\options.js`
- `node tests\run-tests.mjs`
- `npm.cmd run check`
- `node --test tests\markdown.test.ts tests\vault-writer.test.ts`（需在允许子进程派生的环境中执行）

### 已知限制
- 保存 `file://` 页面需要用户在浏览器扩展详情页开启“允许访问文件网址”；扩展不再请求全站 host permission。
- Chrome PDF 阅读器正文文本抽取能力有限，当前版本优先保证保存 PDF 文件链接。
- 快捷键实际冲突/重绑定由 Chrome 的 `chrome://extensions/shortcuts` 管理。

## v0.1.2 - 2026-05-06

### 更新内容
- Native Host 安装方式改为默认“源代码联动模式”。
- 以后更新仓库里的 Host 代码后，只要仓库路径不变，浏览器启动 Native Host 时会直接使用当前仓库最新 `src/host` 逻辑，避免安装目录里的旧拷贝滞后。
- 保留 `-Snapshot` 可选模式：需要脱离仓库固定运行安装时快照时，可以显式复制 Host 文件到 `%LOCALAPPDATA%\ObsidianWebClipperLocal\host`。

### 实现方式
- `scripts/install-native-host.ps1` 新增 `-Snapshot` switch。
- 默认安装时：
  - launcher 仍放在 `%LOCALAPPDATA%\ObsidianWebClipperLocal\native-host.exe`。
  - launcher 内部执行的脚本路径从安装目录改为当前仓库的 `src\host\handle-json-file.ts`。
  - 不再无条件 `Copy-Item` Host 源码到安装目录。
- 显式使用 `-Snapshot` 时才复制 `src\host` 到安装目录，并让 launcher 指向安装目录快照。
- `tests/run-tests.mjs` 增加安装脚本行为检查，防止以后误改回无条件复制模式。

### 验证方式
- `node tests\run-tests.mjs`
- `node --check extension\background.js`
- `npm.cmd run check`
- 重新执行安装脚本并检查生成的 launcher 源码，确认指向 `D:\乱七八糟\vibe\src\host\handle-json-file.ts`。

### 已知限制
- 源代码联动模式依赖仓库路径稳定；如果移动仓库目录，需要重新执行安装脚本。
- 如果换了 Node.js 安装路径或扩展 ID，也需要重新执行安装脚本。

## v0.1.1 - 2026-05-06

### 更新内容
- 保存选中文本时仍然直接插入 fenced code block，但代码块语言不再固定为 `text`。
- 选中网页代码区域时，优先使用页面上的 `language-*`、`lang-*`、`data-language`、`data-lang` 等语言提示。
- 页面没有提供语言提示时，Native Host 会根据文本内容自动识别 JSON、HTML、CSS、JavaScript、TypeScript、Python、Shell、Markdown 等常见格式。
- 识别失败时回退为 `text`，继续保证摘录内容不会破坏 Obsidian 日记结构。

### 实现方式
- `extension/background.js` 在构造 selection 消息时新增 `codeLanguage` 字段：
  - 普通选区会从克隆出的 `<pre>` / `<code>` / 带语言 class 或 data 属性的节点里提取语言。
  - 输入框、textarea、contenteditable 会沿当前选区所在页面节点向上查找语言提示。
- `src/host/types.ts` 为 selection 类型增加可选 `codeLanguage`。
- `src/host/markdown.ts` 在生成代码块时：
  - 先规范化浏览器传入的语言别名，例如 `javascript` -> `js`、`typescript` -> `ts`、`py` -> `python`。
  - 再用轻量启发式识别常见文本格式。
  - 保留更长 fence 逻辑，选中文本内包含反引号时仍能安全保存。
- `tests/markdown.test.ts` 和 `tests/run-tests.mjs` 增加显式语言、JSON 自动识别、HTML/Python 自动识别、普通文本回退测试。

### 验证方式
- `node --check extension\background.js`
- `node --check src\host\markdown.ts`
- `node tests\run-tests.mjs`

### 已知限制
- 自动识别是启发式判断，不等同于完整语法解析；不确定时会优先回退 `text`，避免误伤普通摘录。
- 浏览器侧只能读取页面 DOM 中已经暴露的语言标记；如果网站没有提供相关 class/data 属性，会交给 Native Host 推断。

## v0.1.0 - 2026-04-30

### 更新内容
- 提供 Windows + Chrome/Edge 本地网页采集 MVP。
- 支持通过浏览器右键菜单保存：
  - 当前页面 URL。
  - 选中文本。
  - 页面图片。
  - 可见页面内的框选截图。
- 默认把采集内容追加到 Obsidian Vault 内的 `Inbox/YYYY-MM-DD.md`。
- 图片和截图会保存为附件，并在当天日记里嵌入 Obsidian wiki 链接。
- 选中文本按代码块格式插入，避免复制内容里的 Markdown 符号破坏日记结构。
- 提供扩展选项页，可读取/保存 Vault 路径、Inbox 目录和附件目录。
- 提供 Native Host 安装脚本，自动注册 Chrome 和 Edge 的 Native Messaging Host。
- 提供项目内测试入口，规避当前环境里 `node --test` 的 `spawn EPERM` 问题。

### 实现方式

#### 1. 浏览器扩展层
主要文件：
- `extension/manifest.json`
- `extension/background.js`
- `extension/options.html`
- `extension/options.css`
- `extension/options.js`
- `extension/screenshot-crop.js`

实现要点：
- 使用 Manifest V3 service worker 作为后台脚本。
- 通过 `chrome.contextMenus` 注册 4 个右键菜单：保存 URL、保存选中文本、保存图片、框选截图。
- 右键触发后由 `background.js` 统一组装采集消息，再通过 `chrome.runtime.sendNativeMessage` 发送给本地 Native Host。
- 选中文本菜单同时支持普通网页选区和输入态/可编辑区域：`selection`、`editable`。
- 扩展层保留了 DOM 选区转 Markdown 的辅助逻辑，后续如需恢复富格式可复用；当前主写入行为由 Native Host 按纯文本代码块保存。
- 框选截图通过页面注入脚本显示遮罩，记录拖拽起止点；再调用 `chrome.tabs.captureVisibleTab` 获取可见区域截图，并用 canvas 按设备像素比裁剪为 PNG data URL。
- 截图框选交互为：选区外灰色遮罩、选中区域完全透明、白色边框、Esc 取消。
- `extension/screenshot-crop.js` 独立封装截图选区归一化，便于测试边界坐标和高 DPI 场景。
- 选项页通过 Native Messaging 读取/写入本地配置，不直接访问文件系统。

#### 2. Native Host 层
主要文件：
- `src/host/index.ts`
- `src/host/native-protocol.ts`
- `src/host/host-request.ts`
- `src/host/config.ts`
- `src/host/vault-writer.ts`
- `src/host/markdown.ts`
- `src/host/types.ts`

实现要点：
- `index.ts` 从标准输入读取 Chrome Native Messaging 数据帧，处理后把响应重新编码写回标准输出。
- `native-protocol.ts` 实现 Native Messaging 协议所需的 4 字节小端长度头和 JSON payload 编解码。
- `host-request.ts` 统一分发三类请求：
  - `get-config`：读取配置。
  - `set-config`：保存配置。
  - `url` / `selection` / `image`：写入 Obsidian。
- `config.ts` 把配置保存在 `%USERPROFILE%\.obsidian-web-clipper-local\config.json`，并校验 `vaultPath`、`inboxDir`、`attachmentsDir` 都是非空字符串。
- `vault-writer.ts` 负责把采集内容写入 Vault：
  - 校验采集消息必填字段。
  - 防止 Inbox 和附件目录逃逸到 Vault 外部。
  - 自动创建 Inbox 和附件目录。
  - 根据 `capturedAt` 生成当天 Markdown 文件名。
  - 图片支持普通 URL 和 data URL；附件名使用时间戳 + 图片 URL/时间哈希，降低重名概率。
  - 如果图片下载失败，仍然写入当天日记，并记录失败原因，避免一次图片失败导致整条采集丢失。
  - 追加内容前会检查已有 Markdown 是否缺少空行或存在未闭合代码块，尽量避免破坏后续日记格式。
- `markdown.ts` 负责把不同采集类型格式化为 Obsidian 友好的 Markdown 条目：
  - URL：一条来源链接。
  - selection：来源链接 + `text` 代码块。
  - image：来源链接 + 附件嵌入；截图 data URL 不再把 base64 原文写入日记。

#### 3. 安装与注册层
主要文件：
- `scripts/install-native-host.ps1`

实现要点：
- 根据用户传入的扩展 ID 生成 Native Messaging manifest。
- 在当前用户 HKCU 下注册 Chrome 和 Edge 的 Native Host。
- 让浏览器扩展可以通过固定 host name `com.local.obsidian_web_clipper` 调用本地 Node 脚本。

#### 4. 测试与验证层
主要文件：
- `tests/run-tests.mjs`
- `tests/protocol.test.mjs`
- `tests/markdown.test.ts`
- `tests/vault-writer.test.ts`

实现要点：
- 使用项目自带 `tests/run-tests.mjs` 执行测试，避免依赖当前环境不可用的 `node --test` 子进程派生能力。
- 覆盖 Native Messaging 帧编解码、Markdown 格式化、Vault 写入、附件命名、截图选区归一化等关键逻辑。
- `package.json` 提供：
  - `npm test`：运行项目测试。
  - `npm run check`：先检查 `extension/background.js` 语法，再运行测试。

### 验证方式
- 项目提供的推荐验证命令：

```powershell
node tests\run-tests.mjs
node --check extension\background.js
```

或：

```powershell
npm run check
```

### 已知限制
- 当前记录基于现有代码快照整理；当前目录未检测到 Git 仓库，因此无法从提交历史还原更早的精确 diff。
- 采集日期和时间按本机本地时区从 `capturedAt` 格式化；跨时区同步设备时，不同设备本地时区可能导致日记日期不同。
- 框选截图只截取当前可见页面区域，不支持自动滚动长截图。
- 图片下载依赖 Native Host 的网络访问；如果目标站点防盗链、鉴权或网络失败，会在日记中记录失败原因。
- Native Host 安装脚本面向 Windows + 当前用户 HKCU；其他系统或全局安装方式暂未覆盖。

---

## 历史迭代摘要

| 记录 | 本地时间 | 主题 | 结果 |
| --- | --- | --- | --- |
| H0.1 | 2026-04-29 14:30-14:47 | 需求确认与 MVP 落地 | 确定“浏览器扩展 + Native Host”路线，并实现 URL/文本/图片静默保存 |
| H0.2 | 2026-04-29 14:49-15:15 | 本机配置与 Native Host 注册 | 支持配置 Vault，并完成 Chrome/Edge Native Host 注册验证 |
| H0.3 | 2026-04-29 15:34 | Markdown 文本与截图初版 | 增加选区 Markdown 尝试转换和截图保存能力 |
| H0.4 | 2026-04-29 15:41 | 手动框选截图 | 从“直接全截图”改为拖拽选择截图范围 |
| H0.5 | 2026-04-29 15:44 | 截图写入格式修复 | 截图只写附件嵌入，不再把 data URL/base64 长串写入日记 |
| H0.6 | 2026-04-29 15:56 | 通知、遮罩、设置页 | 修复通知图标错误，截图遮罩改灰色，新增设置页 |
| H0.7 | 2026-04-29 15:59-16:15 | 文本保存与追加稳定性 | 改善选区文本可靠性、输入态右键、未闭合代码块追加安全 |
| H0.8 | 2026-04-29 16:13-17:24 | 截图视觉修复 | 修复截图变色、边框改白色、选中区域完全透明 |
| H0.9 | 2026-04-29 16:58 | 品牌与图标 | 插件命名为“移山”，更换像素风图标 |
| H0.10 | 2026-04-30 14:03 | 文本代码块写入 | 保存选中文本改为代码块格式，包含 fence 自适应测试 |
| v0.1.1 | 2026-05-06 | 自动代码块语言 | 保存选中文本时自动适配代码块语言，继续安全插入 fenced code block |
| v0.1.2 | 2026-05-06 | Native Host 源码联动 | 默认让 Native Host 直接运行当前仓库 Host 源码，避免安装目录旧拷贝滞后 |
| v0.2.0 | 2026-05-06 | 快捷采集主线升级 | Popup、多标签保存、快捷键、Alt 拖选、逐条来源链接、本机时间与文件夹选择 |
| v0.2.1 | 2026-05-07 | 标题格式与本机时间修复 | 恢复 `- HH:mm [标题](URL)` 保存格式，并按本机时间写入 |
| v0.2.2 | 2026-05-07 | macOS 兼容 | 增加 macOS Native Host 注册脚本和 osascript 文件夹选择器 |

---

## 历史迭代明细

## H0.1 - 2026-04-29 14:30-14:47 - 需求确认与 MVP 落地

### 更新内容
- 明确产品方向：做一个本地工具，把网页/应用里看到的有价值内容、链接、图片快速同步到 Obsidian。
- 确定第一阶段范围：优先做网页采集，而不是全局桌面级采集。
- 选择“浏览器扩展 + Node Native Host”方案。
- 实现第一版 MVP：
  - 右键保存当前页面 URL。
  - 右键保存选中文本。
  - 右键保存图片。
  - 静默写入 Obsidian 当天 Inbox 日记。

### 实现方式
- 浏览器扩展负责采集入口和用户动作。
- Native Host 负责本地文件写入，避免浏览器扩展直接访问本地文件系统。
- 通过 Chrome Native Messaging 在扩展和本地 Node 进程之间传输 JSON 消息。
- 建立基础目录结构：
  - `extension/`
  - `src/host/`
  - `scripts/`
  - `tests/`
- 关键文件包括：
  - `extension/manifest.json`
  - `extension/background.js`
  - `src/host/index.ts`
  - `src/host/native-protocol.ts`
  - `src/host/vault-writer.ts`
  - `tests/run-tests.mjs`

### 验证方式
- 创建 Native Messaging 协议测试。
- 创建 Vault 写入和 Markdown 格式化测试。
- 使用项目自带测试入口执行基础验证。

### 设计取舍
- 暂不做完整桌面悬浮窗/全局快捷键，先从浏览器右键菜单切入，降低权限和系统兼容复杂度。
- 选择静默保存，减少每次采集时的弹窗确认。

## H0.2 - 2026-04-29 14:49-15:15 - 本机配置与 Native Host 注册

### 更新内容
- 增加本机 Vault 路径配置能力。
- 完成扩展 ID 对应的 Native Host 注册。
- 支持 Chrome 和 Edge 两个浏览器读取同一个 Native Host 配置。

### 实现方式
- 通过 `src/host/config.ts` 读写 `%USERPROFILE%\.obsidian-web-clipper-local\config.json`。
- 通过 `src/host/configure.ts` 提供命令行配置入口。
- 通过 `scripts/install-native-host.ps1`：
  - 生成 Native Host manifest。
  - 写入当前用户 HKCU 注册表项。
  - 同时覆盖 Chrome 与 Edge 的 Native Messaging Host 注册位置。

### 验证方式
- 配置读取/写入 smoke 验证。
- Native Host manifest 与注册表路径验证。
- 使用用户提供的扩展 ID 完成安装验证。

### 设计取舍
- 配置文件放在用户主目录应用配置目录，避免写入项目目录或浏览器扩展目录。
- 注册使用当前用户 HKCU，避免要求管理员权限。

## H0.3 - 2026-04-29 15:34 - Markdown 文本与截图初版

### 更新内容
- 尝试让选中文本以 Markdown 格式保存。
- 新增截图保存能力。
- 支持标题、段落、粗体、斜体、代码、链接、图片、列表、引用、代码块等常见 DOM 结构的 Markdown 转换。

### 实现方式
- `extension/background.js` 注入脚本读取当前选区 DOM。
- 将 DOM 节点递归转换为 Markdown 字符串。
- 截图初版使用浏览器截图能力获取可见页面图像。
- 采集消息中开始出现 selection 的 `markdown` 字段和 image 类型截图 data URL。

### 验证方式
- 通过语法检查和项目测试验证基础逻辑。
- 通过实际右键菜单验证保存入口。

### 后续变化
- 后来发现复杂网页（例如社交媒体站点）中 DOM 结构不一定能保留用户想要的复制格式；最终版本把选中文本改成代码块保存，DOM Markdown 逻辑保留为可复用能力。

## H0.4 - 2026-04-29 15:41 - 手动框选截图

### 更新内容
- 截图从“直接截取可见页面”改成“手动拖拽选择截图区域”。
- 页面出现截图遮罩后，用户可以自己决定截图范围。
- 支持 Esc 取消截图。

### 实现方式
- `extension/background.js` 注入 `selectScreenshotArea` 页面脚本。
- 页面脚本创建覆盖全屏的 overlay、选区 box、操作提示 label。
- 监听 pointer down/move/up 记录起点和终点。
- 使用 `normalizeSelectionRect` 将 CSS 坐标转换为 bitmap 坐标。
- 使用 canvas 裁剪 `captureVisibleTab` 得到的整张可见截图。

### 验证方式
- 增加/保留截图选区归一化测试。
- 手动验证拖拽选择区域、松开保存、Esc 取消。

## H0.5 - 2026-04-29 15:44 - 截图写入格式修复

### 更新内容
- 修复截图保存后 Markdown 后面跟着一大串 `data:image/png;base64,...` 的问题。
- 截图写入日记时只保留附件嵌入。

### 实现方式
- `src/host/markdown.ts` 针对 image 类型区分普通图片 URL 和截图 data URL。
- 如果 `imageUrl` 以 `data:` 开头，只写入：

```markdown
- HH:mm [页面标题](页面URL)
  ![[截图文件名.png]]
```

- 普通网页图片仍保留“来源图片”链接，方便追溯。

### 验证方式
- 增加/运行格式化测试：截图 data URL 不应写入来源图片长串。
- 手动检查 Obsidian 日记写入结果。

## H0.6 - 2026-04-29 15:56 - 通知、遮罩、设置页

### 更新内容
- 修复 Chrome 通知报错：`Unable to download all specified images`。
- 截图遮罩从紫色改为灰色。
- 选中区域视觉上更接近透明预览。
- 新增设置页面，可配置存储路径。

### 实现方式
- 通知图标改用 PNG 图标，避免 Chrome notification API 加载 SVG 失败。
- 增加 `extension/options.html`、`extension/options.css`、`extension/options.js`。
- 增加 Native Host 请求类型：
  - `get-config`
  - `set-config`
- `host-request.ts` 负责分发配置读写请求。
- `manifest.json` 增加 `options_page`。

### 验证方式
- 通过设置页读取/保存配置 smoke 验证。
- 通过 Chrome/Edge 右键保存后观察通知是否正常出现。

### 设计取舍
- 设置页仍通过 Native Messaging 操作配置，不让扩展直接接触本地文件系统。

## H0.7 - 2026-04-29 15:59-16:15 - 文本保存与追加稳定性

### 更新内容
- 修复部分网页“保存文本没格式/不稳定”的问题。
- 修复输入框、textarea、可编辑区域里右键无法唤醒保存文本菜单的问题。
- 修复手动粘贴内容里存在未闭合代码块后，后续截图无法在 Obsidian 预览的问题。

### 实现方式
- `extension/background.js`：
  - `save-selection` 菜单增加 `editable` context。
  - 如果焦点在 `input` / `textarea` / `contenteditable`，优先读取编辑区域选中文本。
  - 在 DOM Markdown 和纯文本之间做选择，避免复杂网页把换行/列表压成一行。
- `src/host/vault-writer.ts`：
  - 追加新内容前读取已有日记。
  - 如果已有内容末尾没有足够空行，自动补空行。
  - 如果检测到未闭合 Markdown fence，先补一个关闭 fence，再追加新采集内容。

### 验证方式
- 增加/运行追加文本相关测试：
  - 不覆盖已有日记。
  - 自动分隔缺少换行的旧内容。
  - 未闭合代码块时先补闭合 fence。
- 手动验证输入态右键菜单可见。

### 设计取舍
- 不主动修改用户整篇 Obsidian 日记，只在追加点前做最小补救，降低误改用户笔记的风险。

## H0.8 - 2026-04-29 16:13-17:24 - 截图视觉修复

### 更新内容
- 修复截出来的图发灰/变色的问题。
- 手动截图边框改为白色。
- 框选预览最终调整为：
  - 选区外：灰色遮罩。
  - 选中区域：完全透明。
  - 选区边框：白色。

### 实现方式
- 截图完成时先移除 overlay，再等待两帧 `requestAnimationFrame`，确保页面完成重绘后再截图。
- 裁剪 canvas 时设置 `imageSmoothingEnabled = false`，减少图像二次处理带来的视觉变化。
- overlay 本身不再使用整页半透明背景覆盖选中区域，而是通过 box 的大范围阴影制造选区外遮罩。

### 验证方式
- `node --check extension\background.js`
- 手动截图验证：截图结果不应包含灰色蒙层，选区预览不应覆盖截图区域。

## H0.9 - 2026-04-29 16:58 - 品牌与图标

### 更新内容
- 插件名称改为“移山”。
- 通知标题改为“移山”。
- 设置页标题改为“移山设置”。
- 更换为像素风图标。

### 实现方式
- 修改 `extension/manifest.json` 的 `name` 与 `description`。
- 修改 `extension/background.js` 通知标题。
- 修改 `extension/options.html` 设置页标题。
- 新增/替换图标资源：
  - `extension/icons/yishan-source.png`
  - `extension/icons/icon16.png`
  - `extension/icons/icon48.png`
  - `extension/icons/icon128.png`

### 验证方式
- 重新加载扩展后检查扩展名、设置页标题、通知标题、图标展示。
- 检查 manifest 语法和图标路径。

## H0.10 - 2026-04-30 14:03 - 文本代码块写入

### 更新内容
- 根据使用反馈，将“保存选中文本”调整为代码块插入格式。
- 选中文本中如果本身包含 ```，会自动使用更长的 fence，避免代码块提前闭合。

### 实现方式
- `src/host/markdown.ts` 中 selection 类型改为：来源链接 + fenced code block。
- `formatFencedCodeBlock` 会扫描文本中最长连续反引号数量，并生成更长的围栏。
- `tests/markdown.test.ts` 增加对应测试。
- `tests/run-tests.mjs` 更新测试集合。

### 写入格式

````markdown
- HH:mm [页面标题](页面URL)

```text
选中的文本内容
```
````

### 验证方式
- 运行项目测试，确认：
  - 选中文本按代码块写入。
  - 内含反引号的文本不会破坏代码块。

### 设计取舍
- 牺牲一部分富 Markdown 还原能力，换取更稳定、可预测、不破坏 Obsidian 日记结构的保存结果。

---

## 后续维护建议

- 每次修改 `package.json` 或 `extension/manifest.json` 的版本号时，同步在本文档新增正式版本条目。
- 每条版本记录至少写清楚：更新内容、实现方式、验证方式、已知限制。
- 如果只是内部重构，也建议记录“为什么改”和“行为是否保持不变”，避免后续重复排查。
- 如果新增用户可见能力，优先把入口、使用方法和关键文件一起写入记录。
- 如果以后初始化 Git 仓库，建议把上面的 `H0.x` 历史迭代与真实 commit/tag 对齐；对不确定的内容保留“根据日志还原”的标注。
