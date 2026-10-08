# TSH自动刷课 — 开发文档

> 脚本：`tsh-auto-brush.user.js`（v2.2.0，Tampermonkey 油猴脚本）
> 作者：WASD258-jpg · 协议：GPL-3.0
> 目标站点：`https://www.tsinghuaelt.com`（清华社英语在线 · 智慧版）
>
> **v2.2.0 起，本文档区分标注两类依据：**
> - **[静态]** —— 来自对线上构建产物的逆向提取
> - **[实测]** —— 2026-10-08 由志愿者学生账号在登录态下实测确认
>
> 凡两者冲突，**以 [实测] 为准**。被实测推翻的静态结论，在下文就地标注。

---

## 1. 项目简介

对清华社英语在线（智慧版）教材/课程学习的自动刷课脚本：自动取题作答 + 章节推进 +
查成绩 + 上报学习时长，AI 补答为可选兜底。

开发方式：**静态逆向 + 登录态实测 + Vibe Coding**。本版（v2.2.0）的接口契约、路由、题型枚举与 DOM
结构，先由对线上构建产物的逆向提取得出（逐条附证据，详见第 3–7 节），再经登录态实测校验
（详见 §11）。**两者冲突处以实测为准。**

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
- `choice_single`：`userAnswer` = 正确选项的 `idx` 值
- `judge_basic`：`userAnswer` = `"1"`（正确）或 `"0"`（错误）
- `choice_multiple`：`userAnswer` = idx 值构成的 **JSON 数组字符串**（如 `"[…,…]"`）

> **[实测修正] `idx` 不是数字下标，而是 UUID 字符串。**
> 此前文档举例写成 `"0"`/`"1"`（如「`userAnswer` = `"1"`」），这是**误读** ——
> 真实取值形如 `"bf9491b2-d657-e04f-31c1-c7281a231d47"`：
>
> ```json
> "extension": "[{\"idx\":\"bf9491b2-d657-e04f-31c1-c7281a231d47\",\"val\":\"<p>Change is possible.</p>\"}, …]"
> ```
> 实测页面 DOM：`input[type=radio].value` 与 `extension[].idx` **逐字一致**。
>
> 例外：`judge_basic` 的提交值仍固定为裸标量 `"1"` / `"0"`（判断对错的语义值），
> 而 `judge_advanced` 的 `extension.option[].idx` 同样是 UUID，其 `val` 为 `"T"` / `"F"`。

v2.0.0 的实现**不猜字母映射**，而是读取 DOM 上真实的 `input.value` 来匹配
（`getOptionValues()` / `resolveOptionIndexes()`）—— **[实测] 这一做法是正确的**，
因为 DOM 的 value 就是站点会提交的值。

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

> ### ⚠️ 跳过 ≠ 完成 —— 这是个会在成绩上留下缺口的设计后果 [实测]
>
> 实测补三条硬证据：
> - 空提交 `question/submit/answer` → **`HTTP 500 服务器内部错误`**，`answerCount` 始终为 0；
> - 该题**没有 `answerStatus` 字段**（客观题为 1/2/3，主观题为 -1，语音题连字段都不存在）；
> - `attachmentList` 只有 `image/jpg` 的题面配图，**没有任何可用的音频/文本答案载体**。
>
> 因此脚本跳过语音题时，**该内容项不会被标记完成**，`progress` 停在原值。
> 后果会向上传导：含语音题的**单元永远达不到 100%**，而课程总分 = 各单元平均，
> 所以这部分缺口会**永久压低总分**，不是"跑完就能补上"的。
>
> **【修正 2026-10-08】上面这段与实现不符，已按代码改正。**
> 两处跳过语音题的代码路径中，**"整节含语音题"那条会主动调 `apiMarkContentDone`**
> （`doOneRound` 内，注释写明"标记内容完成并尝试翻页，让用户自行处理语音题"），
> 目的是不让流程卡死。因此准确表述应是：
>
> - 脚本**会**标记该内容已学，以便继续推进；
> - 但语音题**拿不到分**（没有提交录音），成绩上仍有缺口；
> - 该标记把 `progress` 推到什么程度、是否影响最终计分，**尚需真机确认**（外审同样标注为待验证）。
>
> 自动刷课遇到语音题不能停（否则整条链卡在第一节），所以 v2.3.0 起改为
> **跳过并继续**（§11.24）。这解决了"卡死"，**没有也无法**解决"分数缺口" ——
> 想补只能人工录一遍。
>
> **文档义务**：README「已知限制」已单列此条。不要把它写成"已支持自动作答"，
> 也不要让用户以为刷完就等于满分；同时**不要**再声称"脚本不标记完成"——那与代码不符。


另外注意：新站**仍在读取旧键** `localStorage['tsinghuayingyu-front.currUser']` 的 `id`
作为驰声评测的 `userId`：

```js
function Ik(){ let e = localStorage.getItem('tsinghuayingyu-front.currUser');
  if (!e) return 0; try { return JSON.parse(e).id || 0 } catch { return 0 } }
```

因此该键在新站**并非纯历史残留**，而是仍被语音模块使用（v2.0.0 自身不依赖它）。

### 6.6 拖拽类（已实现，[实测] 事件序列已触发验证）

三种拖拽题共用组合式函数 `MR`，事件序列**已证实**（并已由 §11.9 在登录态触发验证通过）：

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

其它关键类（CSS 产物交叉验证；**[实测] 结果已标注**）：

- ✅ 线上命中：`exercise-actions`、`unit-exercise-answer-account`、`option-content`、
  `pagination-btn`（`pagination-left` / `pagination-right`）、`preview-navbar`
