# yishan 项目优化计划

> 项目地址：https://github.com/bantubanjiu/yishan  
> 项目定位：Windows + Chrome/Edge 扩展 + Native Messaging + Obsidian 本地采集器  
> 本计划基于静态审查，未做本地运行测试。

---

## 1. 总体判断

yishan 已经具备较完整的 MVP 能力：

- 保存当前网页 URL 到 Obsidian
- 保存选中文本到 Obsidian
- 保存图片到本地附件目录
- 框选截图保存
- 保存当前窗口所有普通标签页
- Popup 配置 Vault、Inbox、附件目录
- 支持 Chrome / Edge Native Messaging
- 已有一定测试覆盖

当前不建议继续直接堆功能。优先级应从“新增功能”切换到：

```text
稳定性 > 安装诊断 > 安全边界 > 工程结构 > 新功能
```

---

## 2. 优化目标

### 2.1 短期目标

让项目从“能跑”变成“稳定可长期自用”。

重点解决：

- 启用拖选保存后，切换标签页或刷新页面仍然可靠
- 图片保存失败时不影响正文保存
- Native Host 报错可定位
- 安装失败有诊断脚本
- README 与实际功能一致

### 2.2 中期目标

让项目适合继续通过 Codex / vibe coding 迭代。

重点解决：

- 拆分过大的 `background.js`
- 拆分 host 端模块
- 增加请求 schema 校验
- 增加自动化测试和 GitHub Actions
- 降低后续改功能时引入连锁 bug 的概率

### 2.3 长期目标

让项目具备可分发能力。

重点解决：

- 简化安装流程
- 打包 Native Host
- 发布 release zip
- 提供升级脚本
- 支持更丰富的网页内容采集能力

---

## 3. 优先级总览

| 优先级 | 模块 | 优化项 | 目标 |
|---|---|---|---|
| P0 | 扩展端 | 修复拖选保存注入生命周期 | 保证切换标签页、刷新页面后仍可用 |
| P0 | Host 端 | 增加请求 schema 校验 | 防止异常请求写坏文件 |
| P0 | 图片保存 | 增加超时、大小、类型限制 | 避免大图/坏图拖死流程 |
| P0 | 安装诊断 | 新增 `diagnose.ps1` | 用户可自查安装问题 |
| P0 | 文档 | 清理 README、补 License | 降低使用和维护歧义 |
| P1 | 工程结构 | 拆分 `background.js` | 降低后续开发风险 |
| P1 | Host 结构 | 拆分配置、写入、下载、渲染模块 | 降低耦合 |
| P1 | 测试 | 拆分测试文件并增加覆盖 | 保证每次改动可回归 |
| P1 | CI | 增加 GitHub Actions | 每次提交自动检查 |
| P2 | 产品体验 | 一键打开今天 Inbox | 提升日常使用效率 |
| P2 | Markdown | 增加富 Markdown 可选模式 | 保留网页结构 |
| P2 | 截图 | 整页截图 / 长截图 | 提升采集能力 |
| P2 | 分发 | 打包 release | 降低安装门槛 |

---

## 4. P0 优化计划：先保证稳定

### 4.1 修复拖选保存注入生命周期

#### 当前问题

拖选保存脚本主要依赖初始化时注入。如果用户：

- 切换标签页
- 刷新页面
- 新开页面
- 浏览器重启后恢复页面

脚本可能没有重新注入，导致拖选保存失效。

#### 优化目标

当用户启用拖选保存后，以下场景都应自动同步状态：

- 当前 tab 激活
- 页面加载完成
- 窗口重新获得焦点
- 设置项变更后

#### 建议修改

在 `extension/background.js` 增加监听：

```js
chrome.tabs.onActivated.addListener(...)
chrome.tabs.onUpdated.addListener(...)
chrome.windows.onFocusChanged.addListener(...)
```

触发后统一调用：

```js
syncSelectionGestureForTab(tabId)
```

#### 验收标准

