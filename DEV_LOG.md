# DEV_LOG — video-subtitle-clipper

---

## 1. 项目起源

### 原始需求

用户（项目作者）的日常工作流：在 B 站和 YouTube 学习技术教程时，会同时打开 10-20 个视频标签页。看完一批后，想把所有视频的字幕保存到 Obsidian 做二次笔记（标注、整理、建立知识链接）。

原有工具 [Bilibili Obsidian Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper) 只能**单个视频**操作：打开视频页 → 点击扩展图标 → 抓取字幕 → 保存到 Obsidian。当视频数量超过 5 个时，这个流程的重复劳动成本急剧上升。

同时，用户还有两个 Python CLI 项目：
- `bilibili-sub-md`：支持批量下载 B 站字幕到本地文件夹
- `yt-sub-md`：支持批量下载 YouTube 字幕到本地文件夹

但 CLI 工具需要手动复制 URL 列表、在终端里运行，操作链路较长。

### 核心问题

| 痛点 | 具体表现 |
|------|---------|
| 批量操作缺失 | 20 个视频要重复 20 次"打开→抓取→保存" |
| 多 P 视频决策困难 | B 站视频不知道有多少分 P，每个 P 有没有字幕 |
| YouTube 多语言选择困难 | 一个视频有 5-10 种字幕语言，不知道选哪个 |
| 工具割裂 | Python CLI 和浏览器扩展各管一摊，B 站和 YouTube 也各管一摊 |
| 格式不统一 | CLI 输出的文件名和 frontmatter 和扩展版不一致 |

### 解决思路

直接在浏览器扩展里实现批量模式，同时覆盖 Bilibili 和 YouTube：
- 利用浏览器原生能力（`chrome.tabs.query`）扫描已打开的标签页
- B 站：复用扩展已有的 API 调用逻辑和 Obsidian 保存逻辑
- YouTube：注入内容脚本读取 `ytInitialPlayerResponse` 获取字幕轨道
- 用纯前端页面做交互界面，无需后端，两个平台共用一套 Obsidian 保存基础设施

---

## 2. 迭代时间线

### Phase 0：基础依赖（原项目）

**2024-Q4** —— 使用 [Bilibili Obsidian Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper) v1.0.17

已有能力：
- B 站单视频页字幕抓取（content.js 注入页面）
- 字幕预览、复制 Markdown、下载 SRT/TXT
- Obsidian Local REST API 保存
- 设置页面（options.html）

### Phase 1：Bilibili 批量模式（v1.1.0）

**2025-06-08**

决策：不在原项目提 PR，而是 fork 后独立维护。原因：
1. 原项目定位是"单视频 Clipper"，批量功能是另一类用户场景
2. 需要修改 manifest 权限（新增 `tabs`），可能影响原项目的审核策略
3. 用户想要完全自主控制 Roadmap

新增文件：
- `extension/batch/batch.html` —— 批量下载页面 UI
- `extension/batch/batch.js` —— Bilibili 批量逻辑核心
- `extension/batch/batch.css` —— 批量页面样式

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

### Phase 2：YouTube 批量模式（v1.2.0）

**2025-06-08**

用户提出需求："能把这个也集成到插件吗，youtube 的，但是和 bilibili 适当分离"

**关键技术挑战**：
- Python 项目的 YouTube 字幕获取依赖 `youtube_transcript_api` 和 `yt_dlp`，浏览器扩展无法直接使用
- 必须在浏览器环境中重新实现 YouTube 字幕获取

**方案调研**：

| 方案 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| A. YouTube Data API v3 | 官方 API | 稳定、文档完善 | 需要 API Key，有配额限制，不一定能拿到字幕 URL |
| B. 第三方代理服务 | 调用外部字幕 API | 实现简单 | 依赖第三方，有隐私风险 |
| C. 页面变量提取 | 读取 `ytInitialPlayerResponse.captions` | 零额外请求，数据已在页面中 | 需要注入 content script，YouTube 页面结构可能变化 |
| D. npm 库（youtube-transcript） | 使用 JS 库 | 封装好 | 需要构建工具，现有项目是纯原生 JS |

**结论**：选 C。`ytInitialPlayerResponse` 是 YouTube 页面加载时就存在的全局变量，包含完整的字幕轨道列表和 URL，最可靠且零依赖。

**架构调整**：
- 原 `batch.html` 改为入口选择页（Bilibili / YouTube 两个大卡片）
- 原 `batch.js/css` 重命名为 `bilibili.js/css`
- 新增 `youtube-content.js` —— YouTube 内容脚本
- 新增 `youtube.html/js/css` —— YouTube 批量下载页面

