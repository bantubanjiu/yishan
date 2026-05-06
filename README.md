# 移山

> yishan / inspiration notion：Windows + Chrome/Edge 本地网页采集工具，把网页右键采集的 URL、选中文本、图片和截图静默保存到 Obsidian 当天 Inbox 日记。

## 功能

- 右键保存当前页面 URL。
- 右键保存选中文本。
- 右键保存图片：下载到附件目录，并在当天日记中嵌入。
- 右键框选截图：拖拽选择可见页面区域，裁剪后保存为 PNG 附件。
- 默认追加到 `Inbox/YYYY-MM-DD.md`。
- Native Host 通过 Chrome Native Messaging 写入本地 vault。

## 配置

先保存 Obsidian vault 路径：

```powershell
node .\src\host\configure.ts "D:\path\to\Vault" Inbox Inbox\attachments
```

默认配置文件位于：

```text
%USERPROFILE%\.obsidian-web-clipper-local\config.json
```

## 安装浏览器扩展

1. 打开 Chrome/Edge 扩展管理页。
2. 启用开发者模式。
3. 加载 `extension/` 目录。
4. 复制扩展 ID。
5. 注册 Native Host：

```powershell
.\scripts\install-native-host.ps1 -ExtensionId "<扩展ID>"
```

Chrome 和 Edge 的 Native Messaging 注册表项都会写入当前用户 HKCU。

## 使用

- 页面空白处右键：保存当前页面 URL。
- 选中文本右键：保存选中文本和来源链接。
- 图片上右键：下载图片并保存来源。
- 页面右键选择“框选截图保存到 Obsidian”：拖拽选择截图大小，松开鼠标后保存。

## 版本记录

- 当前版本：`0.1.0`
- 详细更新历史见 [`版本记录README.md`](./版本记录README.md)。

## 开发验证

```powershell
node tests\run-tests.mjs
node --check extension\background.js
```

或：

```powershell
npm run check
```

> 当前环境中 `node --test` 会触发 `spawn EPERM`，所以项目提供了不派生子进程的 `tests/run-tests.mjs`。