- 开启拖选保存后，刷新页面仍然可用
- 切换到另一个普通网页后仍然可用
- 在 `chrome://`、`edge://` 页面不会报错
- 关闭拖选保存后，已注入页面能正确卸载脚本

---

### 4.2 增加 Host 请求 schema 校验

#### 当前问题

Native Host 接收到消息后，主要依赖 `type` 判断。字段合法性校验不够集中。

风险包括：

- `title` 为空或过长
- `pageUrl` 非法
- `imageUrl` 非法
- `capturedAt` 非 ISO 时间
- `config` 字段类型异常
- 未知字段进入写入流程

#### 优化目标

所有请求进入业务逻辑前，先经过统一校验。

#### 请求类型建议

```text
url
selection
image
get-config
set-config
pick-folder
batch-save-tabs
```

#### 可选实现

方案 A：使用 Zod

```bash
npm install zod
```

方案 B：手写 schema 校验

适合当前项目规模，不增加依赖。

#### 验收标准

- 非法 URL 被拒绝
- 空标题能 fallback 到 `Untitled`
- 非法图片地址被拒绝
- 非法 config 不会写入配置文件
- 所有错误返回结构统一：

```json
{
  "ok": false,
  "error": "具体错误信息"
}
```

---

### 4.3 图片下载增加安全边界

#### 当前问题

图片保存可能遇到：

- 超大图片
- 服务器无响应
- 非图片内容伪装成图片
- data URL 过长
- 下载中断
- Content-Type 异常

#### 优化目标

图片失败不拖死整个保存流程。

#### 建议规则

| 项目 | 建议值 |
|---|---|
| 下载超时 | 10 秒 |
| 最大图片体积 | 20 MB |
| Content-Type | 仅允许 `image/*` |
| data URL 最大长度 | 20 MB 等价长度 |
| 失败处理 | 正文仍然保存，记录图片失败原因 |

#### 验收标准

- 超时图片不会卡死流程
- 非图片 URL 不会写入附件
- 图片失败时 Markdown 仍能保存
- 错误信息能说明是下载失败、类型错误还是体积超限

---

### 4.4 新增安装诊断脚本 `diagnose.ps1`

#### 当前问题

这个项目依赖多段链路：

```text
浏览器扩展
→ Native Messaging manifest
→ Windows 注册表
→ native-host.exe / Node
→ config.json
→ Obsidian Vault 路径
→ 文件写入权限
```

其中任一环节出错，普通用户很难判断问题在哪。

#### 优化目标

新增一个诊断脚本，用户运行后能看到明确结果。

#### 建议检查项

```text
[1] Node 是否安装
[2] Node 版本是否符合要求
[3] native host manifest 是否存在
[4] manifest 中 extension id 是否匹配
[5] native host 可执行文件是否存在
[6] config.json 是否存在
[7] vaultPath 是否存在
[8] inboxDir 是否可创建
[9] attachmentsDir 是否可创建
[10] 测试写入是否成功
```

#### 输出示例

```text
✅ Node: v24.x
✅ Native Host manifest: found
✅ Extension ID: matched
✅ Vault path: found
✅ Test write: success

诊断结果：安装状态正常
```

#### 验收标准

- 用户可以直接运行 `powershell -ExecutionPolicy Bypass -File scripts/diagnose.ps1`
- 每一项检查都有成功/失败信息
- 失败项给出下一步处理建议

---

### 4.5 清理 README 与 License

#### 当前问题

README 中 roadmap 和 changelog 有部分内容可能重复或不一致。例如已完成能力仍出现在规划项里。

同时仓库未声明开源许可证。公开不等于可自由使用。

#### 优化目标

让 README 成为可靠入口。

#### 建议 README 结构

```text
1. 项目简介
2. 功能清单
3. 系统要求
4. 快速安装
5. 配置说明
6. 使用方式
7. 常见问题
8. 故障诊断
9. 开发说明
10. Roadmap
11. Changelog
12. License
```

#### License 建议

如果希望别人自由使用和修改：

```text
MIT License
```

