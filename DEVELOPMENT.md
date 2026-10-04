# TSH自动刷课 — 开发文档

> 脚本：`tsh-auto-brush.user.js`（v2.0.0，Tampermonkey 油猴脚本）
> 作者：WASD258-jpg · 协议：GPL-3.0
> 目标站点：`https://www.tsinghuaelt.com`（清华社英语在线 · 智慧版）

---

## 1. 项目简介

对清华社英语在线（智慧版）教材/课程学习的自动刷课脚本：自动取题作答 + 章节推进 +
查成绩 + 上报学习时长，AI 补答为可选兜底。

开发方式：**静态逆向 + Vibe Coding**。本版（v2.0.0）的接口契约、路由、题型枚举与 DOM
结构全部来自对线上构建产物的逆向提取，逐条附证据；详见第 3–7 节。

---

## 2. 站点技术栈（2026-09 改版后）

| 组件 | 技术 |
| --- | --- |
| 前端 | Vue 3 + vue-router + ant-design-vue |
| 构建 | Vite + rolldown，入口 `/assets/index-*.js` |
| 构建版本 | `window.__BUILD_VERSION__ = '20260930165203'`（首页内联） |
| 站点标题 | 清华社英语在线（智慧版） |
| API 根 | `https://zhjyapi.tsinghuaelt.com/elt-user` |
| 录音评测 | 驰声 chivox（`/speech-assess/chivox-6.1.3-min.js`） |
| 上传 | 阿里云 OSS（`/aliyun-upload-sdk/`） |
| 监控 | 阿里云 RUM，`replay: true`（会话回放）、100% 采样、热力图 |

旧站（Angular 7.2.16 + ng-zorro，`main.54207afdf758669deefc.js`）已下线。

---

## 3. 鉴权（已证实）

```js
// request.js —— axios 实例定义
W = ne.create({
  baseURL: 'https://zhjyapi.tsinghuaelt.com/elt-user',
  timeout: 6e4,
  headers: { 'Content-Type': 'application/json;charset=UTF-8' }
});
// 请求拦截器
async function Qe(e) {
  G.value && K.value && e.token !== false && e.headers.set(K.value, G.value);
  let { locale: t } = oe();
  e.headers.set('Accept-Language', t.value ?? 'zh-CN');
  ...
}
// 令牌键
pe = 'eltUserToken';      // localStorage
me = 'elt-user-token';    // 请求头名
he = 'eltsUserRefreshToken';
```

响应封装 `{ code, data, message }`；未授权实测返回：
```json
{ "code": 401, "data": null, "message": "未通过授权验证" }
```
刷新令牌：`POST /user/refresh/token`，头带 `elt-user-token` + `elt-user-refresh-token`。

**与旧站的差异**：无 MD5 签名、无 `sea-fetch-path`、无 AES 专属头。

---

## 4. API 契约（已证实）

`contentType`：**1 = Textbook，2 = StudentCourse**

| 方法 | 路径 | 参数 / body | 用途 |
| --- | --- | --- | --- |
| GET | `/textbook/course/{biz_id}/content/{catalog_id}/list` | `content_type` | 取章节内容 |
| GET | `/question/echo/content/{content_id}/answer` | `content_type, biz_id, user_id?` | 取题目 **+ 标准答案** |
| POST | `/question/submit/answer` | 见 §5 | 提交答案 |
| POST | `/user/study/course/content/record` | `{courseId, catalogId, contentId}` | 标记内容完成 |
| POST | `/user/study/time/record` | `{bizId, contentType, catalogId}` | 上报学习时长 |
| GET / POST | `/user/study/read/record` | GET: `biz_id, content_type` | 读 / 存阅读进度 |
| GET | `/user/study/course/{courseId}` | `catalog_id` | 进度结果 + 解锁列表 |
| GET | `/user/study/course/{courseId}/ai/assess/status` | `catalog_id` | AI 批改状态 `{success:0\|1\|2}` |
| GET | `/course/{id}/catalog/list/with/progress` | `user_id, type` | 目录树 + 进度 |
| GET | `/user/info` | — | 用户信息 |

