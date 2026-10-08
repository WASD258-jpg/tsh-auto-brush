# tsh-auto-brush-review 代码审查发现

> 审查对象：本仓库 v2.3.0（基线 `v2.1.1`）
> 审查时间：2026-10-08
> 审查方式：源码直读 + 离线测试实跑 + 产物同步校验 + 针对性探针复现（无浏览器、无账号）
> 待验证/无法离线判定的结论在正文中显式标注

---

## 0. 审查范围

深审：`engines/new-engine.user.js`（2955 行，本次改动主体）、`test/*.test.js`、`test/harness.js`、`test/build-dual.js`。

未深审：`engines/legacy-engine.user.js`（本次未动）、§9 学习时长、§10 成绩解析、GUI 渲染细节、需要真实登录态才能验证的服务端行为。

---

## 1. 基线核验（全部通过）

| 项目 | 结果 |
| --- | --- |
| `node test/smoke.test.js` | 121 通过 / 0 失败 |
| `node test/dual-engine.test.js` | 35 通过 / 0 失败 |
| `node test/issue2-fixes.test.js` | 20 通过 / 0 失败 |
| `node test/score-format.test.js` | 16 通过 / 0 失败 |
| `node test/auto-run.test.js` | 24 通过 / 0 失败 |
| **合计** | **216 通过 / 0 失败**（与 REVIEW.md §2 一致） |
| 产物同步 | 跑 `node test/build-dual.js` 前后产物 SHA256 完全相同：`99534EBDB2159E6D59C06E3B46DE730D41F9174DDD4902E62A7829FE53AE6BE3`；`git status` 干净 |

结论：`engines/new-engine.user.js` 与产物 `tsh-auto-brush.user.js` 确实同步，基线可信，后续结论不受"测到旧代码"影响。

---

## 2. 结构问题：分节不是"乱序"，是**覆盖**

### 2.1 现象

16 个横幅的物理顺序：

```
1(29) 2(106) 3(182) 4(309) 4bis(370) 5(469) 6(640) 7(992) 8(1093)
9(1730) 9b(1793) 10(1818) 12bis(1920) 12(2319) 13(2389) 14(2666)
```

`4bis`、`9b` 属"按需追加"的命名补丁；`12bis(1920)` 排在 `12(2319)` 之前；**`11` 完全缺失**。

### 2.2 根因：§11 的横幅被顶掉了

`git diff v2.1.1...HEAD -U0 -- engines/new-engine.user.js` 的直接证据：

```diff
-// 11. 结构自检（关键：作者无法登录实测，交由用户反馈）
+// 12bis. 自动连续刷课（跨节推进）
```

`v2.1.1` 的章节完整：`11(1162) → 12(1337) → 13(1407) → 14(1545)`，全文 1798 行。
`v2.3.0` 中，`12bis` 的整块新代码插入点落在**原 §11 横幅那一行**，把 §11 的三个函数与其文档注释一并吞进 12bis 尾部：

```
1922-2124   12bis 区块体（getAutoRun/setAutoRun/…/startAutoRun）
2125        悬空的 //
2126-2132   「设计要点（来自 issue #2 的实测反馈）」← 原本挂在 §11 上
2135        waitForStableRender()   ← 实际属于 §11
2153        classSummary()          ← 实际属于 §11
2164        selfCheck()             ← 实际属于 §11
2319        // 12. 脚本有效性检测 + GitHub Issue 上报
```

即 §11 的三个函数现在寄居在 12bis 段落内，注释与函数之间还夹了一个孤立的 `//`。

### 2.3 判定

单靠重排编号治不了，因为"编号"本身已失去锚点意义。建议：

1. 横幅改用**不依赖序号的命名**（如 `// === 结构自检 ===`），彻底消除追加时的覆盖动机；
2. 每个区块以**函数群**为单位闭合（区块尾不留悬空注释）；
3. 重排时把 `waitForStableRender / classSummary / selfCheck` 拆回独立的"结构自检"区块。

---

## 3. 职责耦合与状态散落

