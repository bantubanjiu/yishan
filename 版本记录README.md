# 版本记录

本文档只记录“移山”的正式版本与当前维护规则，避免把临时调试记录、历史推测和本机环境说明混入发布说明。`v0.2.7` 是当前代码中可见的正式版本号。

## 当前版本

- 当前版本：`0.2.7`
- 发布时间：2026-05-25
- 版本元数据：`package.json` 与 `extension/manifest.json` 版本同步为 `0.2.7`
- 重点优化：当天 Inbox 汇总格式改为 `#### [页面标题](页面URL)` + `- HH:mm 类型`，并优先用普通文本保存摘录。

## v0.2.7 - 2026-05-25

### 更新内容
- 当天 Inbox 的轻量采集改为 Obsidian 汇总友好格式：来源网页使用 `#### [页面标题](页面URL)`，每次材料以 `- HH:mm 类型` 追加在链接下，不再用标题记录每个保存点。
- 选中文本默认尽量以普通文本保存；只有富 Markdown 确实包含标题、加粗、链接、列表、引用、代码块或图片等格式信息时才保留富文本。
- 继续兼容旧版 `## [标题](URL)` 分组和“来源：URL”旧分组，后续同 URL 记录会追加到原分组，避免拆散既有日记。
- README 同步新的 Obsidian 汇总格式、当前版本和使用说明。

### 实现方式
- `src/host/markdown.ts` 将分组标题改为四级标题，子记录改为 bullet，并为普通摘录增加文本优先、代码/围栏内容才加代码块的格式化规则。
- `src/host/vault-writer.ts` 同时识别 `#### [标题](URL)`、旧版 `## [标题](URL)` 和“来源：URL”分组，保持同日同 URL 追加行为。
- `tests/markdown.test.ts`、`tests/vault-writer.test.ts` 与 `tests/run-tests.mjs` 增加新格式和兼容旧分组的回归覆盖。

### 验证方式
- `node --test tests/markdown.test.ts tests/vault-writer.test.ts`
- `npm.cmd test`
- `npm.cmd run check`
- `git diff --check`

### 已知限制
- 本次只影响新写入和后续追加的当天 Inbox 记录，不迁移或重写既有日记内容。

---

## v0.2.6 - 2026-05-25

### 更新内容
- 修复 macOS Native Host 未响应、未安装完成或首次缺少 `config.json` 时，Popup 一直显示加载态且无法进入完整设置的问题。
- Popup 和设置页的 Host 请求增加超时保护；加载失败后保留“完整设置”“快捷键”“刷新”等恢复入口，避免用户被卡在空转状态。
- Host 的 `get-config` 在配置缺失时返回安全默认配置，允许用户先打开设置选择 Vault；真正保存和采集仍要求有效 Vault 路径。
- macOS 安装脚本把 Native Host stderr 写入 `~/Library/Application Support/ObsidianWebClipperLocal/native-host.log`，便于排查 Node、权限、路径或 launcher 异常。
- macOS 诊断脚本新增真实 Native Messaging `get-config` 握手，确认 launcher 是否能在 5 秒内返回响应帧。
- README 同步当前安装、诊断和 macOS Popup 加载态排查说明。

### 实现方式
- `src/host/config.ts` 支持缺失配置时返回空 Vault 默认配置；写入链路继续复用既有配置校验。
- `extension/popup.js`、`extension/options.js` 为 runtime/native 消息增加超时和忙碌态降级逻辑，避免恢复入口被 disabled 状态锁住。
- `scripts/install-native-host-macos.sh` 生成带 stderr 日志重定向的 launcher。
- `scripts/diagnose-macos.sh` 通过 4 字节长度头协议发送 `get-config` 请求，并验证 Native Host 在 5 秒内返回 Native Messaging 帧。
- `README.md` 与本文件同步 `0.2.6` 当前版本说明。

### 验证方式
- `npm.cmd test`
- `npm.cmd run check`
- `Chrome headless CDP Popup 烟测：确认 Native Host 故障后完整设置、快捷键、刷新入口仍可点击`