证据原文（`textbook-reader-5onku7rN.js`）：
```js
var R = {
  getContent(e){ return M.get(`textbook/course/${e.biz_id}/content/${e.catalog_id}/list`, {content_type:e.content_type}) },
  saveReadRecord(e){ return M.post(`/user/study/read/record`, e) },
  getExerciseContent(e){ return M.get(`/question/echo/content/${e.content_id}/answer`,
      {content_type:e.content_type, biz_id:e.biz_id, user_id:e.user_id}) },
  submitExerciseAnswer(e){ return M.post(`/question/submit/answer`, e) },
  submitCourseLearningContent(e){ return M.post(`/user/study/course/content/record`, e) },
  saveStudyTime(e){ return M.post(`user/study/time/record`, e) },
  loadChallengeResult(e,t){ return M.get(`user/study/course/${e}`, {catalog_id:t}) },
  getCourseCatalogAiAssessStatus(e,t){ return M.get(`user/study/course/${e}/ai/assess/status`, {catalog_id:t}) }
};
```

---

## 5. 提交载荷（已证实）

```js
// src-DqZ23PK2.js —— UnitExercisePreview 的提交入口
async function de() {
  let e = 0;
  s.value.forEach(t => { ce(t) || (e += 1) });
  if (e > 0) { e$.warning(`请完成所有习题后再提交（已完成 ... 未完成 ${e} 题`); return }  // 前端硬门禁
  p.value = !0;
  try {
    let e = new Map(u.value.map(e => [e.questionId, e.userAnswer || '']));
    let n = { catalogId: t.catalogId, contentId: t.contentId, questionItemList: le(s.value, e) };
    let i = await t.onSubmitAnswer(n);          // 外层包装 {bizId, contentType} → POST /question/submit/answer
    u.value = i || [];                          // 响应回传新的 questionAnswerItemVOList
    t.onSubmitCourseLearningContent && await t.onSubmitCourseLearningContent({catalogId, contentId});
    ...
  }
}

// 展平组合题
function le(e, t) {
  let n = [];
  e.forEach(e => {
    if (e.children?.length) { n.push(...le(e.children, t)); return }
    n.push({ questionId: Number(e.id), userAnswer: t.get(Number(e.id)) || `` });
  });
  return n;
}
```

**关键**：`questionItemList[].userAnswer` **一律是字符串**，连单选也是。
提交后若触发限流，代码里判定 `e?.status === 429 || e?.data?.code === 429`。

---

## 6. 题型与状态枚举（已证实）

### 6.1 题型（站点变量 `Q`，共 24 个字符串值）

| 常量 | 字符串值 |
| --- | --- |
| SingleChoice | `choice_single` |
| MultipleChoice | `choice_multiple` |
| FillBlank | `fill_base` |
| FillBlankDialogue | `fill_dialog` |
| FillBlankImg | `fill_image` |
| FillBlankCloze | `fill_word_selection` |
| FillBlankClozeMN | `fill_mchoosen` |
| Judge | `judge_basic` |
| JudgeHigh | `judge_advanced` |
| Writing | `essay_writing` |
| Translate | `essay_translate` |
| QuestionsAndAnswers | `essay_questions_answers` |
| CorrectWrong | `correction_error` |
| DragDropOne | `matching_onetoonedrag` |
| DragDropMany | `matching_onetomanydrag` |
| DragDropFillBlank | `matching_dragfillblank` |
| DropDownImg | `matching_imagedropdown` |
| DropDownParagraph | `matching_paragraphdropdown` |
| CombinationQuestion | `combined_basic` |
| ReadingComprehension | `combined_read_comprehension` |
| OralBrief | `oral_simple_speak` |
| ListenAndRepeat | `oral_follow_along` |
| RolePlay | `oral_roleplay` |
| Words | `oral_vocabulary_learning` |

**两个易错点**：
- 不存在 `reading_comprehension` 这个字符串；同族题型是 `combined_read_comprehension`。
- `listen_repeat` **不是题型字符串**，它是 CSS 类名（`listen-repeat-view`）；对应题型是 `oral_follow_along`。

### 6.1.1 userAnswer 的最终编码（站点 `stringifyField`，@688462）

```js
stringifyField(e) {
  if (e == null) return null;
  if (typeof e === 'string') return e;                 // 裸串原样，不 JSON 化
  if (Array.isArray(e) && e.length === 0) return '';   // 空数组 → 空串
  try { return JSON.stringify(e) } catch (t) { return String(e) }
}
```