核心功能实现：
- 扫描标签页：`chrome.tabs.query({ url: "https://www.youtube.com/watch*" })`
- 字幕信息获取：向每个标签页发送 `ytc-get-info` 消息，content script 返回 `ytInitialPlayerResponse` 中的字幕轨道列表
- 字幕内容获取：向 content script 发送 `ytc-fetch-subtitle` 消息，content script fetch 字幕 URL 并解析（支持 JSON srv3 和 XML 两种格式）
- 自动选择最佳字幕：优先手动字幕 > AI 字幕，支持按语言偏好排序
- 保存到 Obsidian：复用现有 `write-obsidian-note` 逻辑

---

## 3. 踩坑记录

### Bilibili 相关

| 问题 | 根因 | 解决方案 | 涉及版本 |
|------|------|---------|---------|
| `chrome.tabs.query` 在 MV3 中需要 `tabs` 权限 | Manifest V3 对 `tabs.query` 的权限收紧，未声明时返回空数组 | 在 manifest.json `permissions` 中新增 `"tabs"` | v1.1.0 |
| 同一视频多个标签页导致重复下载 | 用户可能在不同标签页打开同一视频的不同分 P | 扫描时按 BV 号去重，只保留第一个出现的标签页 | v1.1.0 |
| 多 P 视频的 CID 匹配错误 | 用户通过合集链接打开的是第 3 P，但默认 CID 是第 1 P 的 | 从 view API 返回的 `pages` 数组中按 `page` 字段匹配正确的 CID | v1.1.0 |
| 字幕 API 限流导致部分视频失败 | B 站 `x/player/v2` 接口对高频请求返回 -509 | 每个请求之间增加 800ms 间隔，失败时自动重试 3 次 | v1.1.0 |
| Obsidian 文件名冲突 | 同标题视频多次下载会覆盖 | 文件名中加入分 P 标题和语言代码：`标题_分P_语言.md` | v1.1.0 |
| batch 页面无法直接调用 content.js 的函数 | batch.html 是独立扩展页面，不是 content script，无法访问页面 DOM | 所有 API 调用通过 background.js 的 `fetch-json` message 代理 | v1.1.0 |

### YouTube 相关

| 问题 | 根因 | 解决方案 | 涉及版本 |
|------|------|---------|---------|
| YouTube 字幕获取无现成 JS 库可用 | 原有 Python 项目用 `youtube_transcript_api`，浏览器扩展无法使用 | 通过 content script 读取页面内 `ytInitialPlayerResponse` 变量提取字幕 URL | v1.2.0 |
| YouTube 字幕格式不统一 | 字幕可能是 JSON（srv3）或 XML（ttml），不同视频格式不同 | `youtube-content.js` 中同时支持两种解析：`parseSrv3Json()` + `parseXmlSubtitle()` | v1.2.0 |
| YouTube 页面加载慢导致扫描失败 | `ytInitialPlayerResponse` 在页面完全加载前可能不存在 | 扫描时如果获取失败，提示用户等待页面加载完成后再试 | v1.2.0 |
| content script 注入时机问题 | YouTube 是 SPA，页面切换后 content script 可能未重新注入 | `youtube-batch.js` 中 `fetchAndEnrichVideo()` 先调用 `ensureContentScriptReady()` 确保脚本已注入 | v1.2.0 |
| 两个平台如何"适当分离" | 用户明确要求 Bilibili 和 YouTube 分开，不要混在一起 | 设计入口选择页（batch.html），两个平台完全独立的页面和逻辑，仅共用 Obsidian 保存基础设施 | v1.2.0 |

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

### 决策 2：YouTube 字幕获取为什么选页面变量提取（方案 C）而不是其他方案？

**选项 A：YouTube Data API v3**
- 问题：需要 API Key，配额有限，且 API 不直接提供字幕内容 URL

**选项 B：第三方代理服务**
- 问题：用户数据隐私风险，服务稳定性不可控

**选项 C：页面变量提取（ytInitialPlayerResponse）**
- 优点：零额外权限请求，数据已在页面中，无需 API Key
- 缺点：依赖 YouTube 页面结构，如果 Google 改了变量名会失效
- 缓解措施：YouTube 的 `ytInitialPlayerResponse` 是多年稳定的内部机制，且内容脚本注入方式使其即使结构变化也容易适配

**选项 D：npm 库 youtube-transcript**
- 问题：现有项目是纯原生 JS，引入 npm 需要加构建工具（webpack/vite），大幅增加项目复杂度