- ❌ 线上**未命中**（原「全部命中」的说法有误）：
  `answer-count`、`option-line`、`pagination-btn-wrap`、`chapter-title`、`catalog-main`
- 分页计数容器实为 `.preview-pagination`（见 §11.4）
- `judge-option-item` / `judge-topic-item` / `exercise-loading`：**未单独复核**
  （本轮实测页面为选择题与拖拽题，未渲染判断题）

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

## 8. 脚本架构（v2.2.0，IIFE 单文件，`@grant none`）

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

**[实测] 两项均得到验证**：
- 翻页时 URL 确实不变（`location.pathname` 恒定，仅 query 由初始跳转决定）
- 分页计数文本真实存在且格式为 `"25/377"`，翻页后数值递增 —— 判据可靠

**分页栏真实结构（实测修正）**：
```
div.preview-pagination
  ├─ button.pagination-btn        （左）
  ├─ button.pagination-btn        （右）
  └─ span.pagination-text         （"25/377"）
```
原文档写的 `span.pagination-btn-wrap` 嵌套结构 **在线上不存在**（命中数 0）：
计数 span 与两个按钮是**同一容器下的兄弟**，该容器为 `.preview-pagination`。
v2.2.0 已据此修正 `SEL.paginationWrap` 与 `paginationCounter()`。

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

| 机制 | 旧站做法 | 新站做法（v2.2.0） |
| --- | --- | --- |
| 获取答案 | 提交一次 → 读回标准答案 → 修正 → 再提交 | 机制相同但**门槛更高**：新站要答错累计 `errorNumShow` 次才在 `questionAnswerItemVOList[].answer` 下发答案（见 §11.3）。`questionVOList[].answer` 恒空 |
| 作答模型 | 一页一题，`.page-next` 右箭头翻页 | 整章滚动 + 题卡内嵌，`pagination-btn` 切节 |
| 时长上报 | hook `XMLHttpRequest` 抓 `studyTimeCountNew` 地址与 sign 后重放 | 直连 `POST /user/study/time/record`，无需 hook |
| 提交 | 点 `button.wy-btn` | 点 `button.ant-btn`（Submit），或回退直连接口 |
| 内容完成 | 隐含在提交里 | 显式 `POST /user/study/course/content/record`，站点自身用队列按 1s 间隔上报 |
| 限流 | HTTP 530「系统繁忙」，冷却约 60–90s | 429（`status` 或 `data.code`） |

---

## 10. 失效上报（v2.2.0）

- 探针（**对照新站**）：`.textbook-preview-content` / `.unit-exercise-preview` / `.exercise-item` /
  `.pagination-btn` / `.chapter-section`
- 仅在**阅读器路由**下判定（其他页面无此结构属正常，不误报）
- 连续 10 轮全缺 → 判定失效 → 经同意发 issue（附结构自检输出）
- consent + consentVersion 双门禁，24h 去重，路径打码（`/reader/{type}/{bizId}`）

---

## 11. 实测结论（v2.2.0 依据）

### 11.1 实测环境 [实测]

| 项 | 值 |
| --- | --- |
| 账号 | 志愿者学生账号（`userType=6`、`jumpPlat=0`） |
| 落入站点 | 新站 `/course_center/`（**未**走旧站分流） |
| 阅读器 | `/course_center/reader/student_course/2095675591799939073` |
| 规模 | 369 个目录叶节点、989 个内容项 |
| 构建版本 | `20260930165203` |
| 手段 | Chrome CDP 驱动真实登录态页面；未登录态静态产物为对照 |

> **纠错**：README/本文档此前把 `jumpPlat = 0` 当作「被分流旧站」的判据。
> [实测] 该值为 0 的账号照样进入新站 —— **两者无因果关系**，原推断不成立。

### 11.2 待验证项的实测结果 [实测]

| # | 原待验证项 | 结果 | 影响 |
| --- | --- | --- | --- |
| 1 | 各题型 `extension` / `answer` 的精确 JSON 结构 | 见 §11.3 | 已按实测实现 |
| 2 | 填空 `zty-exercise-item-fill-blank-do` 是否 `contenteditable` | ✅ **是**（`span` + `contenteditable="true"`） | 填空写入路径成立 |
| 3 | 拖拽 `drag-drop-container` 的有效事件序列 | ✅ **HTML5 DnD 有效**（触发式验证，见 §11.9） | 原实现成立，无需改 pointer |
| 4 | 取题接口对**学生身份**是否下发 `answer` | ⚠️ **须分字段**：`questionVOList[].answer` 恒空；`questionAnswerItemVOList[].answer` 在答错达 `errorNumShow` 次后由服务端下发（见 §11.3） | 引擎应实现「试错取答案」 |
| 5 | 提交后响应回传的 `questionAnswerItemVOList` 形状 | ✅ 形状确认；其中 `answer` 按 §11.3 的规则填充 | **试错法在新站可行** |
| 6 | 翻页按钮在 `stream` 阅读模式下是否存在 | ✅ **存在**（`.pagination-btn` 恒为 2 个） | 翻页路径成立 |

### 11.3 答案来源：需要区分两个字段 [实测，含一次自我更正]

这一节经历了两次实测，第一版结论**下错了**，此处保留更正过程。

#### 第一版结论（不完整）

检查 `questionVOList[].answer`，抽样 40 个内容项 → **40/40 为空**，
于是判定「站点不下发标准答案」。**这个判断是错的**，因为查错了字段。

#### 更正后的结论

标准答案出现在 **`questionAnswerItemVOList[].answer`**，且**只在两种情况下被填充**：