### 已知限制
- 本轮自动化和 headless 烟测在 Windows 开发环境完成，未在真实 macOS Chrome UI 中手工复现；macOS 侧应优先运行 `bash ./scripts/diagnose-macos.sh "<扩展ID>"` 验证本机安装链路。
- 已安装用户如果移动仓库目录、更换 Node 路径或重装扩展导致扩展 ID 改变，仍需重新执行对应安装脚本。

---

## 版本历史

## v0.2.5 - 2026-05-07

### 更新内容
- 保存页面改为页面剪藏：右键保存当前页面时提取正文 Markdown、尽量本地化页面图片，并生成单独 Markdown 文档，不再写入当天 Inbox 日记。
- 快捷键默认改为 `Ctrl+Shift+S` 保存当前窗口标签、`Ctrl+Shift+X` 框选截图，降低与输入法或系统快捷键冲突的概率；Popup 和设置页会显示快捷键是否未绑定或被占用。
- 启用长按拖选保存后，普通 `http/https` 页面通过 `gesture-content-script.js` 内容脚本在浏览器重启后自动请求同步，不再依赖先打开 Popup 才生效。
- 右键菜单中“框选截图保存到 Obsidian”移动到“保存当前页面剪藏到 Obsidian”上方。
- 除页面剪藏外，URL、文字、富 Markdown、图片和截图改为同日同 URL 聚合：当天 Inbox 内只保留一个 `## [页面标题](页面URL)`，每次材料以 `### HH:mm 类型` 追加在该链接下。
- 图片和截图只写入 Obsidian 附件嵌入或下载失败原因，不再追加原始图片来源 URL，并跟随来源网页分组。

### 实现方式
- `extension/page-clip.js` 注入页面侧提取逻辑，优先读取 `article/main/[role=main]`，移除脚本、导航、表单等噪声，并把常见 DOM 转成 Markdown。
- `extension/manifest.json` 增加 `gesture-content-script.js` 内容脚本、普通 `http/https` host permissions，并更新 Commands 默认键位。
- `extension/background.js` 新增 `sync-selection-gesture` runtime message，让页面加载后主动同步拖选启用状态。
- `extension/context-menu.js` 调整右键菜单创建顺序，并把 `save-url` 改为发送 `page` 剪藏请求。
- `src/host/request-schema.ts`、`src/host/types.ts`、`src/host/vault-writer.ts` 支持 `page` 请求；页面图片复用安全下载边界写入附件，再替换为 Obsidian 本地嵌入。
- `src/host/markdown.ts` 输出网页分组标题和按类型命名的时间子标题；`src/host/vault-writer.ts` 在写入当天 Inbox 时查找同 URL 分组并追加到分组尾部。

### 验证方式
- `npm test`
- `npm run check`
- `npm run release:zip`

### 已知限制
- 页面剪藏使用内置 DOM 转 Markdown 启发式，不新增 Readability/Turndown 依赖；复杂网页可能需要后续继续优化正文抽取质量。
- 本次只调整新写入条目的格式，不迁移或重写既有日记内容。
- 已安装用户的既有快捷键可能不会被 Chrome 自动改写；如仍为空或冲突，需要在 `chrome://extensions/shortcuts` 手动重新绑定。

## v0.2.4 - 2026-05-07

### 更新内容
- 完成优化计划中剩余的 P1/P2 主体事项：扩展端和 Host 端拆分为更小模块，降低后续修改风险。
- “保存当前窗口”改为单次 `batch-save-tabs` Native Message，请求一次传递所有普通标签页，并返回 `saved`、`failed`、`failures`。
- Popup 新增打开今天 Inbox、附件目录、Vault 根目录、配置文件的入口，并增加当前视口截图和 PDF 链接保存按钮。
- 选中文本保存新增 `selectionSaveMode`：默认安全纯文本，可切换富 Markdown；富 Markdown 提取失败时回退纯文本。
- 新增 `npm run release:zip` 本地打包脚本；GitHub Actions 增加 Node 26.x 矩阵。