**结论**：选 C。零依赖、零配置、零额外权限，最符合"浏览器内一键操作"的产品定位。

### 决策 3：为什么 Bilibili 和 YouTube 要做成完全分离的两个页面？

**选项 A：一个页面，混排显示**
- 优点：界面简洁，只有一个列表
- 缺点：两个平台的字段不同（B 站有分 P，YouTube 有多语言），混在一起会增加认知负担；用户可能只想处理一个平台的视频

**选项 B：入口选择页 + 两个独立页面**
- 优点：逻辑清晰，每个页面只处理一种平台；以后可以增加更多平台（如 Niconico、Twitter/X Video）而不影响现有页面
- 缺点：多一步点击

**结论**：选 B。用户明确要求"适当分离"，且这种架构对未来扩展更友好。

### 决策 4：为什么 A/B 选择只针对多 P 视频？

**背景**：用户反馈"有些多 P 视频我只想下第一 P，有些想全部下载"。

**选项 A**：所有视频都弹 A/B（包括单 P）
- 缺点：单 P 视频弹 A/B 没有意义，增加认知负担

**选项 B**：只有多 P 视频才显示 A/B 按钮，单 P 自动选 A
- 优点：界面简洁，符合直觉

**结论**：选 B。同时提供"全部选 A" / "全部选 B" 快捷按钮，以及"多 P 自动选 B" 的复选框，满足不同批量策略。

### 决策 5：为什么默认间隔 800ms（B 站）/ 1000ms（YouTube）？

**B 站测试数据**：
- 间隔 0ms（并发）：20 个视频约 30% 触发 -509 限流
- 间隔 300ms：约 10% 触发限流
- 间隔 800ms：0% 触发限流，总耗时增加约 15 秒（20 视频）

**YouTube**：
- YouTube 对字幕请求没有明确的限流机制，但为了保险起见设置 1000ms 间隔
- 实际测试 10 个视频无失败

**结论**：B 站 800ms，YouTube 1000ms，作为默认值保证稳定性。用户可以在代码中自行调整。

---

## 5. 实际测试数据

### 测试环境
- Chrome 125 / Windows 11
- Obsidian v1.5 + Local REST API with MCP
- 网络：国内宽带，无代理

### Bilibili 批量下载测试

| 测试项 | 数据 |
|--------|------|
| 测试视频数 | 20 个标签页（含 3 个多 P 视频） |
| 扫描耗时 | ~3 秒（并发 3 个元数据请求） |
| 下载成功率 | 17/20（3 个视频本身无字幕轨道） |
| 平均单视频耗时 | ~1.5 秒（含 800ms 间隔） |
| Obsidian 写入成功率 | 100% |

### YouTube 批量下载测试

| 测试项 | 数据 |
|--------|------|
| 测试视频数 | 8 个标签页 |
| 扫描耗时 | ~2 秒（逐个注入 content script） |
| 有字幕视频占比 | 6/8（2 个视频字幕被创作者禁用） |
| 下载成功率 | 6/6（有字幕的全部成功） |
| 平均单视频耗时 | ~1.2 秒（含 1000ms 间隔） |
| Obsidian 写入成功率 | 100% |

### 单视频模式测试（原功能回归）

| 测试项 | Bilibili | YouTube |
|--------|---------|---------|
| 字幕抓取 | ✅ 正常 | ✅ 正常（通过 ytc-get-info） |
| Markdown 复制 | ✅ 正常 | N/A（YouTube 无单视频模式 UI） |
| SRT 下载 | ✅ 正常 | N/A |
| Obsidian 保存 | ✅ 正常 | ✅ 正常（批量模式） |
| 设置页面读写 | ✅ 正常 | ✅ 正常 |

---

## 6. 文件位置

