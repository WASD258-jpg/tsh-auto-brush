<h1 align="center">🛠️ TSH自动刷课</h1>

<p align="center"><strong>v2.1.0 · 双引擎版</strong></p>

<p align="center">
  <em>清华社英语在线（www.tsinghuaelt.com）油猴脚本。自动答题、章节推进、查成绩、学习时长保活。<br>
  内置新旧两套引擎，按地址栏自动适配 —— 装一次通用。</em>
</p>

<p align="center">
  <a href="https://github.com/WASD258-jpg/tsh-auto-brush/stargazers"><img src="https://img.shields.io/github/stars/WASD258-jpg/tsh-auto-brush?logo=github&label=Stars" alt="GitHub stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--only-3b82f6?style=flat" alt="GPL-3.0-only"></a>
  <a href="https://github.com/WASD258-jpg/tsh-auto-brush/releases/latest"><img src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-v2.1.0-16a34a" alt="Version"></a>
  <a href="https://www.tampermonkey.net/"><img src="https://img.shields.io/badge/Tampermonkey-Userscript-00485B?logo=tampermonkey&logoColor=fff" alt="Tampermonkey"></a>
  <br>
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=000" alt="JavaScript">
  <img src="https://img.shields.io/badge/grant-none-lightgrey" alt="grant none">
  <img src="https://img.shields.io/badge/%E5%8F%8C%E5%BC%95%E6%93%8E-%E6%96%B0%E7%89%88%20%2B%20%E6%97%A7%E7%AB%99-8b5cf6" alt="双引擎">
</p>

<p align="center">
  <a href="https://github.com/WASD258-jpg/tsh-auto-brush/releases/latest">下载</a> ·
  <a href="https://github.com/WASD258-jpg/tsh-auto-brush/issues/new">反馈</a> ·
  <a href="https://openuserjs.org/scripts/WASD258/TSH%E8%87%AA%E5%8A%A8%E5%88%B7%E8%AF%BE">OpenUserJS</a>
</p>

---

## ✅ 装一次就够 —— 无需再判断版本

站点现在是**双轨**运行，但**本脚本内置两套引擎，会自动识别并启用对应的一套**。

| 地址栏路径 | 实际前端 | 脚本行为 |
| --- | --- | --- |
| `/course_center/...` | 新版「智慧版」（Vue3 + Vite） | 自动启用**新版引擎** |
| `/legacy/...` | 旧站（Angular 7，仍在运行） | 自动启用**旧站引擎** |
| 其他页面 | 首页、课程列表等 | 待命，进入教材后自动启用 |

**你不需要做任何判断，装上就行。**

> **为什么会有两套前端**：站点自 2026-09 起提供新版，但旧站没有下线，只是挪到了 `/legacy/`。
> 登录时由统一认证中心 `uc.izhixue.cn` 按账号属性分流：
>
> ```js
> type: 1-正常登录  2-绑定手机  3-需要跳转到旧外语登录页  4-…  5-账号登录页
> ```
>
> 返回 `type === 3` 的账号会被送往 `/legacy/login`，**全程不签发新站令牌**。
> 因此**同一门课，不同的人可能看到两个完全不同的网站** —— 这正是过去"脚本时好时坏"反馈的根源。

### 历史版本

| 版本 | 说明 |
| --- | --- |
| **v2.1.0** | **双引擎版**（当前）—— 新旧两站通用 |
| v2.0.0 | 仅新版。已被 v2.1.0 取代 |
| v1.1.2 | 仅旧站。已被 v2.1.0 取代 |

---

## 🙏 征集：需要有**新版（智慧版）**访问权限的用户协助验证

### 为什么需要

**新版引擎**（对应新版站点 `/course_center/`）的实现依据是：接口契约、路由、
**24 种题型枚举**、DOM 结构**全部来自对线上构建产物的静态逆向**，逐条有据
（见 [DEVELOPMENT.md](DEVELOPMENT.md)）。