### 实现方式
- `extension/background.js` 保留服务工作线程入口和事件注册，功能逻辑拆到 `context-menu.js`、`commands.js`、`native-client.js`、`screenshot.js`、`selection-markdown.js`、`gesture.js`、`batch-save.js`、`config-client.js` 等模块。
- `src/host/host-request.ts` 专注请求分发；请求白名单校验移动到 `request-schema.ts`，图片下载移动到 `image-downloader.ts`，日期/附件名移动到 `filename.ts`，通用错误工具移动到 `errors.ts`。
- `batch-save-tabs` 在 Host 端逐条写入并收集失败明细，单条失败不阻断后续标签写入。
- `open-path` 只允许固定目标枚举，不接受任意路径；路径不存在或越界时返回明确错误。

### 验证方式
- `npm.cmd test`
- `npm.cmd run check`
- `npm.cmd run release:zip`

### 已知限制
- 本轮未做滚动长截图拼接。
- 本轮未做 PDF 正文文本提取，只实现 PDF 链接保存。

## v0.2.3 - 2026-05-07

### 更新内容
- 修复拖选自动保存的注入生命周期：标签切换、页面刷新、窗口重新聚焦后会重新同步启用/停用状态。
- Native Host 增加统一请求 schema 校验，非法 URL、时间戳、图片地址或配置会返回 `{ ok:false, error:"..." }`，空标题回退 `Untitled`。
- 图片下载增加 10 秒超时、20MB 体积上限和 `image/*` 类型校验；失败时仍追加 Markdown，并记录明确原因。
- 新增 Windows/macOS 安装诊断脚本，检查 Node、manifest、allowed_origins、config、Vault、Inbox、attachments 和测试写入权限。
- 补充 MIT License、GitHub Actions CI，并清理 README 的安装、诊断、FAQ、Roadmap 和 Changelog 说明。

### 实现方式
- `extension/background.js` 增加 `tabs.onActivated`、`tabs.onUpdated`、`windows.onFocusChanged` 监听，并只对 `http/https/file` 页面同步拖选脚本。
- `src/host/host-request.ts` 对 `url`、`selection`、`image`、`get-config`、`set-config`、`pick-folder` 请求做白名单校验和字段净化。
- `src/host/vault-writer.ts` 使用 `AbortController` 控制远程图片超时，校验 `Content-Type`、`Content-Length` 和实际字节长度。

### 验证方式
- `npm test`
- `npm run check`

### 已知限制
- 批量保存仍是扩展端逐个发送 Native Message；后续已在 v0.2.4 改为单次请求。
- `background.js` 当时仍未拆分模块，本次只做稳定性修复，避免计划外重构风险。

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

## v0.2.1 - 2026-05-07

### 更新内容
- 恢复保存条目标题格式为 `- HH:mm [页面标题](页面URL)`，不再把来源写成 `## [标题](URL)` + `来源：URL` 分组。
- 保存时间和当天日记文件名改为按本机本地时间计算，避免 UTC 时间导致小时和日期偏移。
- 保留 v0.2.0 的并发写入文件锁、Popup、快捷键、拖选开关和权限收敛等修复。

### 实现方式
- `src/host/markdown.ts` 使用本机 `Date#getHours()` / `getMinutes()` 格式化条目时间。
- `src/host/vault-writer.ts` 恢复逐条追加 `formatCaptureEntry(...)`，日期和附件文件名改用本机本地年月日时分秒。
- `tests/run-tests.mjs`、`tests/markdown.test.ts`、`tests/vault-writer.test.ts` 增加逐条标题格式和本机时间回归用例。

### 验证方式
- `npm run check`
- `git diff --check`
- `node --test tests/markdown.test.ts tests/vault-writer.test.ts`

## v0.2.0 - 2026-05-06

### 更新内容
- 插件图标左键改为打开 Popup，新 UI 支持保存当前页、保存当前窗口全部普通标签、框选截图、修改保存路径和修改选区触发键。
- 新增当前窗口多标签快速保存，默认保存 `http/https/file` 普通标签并跳过浏览器内部页。
- 新增快捷键：`Alt+Shift+S` 保存当前窗口标签，`Alt+Shift+X` 进入框选截图；用户可在 Chrome 快捷键设置中自定义。
- 新增长按 Alt 后拖选文本自动保存；默认为关闭，可在 Popup/选项页启用，触发键可改为 Ctrl/Shift/Meta。
- 支持 `file://` 本地页面/阅读器链接保存；Chrome PDF 阅读器先保存文件链接，正文选区抽取仍受浏览器限制。