| 情形 | `item.answer` | `item.answerStatus` | `item.rightRate` |
| --- | --- | --- | --- |
| 答错，且累计次数 < `errorNumShow` | `""`（空） | 3 | 0 |
| **答错，累计次数 ≥ `errorNumShow`** | **服务端下发的标准答案** | 3 | 0 |
| 答对 | 回显自己提交的答案 | 1 | 100 |

**对照实验（同一课程内两处独立观察）**：

```
# A. 选择题 23969（未作答 → 逐次提交）
起始      answerCount=0  item.answer=(无)
第1次(A,错) answerCount=1  item.answer=""                  status=3  rightRate=0
第2次(B,对) answerCount=2  item.answer="12b6610b-…"        status=1  rightRate=100

# B. 选择题 23946（连续提交错误答案，全部答错）
提交 4 次后 answerCount=4  item.answer="240f8800-fcd9-c9a6-eac2-2f771481c6a4"
                          status=3  rightRate=0        ← 服务端下发的正确答案（对应选项 D）
```

B 组 `status=3`（答错）却拿到非空 `answer`，证明该值来自服务端而非回显。
本课 `errorNumShow = 3`（见 §11.6），即**答错 3 次后开始下发**。

#### 对引擎的含义

`buildAnswerMap()` 读的正是 `questionAnswerItemVOList`，**方向本来就是对的**；
问题在于 `doOneRound()` 在拿不到答案时直接停下，从未制造「答错足够多次」的条件。
要利用这条路径，必须先提交若干次错误答案。

`questionVOList[].answer` 确实恒为空 —— 这一点第一版结论没错，
但它是**题面**字段，本来就不承担下发答案的职责。

#### 判分口径（来自 `/course/{id}/detail` 与教师端配置文案）

| 模式 | 说明（教师端界面原文） | 成绩取值 |
| --- | --- | --- |
| 自由模式 `learnMode=1` | 「学生答对即时显示答案与解析，答错 N 次后显示答案与解析」 | **记录末次答题结果** |
| 闯关模式 `learnMode=2` | 「学生任务过关后显示答案与解析」 | **记录最高答题结果** |

本课为**自由模式**（`learnMode=1`、`freeShowAnswer=1`、`errorNumShow=3`、`caculateToGrade=1`）。

**反复提交的权重由此确定**：
- 自由模式 → 末次覆盖，**最后一次提交决定成绩**
- 闯关模式 → 取最高

**成绩与时长分属两条通道**：`/course/{id}/study/situation/overview` 返回

```json
{ "score":"0", "progress":1, "duration":2730,
  "courseScoreCourseRank":9, "courseProgressCourseRank":9, "courseStudyUseTimeCourseRank":8 }
```

`duration` 只参与「学习时长」排名，**不进入 `score`**。`learnTimeLimit` 是学习时长的
**限制**开关而非计分项。**新站并非旧站那种「时长权重更高」的规则。**

### 11.4 DOM 契约实测对照 [实测]

| 选择器 | 静态结论 | 实测 |
| --- | --- | --- |
| `.textbook-preview-content` | 命中 | ✅ 1 |
| `.textbook-content-fill` | 命中 | ✅ 1 |
| `.chapter-section` | 命中 | ✅ 2（含 `data-catalog-id`） |
| `.content-item` | 命中 | ✅ 5–7（含 `data-content-id` / `data-content-hash`） |
| `.unit-exercise-preview` / `.exercise-list` / `.exercise-item` / `.exercise-content` / `.exercise-view` / `.instruction` / `.annex-list` | 命中 | ✅ 各 1 |
| `.pagination-btn` | 命中 | ✅ 2 |
| `.pagination-text` | 命中 | ✅ 1，文本形如 `"25/377"` |
| **`.pagination-btn-wrap`** | 计数 span 的兄弟容器 | ❌ **0，不存在** |
| `.exercise-actions` | 命中 | ✅ 1 |
| `.unit-exercise-answer-account` | 命中 | ✅ 1 |
| **`.answer-count`** | 关键类 | ❌ 0（宽匹配 `[class*="answer"]` 命中 `unit-exercise-answer-account` 等） |
| **`.option-line`** | 选择题选项容器 | ❌ 0；实际为 `.ant-radio-wrapper`（选择题，4 个） |
| `.option-content` | — | ✅ 拖拽题的投放项（8 个），**非选择题选项** |
| **`.chapter-title`** / **`.catalog-main`** | 关键类 | ❌ 0 |
| `.drag-drop-container` / `.drop-zone-item-wrapper` / `.drag-item` | 命中 | ✅ 1 / 8 / 8 |
| `.judge-option-item` | 命中 | 本轮实测页为选择/拖拽题，**未渲染判断题**，此项未复核 |

**分页栏真实结构**（修正 §8bis.1）：
```
div.preview-pagination
  ├─ button.pagination-btn        （左）
  ├─ button.pagination-btn        （右）
  └─ span.pagination-text         （"25/377"）
```
即**单一容器下三个兄弟节点**，不存在嵌套的 `pagination-btn-wrap`。

### 11.5 索引与编码形态 [实测]

- `extension` 里选项的 `idx` 是 **UUID**（如 `"bf9491b2-d657-e04f-31c1-c7281a231d47"`），
  **不是** `"0"`/`"1"` 这类数字下标。README 此前的表述有误。
- DOM 上 `input[type=radio].value` **与 `extension[].idx` 完全一致** —— 印证
  「读 DOM 真实 value 来匹配答案」的做法是正确的。
- 判断题族：`judge_advanced` 的 `extension` 为
  `{"option":[{"idx":"…","val":"T"},{"idx":"…","val":"F"}], "topic":[…]}`，
  即选项值是 `T`/`F` 而非 `A`/`B`。