### 3.1 GUI ↔ 业务是双向的

业务直接读/写面板 DOM：

| 位置 | 内容 |
| --- | --- |
| `resolveCourseId()` 1982 | 读 `$1('#b6-course').value` |
| `fillCourseSelect()` 1997-2014 | `createElement('option')` 直接写下拉 |
| `stopRun()` 2655-2656 | 写 `#b6-start` 文案 |
| `status()` 2661 | 写 `statusEl`（由 `mkUI()` 2774 赋值）；`doOneRound` 内调用 20+ 处 |

面板直接驱动业务：

| 位置 | 内容 |
| --- | --- |
| 2796 | `#b6-start` → `startAutoRun()` / `loop()` |
| 2808 | `#b6-one` → `doOneRound()` |
| 2842 | `#b6-check` → `selfCheck()` |
| 2944-2954 | 恢复 IIFE 直接改 `running/roundCount/noProgressRounds/invalidRounds` 后进 `loop()` |

`statusEl` 在 `mkUI()` 之前恒为 `null`，`status()` 静默丢弃 —— 面板成了业务的前置依赖。

### 3.2 状态没有统一对象

模块级可变状态共 14 个 `let`，其中 **4 组被 GUI 与业务同时读写**：

- `aiConfig`(644)：GUI 写 2875-2878，业务读 651/658/665/680
- `reportConfig`(2323)：GUI 写 2896-2897/2902-2905/2910-2913，业务写 2378
- `studyTimer`(1748)：GUI 读写 2814/2864-2865，业务写 1773/1780
- `running/roundCount/noProgressRounds/invalidRounds`(2392-2396)：GUI 2799、恢复 IIFE 2950、业务 2425/2449/2610 同写

再叠上 localStorage 的 `tsh_auto_run`(1935) / `tsh_auto_brush_ai`(643) / `tsh_auto_brush_report`(2322)，其中 `tsh_auto_run.done` 数组(2067/2104/2107)参与跨页去重。

同一职责还被拆到文件两端：`resumeAutoRun`(2944) 与 12bis 的 `autoAdvance`(2060)/`startAutoRun`(2098) 分居首尾。

建议：抽一个"面板适配层"（业务只与 `getCourseSelection()` / `setStatus()` / `setRunning()` 这类窄接口对话），并把运行状态收敛成一个 `runState` 对象；恢复逻辑并入 12bis。

---

## 4. `doOneRound()` 分支堆积

| 指标 | v2.1.1 | v2.3.0 |
| --- | --- | --- |
| 行数 | 1418-1518（101 行） | 2400-2630（231 行） |

膨胀 2.3 倍，内含 4 条主路径 + 3 个前置守卫（限流冷却、路由识别、有效性检测），以及成片的复制：

| 重复形态 | 出现位置 | 次数 |
| --- | --- | --- |
| `questions.filter(q => !hasUserAnswer(q))` | 2473、2490、2510、2550 | 4 |
| `buildAnswerMap(currentResp)` 同源重建 | 2493、2532、2578 | 3 |
| `noProgressRounds++` + `>=3` 阈值块 | 2449、2466、2610、2624 | 4 |
| `if (route.catalogId) await apiMarkContentDone(...)` | 2463、2607、2619 | 3（一字不差） |
| 翻页失败处理块 | 2608-2613、2622-2629 | 2（仅差一个 `else`） |
| `noProgressRounds = 0;` | 2450/2468/2570/2596/2606/2611/2625/2628 | 8 |

其中 2610-2611 与 2624-2625 的 `stopRun('已到最后一页，全部完成')` 文案完全相同；2473 的 `unanswered` 算完只用于一次 `if`，随即被 2490 的 `left` 取代（纯冗余计算）。

"取答案 → 提交 → 标记完成 → 翻页 → 失败计数"这条链被复制成 3 条出口：无题 2617-2629、语音题 2455-2470、已答完 2573-2614。

