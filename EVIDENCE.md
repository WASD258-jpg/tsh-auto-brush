# 实测证据汇总（v2.3.0）

> 本文件汇总 v2.3.0 各项结论所依据的**原始数据**，便于逐条核对。
> 所有数据来自 2026-10-08 的登录态实测（志愿者提供的学生账号）。
> 已脱敏：不含姓名、学号、学校、手机号、令牌值与 API Key。

---

## 1. 实测环境

| 项 | 值 |
| --- | --- |
| 账号属性 | `userType=6`（学生）、`jumpPlat=0` |
| 落入站点 | **新站** `/course_center/` |
| 阅读器 | `/course_center/reader/student_course/{bizId}` |
| 数据规模 | 369 个目录叶节点、989 个内容项 |
| 构建版本 | `20260930165203` |
| 手段 | Chrome CDP 驱动真实登录态页面；在文档加载前注入 fetch/XHR 拦截取证 |

> **顺带纠正**：此前文档把 `jumpPlat = 0` 当作「被分流旧站」的判据。
> 实测该值为 0 的账号**照样进入新站** —— 两者无因果关系。

---

## 2. 成绩与判分口径

`GET /course/{id}/detail` 直接给出判分字段：

```json
{ "learnMode": 1, "freeShowAnswer": 1, "passShowAnswer": 1,
  "errorNumShow": 3, "caculateToGrade": 1, "learnTimeLimit": 0 }
```

教师端配置界面对两种模式的原文说明：

> **自由模式**：「学生答对即时显示答案与解析，答错 N 次后显示答案与解析，**学习成绩记录末次答题结果**。」
> **闯关模式**：「学生任务过关后显示答案与解析，**学习成绩记录最高答题结果**。」

**本课为自由模式**（`learnMode=1`）。

成绩与时长是**两条独立通道**，`GET /course/{id}/study/situation/overview`：

```json
{ "score": "0", "progress": 1, "duration": 2730,
  "courseScoreCourseRank": 9, "courseProgressCourseRank": 9,
  "courseStudyUseTimeCourseRank": 8 }
```

`duration` 只参与「学习时长」排名，**不进入 `score`**；`learnTimeLimit` 是限制开关而非计分项。

---

## 3. 答案下发机制（核心结论）

### 3.1 `questionVOList[].answer` 恒为空

抽样 40 个内容项，该字段 **40/40 为空字符串**。这一点第一版结论没错，
但它是**题面**字段，不承担下发答案的职责 —— 第一版据此判定「站点不下发答案」是**错的**。

### 3.2 真正的答案在 `questionAnswerItemVOList[].answer`

只在两种情况下被填充：

| 情形 | `item.answer` | `answerStatus` | `rightRate` |
| --- | --- | --- | --- |
| 答错，累计 < `errorNumShow` | `""` | 3 | 0 |
| **答错，累计 ≥ `errorNumShow`** | **服务端下发的标准答案** | 3 | 0 |
| 答对 | 回显自己提交的答案 | 1 | 100 |

**选择题对照实验**（同一课程内两处独立观察）：

```
# A. contentId=23969（未作答 → 逐次提交）
起始       answerCount=0  item.answer=(无)
第1次(A,错) answerCount=1  item.answer=""                 status=3  rightRate=0
第2次(B,对) answerCount=2  item.answer="12b6610b-…"       status=1  rightRate=100

# B. contentId=23946（连续提交错误答案）
提交4次后   answerCount=4  item.answer="240f8800-…"       status=3  rightRate=0
                          ↑ 答错却是非空，只能是服务端下发的标准答案
```

### 3.3 填空题同样会下发，且带多个可接受写法

第 3 次提交（`answerCount=3`）后服务端下发：

```json
[{"group":"group_1","idx":"1e313e81-…","standardAnswer":"wild",     "val":"wild"},
 {"group":"group_2","idx":"e726f7d7-…","standardAnswer":"habitat(s)","val":"habitats; habitat"},
 {"group":"group_3","idx":"1fca14c0-…","standardAnswer":"climate",   "val":"climate"},
 {"group":"group_4","idx":"44b704b4-…","standardAnswer":"protect",   "val":"protect"},
 {"group":"group_5","idx":"a1815233-…","standardAnswer":"species",   "val":"species"}]
```

**字段是 `standardAnswer`**，`val` 以分号给出多个可接受写法。

### 3.4 主观题不下发答案

`obSub: 'sub'` 的题目 `answerStatus` 恒为 `-1`，答案字段是
`"Answers will vary."` 或整句参考 —— 轮询对它零收益。

---

## 4. 客观题 vs 主观题：实测对比

同一道 **12 空的客观填空题**：