- 内容类型（`content-item.type`）实测分布：`{2:40, 3:157, 4:361, 5:10, 6:62, 7:1, 12:8, 14:350}`。
  其中 **`type=14` 数量最多**，是习题类内容。

### 11.6 接口参数修正 [实测]

| 项 | 静态文档 | 实测 |
| --- | --- | --- |
| `content_type`（student_course） | 未明确 | **必须为 2**；用 1 返回 `80020 内容项不存在！` |
| 目录树接口参数 | `user_id, type` | 前端实际发 **`user_id=0&type=0`** |
| 内容清单 | — | `GET /textbook/course/{bizId}/content/{catalogId}/list?content_type=2` |
| 非习题内容 | — | 对非习题项取题返回 `601 该内容不是习题项！` |
| 阅读进度 | GET/`POST /user/study/read/record` | ✅ 载荷 `{bizId, contentType, catalogId, contentId}` 一致 |
| 时长上报 | `POST /user/study/time/record` | ✅ 载荷 `{bizId, contentType, catalogId}` 一致 |
| 内容完成 | `POST /user/study/course/content/record` | ✅ 提交答案后站点自动顺带调用，载荷 `{courseId, catalogId, contentId}` |

### 11.7 提交按钮状态机 [实测]

- 未作答：按钮文案 **`Submit`**（`ant-btn ant-btn-default ant-btn-block`）
- 提交后：文案变为 **`Retry`**
- 与 §6.2 的状态机推断一致（`answer-submit` / `answer-retry`）

### 11.8 其它限制（不变）

- **语音题**走驰声 chivox 实时评测，必须真人录音，脚本识别后跳过，不伪造音频
- 作业/考试模块有全屏监控、切屏自动提交、人脸抓拍（`/exam/*/face/capture`、`/exam/*/switch/scree`），脚本不触碰
- 新站启用阿里云 RUM 会话回放（全站），操作会被记录

### 11.9 拖拽事件序列：触发式验证通过 [实测]

§6.6 推断的事件序列此前只在产物里读到，未在登录态触发过。本轮补齐：点 `Retry`
使题目回到作答态，再用最小 `DataTransfer` 桩派发序列，观察投放区反馈。

**验证结果**：投放区从
`"1. cheetah 请拖拽到此区域"`（`.dropped-item` 数 = 0）
变为
`"1. cheetah a. animals, birds, etc. …"`（`.dropped-item` 数 = 1）。

→ **HTML5 DnD 序列被站点接受，不需要 pointer 事件**。§6.6 的事件序列与字段语义
（`extension.drag` = 投放目标、`extension.dragged` = 可拖项）均成立。

**顺带确认的两个状态差异**：

| 状态 | `.drag-item` class | `draggable` | 投放区提示 |
| --- | --- | --- | --- |
| 查看态（已提交） | `drag-item drag-item-with-handle view-mode` | `null` | 显示学生答案 |
| 作答态（Retry 后） | `drag-item drag-item-with-handle` | `"true"` | `请拖拽到此区域` |

即 **`draggable="true"` 只在作答态存在**；引擎 `findDragSource()` 里
`.drag-item[draggable="true"], .drag-item` 的双选择器兜底是必要且正确的。

### 11.10 「正确答案」容器存在但为空 [实测]

已作答的拖拽题里，每个投放区下有两个兄弟容器：

```html
<div class="answer-container view-mode has-answer">
  <div class="dropped-item user-answer wrong">…</div>   ← 学生答案，逐题标注对错
</div>
<div class="answer-container view-mode correct-answer has-answer">
  <!---->                                              ← 空占位，未渲染
</div>
```

**`.correct-answer` 容器在线上为空**（Vue 空占位注释）。这进一步印证 §11.3：
站点**具备**展示正确答案的槽位，但**实际不下发**。

> 产物里能读到控制这一行为的开关：
> ```js
> function te(){ let e = Number(t.textbookInfo?.errorNumShow); return Number.isFinite(e) && e>0 ? e : 1 }
> ```
> 即 `errorNumShow`（提交后允许查看答案的次数）。实测该课程下正确答案未渲染。

**副产品**：`has-answer` 容器内的 `.dropped-item.user-answer.wrong` 直接标出**逐题对错**
（`wrong` / 对应地会有 `right`），可用于定位哪些题答错。

### 11.12 作答策略：模式决定「敢不敢试错」[实测]

#### 为什么必须先分清模式

两种模式的判分口径**相反**，直接决定反复提交的后果：

| 模式 | `learnMode` | 成绩取值 | 试错后果 |
| --- | --- | --- | --- |
| 自由模式 | 1 | 记**末次** | ⚠️ 中途的错误提交会成为最终成绩；只有最后一次答对才能挽回 |
| 闯关模式 | 2 | 记**最高** | ✅ 反复提交不会拉低成绩 |

**因此「先分清模式」是作答的前置条件，而不是可选项。**

#### 实现（v2.3.0）

判分口径来自 `GET /course/{id}/detail`（阅读器页面自身也调这个接口）：

```json
{ "learnMode":1, "freeShowAnswer":1, "passShowAnswer":1,
  "errorNumShow":3, "caculateToGrade":1, "learnTimeLimit":0 }
```

引擎据此分三条路径：

1. `loadCoursePolicy()` —— 作答前拉取并缓存策略
2. `strategyOf()` —— 推出 `retrySafe`（该模式下反复提交是否安全）
3. `answerRevealThreshold()` —— 由 `errorNumShow` 得到答案下发阈值，**读不到则返回 `Infinity`（永不试错）**