但作者本人的账号被平台分流到了**旧站**（旧站「跳转新版」接口对其返回 `403 权限异常`，
对应账号标识 `jumpPlat = 0`），**无法在登录态下实测新版**。

所以当前版本的状态是：**代码完整、静态逻辑自洽、148 项离线测试通过，但缺少新版的实机验证**。

### 你要做的（约 1 分钟）

如果你能正常打开 `/course_center/...`（新版页面）：

1. 安装脚本（v2.1.0 双引擎版，自动适配，无需选择）
2. 进入任意教材章节
3. 点击面板上的 **「结构自检」** 按钮
4. **[新建 issue](https://github.com/WASD258-jpg/tsh-auto-brush/issues/new)** 并把输出结果贴进去

### 自检输出包含什么（隐私说明）

**只含**：路由解析结果、令牌是否存在（**不输出令牌内容**）、DOM 探针命中数量、
题卡推断题型与数量、按钮状态、取题接口返回的**字段名**。

**不含**：账号、姓名、学校、课程名、题目内容、令牌值、任何个人标识。

### 能验证出什么

一次性确认这些**尚未在实机证实**的假设，任何一条被推翻我都会立即修正：

| 待验证项 | 若不成立的影响 |
| --- | --- |
| 学生身份下取题接口是否下发标准答案（`questionAnswerItemVOList[].answer`） | 不成立则需改走 AI 补答 |
| 单选答案是选项 `idx`（`"0"`/`"1"`）而非字母 `"A"` | 不成立则所有选择题选项错位 |
| 分页计数文本 `pagination-text` 的实际渲染 | 不成立则章节推进判断需换判据 |
| 填空作答元素是否为 `contenteditable` | 不成立则填空无法写入 |

### 联系方式

统一走 GitHub issue，便于留档与他人参照：

- **[新建 issue](https://github.com/WASD258-jpg/tsh-auto-brush/issues/new)** —— 结构自检结果、失效反馈、新版验证协助，都请**开新 issue**
- **愿意长期协助验证** → 在 issue 里说明，我会把你记入协作名单

> 历史 issue #1（旧脚本失效诊断）**已关闭**。它记录的是改版前的问题与诊断过程，
> 有考古价值但不再跟进。**新的反馈请一律开新 issue**，并附上「结构自检」输出。

---

## 新版站点适配说明（引擎 A）

站点已于 2026-09 提供新版：前端从 **Angular 7** 换成 **Vue3 + Vite/rolldown**，
API 从 `www.tsinghuaelt.com/tsenglish/` 迁到独立域名 `zhjyapi.tsinghuaelt.com/elt-user`。

旧版脚本依赖的全部 DOM 结构、路由与接口在新版上均已不存在，功能整体失效
（诊断过程见 [已关闭的 issue #1](https://github.com/WASD258-jpg/tsh-auto-brush/issues/1)，**请勿在该 issue 留言，新反馈请开新 issue**）。

因此**新版引擎**是针对新版站点的**整体重写**，依据来自对线上构建产物的静态逆向，而非猜测：

| 项 | 旧站（引擎 B） | 新版（引擎 A） |
| --- | --- | --- |
| API 域 | `www.tsinghuaelt.com/tsenglish/` | `zhjyapi.tsinghuaelt.com/elt-user` |
| 鉴权 | MD5 签名 + `sea-fetch-path` + AES 专属头 | 单一请求头 `elt-user-token`（令牌在 `localStorage.eltUserToken`） |
| 练习路由 | `/course-study-student/{bookId}/{courseId}/{userId}/{hash}` | `/course_center/reader/{type}/{bizId}?catalogId=&contentId=` |
| 作答模型 | 一页一题 + 右箭头翻页 | 整章滚动 + 题卡内嵌（分页按钮仍在） |
| 时长上报 | hook XHR 抓上报地址后重放 | 直连 `POST /user/study/time/record` |
| 答案来源 | 提交一次 → 读回标准答案 → 修正 → 再提交（试错法） | **取题接口直接下发标准答案** |

> 新版取题接口 `/question/echo/content/{contentId}/answer` 会把标准答案一并返回，
> 因此新版引擎改为「先取答案 → 一次填对 → 提交」，不再需要旧的试错法。

### ⚠️ 关于实测状态（请务必阅读）

**新版引擎**的接口契约、路由格式、题型枚举、DOM 结构均已从线上产物中逐条提取并交叉验证
（见 [DEVELOPMENT.md](DEVELOPMENT.md) 的证据章节），但作者**无法在登录态下完成端到端实测**
（没有可用的测试账号）。

因此脚本内置 **「结构自检」** 按钮：在阅读器页面点击后，会打印当前路由解析、令牌状态、
DOM 探针命中情况、题卡推断题型、提交/分页按钮状态，以及取题接口的真实返回结构。

**如果功能不生效，请先点「结构自检」，把输出贴到 issue。** 有了这份输出，定位失效点通常只需一次修改。

---

## 安装

1. 浏览器安装 Tampermonkey（油猴）
2. 打开 Tampermonkey 管理面板 → 新建脚本
3. 粘贴 `tsh-auto-brush.user.js` 全部内容，保存
4. 打开 `www.tsinghuaelt.com` 并登录
5. 进入任意教材/课程，打开具体章节（URL 形如 `/course_center/reader/...?catalogId=...`）

> 已装旧版的用户：Tampermonkey 会依据 `@version` 提示更新；若未提示，
> 在管理面板手动「检查更新」，或重新安装。

---

## 使用

页面右下角为控制面板：

| 按钮 | 作用 |
| --- | --- |
| 开始刷课 | 全自动：取题 → 填答 → 提交 → 章节推进，循环直至到最后一节 |
| 做一轮 | 只执行一轮，便于观察行为 |
| 查成绩 | 查询课程学习情况（学生课程页可用） |
| 时长保活（防空闲熔断） | 站点自身每 10 秒上报学习时长，但**空闲满 10 分钟会跳过上报**。此功能周期派发无害的用户活动事件，让站点的计时器保持活跃 |
| 结构自检 | 排错用：打印页面识别、接口返回与 DOM 探针结果 |

推荐流程：登录 → 进入教材/课程 → 打开第一章 → 点「开始刷课」。

> **关于学习时长**：站点本身的设计就是「页面开着 + 有交互」即自动累计，不需要脚本代刷。
> 「时长保活」只是防止挂机 10 分钟后被熔断。这也是为什么它按分钟级而非秒级运行。

---

## AI 配置（可选，仅作兜底）

面板「设置」→ AI 区：

1. 勾选「启用 AI 补答」
2. API Base URL：OpenAI 兼容接口，如 DeepSeek `https://api.deepseek.com/v1`
3. API Key：你的密钥
4. 模型名：如 `deepseek-chat`
5. 保存（存本地 localStorage，只填一次）

AI **仅在页面未下发标准答案时**使用。新站正常情况下取题接口已含答案，无需配置。

---

## 失效自动上报（开源协作，可选）

脚本内置有效性检测：在阅读器页面检测核心 DOM 结构，若连续 10 轮全部缺失（站点再次改版）
则判定脚本失效，经你同意后自动向 GitHub 仓库发 issue（附结构自检结果，24 小时去重）。

- 首次启用会弹**知情同意书**，默认不允许；同意后才显示上报设置（仍默认关闭）
- 设置面板「失效上报」：启用开关 + GitHub 用户名/仓库名 + Token + 发测试 issue 验证
- Token 创建：GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens，仓库权限勾选 **Issues: Read and write**
- 隐私：issue 仅含脚本版本、站点构建版本、已打码的页面路径、检测结果、时间与自检输出

**安全提示**：Token 与 API Key 存本地 localStorage（明文），请使用权限最小化的令牌。
启用 AI 后题目文本会发送到你配置的 API 服务商；失效上报只发 GitHub。

---

## 已知限制

- **新版引擎未登录态实测**：作者账号被平台分流至旧站（无新版权限）。请用「结构自检」反馈问题
- **旧站引擎未更新**：沿用 v1.1.2 逻辑，未针对旧站做过新的适配或验证
- **语音题无法自动作答**（新版）：口语（`oral_simple_speak` / `oral_follow_along` / `oral_roleplay` / `oral_vocabulary_learning`）走驰声 chivox 实时评测（WebSocket + 麦克风采集 + 服务端打分），必须真人录音。脚本会识别出来并提示跳过，不会伪造音频
- **拖拽类**（新版）的事件序列已按产物还原，但**未在登录态下实测**
- 作业/考试模块有全屏监控、切屏自动提交、人脸抓拍等强反作弊，脚本不触碰，也请勿用于作业测试
- 新版站点启用了阿里云 RUM **会话回放**（`replay: true`，全站 100% 采样），操作节奏会被记录
- 脚本依赖当前站点结构，站点改版可能导致失效（失效上报会自动通知）

## ⚠️ 安全提醒：该站点会把密码明文放进 URL

若你的账号走 `type === 3` 分流，平台前端会拼接：

```
https://www.tsinghuaelt.com/legacy/login?appId=user_center&sign=<账号>##<密码明文>
```

这是**平台自身的实现缺陷**（见 `uc.izhixue.cn/js/login.js`），会进入浏览器历史、可能被服务端日志与
分析类 SDK（该站启用了阿里云 RUM）采集。

**建议经此入口登录过的用户修改密码**，并避免在公共设备上使用该登录链路。

## 协议与贡献

- 本项目以 GPL-3.0 开源（见 [LICENSE](LICENSE)），欢迎 fork / PR / issue
- 反馈失效请附带「结构自检」输出，这能极大缩短修复时间
- 贡献前请确保不包含任何个人账号/课程信息；脚本头部保留版权声明与 GPL-3.0 许可

---

## 版本状态

**只需安装当前版本** —— 它同时覆盖新版与旧站，历史版本不用管。

| 版本 | 覆盖范围 | 状态 |
| --- | --- | --- |
| **v2.1.0（当前）** | **新版 + 旧站** | ✅ **装这个** |
| v2.0.0 及更早 | 仅单一站点 | ❌ 已被取代，不要装 |

> 为什么会有"仅单一站点"的版本：双引擎方案是逐步演进出来的。
> v2.0.0 只改了新版，v1.1.2 只服务旧站，用户得自己判断装哪个 —— 那正是 v2.1.0 要消灭的摩擦。
>
> **提醒**：如果你的 Tampermonkey 里还留着 v1.1.2 或 v2.0.0，建议删掉旧的那份，
> 只保留 v2.1.0（同名脚本装两份会重复注入面板）。

## 版本历史

| 版本 | 说明 |
| --- | --- |
| **2.1.0** | **双引擎版**：内置新旧两套引擎，按 `location.pathname` 自动分派（`/course_center/` → 新版，`/legacy/` → 旧站），装一次通用。两引擎各包独立 IIFE，20 处同名函数互不干扰 |
| 2.0.0 | 新版重写：适配 Vue3。API 域/鉴权/路由/接口全部重写；改为「取题接口直接拿标准答案」一次填对；接入 24 种题型枚举；实现拖拽作答；新增结构自检 |
| 1.1.2 | 全新身份：改名 TSH自动刷课、namespace/存储键/文件名全新；知情同意书版本化、GUI 重写。**对应旧站 `/legacy/`** |
| 1.1.3 | （未发布，已撤回）停止维护 |
| 1.0.0 | 发布版：清理死代码、加载容错、翻页 URL 校验、弹窗白名单 |
| 0.9.x | 右箭头全自动：自动翻页跨任务/跨单元；降频规避限流；限流自动冷却恢复 |
| 0.7.x | 查成绩 + 刷学习时长 + AI 接入 |
| 0.6.x | 基于 2026 实测 DOM 重写 |