如果希望更正式一些：

```text
Apache-2.0
```

#### 验收标准

- 已完成能力不再出现在 roadmap
- 安装步骤与当前脚本一致
- 增加排障章节
- 增加 License 文件
- README 明确支持 Chrome / Edge / Windows / Node 版本

---

## 5. P1 优化计划：降低后续开发风险

### 5.1 拆分 `background.js`

#### 当前问题

`background.js` 同时承担：

- 右键菜单
- 快捷键
- Popup 消息处理
- Native Message 通信
- 截图框选
- 截图裁剪
- 文本转 Markdown
- 拖选保存手势
- 批量保存

文件继续膨胀后，后续 Codex 修改容易误伤。

#### 建议拆分

```text
extension/
├─ background.js
├─ context-menu.js
├─ commands.js
├─ native-client.js
├─ screenshot.js
├─ selection-markdown.js
├─ gesture.js
├─ batch-save.js
└─ config-client.js
```

#### 拆分原则

- `background.js` 只做入口和事件注册
- 每个文件只负责一个功能域
- 公共工具函数放到 `utils.js`
- 拆分后先不改业务逻辑，只移动代码

#### 验收标准

- 拆分前后功能一致
- 测试全部通过
- Chrome/Edge 扩展加载无报错

---

### 5.2 拆分 Host 端模块

#### 建议结构

```text
src/host/
├─ index.ts
├─ native-protocol.ts
├─ request-schema.ts
├─ config.ts
├─ vault-writer.ts
├─ image-downloader.ts
├─ markdown-renderer.ts
├─ filename.ts
├─ diagnostics.ts
└─ errors.ts
```

#### 模块职责

| 文件 | 职责 |
|---|---|
| `native-protocol.ts` | 读取/写入 Native Messaging 二进制协议 |
| `request-schema.ts` | 校验请求结构 |
| `config.ts` | 读取、写入、修复配置 |
| `vault-writer.ts` | 写 Markdown 和附件 |
| `image-downloader.ts` | 图片下载与安全限制 |
| `markdown-renderer.ts` | 生成 Markdown 内容 |
| `filename.ts` | 文件名清洗和冲突处理 |
| `diagnostics.ts` | 安装诊断逻辑 |
| `errors.ts` | 统一错误类型 |

#### 验收标准

- 每个模块有对应测试
- `index.ts` 只负责串联流程
- 保存 URL、文本、图片、截图功能全部保持一致

---

### 5.3 批量保存改为单次请求

#### 当前问题

保存当前窗口所有标签页时，扩展端逐个发送 Native Message。每次发送都可能启动一次 native host 流程，性能和稳定性都不理想。

#### 优化目标

一次请求传递多个标签页。

#### 新请求格式

```json
{
  "type": "batch-save-tabs",
  "tabs": [
    {
      "title": "Page A",
      "pageUrl": "https://example.com/a",
      "capturedAt": "2026-05-07T00:00:00.000Z"
    },
    {
      "title": "Page B",
      "pageUrl": "https://example.com/b",
      "capturedAt": "2026-05-07T00:00:01.000Z"
    }
  ]
}
```

#### 返回格式

```json
{
  "ok": true,
  "saved": 10,
  "failed": 1,
  "failures": [
    {
      "title": "Page X",
      "pageUrl": "https://example.com/x",
      "error": "失败原因"
    }
  ]
}
```

#### 验收标准

- 10 个标签页只发送一次 Native Message
- 部分失败不影响其他标签页
- Popup/通知能显示保存数量和失败数量

---

### 5.4 增加 GitHub Actions

#### 建议工作流

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: windows-latest

    strategy:
      matrix:
        node-version: [24.x, 26.x]

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
      - run: npm run check