策略分派：

- **闯关模式** → 未下发答案时调用 `retryUntilAnswer()` 自动试错，取到答案后回填并**再提交一次**闭环
- **自由模式** → **不自动试错**，无答案且未配 AI 时 `stopRun` 并说明原因
- **读不到策略** → 一律 `retrySafe:false`

自检面板会输出判定结果（实测样例）：

```
== 课程判分策略 ==
学习模式: 自由模式（learnMode=1）
成绩取值: 记末次答题结果
反复提交: 有风险（记末次，错误提交会成为最终成绩）
答案下发阈值 errorNumShow: 3（答错达该次数后服务端下发标准答案）
计入成绩 caculateToGrade: 1；学习时长限制 learnTimeLimit: 0
```

#### 关于「会不会触发反作弊」

实测范围内的结论（与 §8bis.6 一致）：**教材阅读器内无行为监控**。
全量扫描 282 个产物，`textbook-reader-*` 中 `cheat / face / monitor /
visibilitychange / blur / fullscreenchange` 全部 0 命中；全站无 `sendBeacon`、无自建埋点。
人脸抓拍、切屏提交等反作弊**只存在于作业/考试模块**，不适用于教材阅读。

真正需要控制的是：**阿里云 RUM 会话回放**（全站开启）与**站点自身没有限流退避**。
故试错做了随机化节流（每次提交间隔 600–1200ms、轮间 1600–2800ms），
并且**只在无副作用的闯关模式下自动启用**。

### 11.13 修复：`questionAnswerItemVOList` 未合并导致的两个缺陷 [实测]

站点前端在渲染前会把两个列表按 `questionId` 合并（`src-DZ23PK2` 的 `T()` / `E()`）：

```js
function T(e, t) {
  let n = t.get(e.id);
  e.doRecord = n?.overWriteUserAnswer || n?.userAnswer || ``;
  e.answer   = n?.answer || ``;
  ...
}
```

`doRecord` / `overWriteUserAnswer` / `userAnswer` **只存在于 `questionAnswerItemVOList` 的元素上**，
`questionVOList` 的元素里没有这些字段。引擎此前漏了合并，于是：

- **缺陷 A**：`hasUserAnswer()` 恒为 `false` —— 已作答的题也被当成未答
- **缺陷 B**：由此永远走「未作答」分支，**「已全部作答」分支从未被执行过**；
  修好 A 之后才暴露出该分支里多写了一次 `submitAnswers()`，导致对同一节**重复提交同一份答案**
  （实测连发 4 次相同载荷）

**修复**：新增 `mergeAnswerItems()` 在 `loadCurrentExercise()` 内调用；
「已全部作答」分支改为**直接推进下一节**（`doRecord` 有值即说明服务端已记录，无需再提交）。

**复验**：对一节已完成作答的页面启动刷课，`POST /question/submit/answer` 请求数 = **0**（修复前为 4）。

### 11.15 AI 补答接入与填空题作答：三处实测修复 [实测]

用真实 API（DeepSeek 的 Anthropic 兼容层，`https://api.deepseek.com/anthropic`）跑通
「取题 → AI 补答 → 填入 → 提交 → 计分」全链路后，修正了三处此前想当然的地方。

#### (a) 请求格式必须自适应

服务端的模型是分格式的。实测两种情况都遇到了：

```
POST /chat/completions  → 400
  Model "claude-sonnet-5" must be called via /provider/v1/messages (Anthropic Messages shape).
```

```json
// DeepSeek 的模型名也踩了坑
{"error":{"message":"The supported API model names are deepseek-flash, deepseek-v4-pro,
  but you passed deepseek_flash."}}
```

**修正**：`aiFormat()` 按 Base URL 是否含 `anthropic`/`commandcode` 自动选择格式；
`aiEndpoint()` 兼容末尾带不带 `/v1`。Anthropic 走 `x-api-key` + `anthropic-version`，
正文取 `content[]` 中 `type === 'text'` 的块。

#### (b) 推理模型会把 token 额度全烧在思维链上

这是最隐蔽的一处。`deepseek-flash` 默认先产出一大段 `thinking`：

```
max_tokens=1024 → stop=max_tokens  blocks=["thinking"]           text=""   ✗
max_tokens=4096 → stop=max_tokens  blocks=["thinking"]           text=""   ✗
thinking disabled → stop=end_turn  blocks=["text"]               text="It is their…"  ✓
deepseek-v4-pro   → stop=end_turn  blocks=["thinking","text"]    text="ice\nhabitat\nmelting" ✓
```

**提高额度并不解决问题**（思维链会把新额度同样吃光），`stop_reason` 恒为 `max_tokens`
且**根本不产出 `text` 块**，于是解析出空串、静默失败。该现象与题目难度无关，只与
模型是否输出思维链有关 —— 因此曾出现「同一段代码，有的题成功有的题失败」。

**修正**：Anthropic 分支默认带 `thinking: {type:'disabled'}`；
解析时若只有 `thinking` 块，主动 `log` 出 `stop_reason` 与块类型，不再静默返回 null。

#### (c) 填空题的写入需要完整事件序列

只做 `textContent` + `input` + `blur` 时，**DOM 有值但提交被前端硬门禁拦下**：

```
操作提示 请完成所有习题后再提交（已完成 0题，未完成 1 题）
```

读产物里填空题组件（`src-DZ23PK2` 的 `Ij()`）才看清它的契约 —— 组件在容器 `#do_{id}` 上绑定：

