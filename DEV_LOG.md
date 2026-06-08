# DEV_LOG — bilibili-sub-md-chrome

---

## 1. 项目起源

### 原始需求

用户（项目作者）的日常工作流：在 B 站学习技术教程时，会同时打开 10-20 个视频标签页。看完一批后，想把所有视频的字幕保存到 Obsidian 做二次笔记（标注、整理、建立知识链接）。

原有工具 [Bilibili Obsidian Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper) 只能**单个视频**操作：打开视频页 → 点击扩展图标 → 抓取字幕 → 保存到 Obsidian。当视频数量超过 5 个时，这个流程的重复劳动成本急剧上升。

同时，用户之前还有一个 Python CLI 项目 `bilibili-sub-md`，支持批量下载字幕到本地文件夹，但需要手动复制 URL 列表、在终端里运行，操作链路较长。

### 核心问题

| 痛点 | 具体表现 |
|------|---------|
| 批量操作缺失 | 20 个视频要重复 20 次"打开→抓取→保存" |
| 多 P 视频决策困难 | 不知道视频有多少分 P，每个 P 有没有字幕 |
| 工具割裂 | Python CLI 和浏览器扩展各管一摊，没有统一体验 |
| 格式不统一 | CLI 输出的文件名和 frontmatter 和扩展版不一致 |

### 解决思路

直接在浏览器扩展里实现批量模式：
- 利用浏览器原生能力（`chrome.tabs.query`）扫描已打开的标签页
- 复用扩展已有的 B 站 API 调用逻辑和 Obsidian 保存逻辑
- 用纯前端页面（batch.html）做交互界面，无需后端

---

## 2. 迭代时间线

### Phase 0：基础依赖（原项目）

**2024-Q4** —— 使用 [Bilibili Obsidian Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper) v1.0.17

已有能力：
- 单视频页字幕抓取（content.js 注入页面）
- 字幕预览、复制 Markdown、下载 SRT/TXT
- Obsidian Local REST API 保存
- 设置页面（options.html）

### Phase 1：批量模式（v1.1.0）

**2025-06-08**

决策：不在原项目提 PR，而是 fork 后独立维护。原因：
1. 原项目定位是"单视频 Clipper"，批量功能是另一类用户场景
2. 需要修改 manifest 权限（新增 `tabs`），可能影响原项目的审核策略
3. 用户想要完全自主控制 Roadmap

新增文件：
- `extension/batch/batch.html` —— 批量下载页面 UI
- `extension/batch/batch.js` —— 核心逻辑（~600 行）
- `extension/batch/batch.css` —— 样式

修改文件：
- `extension/popup.html` —— 新增"批量下载"入口按钮
- `extension/popup.js` —— 点击打开 batch 页面
- `extension/popup.css` —— 按钮布局
- `extension/manifest.json` —— 新增 `tabs` 权限

核心功能实现：
- 扫描标签页：`chrome.tabs.query({ url: "https://www.bilibili.com/video/*" })`
- 元数据获取：复用 `fetchVideoMeta()` 逻辑，并发 3 个请求
- 字幕获取：复用 `fetchSubtitleBundle()` 的双源策略（wbi/v2 → v2）
- A/B 选择：A=只下第 1P，B=全部分 P（多 P 视频才显示 B 按钮）
- 保存到 Obsidian：复用 background.js 的 `write-obsidian-note` message

---

## 3. 踩坑记录