| doRecord 形态 | userAnswer |
| --- | --- |
| 裸字符串（选项 idx 等） | 原样，**不加引号** |
| 非空数组 / 对象 | `JSON.stringify(...)` |
| 空数组 `[]` | `""` |

站点 `createDoRecord` 给出的空初值（判断"作答了几题"的依据）：

```js
case SingleChoice: case Judge: case OralBrief: return '';          // 裸串 → 空串
case MultipleChoice: ... case JudgeHigh: ... case ReadingComprehension: return [];   // 数组
case Writing: case Translate: case QuestionsAndAnswers: return {answer:'', annex:[]};
case ListenAndRepeat: case Words: return [];
case RolePlay: return {roleId:'', answer:[]};
```

**注意**：`judge_advanced` 的 doRecord 是**数组**（每子题一个答案），不在裸标量分支；
`oral_simple_speak` 的空值是**空字符串**而非数组。这两处极易与 `judge_basic` 混淆。

### 6.2 题目状态（站点变量 `Z`）

```
1 PreviewBasic   2 PreviewComposing  3 PreviewComposed  16 PreviewSimple
4 ExamDoIng      5 ExamDoFinish     6 ExamDoneMark     7 ExamDoneMarked
8 ExamDoneMarkedNoAnswer            9 ExamAnalysis
10 CourseDoIng  11 CourseDoFinish  12 CourseDoneMarked 13 CourseDoneMarkedNoAnswer
14 CourseAnalysis 15 CourseAnalysisNot
```

状态机 `O()`：
```js
function O() {
  return S.value ? (h.value ? 'teach-show-answer' : 'teach-hide-answer')
    : x.value ? 'teacher-student-review'
    : n.value ? 'answer-retry'
    : (m.value || d.value === 0) ? 'answer-submit'      // d = answerCount
    : 'answer-retry';
}
```

### 6.3 答案编码（站点 `parseAnswer`）

```js
parseAnswer(e, t) {
  if (t === Q.SingleChoice || t === Q.Judge) return e;          // 裸标量
  if (typeof e === 'string') { try { return JSON.parse(e) } catch { return e } }
  return e;                                                     // 其余题型：JSON 字符串
}
```
`doRecord`（学生作答）、`answer`（标准答案）、`extension`（题目结构）三者同规则。

**关键：单选/判断的"裸标量"是 option 的 `idx` 值，不是字母。** 证据（`SingleChoiceCourseDone`）：

```js
// 选项渲染：显示字母 yO(t)，但 value 绑定的是 e.idx
<RadioGroup value={doRecord}>
  {extension.map((e, t) => <Radio value={e.idx}>{yO(t)}. {e.val}</Radio>)}
</RadioGroup>

// 判断题特例：value 固定为 "1" / "0"
<Radio value="1"> A、正确 </Radio>
<Radio value="0"> B、错误 </Radio>

// 单选回显：用 answer 去 extension 里找 idx
let t = extension.findIndex(t => t.idx === answer);
return t >= 0 ? yO(t) : '';

// 多选回显：answer 是 **数组**，元素为 option 的 idx
Array.isArray(answer) && answer.includes(e.idx)

// 判断回显：answer === '1' ? 'A' : 'B'
```

因此提交时：
- `choice_single`：`userAnswer` = 正确选项的 `idx` 值（如 `"1"`）
- `judge_basic`：`userAnswer` = `"1"`（正确）或 `"0"`（错误）
- `choice_multiple`：`userAnswer` = idx 值构成的 **JSON 数组字符串**（如 `"[0,2]"`）

v2.0.0 的实现**不猜字母映射**，而是读取 DOM 上真实的 `input.value` 来匹配
（`getOptionValues()` / `resolveOptionIndexes()`），同时兼容字母与下标形态作为兜底。

### 6.4 语音评测题（硬边界，非可绕过项）

新站的**口语 / 跟读 / 角色扮演**类题目走驰声 chivox **实时语音评测**，链路如下：

```js
// src-DqZ23PK2.js —— 录音与评测
t.value = new window.Html5Recorder({
  appKey: '1559186300000010',
  alg: 'sha1',
  sigurl: `${mi('baseApi')}/chivox/sign`,   // 服务端签名
  server: 'wss://cloud.chivox.com',          // WebSocket 实时评测
  originalResult: true,
  ...
});
// 采集：navigator.mediaDevices.getUserMedia({ audio: true })
// 评测类型 coreType：WORD / SENT / EXAM / ORAL_ANSWER
// 返回：score / accuracy / fluency / integrity / pron / rhythm / speed / pause / words[]
```