| 事件 | 作用 |
| --- | --- |
| `input` → `O()` | 用 **`span.id`** 作 key 写入 `doRecord`，置 `changed = true` |
| `focusout` → `M()` | 置 `focus = false`，若 `inner` 也 false 则 emit `doRecordChange` |
| `mouseout` → `j()` | 置 `inner = false`，若 `focus` 也 false 则 emit `doRecordChange` |

即必须让 `changed` / `focus` / `inner` **三个标志依次就位**才会真正提交作答；
且监听的是 `focusout`（冒泡）而非 `blur`。另外 `O()` 开头就是 `if (!t?.id) return;`，
所以 span 的 `id` 是必需的。

**修正**：`fillEditable()` 补齐 `focusin → input → change → focusout → mouseout` 序列，
并为 `FocusEvent` 不存在（离线测试的 mock DOM）的情况做降级。

#### 验证结果

填空题（5 个空，纯文字题干）一次通过：

```json
{ "answerCount": 1, "rightRate": 80,
  "overWrite": "[{wild,status:1},{homes,status:3},{climate,status:1},
                 {protect,status:1},{species,status:1}]" }
```

服务端**逐空**返回 `answerStatus`（1 = 对，3 = 错），比整题粒度更有用。

#### (d) 拿分的完整闭环：试错 → 应答态 → 回填 → 覆盖

在 (a)(b)(c) 都修好之后，才暴露出两个**只有跑通全链路才会显现**的缺陷。
它们共同导致「服务端明明给了标准答案，脚本却拿不到分」：

| 缺陷 | 现象 | 根因 |
| --- | --- | --- |
| **查看态下无法写入** | `写入 0 个空`，提交的仍是旧答案 | 已作答的题渲染成**查看态**：填空元素是 `zty-exercise-item-fill-blank-**done**`（done），不是 `-do`。查看态没有可写元素，必须先点 `Retry` 回到作答态 |
| **填空载荷格式错误** | 答案值全对却 `rightRate: 0` | 站点线格式是 `[{idx, answer}]`（`idx` = 题干空位 span 的 `id`）。引擎自己拼的是裸值数组 `["surrogate","hyena",…]`，服务端整题判错 |

**另外**：`deepseek-flash` 等推理模型的思维链长短直接影响是否产出正文，
所以**超时不能按普通请求设**（原 25s 会在复杂题上误判超时，已提到 90s）。

#### 最终闭环（v2.3.0）

```
取题(无答案) → AI 补答(可选) → 试错轮询至 errorNumShow 次
             → 服务端下发 standardAnswer
             → 点 Retry 回到作答态 → 按 [{idx,answer}] 回填
             → 提交覆盖 → 满分
```

**实测结果**：同一道填空题，AI 首答 `rightRate: 0`（五个空全错），
经上述闭环覆盖后 **`rightRate: 100`（五空全对）**。

**已作答的节也会被修正**：若节内存在 `answerStatus !== 1` 且服务端已下发标准答案，
脚本会重做覆盖，而不是直接翻页 —— 否则这一节的分数会永久停在错误值上。

### 11.17 客观题与主观题必须分流：AI 只该处理后者 [实测]

一度把 AI 用在所有题上，这是错的。两条路其实**互补**，混用只是浪费：

| 题目性质 | 服务端行为 | 正确处理 |
| --- | --- | --- |
| **客观题**（`obSub: 'ob'`） | 答错累计到 `errorNumShow` 后**下发权威 `standardAnswer`** | **轮询**取答案后回填 |
| **主观题**（`obSub: 'sub'`） | `answerStatus` 恒为 `-1`，**不下发答案**（返回 `"Answers will vary."` 或整句参考） | **AI** 作答（轮询对它无效） |

**实测对比**（同一道 12 空的客观填空题）：

| 路径 | 结果 | token |
| --- | --- | --- |
| AI 首答 | 部分正确甚至全错（另一道 5 空题 AI 全错） | 有 |
| **轮询取答案** | **`rightRate: 100`，12 空全对** | **0** |

即：**客观题用 AI 既不准又费钱**；轮询拿到的是服务端权威答案，天然优于模型猜测。
而主观题服务端根本不给答案，**那才是 AI 唯一必要的场景**。

**实现**：`isSubjective(q)` 依据 `obSub === 'sub'`（并兜底 `essay_*` 题型）分流 ——
AI 只处理主观题，客观题全部交给 `retryUntilAnswer`。
实测全客观的一节：**AI 请求数 = 0**，最终 `rightRate: 100`。

**副产品**：`obSub` 就摆在题目对象里（与 `DEVELOPMENT §6.8` 记录一致），
无需猜测题型的主观性。

### 11.19 查成绩面板：把接口字段名当界面用 [实测，含一次假绿教训]

**症状（用户报告）**：点「查成绩」，面板吐出的是一串英文字段名：

```
classNum: 39
courseNum: 39
courseScoreCourseRank: 9
courseStudyUseTimeCourseRank: 8
duration: 4150
progress: 2
score: 1.02
```

**根因**：`formatScore()` 里有个 `flat()`，把接口返回的键值对**原样拼成 `k: v`**。
这不是 bug 的偶然，而是当年「作者无法登录实测」时的权宜之计 —— 手上没有真实字段，
就把整个对象摊开给用户自己看。现在能实测了，它就从「排查手段」变成了「界面缺陷」。

**顺带查出第二个缺陷**：`fetchScore()` 调了 `/course/{id}/class/base/info`，实测对学生账号

```
403 您没有该操作权限
```

即课程名**永远取不到**（`base` 恒为 null）。改为学生视角的 `/student/course/{id}/detail`
（含 `title` / `courseClassName` / `teacherName` / `learnMode` / `errorNumShow`）。