建议：把"这一节该怎么处理"抽成纯函数（输入 `questions + policy + route + 已答状态`，输出动作枚举：`SUBMIT / REDO / SKIP_SPEECH / ADVANCE / STOP`），`doOneRound` 只负责执行动作与副作用。

---

## 5. 正确性缺陷

### 5.1 `retryUntilAnswer()` 在"客观题 + 主观题同节"时永不闭环（高）

**复现**：探针脚本见附录 A，实跑结果：

| 场景 | 取题次数 | 提交次数 | `retryUntilAnswer` 返回 | 耗时 | 日志 |
| --- | --- | --- | --- | --- | --- |
| 混合节（1 客观 + 1 主观，主观题服务端不下发答案） | 7 | **6**（= `threshold+3`） | `false` | 26.2 s | 无"回填"日志 |
| 对照（2 道客观题） | 2 | 2 | `true` | 6.5 s | `试错取得答案，回填 {filled:2}` |

**根因**：1686 的退出条件

```js
const missing = questions.filter(q => !usable(q));
if (!missing.length) { /* 答案已齐 → 回填并提交 */ }
```

`usable()`(1680-1685) 用 `a.answer` 是否非空判定；而主观题的 `answer` 服务端永不下发（填空还会下发 `Answers will vary.`，被 `normalizeFillAnswer` 判为 null，见 605/627）。**只要本节含一道这样的题，`missing` 永远非空 → 1688 的"答案已齐"分支永不进入 → 客观题的官方答案即使已经下发也从不回填**，循环空转到 `maxCalls`（`threshold + 3`）才返回 `false`。

**影响**：

- 打穿文档核心承诺。README.md:143 / :221 / :375 三处都写"拿到服务端答案后闭环覆盖，因此是单调改善"，混合节里这个闭环根本不发生；
- 每轮白烧 `errorNumShow + 3` 次提交（实测一次 26 秒、6 次提交），而站点对 429 只提示不重试（194-196 注释），持续空转有触发限流风险；
- 现有测试只覆盖"全为主观题"的 pre-check 早退（`auto-run.test.js:161-166`），**混合路径零覆盖**。

**修法**：`usable()` 只对"可期望下发答案"的题计票 —— 即先按 `gradedKindOf` / `isSubjective` 过滤掉主观题，让 `missing` 只统计客观题；主观题交由 AI 路径处理。

### 5.2 试错门禁与三份文档互相矛盾（中）

**声称**：

- `new-engine.user.js` 1606-1610：「本函数**只允许在闯关模式下调用**」「调用方**必须先经** `strategyOf()` 判定 `retrySafe`」
- DEVELOPMENT.md:853：「**自由模式** → **不自动试错**，无答案且未配 AI 时 `stopRun` 并说明原因」
- DEVELOPMENT.md:876：「并且**只在无副作用的闯关模式下自动启用**」

**实际**：2543-2548

```js
if (!strat.retrySafe) {
    status('【' + strat.mode + '】成绩记' + strat.gradeBy + ' —— 保持当前答案不变，只补空白，…');
}
status('试错取答案：服务端在答错 ' + threshold + ' 次后下发标准答案');
const got = await retryUntilAnswer(route, questions, threshold);   // ← 无条件
```

`if (!strat.retrySafe)` 的分支体只有一行 `status()`，没有 `return`、没有跳过；`retryUntilAnswer` 全文（1660-1727）不含任何 `retrySafe` 检查；`retrySafe` 全文件仅两处使用：2185（自检显示）、2543（这句提示）。**实际生效的门禁只是阈值有限性**（1661 + 2540）。

而 README.md:143/375 又说自由模式照跑试错、只是"单调改善"——三份文档各说各话，代码跟 README 走。

**判定**：注释与 DEVELOPMENT.md 已过时，必须统一口径（选哪边都行，但不能三处并存）。

### 5.3 语音题分支会把内容标记完成（中，需真机验证）

**声称**：DEVELOPMENT.md:313「脚本跳过语音题时，**该内容项不会被服务端标记完成**，`progress` 停在原值」；README.md:404「该内容项**不会被标记为完成**」；README.md:408「语音题那部分进度**永远得你自己补**」。

