# 代码审查交接说明

> 给接手审查的人/会话。本文说明**当前状态**、**已知问题**、**如何验证**，以及**建议的审查重点**。
> 写于 v2.3.0 完成时。

---

## 1. 这是什么

清华社英语在线（`www.tsinghuaelt.com`）的 Tampermonkey 用户脚本，双引擎架构：

| 文件 | 作用 |
| --- | --- |
| `engines/new-engine.user.js` | **新版引擎**（`/course_center/`），2955 行，本次改动的主体 |
| `engines/legacy-engine.user.js` | 旧站引擎（`/legacy/`），1467 行，**本次未动** |
| `tsh-auto-brush.user.js` | **构建产物**，由 `test/build-dual.js` 把两个引擎拼进一个 userscript。**不要手工编辑** |
| `DEVELOPMENT.md` | 开发文档，含大量实测记录（§11.x 是本次新增） |
| `EVIDENCE.md` | 本轮各项结论的**原始数据**汇总，便于逐条核对 |

---

## 2. 当前状态

- 版本 `2.3.0`，产物 232730 字节，**离线测试 216 项全过**
- 所有改动**已提交**在本仓库（基线是上一版的 `v2.1.1`）
- **未推送远端**

---

## 3. 建议的审查重点

### 3.1 结构问题（写作者自评，供参考不代表全部）

**a. 分节编号已乱序。** `engines/new-engine.user.js` 里：

```
L1920: // 12bis. 自动连续刷课（跨节推进）
L2319: // 12. 脚本有效性检测 + GitHub Issue 上报     ← 12bis 却排在 12 前面
```

`4bis`（L370）同理，被插在 `4` 与 `5` 之间。**这是"按需追加"留下的痕迹**，
分节编号已经不能反映阅读顺序，建议整体重排或改用不依赖序号的命名。

**b. 几个区块体量偏大，职责不单一。**

| 区块 | 行数 |
| --- | --- |
| `8. 答题主流程` | 637 行 |
| `12bis. 自动连续刷课` | 399 行 |
| `6. AI 答题` | 352 行 |
| `14. GUI` | 290 行 |
| `13. 主循环` | 277 行 |

单文件 2955 行、103 个函数，全部塞在一个 IIFE 里。**GUI 与业务逻辑混在同一个文件**，
而 GUI 只在 `mkUI()` 之后才存在，业务函数却要 `$1('#b6-xxx')` 去读它的状态
（例：`resolveCourseId()` 读 `#b6-course` 的值）——这是**双向耦合**，比较可疑。

**c. `doOneRound()` 的分支已经堆到 4 条路径**（答案已下发 / AI 补答 / 试错轮询 / 已作答重做），
且每条路径都会重新 `filter(hasUserAnswer)`。存在重复的判定与状态同步。
建议看看能否把"决定这节该怎么处理"抽成一个纯函数（输入题目+策略，输出动作），
`doOneRound` 只负责执行。

**d. 状态散落。** 运行状态分散在模块级变量（`running` / `roundCount` / `noProgressRounds`
/ `invalidRounds` / `lastAnswerMap` / `currentResp` / `policy` / `aiConfig` / `studyTimer`）
**加上** localStorage（`tsh_auto_run` / `tsh_auto_brush_ai` / `tsh_auto_brush_report`）里。
跨页推进又引入了 `tsh_auto_run.done` 数组。**没有统一的状态对象**，容易漏同步。

### 3.2 值得重点盯的正确性风险

- **`markAnswered(q, value, card)` 会改写 `q.doRecord`**，而 `q` 是 `currentResp.questionVOList`
  的元素。填空类的线格式必须构造成 `[{idx, answer}]`（`idx` 取 span 的 `id`），
  写成裸值数组会被服务端整题判错（实测 `rightRate: 0`）。**这里很容易改坏。**
- **试错轮询与"重做已答错题"都会二次提交**。自由模式记「末次」，理论上每轮都"保持当前
  最优答案、只补空白"，但这依赖 `fillPlaceholder` 只填空白的实现细节。**若将来改动
  这里，必须重新评估"单调改善"这个前提是否还成立。**
- **`ensureEditableState()`**：查看态下没有可写作答元素（填空是 `-done` 而非 `-do`），
  必须先点 `Retry`。**漏掉这步会表现为"填了但拿不到分"**，很隐蔽。
- **`autoAdvance()` 靠 `location.href` 整页跳转推进**，状态存 localStorage。
  若状态写失败或被别处清掉，会静默停下（表现为"跑到一半不动了"）。

---

## 4. 如何验证

### 4.1 跑测试（不需要浏览器、不需要账号）

```bash
cd tsh-auto-brush-review        # 或你的仓库根目录
node test/smoke.test.js         # 121 项
node test/dual-engine.test.js   #  35 项
node test/issue2-fixes.test.js  #  20 项
node test/score-format.test.js  #  16 项   查成绩输出格式
node test/auto-run.test.js      #  24 项   自动连续刷课 / 题型分流
```

全部通过 = 216 项。测试用 `test/harness.js` 造 mock DOM + mock fetch，
**在 Node 里真实执行整个脚本**，通过 `globalThis.__TEST__` 钩子调用内部函数。

### 4.2 改完引擎后必须重组产物

```bash
node test/build-dual.js         # 重新生成 tsh-auto-brush.user.js
```

**产物是生成的，不要手改**；测试跑的也是产物（`harness.js` 读的是
`tsh-auto-brush.user.js`，不是引擎源码）。**忘了重组会测到旧代码。**

### 4.3 加内部函数到测试钩子

`test/harness.js` 顶部有个 `EXPORT_HOOK`，列出了一批内部函数名。
要测新函数，先把它加进那个列表，否则测试里取不到。

---

## 5. 需要真实登录态才能验的部分

离线测试覆盖不到这些，**改动它们时要格外小心**（本地测试全绿也不能说明问题）：

- 题目答案的**下发时机**（服务端在答错累计到 `errorNumShow` 次后下发，实测为 3）
- 填空的**线格式**（`[{idx, answer}]`）与逐空 `answerStatus`
- 语音题的 `HTTP 500`（需真实音频）
- 自动刷课的**跨页跳转**与恢复
- 试错轮询的**限流行为**

`DEVELOPMENT.md` §11 与 `EVIDENCE.md` 里保留了这些实测的原始数据与请求样本，
可以据此判断某处改动是否会破坏既有契约。

---

## 6. 已知无法解决的问题（不是 bug，是硬边界）

**语音题（`oral_*`）无法自动作答**，脚本跳过它。但这**不等于完成**——
该内容项不会被标记完成，含语音题的单元**永远达不到 100%**，进而压低课程总分
（总分 = 各单元平均）。

这是评测机制（驰声 chivox 实时语音评测，需真实音频）决定的，**没有绕过路径**：
空提交服务端直接返 `HTTP 500`，伪造音频会被判「未识别到有效发音」。
详见 `README.md` 的「已知限制」与 `DEVELOPMENT.md` §6.4。

**请勿试图"修掉"它。** 可以优化的只有提示与处理方式，不能伪造作答。