### 实现方式
- `extension/manifest.json` 增加 `action.default_popup` 和 `commands`，不再声明全站 `host_permissions`。
- `extension/background.js` 增加 Popup runtime message 分发、当前窗口批量保存、快捷键处理和按需启用的 Alt 拖选内容脚本动态注入。
- 新增 `extension/popup.html/css/js`，并同步升级 `options.html/css/js` 的路径选择、选区触发键和拖选自动保存开关配置。
- `src/host/host-request.ts` 增加 `pick-folder` 请求，Windows 下通过 PowerShell/.NET FolderBrowserDialog 选择目录。

### 验证方式
- `node --check extension/background.js`
- `node --check extension/popup.js`
- `node --check extension/options.js`
- `node tests/run-tests.mjs`
- `npm.cmd run check`

### 已知限制
- 保存 `file://` 页面需要用户在浏览器扩展详情页开启“允许访问文件网址”。
- Chrome PDF 阅读器正文文本抽取能力有限，当前版本优先保证保存 PDF 文件链接。

## v0.1.2 - 2026-05-06

### 更新内容
- Native Host 安装方式改为默认“源代码联动模式”。
- 更新仓库里的 Host 代码后，只要仓库路径不变，浏览器启动 Native Host 时会直接使用当前仓库最新 `src/host` 逻辑。
- 保留 `-Snapshot` / `--snapshot` 可选模式：需要脱离仓库固定运行安装时快照时，可以显式复制 Host 文件到安装目录。

### 实现方式
- Windows `scripts/install-native-host.ps1` 新增 `-Snapshot` switch；macOS 安装脚本后续提供对应 `--snapshot`。
- 默认安装时，Native Host manifest 指向本机 launcher；launcher 再运行当前仓库的 Host 入口。
- 显式使用 snapshot 时才复制 `src/host` 到安装目录，并让 launcher 指向安装目录快照。
- `tests/run-tests.mjs` 增加安装脚本行为检查，防止以后误改回无条件复制模式。

### 验证方式
- `node tests/run-tests.mjs`
- `node --check extension/background.js`
- `npm.cmd run check`

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
- `extension/background.js` 收集选区附近的代码块语言提示。
- `src/host/markdown.ts` 增加语言归一化和内容启发式识别。
- `tests/run-tests.mjs` 增加语言识别和 fence 安全用例。

### 验证方式
- `npm run check`

## v0.1.0 - 2026-04-29

### 更新内容
- 完成“浏览器扩展 + Native Host + Obsidian Vault 写入”的本地优先 MVP。
- 支持保存当前页面链接、选中文本、图片和框选截图到当天 Inbox。
- 支持 Windows Chrome/Edge Native Host 注册、Vault 配置和基础 Markdown 追加保护。
- 插件命名为“移山”，提供基础图标、右键菜单、设置页和本地静默写入链路。

### 实现方式
- `extension/background.js` 注册右键菜单并发送 Native Messaging 请求。
- `src/host/index.ts` 处理 Native Messaging stdin/stdout 协议，Host 侧写入 Obsidian Vault。
- `src/host/markdown.ts`、`src/host/vault-writer.ts` 负责条目格式化、附件命名和当天日记追加。
- `scripts/install-native-host.ps1` 注册 Windows Native Host manifest。

### 验证方式
- 本地加载扩展后执行 URL、文本、图片和截图保存 smoke test。
- 后续版本已补充自动化测试覆盖核心写入链路。

---

## 维护规则

- 发布或修改 `package.json` / `extension/manifest.json` 版本号时，必须同步更新 README 当前版本和本文件当前版本。
- 每个正式版本至少记录：更新内容、实现方式、验证方式、已知限制。
- 用户可见功能变更优先写清入口、行为变化、诊断方式和兼容限制。
- 不把临时调试流水、未验证推测、本机私有路径或已过期计划混入正式版本历史；历史规划保留在独立计划文档中。