**实际**：`doOneRound` 语音题分支 2463

```js
if (route.catalogId) await apiMarkContentDone(route.bizId, route.catalogId, route.contentId || 0);
```

`apiMarkContentDone`(277-278) 即 `POST /user/study/course/content/record`。服务端是否接受无法离线判定，但"脚本不标记"这一对外承诺与代码不符。

附带：该分支是**整节跳过** —— 只要一节里有一道语音题，同节里可自动作答的客观题也一并放弃（2464 直接 `clickPagination('next')`）。是否接受属产品取舍，但应与 README 的表述对齐。

### 5.4 注释与文案脱节（低）

- 439 注释「（未配置时保守取 1，即不依赖试错）」与 443 的 `return Number.isFinite(n) && n > 0 ? n : Infinity;` 直接矛盾；DEVELOPMENT.md:848 写的是 `Infinity`，即实现正确、注释错。
- 面板文案 2749「仅在页面未下发标准答案时使用」与实现不符：AI 只走主观题路径（2494-2504），客观题即使没有官方答案也只轮询（2513-2514）。README.md:317「只给主观题用」才对。

---

## 6. 测试可信度：216 项全绿有一个具体的洞

`test/harness.js` 的 `matches()`(95-128) 不支持**逗号分组选择器**（`split(/\s+/)` 后只取最后一段匹配）。实测结果：

| 选择器 | 桩内实际行为 |
| --- | --- |
| `.ant-radio-wrapper, .ant-checkbox-wrapper` | 任何元素都**不匹配** |
| `button.ant-btn, button` | 退化为匹配**任意 `button`** |
| `.zty-exercise-item-fill-blank-do, .ant-radio-wrapper, .option-content, .drag-drop-container` | 只匹配 `.drag-drop-container` |

后果：

1. `getOptions()`(504-510) 的**线上首选分支永不执行**。而代码注释自己写明 501-503：「线上选择题里 `.option-line` 命中数为 0，真正的选项容器是 antd 的 `.ant-radio-wrapper`」，`.option-content` 是**拖拽题**的投放项。**离线测试验证的是线上不成立的那条路径。**
2. `findSubmitButton/findRetryButton`(1533/1541) 的 `$('button.ant-btn, button', …)` 语义在测试中被放宽。
3. `ensureEditableState()`(1649) 判定"是否已是作答态"时只看到 `.drag-drop-container`，与线上判若两物。

建议：`matches` 按 `,` 切分后 `some` 匹配；随后给这三个选择器补针对性用例。在此之前，"本地全绿"在这几处确实不能证明线上行为。

---

## 7. 其余次要项

- `build-dual.js` 注释(14/84-85)断言"共 20 处同名函数…不会互相覆盖"。实测：**同名函数 20 个**（`click/clickSeq/detectType/loadAiConfig/saveAiConfig/aiEnabled/aiAsk/startStudyFarm/stopStudyFarm/fetchScore/formatScore/loadReportConfig/saveReportConfig/checkScriptValidity/reportIssue/doOneRound/loop/stopRun/status/mkUI`）+ **同名变量 17 个**（`SCRIPT_VERSION/$/$1/sleep/rnd/AI_STORAGE_KEY/aiConfig/studyTimer/studyCount/REPORT_KEY/reportConfig/running/timer/roundCount/invalidRounds/statusEl/MAX_ROUNDS`）。两引擎各自包在独立 function 内，隔离本身成立；但构建脚本只校验 IIFE 边界(37)与 `SCRIPT_VERSION` 存在性(49)，**没有机械的同名符号校验**，`dual-engine.test.js` 的"互不干扰"是日志行为反推(146-165)，不是符号表校验。
- DEVELOPMENT.md:1120 写 `test/auto-run.test.js`「13 项」，实测 24 项（README/REVIEW 已是 24）。
- `fillByAnswerMap()`(1196-1198) 用 `items[i]` / `list[i]` 索引对齐，`data-question-id` 只是兜底且 harness 的题卡上并不存在该属性；一旦站点题卡不带它，就完全依赖渲染顺序 —— 与 REVIEW.md 里"子题导致索引错位"属同一类脆弱点。
- `status()`(2660) 一人两职（写 DOM + `console.log`），且 `statusEl` 未就绪时静默丢弃。