**修法**：新增 `formatDuration()`（秒 → `1小时9分`）与 `formatRank()`（→ `9/39`），
`formatScore()` 重写为中文看板，并补上各单元明细（`/course/{id}/study/situation/unit/list`）。

#### 一次「假绿」教训

首版回归测试跑出 11/11 全绿，但输出第一行是**空的** —— 课程名没显示。
原因是测试给 `formatScore` 喂的是**旧结构** `{overview, base}`，漏了 `detail`；
而断言写成了

```js
out.includes('新世界交互英语') || !/查询失败/.test(out)   // ← 后半段兜底，恒真
```

那个 `||` 让断言在对**错误输入**时也能通过。改成传入真实结构（`overview` + `detail` + `units`）
并把断言拆成独立的 `显示课程名` / `显示班级` / `显示教师` 三条后，才真正测到东西。

> **教训**：断言里的 `||` 兜底 = 放弃断言。测试通过不等于被测量正确。

**回归测试**：`test/score-format.test.js`（16 项，覆盖字段名不泄漏、中文标签、时长格式、
排名分母、以及「不再请求那个 403 接口」）。

### 11.21 「点了没反应」与「不会自动翻页」[实测]

**用户报告**：在目录页点「开始刷课」**完全没反应**；而且**不会自动翻页**，
应该像旧站那样进了目录页就能从进度不足处自动往下刷。

**排查到的第一层**：`doOneRound()` 开头就是

```js
const route = parseReaderRoute();
if (!route) {
    if (isCoursePage()) { status('请在课程中打开具体教材/课程章节'); return; }   // ← 只提示一行
}
```

即「开始刷课」**只在阅读器页面内工作**。从目录页点击 → 解析不到内容 id → 写一行状态就退出。
「做一轮」更甚：先写「执行一轮...」、立刻返回、再写「本轮完成」，**看着就是什么都没发生**。

**第二层**：即便在阅读器内，处理完一节只调 `clickPagination('next')` 翻**页内**分页，
不会跨节推进。而 `loop()` 只是 `setTimeout` 重复 `doOneRound`，始终停在同一节。

**第三层（修完前两层才暴露）**：课程列表页 `/course_center/my_course` 的
**URL 和 DOM 都不含 courseId** —— 没有 `<a href>`（Vue 编程式路由），
HTML 里也搜不到 19 位数字。所以「从列表页开刷」还缺一个课程来源。

**修法**（新增 §12bis 自动连续刷课）：

| 环节 | 做法 |
| --- | --- |
| 定位未完成处 | `/course/{id}/catalog/list/with/progress` 拿 566 个节点带 progress，取第一个 `progress < 100` 的**叶子** |
| catalog → content | 叶子只给 catalogId，再调 `/textbook/course/{biz}/content/{catalogId}/list` 取内容项 |
| 遍历单位 | **contentId**，不是 catalogId —— 实测一个 catalog 下挂多个内容项（13053 → 23882/23883/23884） |
| 跨页推进 | `location.href` 整页跳转 + 状态存 localStorage，页面重载后自动恢复 |
| 判重 | 记录已处理的 contentId 集合，避免服务端进度未及时更新导致原地打转 |
| 列表页选课 | `/student/school/course` 取课程清单，面板加「Course · 课程」下拉（URL/DOM 都拿不到 id，只能这样） |

> **副作用**：整页跳转意味着地址栏会逐节变化，这是设计而非故障。

**回归测试**：`test/auto-run.test.js`（26 项）——覆盖定位未完成处、跳过已处理 contentId、
跨目录推进、全部完成返回 null、课程页点击确实发出目录请求并导航、状态持久化与清除。

### 11.23 以服务端返回判断题型性质，而不是只信标签 [实测]

`obSub` 是站点给的**标签**，而 `answerStatus` 是服务端的**实际行为**。两者一致性靠不住，
所以判分口径应以行为证据为准。实测的规律非常干净：

| 题型 | `answerStatus` | `answer` 内存 |
| --- | --- | --- |
| 客观题（含听力选择题） | **1 / 2 / 3**（自动判分） | 阈值后下发标准答案 |
| 主观题（填空「答案多样」、问答、写作、翻译） | **-1**（服务端不自动判分） | 不下发 |
| 语音题（`oral_*`） | 始终缺席（空提交直接 500） | 不下发 |

**听力题属于客观题**（`obSub: 'ob'`，`answerStatus` 正常判分），所以**轮询完全可行**——
实测：

```json
{"type":"choice_single", "obSub":"ob", "answerCount":4,
 "itemAnswer":"240f8800-fcd9-c9a6-eac2-2f771481c6a4"}   ← 标准答案已下发
```

**实现**：新增 `gradedKindOf(item)` → `'objective' | 'subjective' | null`。
分流与试错都以它**优先**、`obSub` **兜底**（首次作答尚无返回，只能先猜）：

```js
const kind = gradedKindOf(kindMap.get(Number(q.id)));
if (kind === 'subjective') return true;
if (kind === 'objective')  return false;
return isSubjective(q);            // 尚无返回 → 退回标签
```

**收益**：① 站点标签写错时不会白调 AI 或白轮询；
② `retryUntilAnswer` 开头即检查——若全部题为 `subjective`，**直接放弃轮询**，
不再空烧 3~4 次提交（附带降低触发限流的风险）。

### 11.24 自动刷课遇语音题会卡死 [实测]

**症状**：自动刷课跑到第一节语音题就停住，状态栏「仍有 1 题无法作答，已停止以免空提交」。

**根因**：那段门禁无条件 `stopRun`：

```js
if (left.length) { stopRun('仍有 ' + left.length + ' 题无法作答…'); return; }
```