| 问题 | 根因 | 解决方案 | 涉及版本 |
|------|------|---------|---------|
| `chrome.tabs.query` 在 MV3 中需要 `tabs` 权限 | Manifest V3 对 `tabs.query` 的权限收紧，未声明时返回空数组 | 在 manifest.json `permissions` 中新增 `"tabs"` | v1.1.0 |
| 同一视频多个标签页导致重复下载 | 用户可能在不同标签页打开同一视频的不同分 P | 扫描时按 BV 号去重，只保留第一个出现的标签页 | v1.1.0 |
| 多 P 视频的 CID 匹配错误 | 用户通过合集链接打开的是第 3 P，但默认 CID 是第 1 P 的 | 从 view API 返回的 `pages` 数组中按 `page` 字段匹配正确的 CID | v1.1.0 |
| 字幕 API 限流导致部分视频失败 | B 站 `x/player/v2` 接口对高频请求返回 -509 | 每个请求之间增加 800ms 间隔，失败时自动重试 3 次 | v1.1.0 |
| Obsidian 文件名冲突 | 同标题视频多次下载会覆盖 | 文件名中加入分 P 标题和语言代码：`标题_分P_语言.md` | v1.1.0 |
| batch 页面无法直接调用 content.js 的函数 | batch.html 是独立扩展页面，不是 content script，无法访问页面 DOM | 所有 API 调用通过 background.js 的 `fetch-json` message 代理 | v1.1.0 |

---

## 4. 设计决策

### 决策 1：为什么用独立页面（batch.html）而不是在 popup 里做批量？

**选项 A**：在 popup 里扩展（保持单面板）
- 优点：入口统一，用户不用跳转
- 缺点：popup 最大高度有限（Chrome 约 600px），放不下长列表；popup 失去焦点会自动关闭，下载过程中不能切换标签页

**选项 B**：打开独立标签页（batch.html）
- 优点：空间充足，支持长列表；不会自动关闭，下载过程中可以自由操作浏览器
- 缺点：多一步跳转

**结论**：选 B。批量下载是"后台任务"场景，用户需要看到进度条、可能要等待几分钟，popup 不适合这种长时间任务。

### 决策 2：为什么复用原项目的 API 逻辑，而不是重写？

**选项 A**：重写一套 API 调用（batch.js 独立）
- 优点：完全解耦，以后改单视频逻辑不影响批量
- 缺点：维护两套几乎相同的 B 站 API 调用代码，容易不同步

**选项 B**：复用原项目的 `fetchSubtitleBundle`、`fetchVideoMeta` 等逻辑
- 优点：一套代码，B 站 API 变动时只需改一处
- 缺点：batch.js 需要内联这些函数（因为 content.js 的函数无法直接被 batch.html 调用）

**结论**：选 B 但做代码复制。batch.js 内联了 `fetchVideoMeta`、`fetchSubtitleBundle`、`fetchSubtitleBody` 等函数，保持与原项目逻辑一致。如果以后原项目升级 API 逻辑，batch.js 需要同步更新。

### 决策 3：为什么 A/B 选择只针对多 P 视频？

**背景**：用户反馈"有些多 P 视频我只想下第一 P，有些想全部下载"。

**选项 A**：所有视频都弹 A/B（包括单 P）
- 缺点：单 P 视频弹 A/B 没有意义，增加认知负担

**选项 B**：只有多 P 视频才显示 A/B 按钮，单 P 自动选 A
- 优点：界面简洁，符合直觉

**结论**：选 B。同时提供"全部选 A" / "全部选 B" 快捷按钮，以及"多 P 自动选 B" 的复选框，满足不同批量策略。

### 决策 4：为什么默认间隔 800ms？

**测试数据**：
- 间隔 0ms（并发）：20 个视频约 30% 触发 -509 限流
- 间隔 300ms：约 10% 触发限流
- 间隔 800ms：0% 触发限流，总耗时增加约 15 秒（20 视频）

**结论**：800ms 是稳定性与速度的折中。作为默认值，用户可以在代码中自行调整。

---

## 5. 实际测试数据

### 测试环境
- Chrome 125 / Windows 11
- Obsidian v1.5 + Local REST API with MCP
- 网络：国内宽带，无代理

### 批量下载测试

| 测试项 | 数据 |
|--------|------|
| 测试视频数 | 20 个标签页（含 3 个多 P 视频） |
| 扫描耗时 | ~3 秒（并发 3 个元数据请求） |
| 下载成功率 | 17/20（3 个视频本身无字幕轨道） |
| 平均单视频耗时 | ~1.5 秒（含 800ms 间隔） |
| Obsidian 写入成功率 | 100% |