---

## 8. 未覆盖范围（需真实登录态）

- 服务端是否接受对"含未作答语音题"的内容项调用 `apiMarkContentDone`（5.3）
- 填空线格式 `[{idx, answer}]` 与逐空 `answerStatus` 的真实回执
- 试错轮询的限流边界（`errorNumShow` 实测为 3）
- 自动刷课的跨页跳转与恢复
- 语音题 `HTTP 500`

`DEVELOPMENT.md` §11 与 `EVIDENCE.md` 保留了这些实测原始数据，可据此判断改动是否破坏既有契约。

---

## 9. 修复优先级

1. **5.1 `usable()` 判据**（高）：改动量一行级，直接决定能否刷满；同时补"客观 + 主观混合节"回归用例。
2. **5.2 / 5.3 文档-实现对齐**（中）：先定"谁是对的"，再改另一边；5.3 需真机确认服务端行为。
3. **第 6 节 harness 选择器桩**（中）：修 `matches` 后重跑 216 项，观察是否有测试因此变红 —— 这是拿回测试可信度的最快路径。
4. **第 2/3/4 节结构整治**（中低）：分节改名 + 职责分层 + `doOneRound` 决策/执行拆分。
5. **第 7 节清理项**（低）。

> 落地任何改动后：`node test/build-dual.js` 重组产物 → 跑五套测试（应保持 216）→ 复跑附录 A 探针。

---

## 附录 A：复现步骤

```powershell
cd E:\AI\自由组\tsh-auto-brush-review
node test/smoke.test.js; node test/dual-engine.test.js; node test/issue2-fixes.test.js
node test/score-format.test.js; node test/auto-run.test.js     # 合计应 216 通过

# 产物同步校验（应打印 identical=True 且 git status 干净）
node test/build-dual.js

# 5.1 的复现探针（临时脚本，不写入仓库）
node D:\Temp\tsh-probe\retry-mixed.js
```

探针脚本全文：