含义：这类题**必须真实麦克风录音并经服务端打分**，不存在"填 DOM 就能过"的路径。
v2.0.0 的处理方式是 —— 识别出语音题后**明确告知用户并跳过**，而非静默失败或伪造音频。

另外注意：新站**仍在读取旧键** `localStorage['tsinghuayingyu-front.currUser']` 的 `id`
作为驰声评测的 `userId`：

```js
function Ik(){ let e = localStorage.getItem('tsinghuayingyu-front.currUser');
  if (!e) return 0; try { return JSON.parse(e).id || 0 } catch { return 0 } }
```

因此该键在新站**并非纯历史残留**，而是仍被语音模块使用（v2.0.0 自身不依赖它）。

### 6.6 拖拽类（已实现）

三种拖拽题共用组合式函数 `MR`，事件序列**已证实**：

```js
dragstart  → e.dataTransfer.setData('text/plain', item.idx)，effectAllowed = 'move'
dragover   → e.preventDefault()，dropEffect = 'move'
dragenter  → 记录 activeDropZoneId
drop       → 读 dataTransfer.getData('text/plain') 写入 answer
```

DOM 结构：

```
div.drag-drop-container
  div.drop-zone-list
    div.drop-zone-item-wrapper      ← 投放区（绑定 onDrop/onDragover/onDragenter/onDragleave）
  div.drag-item-list
    div.drag-item.drag-item-with-handle[draggable="true"]   ← 可拖项（绑定 onDragstart/onDragend）
```

**字段名与含义相反（以代码为准）**：`extension.drag` = 投放目标，`extension.dragged` = 可拖拽项。

answer 形状：

| 题型 | 形状 |
| --- | --- |
| `matching_onetoonedrag` / `matching_onetomanydrag` | `[{idx:"<投放区idx>", answer:["<拖拽项idx>", ...]}]` |
| `matching_dragfillblank` | `[{idx:"<blankId>", answer:"<拖拽项idx>"}]`（**扁平，单项字符串**） |

拖拽填空的目标是题干 HTML 内的 `span.blank-placeholder[data-blank-id]`（未答）/
`span.inline-answer[data-blank-id]`（已答），由组件手动 `addEventListener` 绑定四个原生事件。

实现说明：脚本用最小 `DataTransfer` 桩 + `DragEvent`（构造失败时退回 `Event` 并注入
`dataTransfer` 属性）复现该序列，因为脚本无法持有真实 DataTransfer 对象。

### 6.7 组合题与「题卡索引」陷阱（已修复的 bug）

组合题（`combined_basic` / `combined_read_comprehension`）的子题**同样带 `.exercise-item` 类**，
并以 `data-child-question-id` 标识，**嵌在父题卡片内部**：

```js
// 站点模板（src @839640）
<div class="exercise-item" data-child-question-id={child.id}>
  ...
</div>   // 该节点位于父题 div.exercise-item 之内
```

因此 `querySelectorAll('.exercise-item')` 会把子题一并收进来，导致**题卡索引错位、
标准答案与题目错配**。v2.0.0 的 `getExerciseItems()` 过滤掉「祖先中已有 `.exercise-item`」的节点，
只返回顶层题卡。

另：组合题顶层**自身不产生** `questionItemList` 条目，由 `le()` 展开 children，
每个子题各自成为一条（与单题格式一致）。子题类型受站点硬约束——`AdaptGroupExerciseCourseDo`
只支持 7 种：单选、多选、判断、填空、写作、翻译、问答、口语简述。

### 6.8 其它枚举

- `obSub`：`ob`（客观）/ `sub`（主观）
- `learnMode`：`1 = Freedom` / `2 = Breakthrough`
- `readerType`：`textbook` / `student_course` / `public_course`
- 阅读模式：`stream` / `pagination`
- 用户类型：`1 SuperAdmin, 3 Customer, 4 EntryClerk, 5 SchoolAdmin, 6 Student, 8 Tourist`
- 内容类型 `Fq`：`UnitHome` / `Content` / `Exercise` / `Img` / `Notes` / `H1`–`H4` / `UnitAnnex` …