它本意是防止对着没答完的题空提交，但**语音题永远答不完**（需真实音频），
于是整条自动刷课链被一节语音题掐断。

**修法**：自动刷课期间改为**跳过并继续**（`return` 而不 `stopRun`，
交给 `loop` 尾部的 `autoAdvance` 记入 `done` 并跳下一节）；手动模式仍如实停下。

> **但"不卡死"不等于"没问题"**：跳过之后该内容项仍未完成，`progress` 不会上涨。
> 这是评测机制决定的硬边界（详见 §6.4 的说明），**必须让用户知道**，
> 否则会误以为"刷完就满分"。README「已知限制」已单列此条。

### 11.25 排查手段

面板「结构自检」会打印路由解析、令牌状态、DOM 探针命中、题卡推断题型、按钮状态
与取题接口返回的**字段名与长度**（不含内容）。

---

## 12. 测试方法论

- 逆向语料：无登录抓取线上首页 + 282 个构建产物（7.21 MB），本地全文检索
- 证据优先级：**运行时/线上产物原文 > 注释与文档**
- CSS 产物与 JS 产物交叉验证选择器（避免只读渲染函数导致的误判）
- 契约一致性自查：脚本内检索旧站残留标识（`tsenglish` / `sea-fetch-path` / `app-course-task-stu` /
  `.page-next` / `wy-btn` / `.courseList` / `.uniteTitle` / `tsinghuayingyu-front.currUser`）应为 0 命中

### 12.1 登录态实测方法（v2.2.0 新增）

静态逆向的弱点是：**它只能证明代码里写了什么，不能证明线上跑的是什么。**
§11 的多处推翻正出自这一差距。因此 v2.2.0 补齐了实测环节：

- **驱动方式**：Chrome 以独立 profile 启动并开 `--remote-debugging-port`，
  通过裸 WebSocket CDP 客户端（`tsh-reverse/test/cdp.js`，零依赖）驱动真实登录态页面
- **网络取证**：在文档加载前注入 `fetch` / `XHR` 拦截，捕获站点自身发出的请求与响应原文
  —— 这是确定「接口到底返回了什么」的唯一可靠手段
- **行为验证**：用 `Input.dispatchMouseEvent` 派发**真实鼠标事件**（`isTrusted=true`）
  驱动作答与提交，而非页面内合成事件
- **只读优先**：默认只做读取与探测；涉及写入（提交）的操作单独隔离，
  且提交后立即回查接口，比对前后差异
- **证据留档**：每步产物写入 `tsh-reverse/captcha/*.json`，便于复核

原则与静态阶段一致，仅顺序调换：**运行时行为 > 线上产物 > 注释与文档**。

---

## 13. 版本历史

| 版本 | 说明 |
| --- | --- |
| **2.3.0** | **策略感知版**。新增：以服务端返回（answerStatus）判断题型性质而非只信 obSub（§11.23）、自动刷课遇语音题跳过而非卡死（§11.24）、自动连续刷课（课程页一键开刷、自动定位进度不足处、跨节推进，见 §11.21）、查成绩面板改中文可读（原直接输出接口英文字段名，并改走有权限的接口，见 §11.19）、客观题/主观题分流（客观题走轮询取权威答案、零 token；主观题用 AI，见 §11.17）、AI 请求格式自适应（Anthropic/OpenAI）、输出额度自适应（推理模型的思维链会吃掉额度）、填空题完整事件序列写入、查看态自动 Retry 回作答态、填空载荷按 [{idx,answer}] 构造、答错题自动重做覆盖（见 §11.15）。作答前先读 `learnMode` / `errorNumShow` 等判分口径（§11.12），据此分派：闯关模式自动试错取答案，自由模式不试错并明确停下。修复 `questionAnswerItemVOList` 未合并进 `questionVOList`（§11.13）导致的「已作答永远判为否」与由此产生的重复提交 |
| **2.2.0** | **新站实测修正版**。以志愿者学生账号在登录态下完成端到端实测（§11）。修正：`content_type` 推断正则（原漏下划线 → 恒判为 1 → 接口 80020）；`SEL.paginationWrap` 改指真实存在的 `.preview-pagination`；选项容器以 `.ant-radio-wrapper` 优先；实现真正的 AI 补答（`aiAsk` 在 v2.0.0–v2.1.1 中定义了却从未被调用），并在无答案且未配 AI 时明确停止而非提交空答案。**另查明**：标准答案由服务端在答错累计 `errorNumShow` 次后下发到 `questionAnswerItemVOList[].answer`（§11.3），自由模式成绩记末次 |
| 2.1.1 | 依 issue #2 实测反馈修复；引擎源码分离架构（`engines/`） |
| 2.1.0 | 双引擎版：按路径分派新旧两套引擎，装一次通用 |
| 2.0.0 | **新站重写**：适配 Vue3/Vite。API 域、鉴权、路由、接口、题型层、交互层全部重写；新增结构自检；撤回 v1.1.3 停止维护决定。**注：其「取题接口直取标准答案」的核心前提，已于 v2.2.0 被实测推翻** |
| 1.1.3 | （未发布，已撤回）停止维护 |
| 1.1.2 | 全新身份（改名/namespace/存储键/文件名）；知情同意书版本化；GUI 重写 |
| 1.0.0 | 清理死代码、加载容错、翻页 URL 校验、弹窗白名单 |
| 0.9.x | 右箭头全自动；降频；限流自动冷却 |
| 0.7.x | 查成绩 + 刷时长 + AI 接入 |
| 0.6.x | 基于 2026 实测 DOM 重写 |
