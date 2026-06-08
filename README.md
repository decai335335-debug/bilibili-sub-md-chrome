# Video Subtitle Clipper

一键扫描浏览器中所有打开的 Bilibili / YouTube 视频标签页，批量提取字幕并保存到 Obsidian。做知识整理时，不再逐个页面手动复制粘贴字幕。

---

## 解决什么痛点

以前是这样的：
- 做专题学习时开了 20 个 B 站 / YouTube 教程标签页，想保存字幕做笔记
- 只能逐个页面点进视频 → 找字幕按钮 → 复制 → 粘贴到 Obsidian，重复 20 次
- 多 P 视频更麻烦，要手动确认有多少分 P、每个 P 有没有字幕
- YouTube 视频有多种语言字幕，不知道选哪个，逐个试很费时间
- 下载的字幕格式不统一，还要手动改文件名和 frontmatter

现在是这样的：
- 打开所有想保存的视频标签页（Bilibili 或 YouTube）
- 一键扫描，自动识别视频 ID、标题、可用字幕数量
- Bilibili 多 P 视频弹 A/B 选择：只下第 1 P，还是全部分 P 都下
- YouTube 视频自动识别所有可用字幕语言，支持一键选择最佳字幕
- 自动按统一格式命名文件、生成 frontmatter，批量写入 Obsidian

适合谁用：
- **知识整理者** —— 看完一批 B 站 / YouTube 教程，想批量归档字幕到 Obsidian 做二次笔记
- **视频调研者** —— 需要同时对比多个视频的内容，先把字幕全部拉取下来
- **多语言学习者** —— B 站 AI 字幕和 YouTube 多语言字幕，批量下载方便对照学习

---

## 核心功能

| 功能 | 解决什么问题 |
|------|-------------|
| **双平台批量扫描** | Bilibili + YouTube 都支持，打开 N 个视频页后一键识别所有标签页，自动去重 |
| **Bilibili A / B 分 P 选择** | 多 P 视频默认只下第 1 P 容易漏内容，全下又可能浪费空间；A/B 选择让用户按需决定 |
| **YouTube 多语言字幕选择** | YouTube 视频常有 5-10 种字幕，自动识别手动/AI 字幕，支持按语言偏好一键选择 |
| **多格式导出** | 支持 Markdown（带 frontmatter + 时间戳）、SRT、TXT，适配不同笔记工作流 |
| **自动保存到 Obsidian** | 通过 Local REST API 直接写入 vault，自动按 `标题_分P/语言.md` 命名 |
| **单视频模式（原版保留）** | 只想保存当前这一个视频的字幕？点击扩展图标，和原来一样即用即走 |

---

## 安装方法

### 方式一：开发者模式加载（推荐，实时更新）

1. 下载或克隆本项目到本地
2. 打开浏览器扩展管理页：
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
3. 开启右上角 **"开发者模式"**
4. 点击 **"加载已解压的扩展程序"**
5. 选择项目中的 `extension/` 文件夹

### 方式二：打包安装

1. 在 `chrome://extensions/` 开启开发者模式
2. 点击 **"打包扩展程序"**
3. 选择 `extension/` 文件夹，生成 `.crx` 文件
4. 拖拽 `.crx` 到扩展管理页安装

### Obsidian 配置（必须）

1. 在 Obsidian **社区插件市场**搜索并安装 `Local REST API with MCP`
2. 进入插件设置 → 勾选 **"Enable Non-encrypted (HTTP) Server"**
3. 复制页面上的 **API Key**
4. 点击扩展图标 → **"设置"** → 填写：
   - **Local REST API 地址**：`http://127.0.0.1:27123`
   - **API Key**：粘贴刚才复制的 Key
   - **笔记目录**：想保存到的 Obsidian 文件夹路径（如 `Clippings/Bilibili` 或 `Clippings/YouTube`）

---

## 使用方法

### 场景一：批量下载 B 站视频字幕

**什么时候用**：你刚刚刷完一批 B 站教程/讲座，想把所有字幕保存到 Obsidian 做统一笔记。

1. 在浏览器中打开所有想保存的 B 站视频页（每个视频一个标签页）
2. 点击扩展图标 → 点击 **"批量下载"**
3. 选择 **"哔哩哔哩"**
4. 点击 **"扫描标签页"**，等待扫描完成
5. 对多 P 视频点击 **"A 单 P"** 或 **"B 全 P"**（单 P 视频自动选 A）
   - 也可以点击顶部 **"全部选 A"** / **"全部选 B"** 一键设置