---

## 7. 路由与 DOM（已证实）

### 7.1 路由

阅读器路由：`/course_center/reader/{type}/{bizId}?catalogId=&contentId=`

```js
// textbook-reader 组件 setup
let r = ie(), a = re();
let s = r.params.type,        // 'Textbook' | 'StudentCourse' | 'PublicCourse'
    c = r.params.id;          // bizId
...
initialCatalogId: +i(r).query.catalogId,
initialContentId: +i(r).query.contentId,
```

初始化链：`W()`（取教材/课程详情）→ `G()`（取目录树）→ `b = true`（渲染）→ `xe()`（取 AI 助手信息）

### 7.2 DOM 层级

```
div.textbook-preview-content
  div.textbook-content-fill
    div.chapter-section.course[data-catalog-id]
      div.content-item[data-content-id][data-content-hash][data-catalog-id]
        div.unit-exercise-preview
          div.exercise-list
            div.exercise-item
              div.exercise-content
                div.exercise-view
                  div.instruction  div.annex-list
                  div.zty-exercise-item-fill-blank-do | div.drag-drop-container | div.oral-brief-course-do …
```

其它关键类（CSS 产物交叉验证，全部命中）：
`exercise-actions`、`unit-exercise-answer-account`、`answer-count`、`option-content`、`option-line`、
`judge-option-item`、`judge-topic-item`、`pagination-btn`（`pagination-left` / `pagination-right`）、
`pagination-btn-wrap`、`exercise-loading`、`chapter-title`、`catalog-main`。

提交按钮（ant-design-vue `<a-button block>`）：
```js
O() === 'answer-retry' && learnMode !== Breakthrough && a
  ? <a-button block onClick={fe}> Retry </a-button>
  : <a-button block loading disabled> Submit </a-button>
```

`answer-retry` / `answer-submit` 是**状态名**而非 CSS 类——CSS 里 0 命中、JS 里命中，正好印证。

### 7.3 常量

```js
Me = 3e3   // AI 批改轮询间隔 3000ms
Ne = 30    // 轮询上限 30 次
Pe = 1e3   // 内容完成上报队列间隔 1000ms
```

---

## 8. 脚本架构（v2.0.0，IIFE 单文件，`@grant none`）

| 层 | 内容 |
| --- | --- |
| 契约常量 | `API_BASE` / `TOKEN_KEY` / `CT` / `RT` / `TYPE` / `ST` / 节流常量 |
| 工具 | `$` `$1` `sleep` `rnd` `click` `clickSeq` `fillInput` `fillEditable` |
| API 层 | `api()` 统一请求（自动带令牌、401 自动刷新重试、**429 本地冷却**）+ 各接口包装 |
| 识别层 | `parseReaderRoute()` / `isReaderPage()` / `getExerciseItems()` / `detectType()` |
| 答案层 | `loadCurrentExercise()` / `buildAnswerMap()` / `decodeAnswer()` / `applyAnswer()` |
| 交互层 | `selectOption()` / `submitAnswers()` / `clickPagination()` / `fillByAnswerMap()` |
| 推进层 | `doOneRound()` / `loop()` / `keepAliveTick()` |
| 自检 | `selfCheck()` — 打印路由/令牌/DOM 探针/题卡/按钮/取题接口结构 |
| 上报 | `checkScriptValidity()` / `reportIssue()`（consent 门禁 + 24h 去重 + 打码） |
| GUI | 双面板（主面板 + 设置面板）、可拖动、莱茵生命风配色 |

---

## 8bis. 关键运行时契约（已证实，直接影响实现正确性）

以下三条来自对 `textbook-reader-5onku7rN.js` 与 `src-DqZ23PK2.js` 的逐段核对，
推翻了若干想当然的假设，是 v2.0.0 实现的实际依据。

### 8bis.1 翻页**不改 URL**

阅读器全文内 `location` / `href` / `history` **0 命中**（唯一 `replaceState` 在 Vue Router 与 echarts 库内）。
左右按钮只改内存状态：

```js
function Ge(){ ke.value || (Se.value = Math.max(0, Se.value - 1)) }   // 左
function Ke(){ Ae.value || (Se.value = Math.min(xe.value.length - 1, Se.value + 1)) }  // 右
```