```js
/**
 * 临时探针：验证 retryUntilAnswer() 在「同节既有客观题、又有服务端永不下发答案的题」时的行为。
 * 期望（按 2521-2531 的宣称）：拿到官方答案 → 回填 → 闭环提交 → 返回 true。
 * 实测假设成立：missing 永不空 → 跑满 maxCalls → 官方答案从不回填 → 返回 false。
 */
const { makeEl, buildPage, makeEnv, loadScript } = require('E:/AI/自由组/tsh-auto-brush-review/test/harness.js');

const COURSE_ID = '2095675591799939073';
const READER_URL = 'https://www.tsinghuaelt.com/course_center/reader/student_course/'
  + COURSE_ID + '?catalogId=13049&contentId=23878';

function mkFetch(state) {
  return async function (url) {
    const u = String(url);
    if (u.includes('/question/echo/content/')) {
      state.getCount++;
      const delivered = state.getCount >= 2;   // 第 2 次取题起下发标准答案
      const q2type = state.mixed ? 'essay_questions_answers' : 'choice_single';
      const qs = [
        { id: 9001, type: 'choice_single', obSub: 'ob', children: [] },
        { id: 9002, type: q2type, obSub: state.mixed ? 'sub' : 'ob', children: [] }
      ];
      const items = [
        { questionId: 9001, answer: delivered ? '1' : '', userAnswer: '', answerStatus: delivered ? 2 : null },
        // 混合场景里 q2 是主观题：answerStatus 恒为 -1，answer 永不下发
        { questionId: 9002, answer: '', userAnswer: '', answerStatus: state.mixed ? -1 : (delivered ? 2 : null) }
      ];
      if (!state.mixed && delivered) items[1].answer = '0';
      return {
        ok: true, status: 200,
        json: async () => ({ code: 200, message: 'ok', data: { answerCount: 2, questionVOList: qs, questionAnswerItemVOList: items } })
      };
    }
    return { ok: true, status: 200, json: async () => ({ code: 200, message: 'ok', data: {} }) };
  };
}

async function run(mixed) {
  const page = buildPage();
  // 给题卡 2 追加可写元素：
  //   textarea → 模拟站点主观题输入框（否则占位写入失败会提前 return）
  //   .option-content → 让题卡 2 在对照场景下也能作为选择题写入占位
  //   （注意：harness 的选择器桩不支持逗号选择器，getOptions() 的
  //    '.ant-radio-wrapper, .ant-checkbox-wrapper' 必然落空，只能走 .option-content 分支）
  page.item2.appendChild(makeEl('textarea', ''));
  for (let i = 0; i < 2; i++) {
    const label = makeEl('label', 'option-content');
    const input = makeEl('input', '');
    input.attrs.type = 'radio';
    input.value = String(i);
    input.attrs.value = String(i);
    label.appendChild(input);
    page.item2.appendChild(label);
  }

  const state = { getCount: 0, mixed };
  const win = makeEnv(page, READER_URL, mkFetch(state));
  const logs = [];
  win.console = {
    log: (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
    warn() {}, error() {}
  };
  // fillInput() 里 `el instanceof HTMLTextAreaElement` 需要这两个构造器存在
  win.HTMLInputElement = class HTMLInputElement {};
  win.HTMLTextAreaElement = class HTMLTextAreaElement {};

  const T = await loadScript(win);
  const data = await T.loadCurrentExercise();
  const route = T.parseReaderRoute();
  const questions = data.questionVOList;

  const t0 = Date.now();
  const got = await T.retryUntilAnswer(route, questions, 3);
  const ms = Date.now() - t0;

  return {
    mixed,
    取题次数: state.getCount,
    提交点击次数: page.submitBtn.events.filter(e => e.type === 'click').length,
    retryUntilAnswer返回: got,
    耗时毫秒: ms,
    关键日志: logs.filter(l => /回填|填充失败|试错/.test(l)).slice(0, 10)
  };
}

(async () => {
  console.log('【混合场景：客观题 + 服务端不下发答案的主观题】');
  console.log(JSON.stringify(await run(true), null, 2));
  console.log('\n【对照：两道客观题】');
  console.log(JSON.stringify(await run(false), null, 2));
})();
```

---

## 附录 B：证据索引

| 结论 | 证据位置 |
| --- | --- |
| §11 横幅被 12bis 覆盖 | `git diff v2.1.1...HEAD -U0 -- engines/new-engine.user.js` |
| v2.1.1 章节完整（11/12/13/14） | `git show v2.1.1:engines/new-engine.user.js` → 1162/1337/1407/1545，共 1798 行 |
| `doOneRound` 101 → 231 行 | v2.1.1: 1418-1518；v2.3.0: 2400-2630 |
| 试错门禁空转 | new-engine 2543-2548（分支体只有 `status()`） |
| 语音题标记完成 | new-engine 2463 + 277-278 |
| `missing` 永不空的判据 | new-engine 1680-1701、605/627 |
| 注释与实现矛盾 | new-engine 439 vs 443；2749 vs 2494-2504 |
| 文档承诺"闭环覆盖" | README.md 143 / 221 / 375 |
| 文档承诺"不标记完成" | DEVELOPMENT.md 313；README.md 404 / 408 |
| 文档承诺"自由模式不试错" | DEVELOPMENT.md 853 / 876 |
| 选择器桩缺陷 | test/harness.js 95-128；new-engine 504-510 / 1533 / 1541 / 1649 |
| 同名符号统计 | `engines/new-engine.user.js` vs `engines/legacy-engine.user.js`（20 函数 + 17 变量） |
| 测试项数笔误 | DEVELOPMENT.md 1120（写 13，实为 24） |