6. 选择输出格式（Markdown / SRT / TXT）
7. 点击 **"开始下载"**，等待进度条走完
8. 打开 Obsidian，字幕文件已出现在你设置的目录中

### 场景二：批量下载 YouTube 视频字幕

**什么时候用**：在 YouTube 上看完一批教程，想批量保存字幕。

1. 在浏览器中打开所有想保存的 YouTube 视频页
2. 点击扩展图标 → **"批量下载"** → 选择 **"YouTube"**
3. 点击 **"扫描标签页"**
4. 每个视频会显示可用的字幕语言数量
5. 点击 **"自动选择最佳字幕"**，或手动在每个视频下拉框中选择字幕语言
   - 支持设置"首选语言"和"优先手动字幕"
6. 点击 **"开始下载"**

### 场景三：只保存当前这一个视频的字幕

**什么时候用**：临时看到一个视频，只想快速保存它的字幕。

1. 打开 B 站或 YouTube 视频页
2. 点击扩展图标
3. 面板自动抓取当前视频字幕
4. 点击 **"保存到 Obsidian"** 即可

### 场景四：只下载某个 B 站多 P 视频的全部分 P

**什么时候用**：一个系列课程有 20 个分 P，你想全部保存。

1. 打开该视频任意一页
2. 点击扩展图标 → **"批量下载"** → **"哔哩哔哩"**
3. 扫描后找到该视频 → 选择 **"B 全 P"**
4. 点击 **"开始下载"**，所有分 P 会逐个保存为独立文件

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 / 扩展规范 | Chrome Extension Manifest V3 |
| 语言 | 纯原生 JavaScript（ES2022），零构建工具 |
| UI | 原生 DOM + CSS，无框架 |
| API 通信 | Fetch API + Chrome Runtime Messaging |
| 数据存储 | `chrome.storage.sync` / `chrome.storage.local` |

### 依赖库

无。本项目完全基于浏览器原生 API 实现，零第三方依赖。

---

## 文件结构

```
video-subtitle-clipper/
├── extension/                          ← 扩展源码（加载此目录）
│   ├── manifest.json                   ← Manifest V3 配置（Bilibili + YouTube）
│   ├── background.js                   ← Service Worker：API 代理、Obsidian 写入
│   ├── content.js                      ← Bilibili 内容脚本：单视频页字幕抓取
│   ├── content.css                     ← Bilibili 浮动面板样式
│   ├── youtube-content.js              ← 【新增】YouTube 内容脚本：读取 ytInitialPlayerResponse
│   ├── popup.html / popup.js / popup.css   ← 扩展图标弹出面板
│   ├── options.html / options.js / options.css   ← 设置页面
│   ├── batch/                          ← 【新增】批量下载模块
│   │   ├── batch.html                  ← 入口选择页（Bilibili / YouTube）
│   │   ├── bilibili.html               ← Bilibili 批量下载页面
│   │   ├── bilibili.js                 ← Bilibili 批量逻辑
│   │   ├── bilibili.css                ← Bilibili 批量样式
│   │   ├── youtube.html                ← 【新增】YouTube 批量下载页面
│   │   ├── youtube.js                  ← 【新增】YouTube 批量逻辑
│   │   └── youtube.css                 ← 【新增】YouTube 批量样式
│   └── icons/                          ← 扩展图标
├── docs/images/                        ← 文档图片
├── scripts/
│   └── build_release.py                ← 打包脚本
├── README.md                           ← 本文档
├── DEV_LOG.md                          ← 开发记录
└── LICENSE
```

---

## 常见问题

**Q: 扫描标签页时为什么有些视频没出现？**

A: 
- **Bilibili**：只扫描 URL 匹配 `bilibili.com/video/*` 的标签页。如果视频页还没加载完成、或者是收藏夹/合集页（非直接视频页），不会识别。确保每个视频都是直接打开的视频页。
- **YouTube**：只扫描 `youtube.com/watch*` 标签页。Shorts、Live、Embed 页面理论上也能识别，但建议用标准 watch 页面。

**Q: 点击"开始下载"后显示"该视频暂无可用字幕"？**

A: 这表示 API/页面没有返回字幕轨道。可能原因：
1. 该视频确实没有字幕（UP 主/创作者未上传，也未开启 AI 字幕）
2. 视频是内嵌字幕（字幕直接烧录在画面里，API 检测不到）
3. Bilibili 需要登录才能看到的字幕 —— 在插件设置中配置 SESSDATA Cookie
4. YouTube 视频的字幕被创作者禁用