→ **URL 变化不能作为翻页判据。** 正确判据是分页计数文本（`pagination-text`，渲染为 `displayIndex/总数`）
与页面内容签名。另：右按钮在下一条目 `lock` 为真时 `disabled`。

分页栏真实结构：
```
div[ button.pagination-btn(左) , span.pagination-text("n/总数") , span.pagination-btn-wrap[ button.pagination-btn(右) ] ]
```
计数 span 与 `pagination-btn-wrap` 是**兄弟**关系。

### 8bis.2 内容"完成"由 IntersectionObserver 自动触发，无需脚本代劳

```js
// 可见性埋点：selector = '[data-track-visibility="true"]'，threshold=0，rootMargin='0px'
// 必须 dataset.contentId 与 dataset.catalogId 同时为真值；每 contentId 只触发一次；
// 需在 delay 毫秒内持续可见（delay = visibilityDelay = 1000ms）
// 只有 type===Content(5) 与 type===DoubleLanguagePage(13) 会被打上该属性
```

音视频类走另一条路：**播放进度 > 50%** 即上报。附件类（`UnitAnnexPreview`）**进入即上报**。

上报经串行队列（`Pe = 1000ms` 间隔），队列排空后必然调用一次 `applyCategoryLock`
刷新目录 `lock/progress`。**队列提交失败即丢弃，不重试。**

→ 脚本不应手动轰炸 `submitCourseLearningContent`，交给页面自身机制即可；
仅在需要主动推进时调用一次。

### 8bis.3 学习时长由站点自己每 10 秒上报

```js
Be(){ F.value = setInterval(() => { ze() || onSaveStudyTime(o.value) }, 1e4) }   // 10000ms
function ze(){ return Date.now() - Le >= Ede }                                   // Ede = 6e5 = 10 分钟
// Le 由 mousedown/mousemove/wheel/keydown/touchstart/touchmove/scroll 重置（capture, passive）
```

**只要页面开着且 10 分钟内有任意交互，站点自身就会持续上报。**
空闲 ≥ 10 分钟则跳过本次上报（熔断）。

→ 脚本的正确职责是**防止空闲熔断**（周期派发无害活动事件保持计时器活跃），
而不是"代刷"。v2.0.0 的 `keepAliveTick()` 即为此设计，间隔 60 秒，远低于熔断阈值。

启用门闩（仅以下身份上报时长）：
```js
z = !M && f.auth===1 && !L && (userType===Student || userType===Tourist || (userType===Teacher && type===Public))
L = courseStatus === -1 || publicCourseStatus === -1
```

### 8bis.4 限流：站点无退避，脚本必须自建

```js
// request.js 全局拦截器
if (response.status===429 || data?.code===429) {
  error('提交过于频繁，请休息一下，1分钟后再试'); return Promise.reject(response)
}
```
**无重试、无退避、无冷却计时器**（文案里的"1 分钟"在代码中并不存在对应逻辑）。

→ v2.0.0 在 `api()` 层实现本地冷却：命中 429 后写请求一律拦截 60 秒（读请求豁免），
避免持续吃限流。

### 8bis.5 AI 批改轮询的启用条件

`Me = 3000ms`（间隔）、`Ne = 30`（上限）。两种触发：

- `X(courseId, catalogId)`：需 `learnMode===Breakthrough` **且** `openAssess===true`
  **且** `success!==0 && assessStatus===1`；
- `ce(catalogId)`：需 `learnMode!==Breakthrough` **且** `openAssess===true`
  **且本页含写作题或口语简答题**（`Set([Writing, OralBrief])`）。

`success` 三态：`0` 无任务 / `1` 批阅中 / `2` 批阅完成。
两个循环都是**先 `setTimeout` 再请求**（首次请求发生在 3 秒后）。

### 8bis.6 阅读器内无行为监控

全量扫描 282 个 JS：`textbook-reader-*` 内 `cheat / face / monitor / visibilitychange / blur /
fullscreenchange` **全部 0 命中**；全站无 `sendBeacon`、无自建埋点接口。
`fullscreenchange` 仅用于视频全屏同步与全屏时收起面板。