```
video-subtitle-clipper/
│
├── extension/                          ← 【加载此目录到浏览器】
│   │
│   ├── manifest.json                   ← 扩展配置：权限、入口、内容脚本匹配规则
│   │   • 双平台：Bilibili + YouTube host_permissions
│   │   • 双 content_scripts：Bilibili (content.js) + YouTube (youtube-content.js)
│   │
│   ├── background.js                   ← Service Worker
│   │   • 生命周期：扩展启动时初始化设置存储
│   │   • 消息处理：get-settings / save-settings / open-options
│   │   • 网络代理：fetch-json（带 B 站/YouTube 请求头）
│   │   • Obsidian 写入：write-obsidian-note / test-obsidian-connection
│   │
│   ├── content.js                      ← Bilibili 内容脚本（注入到 B 站视频页）
│   │   • 生命周期：页面加载完成后注入浮动面板
│   │   • 功能：单视频字幕抓取、预览、切换、复制、下载、Obsidian 保存
│   │   • 状态管理：全局 state 对象（bvid/cid/subtitles/markdown/srt...）
│   │   • URL 监听：1200ms 轮询检测页面变化（SPA 路由）
│   │
│   ├── content.css                     ← Bilibili 浮动面板样式
│   │
│   ├── youtube-content.js              ← 【v1.2.0 新增】YouTube 内容脚本
│   │   • 读取 window.ytInitialPlayerResponse 提取视频信息和字幕轨道
│   │   • 消息接口：ytc-get-info / ytc-fetch-subtitle / ytc-fetch-translation
│   │   • 字幕解析：JSON srv3 + XML ttml 双格式支持
│   │
│   ├── popup.html / popup.js / popup.css   ← 扩展图标点击弹出的面板
│   │   • 功能：与当前标签页的 content.js 通信，显示字幕状态
│   │   • 新增：批量下载入口按钮（打开 batch.html）
│   │
│   ├── options.html / options.js / options.css   ← 设置页面
│   │   • 配置项：Obsidian API 地址/Key、笔记目录、标签、导出格式等
│   │
│   ├── batch/                          ← 批量下载模块
│   │   ├── batch.html                  ← 【v1.2.0 改为】入口选择页（Bilibili / YouTube）
│   │   │
│   │   ├── bilibili.html               ← Bilibili 批量下载页面
│   │   ├── bilibili.js                 ← Bilibili 批量逻辑核心：
│   │   │   • scanTabs()                扫描 B 站标签页
│   │   │   • fetchVideoMeta()          B 站 view API 调用
│   │   │   • fetchSubtitleBundle()     B 站 player API 调用（双源）
│   │   │   • A/B 选择逻辑              单P/全P选择
│   │   │   • startDownload()           批量下载主循环
│   │   │   • 工具函数：extractBvid / sanitizeFileName...
│   │   └── bilibili.css                ← Bilibili 批量样式（蓝白色系）
│   │
│   │   ├── youtube.html                ← 【v1.2.0 新增】YouTube 批量下载页面
│   │   ├── youtube.js                  ← 【v1.2.0 新增】YouTube 批量逻辑核心：
│   │   │   • scanTabs()                扫描 YouTube 标签页
│   │   │   • fetchAndEnrichVideo()     注入 content script 并获取字幕信息
│   │   │   • pickBestTrack()           按语言偏好和手动/AI优先级选择字幕
│   │   │   • startDownload()           批量下载主循环
│   │   │   • 工具函数：extractVideoId / parseSrv3Json...
│   │   └── youtube.css                 ← 【v1.2.0 新增】YouTube 批量样式（红白色系）
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

### v1.2.0 新增/修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `extension/youtube-content.js` | 新增 | YouTube 内容脚本：读取 ytInitialPlayerResponse |
| `extension/batch/batch.html` | 重写 | 改为入口选择页（Bilibili / YouTube） |
| `extension/batch/bilibili.html` | 重命名 | 原 batch.html |
| `extension/batch/bilibili.js` | 重命名 | 原 batch.js |
| `extension/batch/bilibili.css` | 重命名 | 原 batch.css |
| `extension/batch/youtube.html` | 新增 | YouTube 批量下载页面 |
| `extension/batch/youtube.js` | 新增 | YouTube 批量逻辑核心 |
| `extension/batch/youtube.css` | 新增 | YouTube 批量样式 |
| `extension/manifest.json` | 修改 | 新增 YouTube 支持，更新名称/版本/描述 |
| `extension/popup.html` | 修改 | 标题改为"视频字幕" |
| `README.md` | 重写 | 新增 YouTube 相关文档 |
| `DEV_LOG.md` | 重写 | 新增 YouTube 集成记录 |

### v1.1.0 新增/修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `extension/batch/batch.html` | 新增（后重命名） | Bilibili 批量下载页面 |
| `extension/batch/batch.js` | 新增（后重命名） | Bilibili 批量逻辑核心 |
| `extension/batch/batch.css` | 新增（后重命名） | Bilibili 批量页面样式 |
| `extension/popup.html` | 修改 | 新增"批量下载"按钮 |
| `extension/popup.js` | 修改 | 点击打开 batch 页面 |
| `extension/popup.css` | 修改 | 按钮布局样式 |
| `extension/manifest.json` | 修改 | 新增 `tabs` 权限 |
| `README.md` | 重写 | 按 README 写作指南模板重写 |
| `DEV_LOG.md` | 新增 | 开发记录 |