**Q: 保存到 Obsidian 失败，提示"无法连接"？**

A: 请依次排查：
1. Obsidian 是否已安装并启用 `Local REST API with MCP` 插件
2. 插件设置中是否勾选了 **"Enable Non-encrypted (HTTP) Server"**
3. 扩展设置中的 API 地址和 Key 是否填写正确
4. Obsidian 是否处于打开状态

**Q: YouTube 视频显示"获取失败"或扫描不到？**

A: YouTube 页面加载较慢时，`ytInitialPlayerResponse` 可能还未就绪。建议等待页面完全加载（视频标题出现）后再扫描。如果仍失败，尝试刷新页面后重试。

**Q: 多 P 视频下载太慢？**

A: 每个分 P 之间默认间隔 800ms 避免触发 B 站限流。YouTube 视频间隔 1000ms。如果网络好且视频数量不多，可以修改代码中的 `sleep()` 值（但不建议低于 300ms）。

**Q: 批量下载时浏览器可以关掉吗？**

A: 不可以。批量下载页面需要保持打开，且被下载的视频标签页也需要保持打开状态（因为字幕请求在当前扩展上下文中执行）。

---

## 未来开发路线图 (Roadmap)

**当前状态**：Beta —— 核心功能可用，持续优化体验

### 近期（下个版本）
- **合集/播放列表 URL 识别** —— 用户反馈粘贴合集链接后无法自动展开所有视频；当前只能扫描已打开的标签页，下一步支持直接解析 B 站合集 / YouTube Playlist URL 批量下载
- **视频合集自动识别** —— B 站单视频页面下方的 UP 主合集/系列，当前无法自动提取，计划自动识别并提示"检测到合集，是否批量下载？"
- **YouTube 播放列表支持** —— 类似 B 站合集，支持解析 YouTube Playlist 链接，自动展开所有视频

### 中期（未来 3-6 个月）
- **本地文件系统保存（可选）** —— 当前只能通过 Obsidian API 保存，部分用户只想下载到本地文件夹；计划通过 Chrome Downloads API 支持直接保存到磁盘
- **字幕翻译/双语对照** —— 下载中英双语字幕并合并为对照格式，方便语言学习
- **并发控制可调** —— 让用户在设置中调节下载间隔和并发数，平衡速度与稳定性

### 长期愿景
- **成为浏览器端视频知识管理的一站式工具**：不只是字幕，未来可能支持笔记摘录、视频章节提取、弹幕分析等
- **生态位**：与 yt-dlp、you-get 等命令行工具互补，主打"浏览器内一键操作、零配置、直连 Obsidian"的体验差异

**如何参与**
- 有需求？提交 Issue 并描述你的使用场景
- 想贡献？查看 Issue 列表，欢迎 PR

---

## 更新日志

### v1.2.0 (2025-06-08)
- ✨ **新增 YouTube 批量字幕下载** —— 扫描 youtube.com/watch 标签页，支持多语言字幕选择和自动选择
- ✨ **新增入口选择页** —— 批量下载页面分为 Bilibili / YouTube 两个独立入口
- ✨ 新增 `youtube-content.js` —— YouTube 内容脚本，读取 `ytInitialPlayerResponse` 获取字幕轨道
- ✨ 新增 `batch/youtube.html` / `youtube.js` / `youtube.css`
- 🔧 `manifest.json` 更新：新增 YouTube host_permissions 和 content_scripts
- 🔧 扩展名称更新为 `Video Subtitle Clipper｜B站 & YouTube 字幕批量下载`

### v1.1.0 (2025-06-08)
- ✨ **新增 Bilibili 批量下载模式** —— 扫描所有打开的 B 站标签页，A/B 选择分 P，一键批量保存到 Obsidian
- ✨ 新增 `batch/` 模块（bilibili.html / bilibili.js / bilibili.css）
- ✨ popup 面板新增 **"批量下载"** 入口按钮
- 🔧 manifest.json 新增 `tabs` 权限（用于扫描标签页）

### v1.0.17
- 原 [Bilibili Obsidian Clipper](https://github.com/decai335335-debug/bilibili-sub-md-chrome) 基础功能：单视频字幕抓取、Markdown/SRT/TXT 导出、Obsidian Local REST API 保存