| 路径 | 结果 | token |
| --- | --- | --- |
| AI 首答 | 部分正确甚至全错（另一道 5 空题 AI 五空全错） | 有 |
| **轮询取答案** | **`rightRate: 100`，12 空全对** | **0** |

另一道题（`contentId=23966`）从 `rightRate: 0` 经闭环覆盖后变为 **`rightRate: 100`**：

```json
{ "answerCount": 6, "rightRate": 100, "item_status": 1,
  "perBlank": [{"predator",1},{"surrogate",1},{"maternal instinct",1},{"hyena",1},{"emerging",1}] }
```

---

## 5. DOM 与索引契约（实测对照）

| 选择器 | 文档原说法 | 实测 |
| --- | --- | --- |
| `.textbook-preview-content` / `.chapter-section` / `.content-item` / `.unit-exercise-preview` / `.exercise-list` / `.exercise-item` / `.exercise-view` / `.instruction` / `.annex-list` | 命中 | ✅ 全部命中 |
| `.pagination-btn` | 命中 | ✅ 2 个 |
| `.pagination-text` | 命中 | ✅ 文本形如 `"25/377"` |
| **`.pagination-btn-wrap`** | 计数 span 的兄弟容器 | ❌ **0 命中，不存在**；计数与按钮同挂在 `.preview-pagination` |
| **`.option-line`** | 选择题选项容器 | ❌ 0 命中；实际是 `.ant-radio-wrapper` |
| `.option-content` | — | ✅ 属**拖拽题**投放项，非选择题选项 |
| **`.chapter-title`** / **`.catalog-main`** / **`.answer-count`** | 关键类 | ❌ 0 命中 |
| `.unit-exercise-answer-account` / `.exercise-actions` / `.preview-navbar` | — | ✅ 命中 |
| `.drag-drop-container` / `.drop-zone-item-wrapper` / `.drag-item` | 命中 | ✅ 1 / 8 / 8 |

**索引形态**：`extension[].idx` 是 **UUID**（如 `"bf9491b2-d657-e04f-31c1-c7281a231d47"`），
**不是** `"0"`/`"1"`。实测 DOM 上 `input[type=radio].value` 与之**逐字一致**。

**接口参数**：`content_type` 对 `student_course` 必须为 **2**（用 1 报 `80020 内容项不存在！`）；
目录接口前端实际发 `user_id=0&type=0`。

**提交按钮状态机**：未作答为 `Submit`，提交后变 `Retry`。

**填空题状态差异**：查看态是 `zty-exercise-item-fill-blank-**done**`，
作答态才是 `zty-exercise-item-fill-blank-**do**` —— 查看态没有可写元素，
必须先点 `Retry` 才能回填。

---

## 6. AI 侧实测（DeepSeek Anthropic 兼容层）

**请求格式**：服务端明确要求 Messages 格式 ——
`Model "…" must be called via /provider/v1/messages (Anthropic Messages shape).`；
模型名亦有坑（`deepseek_flash` → 拒绝，应为 `deepseek-flash`）。

**输出额度与思维链**：

```
flash max=4096   → stop=max_tokens  thinking=17271字  text=""                       ✗
flash max=8192   → stop=end_turn    thinking=5762字   text="warmer\nmelting\n…"      ✓
flash 禁思维链   → stop=end_turn    text="Climate change\nArctic sea ice\n…"        ← 快但质量差
flash max=32000  → stop=end_turn    text="warmer\nmelting\n…"                       ✓ 15s
v4-pro max=64000 → stop=end_turn    text="getting warmer\n…"                        108s
```

结论：**思维链会吃掉输出额度**，给小了正文一个字都不出；**但不要禁用思维链**
（禁用后 0.9s 极快，却把整句当答案，质量明显下降）。默认额度取 16384，超时 90s。

**听力题**：题干在音频里，`stem` 为空。原文在 `attachmentList[].script`，
不喂给模型它会直接回「missing actual question」。

---

## 7. 复现方式

本目录 `git log` 可见 v2.1.1 → v2.3.0 的完整改动。要点：

```powershell
# 起一个带调试端口的 Chrome（独立 profile，不影响日常浏览器）
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 --user-data-dir=<独立profile> https://www.tsinghuaelt.com/

# 语法与离线测试
node --check engines/new-engine.user.js
node test/build-dual.js          # 重组 tsh-auto-brush.user.js（产物，勿手改）

# 注入真实页面跑「结构自检」
# 面板会打印路由解析、判分策略、DOM 探针命中、题卡题型与取题接口字段
```

> 实测脚本（CDP 驱动、取证、阈值实验等）位于工作区的 `tsh-reverse/test/`，
> **不在本仓库内** —— 需要的话可以另行归档。