```

#### 验收标准

- 每次 push 自动跑测试
- PR 自动跑测试
- Windows 环境下能验证安装脚本相关逻辑

---

## 6. P2 优化计划：再做产品功能

### 6.1 一键打开今天 Inbox

#### 功能描述

Popup 增加按钮：

```text
打开今天 Inbox
打开附件目录
打开 Vault 根目录
打开配置文件
```

#### 实现方式

由 Native Host 调用系统打开路径：

```text
explorer.exe <path>
```

#### 验收标准

- 点击按钮能打开对应目录或文件
- 路径不存在时给出明确提示
- 不阻塞保存功能

---

### 6.2 富 Markdown 可选模式

#### 功能描述

设置中增加：

```text
保存选中文本模式：
- 安全纯文本
- 富 Markdown
```

#### 两种模式差异

| 模式 | 行为 |
|---|---|
| 安全纯文本 | 尽量保存用户看到的文本，不做复杂结构转换 |
| 富 Markdown | 尽量保留标题、列表、链接、引用、代码块、图片 |

#### 验收标准

- 默认使用安全纯文本
- 用户可手动切换富 Markdown
- 富 Markdown 出错时 fallback 到纯文本

---

### 6.3 整页截图 / 长截图

#### 建议不要立刻做

长截图涉及：

- 页面滚动
- 固定导航栏
- 懒加载图片
- 缩放比例
- 页面高度限制
- canvas 尺寸限制
- 拼接误差

#### 建议顺序

```text
当前视口框选截图
→ 当前视口整页截图
→ 滚动整页截图
→ 指定 DOM 区域截图
```

#### 验收标准

- 截图清晰
- 不重复固定 header
- 不出现明显拼接缝
- 大页面有尺寸限制提示

---

### 6.4 PDF 文本提取

#### 功能描述

对网页中的 PDF 或本地 PDF 增加文本提取能力。

#### 风险

- 浏览器 PDF Viewer 页面权限限制
- 本地 PDF 路径权限
- 扫描版 PDF 无文本层
- 中文排版提取质量不稳定

#### 建议策略

第一阶段只做：

```text
保存 PDF 链接 + 标题 + 来源页面
```

第二阶段再做：

```text
下载 PDF → 提取文本 → 保存 Markdown
```

---

## 7. 建议的 Codex 任务拆分

### 任务 1：修复拖选保存注入生命周期

```text
请修复 selection gesture 在切换标签页、刷新页面、新开页面后不自动生效的问题。

要求：
1. 只改 extension/background.js 和必要测试。
2. 增加 tabs.onActivated、tabs.onUpdated、windows.onFocusChanged 的同步逻辑。
3. chrome://、edge://、about: 页面不能报错。
4. 保持现有功能不变。
5. 补充或更新测试。
```

---

### 任务 2：增加 Host 请求 schema 校验

```text
请给 Native Host 增加统一请求 schema 校验。

要求：
1. 覆盖 url、selection、image、get-config、set-config、pick-folder 请求。
2. 非法请求必须返回 { ok: false, error: "..." }。
3. 不要让非法字段进入文件写入流程。
4. 补充测试覆盖合法和非法请求。
5. 不改变现有正常保存行为。
```

---

### 任务 3：给图片下载增加安全边界

```text
请优化图片下载逻辑。