### 单视频模式测试（原功能回归）

| 测试项 | 结果 |
|--------|------|
| 字幕抓取 | ✅ 正常 |
| Markdown 复制 | ✅ 正常 |
| SRT 下载 | ✅ 正常 |
| Obsidian 保存 | ✅ 正常 |
| 设置页面读写 | ✅ 正常 |

---

## 6. 文件位置

```
bilibili-sub-md-chrome/
│
├── extension/                          ← 【加载此目录到浏览器】
│   │
│   ├── manifest.json                   ← 扩展配置：权限、入口、内容脚本匹配规则
│   │
│   ├── background.js                   ← Service Worker
│   │   • 生命周期：扩展启动时初始化设置存储
│   │   • 消息处理：get-settings / save-settings / open-options
│   │   • 网络代理：fetch-json（带 B 站请求头）
│   │   • Obsidian 写入：write-obsidian-note / test-obsidian-connection
│   │
│   ├── content.js                      ← 内容脚本（注入到 B 站视频页）
│   │   • 生命周期：页面加载完成后注入浮动面板
│   │   • 功能：单视频字幕抓取、预览、切换、复制、下载、Obsidian 保存
│   │   • 状态管理：全局 state 对象（bvid/cid/subtitles/markdown/srt...）
│   │   • URL 监听：1200ms 轮询检测页面变化（SPA 路由）
│   │
│   ├── content.css                     ← 浮动面板样式
│   │
│   ├── popup.html / popup.js / popup.css   ← 扩展图标点击弹出的面板
│   │   • 功能：与当前标签页的 content.js 通信，显示字幕状态
│   │   • 新增：批量下载入口按钮（打开 batch.html）
│   │
│   ├── options.html / options.js / options.css   ← 扩展设置页面
│   │   • 配置项：Obsidian API 地址/Key、笔记目录、标签、导出格式等
│   │
│   ├── batch/                          ← 【新增】批量下载模块
│   │   ├── batch.html                  ← 批量页面骨架
│   │   ├── batch.js                    ← 批量逻辑核心：
│   │   │   • init() / bindEvents()     初始化与事件绑定
│   │   │   • scanTabs()                扫描标签页 + 获取元数据
│   │   │   • fetchVideoMeta()          B 站 view API 调用
│   │   │   • fetchSubtitleBundle()     B 站 player API 调用（双源）
│   │   │   • startDownload()           批量下载主循环
│   │   │   • downloadOnePage()         单分 P 下载 + Obsidian 保存
│   │   │   • buildMarkdownContent()    Markdown 内容生成
│   │   │   • renderVideoList()         视频列表 UI 渲染
│   │   │   • 工具函数：extractBvid / sanitizeFileName / formatSrtTime...
│   │   └── batch.css                   ← 批量页面样式：卡片列表、进度条、状态色
│   │
│   └── icons/                          ← 扩展图标（16/32/48/128px）
│
├── docs/images/                        ← 文档图片（功能演示截图）
│
├── scripts/
│   └── build_release.py                ← 打包脚本：生成 chrome/firefox 发布包
│
├── README.md                           ← 用户文档
├── DEV_LOG.md                          ← 本文档（开发记录）
└── LICENSE
```

---

## 附录：快速参考

### 新增/修改的文件清单（v1.1.0）

| 文件 | 操作 | 说明 |
|------|------|------|
| `extension/batch/batch.html` | 新增 | 批量下载页面 |
| `extension/batch/batch.js` | 新增 | 批量逻辑核心 |
| `extension/batch/batch.css` | 新增 | 批量页面样式 |
| `extension/popup.html` | 修改 | 新增"批量下载"按钮 |
| `extension/popup.js` | 修改 | 点击打开 batch 页面 |
| `extension/popup.css` | 修改 | 按钮布局样式 |
| `extension/manifest.json` | 修改 | 新增 `tabs` 权限 |
| `README.md` | 重写 | 按 README 写作指南模板重写 |
| `DEV_LOG.md` | 新增 | 开发记录 |