「切屏强制交卷」「人脸核验/拍摄」「全屏作答」「最短作答时长」等反作弊项
**全部是作业/考试（`homework-add` / `paper-add`）的教师端配置开关**，
本次下载的静态产物中**未出现消费这些开关的学生答题运行时**。

**唯一全站性监控是阿里云 RUM 会话回放**（`replay: true`，100% 采样，含 api 与 consoleError 采集）。

---

## 9. 与旧站的机制差异（重写要点）

| 机制 | 旧站做法 | 新站做法（v2.0.0） |
| --- | --- | --- |
| 获取答案 | 提交一次 → 读回标准答案 → 修正 → 再提交 | 取题接口直接返回 `questionAnswerItemVOList[].answer`，一次填对 |
| 作答模型 | 一页一题，`.page-next` 右箭头翻页 | 整章滚动 + 题卡内嵌，`pagination-btn` 切节 |
| 时长上报 | hook `XMLHttpRequest` 抓 `studyTimeCountNew` 地址与 sign 后重放 | 直连 `POST /user/study/time/record`，无需 hook |
| 提交 | 点 `button.wy-btn` | 点 `button.ant-btn`（Submit），或回退直连接口 |
| 内容完成 | 隐含在提交里 | 显式 `POST /user/study/course/content/record`，站点自身用队列按 1s 间隔上报 |
| 限流 | HTTP 530「系统繁忙」，冷却约 60–90s | 429（`status` 或 `data.code`） |

---

## 10. 失效上报（v2.0.0）

- 探针（**对照新站**）：`.textbook-preview-content` / `.unit-exercise-preview` / `.exercise-item` /
  `.pagination-btn` / `.chapter-section`
- 仅在**阅读器路由**下判定（其他页面无此结构属正常，不误报）
- 连续 10 轮全缺 → 判定失效 → 经同意发 issue（附结构自检输出）
- consent + consentVersion 双门禁，24h 去重，路径打码（`/reader/{type}/{bizId}`）

---

## 11. 已知限制与未验证项

**未在登录态端到端实测**（无可测账号）。以下为静态分析得出、但需实测确认的部分：

1. 各题型 `extension` / `answer` 的精确 JSON 结构
2. 填空 `zty-exercise-item-fill-blank-do` 作答态是否为 `contenteditable`
3. 拖拽 `drag-drop-container` 的有效事件序列（HTML5 DnD vs pointer）
4. 取题接口对**学生身份**是否也下发 `answer` 字段（教师侧已证实含 `questionVOList`）
5. 提交后响应回传的 `questionAnswerItemVOList` 具体形状
6. 翻页按钮在 `stream` 阅读模式下是否存在

**排查手段**：面板「结构自检」按钮会打印上述相关运行时数据。

其它：
- 作业/考试模块有全屏监控、切屏自动提交、人脸抓拍（`/exam/*/face/capture`、`/exam/*/switch/scree`），脚本不触碰
- 新站启用阿里云 RUM 会话回放（全站），操作会被记录

---

## 12. 测试方法论

- 逆向语料：无登录抓取线上首页 + 282 个构建产物（7.21 MB），本地全文检索
- 证据优先级：**运行时/线上产物原文 > 注释与文档**
- CSS 产物与 JS 产物交叉验证选择器（避免只读渲染函数导致的误判）
- 契约一致性自查：脚本内检索旧站残留标识（`tsenglish` / `sea-fetch-path` / `app-course-task-stu` /
  `.page-next` / `wy-btn` / `.courseList` / `.uniteTitle` / `tsinghuayingyu-front.currUser`）应为 0 命中

---

## 13. 版本历史

| 版本 | 说明 |
| --- | --- |
| **2.0.0** | **新站重写**：适配 Vue3/Vite。API 域、鉴权、路由、接口、题型层、交互层全部重写；改为取题接口直取标准答案；新增结构自检；撤回 v1.1.3 停止维护决定 |
| 1.1.3 | （未发布，已撤回）停止维护 |
| 1.1.2 | 全新身份（改名/namespace/存储键/文件名）；知情同意书版本化；GUI 重写 |
| 1.0.0 | 清理死代码、加载容错、翻页 URL 校验、弹窗白名单 |
| 0.9.x | 右箭头全自动；降频；限流自动冷却 |
| 0.7.x | 查成绩 + 刷时长 + AI 接入 |
| 0.6.x | 基于 2026 实测 DOM 重写 |