要求：
1. 增加 10 秒下载超时。
2. 增加 20MB 最大体积限制。
3. 校验 Content-Type 必须是 image/*。
4. data URL 也要有大小限制。
5. 图片下载失败时，Markdown 正文仍然保存。
6. 错误信息要能区分超时、体积超限、类型不合法、网络失败。
7. 补充测试。
```

---

### 任务 4：新增安装诊断脚本

```text
请新增 scripts/diagnose.ps1，用于诊断 yishan 的本地安装状态。

要求检查：
1. Node 是否安装。
2. Node 版本是否满足 package.json engines 要求。
3. Native Messaging manifest 是否存在。
4. manifest 中 host path 是否存在。
5. manifest 中 extension id 是否匹配。
6. config.json 是否存在。
7. vaultPath 是否存在。
8. Inbox 和 attachments 目录是否可创建。
9. 是否可以写入测试 Markdown 文件。
10. 输出清晰的 ✅/❌ 诊断结果和下一步建议。

不要修改核心保存逻辑。
```

---

### 任务 5：清理 README 和 License

```text
请清理 README 并补充 License。

要求：
1. 将 README 结构调整为：项目简介、功能清单、系统要求、快速安装、配置说明、使用方式、常见问题、故障诊断、开发说明、Roadmap、Changelog、License。
2. 移除 roadmap 中已经完成的功能。
3. 增加 diagnose.ps1 的使用说明。
4. 补充 Chrome / Edge / Windows / Node 版本要求。
5. 新增 MIT License 文件。
6. 不修改代码逻辑。
```

---

### 任务 6：拆分 background.js

```text
请重构 extension/background.js。

要求：
1. 拆分为 context-menu.js、commands.js、native-client.js、screenshot.js、selection-markdown.js、gesture.js、batch-save.js、config-client.js。
2. background.js 只保留事件注册和主流程串联。
3. 不改变任何现有功能。
4. 拆分后扩展仍能正常加载。
5. 更新 import/export。
6. 补充或更新测试。
```

---

### 任务 7：批量保存改为单次 Native Message

```text
请将“保存当前窗口所有标签页”改为单次 Native Message 请求。

要求：
1. 新增请求类型 batch-save-tabs。
2. 扩展端一次性传递所有普通标签页。
3. Host 端逐个写入 Markdown。
4. 部分失败不影响其他标签页。
5. 返回 saved、failed、failures。
6. Popup/通知显示保存数量和失败数量。
7. 保持单个 URL 保存行为不变。
8. 补充测试。
```

---

## 8. 推荐执行顺序

### 第一阶段：稳定性修复

```text
1. 修复拖选保存注入生命周期
2. 增加 Host 请求 schema 校验
3. 图片下载增加安全边界
4. 新增 diagnose.ps1
5. 清理 README 和 License
```

完成后，项目适合长期自用。

---

### 第二阶段：工程结构整理

```text
6. 拆分 background.js
7. 拆分 Host 端模块
8. 批量保存改为单次 Native Message
9. 增加 GitHub Actions
10. 拆分测试文件
```

完成后，项目适合继续用 Codex 分支开发。

---

### 第三阶段：产品能力增强

```text
11. 一键打开今天 Inbox
12. 富 Markdown 可选模式
13. 当前视口整页截图
14. PDF 链接保存
15. PDF 文本提取
16. 长截图
17. Release 打包
```

完成后，项目具备分发给其他用户使用的基础。

---

## 9. 不建议现在做的事

### 9.1 不建议马上做长截图

长截图技术复杂度明显高于当前框选截图，容易引入大量边界 bug。

### 9.2 不建议马上做多平台

当前项目强依赖 Windows Native Messaging、PowerShell、注册表和本地路径。macOS / Linux 支持应放到后期。

### 9.3 不建议一次性大重构

应该先做 P0，再拆模块。否则容易出现“结构变了，但功能坏了”的情况。

### 9.4 不建议把所有网页内容都转成富 Markdown

网页结构差异很大，富 Markdown 应作为可选实验能力，而不是默认能力。

---

## 10. 最小可执行版本

如果只做一轮优化，建议只做这 5 个任务：

```text
1. 修复拖选保存注入生命周期
2. 增加 Host 请求 schema 校验
3. 图片下载增加安全边界
4. 新增 diagnose.ps1
5. 清理 README 和 License
```

这 5 个完成后，项目的稳定性、可维护性和可诊断性会明显提升。

### 9.5 v0.2.7 Obsidian 汇总格式补充

- 当天 Inbox 轻量采集采用 `#### [页面标题](页面URL)` 作为来源链接分组。
- 每次保存材料采用 `- HH:mm 类型` 作为记录点，不再使用标题层级。
- 普通选区优先保存为文本；只有包含加粗、链接、列表、引用、代码块、图片等结构时才保留富 Markdown。
- 旧版 `## [标题](URL)` 与“来源：URL”分组继续兼容，后续同 URL 记录追加到原分组。
