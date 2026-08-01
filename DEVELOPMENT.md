# TSH自动刷课 — 开发文档

> 脚本：`tsh-auto-brush.user.js`（v1.1.2，Tampermonkey 油猴脚本）
> 作者：WASD258-jpg · 协议：GPL-3.0
> 目标站点：`https://www.tsinghuaelt.com`（清华社英语在线，教材学习）

---

## 1. 项目简介

对清华社英语在线视听说教材学习的自动刷课脚本：全自动答题 + 右箭头翻页（跨任务/跨单元）+
AI 优先出答案 + 查成绩 + 刷学习时长 + 站点改版失效自动上报。

开发方式：**Vibe Coding + 人工**——AI 辅助生成与逆向分析，人工大量实测、调试与修复。

## 2. 网站技术栈

| 组件 | 技术 |
| --- | --- |
| 前端 | Angular 7.2.16（AOT），ng-zorro（antd） |
| 构建 | main.54207afdf758669deefc.js（约 10MB，webpack 混淆） |
| 视频 | 阿里云 Aliplayer（`#J_prismPlayer`） |
| 录音评测 | 驰声 chivox |
| API 根 | `https://www.tsinghuaelt.com/tsenglish/` |

主要接口：

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/course/studyTimeCountNew` | GET | 学习时长上报（页面每 10 秒自动） |
| `/course/basicDetail?id=` | GET | 课程信息（含成绩配置 examSet） |
| `/textbook/content_detail?pageId=` | GET | 练习页内容 |
| `/exercise/record_for_detail` | POST | 答题记录（含 submitNum 作答次数） |
| `/textbook/submit?pageId=` | PUT | 教材学习提交（body 含 `duration:1` 硬编码） |
| `/course/stuGeneralScore?id=&userId=` | POST | 学生综合成绩 |

## 3. 路由与识别

| 路由 | 含义 | 识别 |
| --- | --- | --- |
| `/studentcourse` | 课程列表 | isCourseHome |
| `/course-student/{courseId}/study` | 课程主页 | isCourseHome |
| `/course-study-student/{bookId}/{courseId}/{userId}/{hash}` | 练习页 | isExercisePage |

## 4. 核心 DOM（实测）

- 课程主页树：`.courseList > div > .uniteTitle`（展开 Unit）+ `.goalItemOr.testTitle`（任务）
- 练习页：`app-course-task-stu`、按钮 `button.wy-btn`（Submit/Retry）、右上翻页 `.page-next`（左右箭头）、分页计数 `.font-y`
- 题型组件：`lib-single-choice-*` / `lib-multiple-choice-*` / `lib-judge-*` / `lib-drop-down-*` / `lib-fill-blank-*` / `lib-listen-and-repeat-*` / `lib-oral-*` / `lib-role-play-*` / `lib-drag-*` / `lib-video-*`

## 5. 答题交互机制（实测结论）

| 交互 | 方式 |
| --- | --- |
| 单选/多选选中 | 对 `p.lib-single-item-one` 派发 `MouseEvent('click')`（实测唯一有效目标） |
| 按钮 Submit/Retry | `button.wy-btn` JS click 有效 |
| 课程卡片 | 须点 `.course-title` 子级 + 完整鼠标序列（父级 `.course-list-item` 无效） |
| 下拉 | `nz-select`（`.ant-select-selection` 展开 + 当前可见下拉内选 `.ant-select-item-option`） |
| 填空 | **`span[contenteditable]`**（非 input！设 textContent + input 事件） |
| 录音 | `img[title="录音"]` → 变"停止" → 再点停止（两步） |
| 翻页（全自动核心） | `.page-next` 右箭头 **JS click 有效**，自动跨任务/跨单元（42/42 → 1/41 实测跨 Unit） |

## 6. 脚本架构（IIFE 单文件，@grant none）

- 工具：$ / $1 / click / clickSeq / realClick 体系 / fill / sleep / rnd
- AI：aiConfig(localStorage) / aiAsk(OpenAI 兼容 15s 超时) / aiGuess*（单选/多选/判断/下拉/填空）
- 题型：solveChoice / solveJudge / solveDropdown / solveFill / solveListenRepeat / solveOral / solveRoleplay / solveDrag / solveVideo / solveListenFill
- 提交：submitSmart（播放音频→提交→确认按钮变 Retry→失败冷却）
- 成绩/时长：makeSigned（签名）/ fetchScore / startStudyFarm（hook XHR 捕获上报地址后 10s 定时重放）
- 失效上报：checkScriptValidity（探针）/ reportIssue（GitHub API，consent 门禁+版本化+24h 去重+打码）
- 主循环：doOneRound / loop / stopRun / enterCooldown / detectBusy
- GUI：双面板（主面板+设置面板）+ 知情同意书 + 使用引导（莱茵生命风：冷白+墨蓝灰+六边形）

## 7. 反作弊机制（实测破解）

### 7.1 请求签名

```
serverTime（localStorage currUser）+ clientTime(随机UUID) + 参数名排序拼接 + userId
sign = md5(serverTime + clientTime + 参数名排序 + userId)，放 header
URL 加 clientTime/diResU/diLoohcs/version(3.0.149)/request_id
```

- 签名可重放（后端只验 md5 格式）；无签名返回"出现签名错误"

### 7.2 提交专属 sea-fetch-path

```
C = AES-128-CBC 解密 hahaxixi（key=1234567890ABCDEF, iv=ABCDEF1234567890）→ "III-3.0.149PC"
sea-fetch-path = md5("pc-用户ID-pageId-serverTime-C").slice(-6)
```

### 7.3 频率限制（"系统繁忙"真相）

| 间隔 | 结果 |
| --- | --- |
| <1s | HTTP 530 拦截 |
| 1s | 边缘偶发 |
| ≥1.5s | 全通过 |

- **POST/写接口约 1 次/秒**；GET 读接口不限流（80 并发实测全过）
- **冷却实测约 60 秒恢复**（脚本取 90 秒余量自动冷却自愈）

### 7.4 作答上限

- `record_for_detail` 返回 submitNum；上限实测 3 次，达上限后提交被静默拒绝（连请求都不发）

### 7.5 作业模块强反作弊（脚本不触碰）

全屏监控 / 切屏自动提交 / 窗口最小化提交 / 人脸抓拍 / 截屏 / 行为监控 / 限时——仅作业考试模块。

## 8. 成绩机制（实测验证）

```
综合成绩 = Σ(各维度得分)
学习时长分 = min(实际时长/满分目标,1) × studyTimeRate
完成率分   = min(实际完成率/满分目标,1) × completeRate
学习得分   = min(学习得分/100,1) × studyScoreRate
作业/测试/期末 = 各自占比
```

- 配置在 `examSet`（basicDetail 返回，老师设置）
- 验证用例：完成率 100%/75%×40% + 时长 648h/3h×20% + 学习 39.63/40 = 99.63 与接口一致
- 接口：`POST /course/stuGeneralScore`

## 9. 右箭头全自动（v0.9.0 突破）

```
练习页 → 有 Submit？答题（AI/试错+读Key修正全对）→ 无 → 点右箭头翻页
→ 自动跨任务/跨单元 → 最后一页箭头消失/URL不变×3轮 → 停止"全部完成"
```

- 翻页间隔 4~6s、循环 8~12s（规避 POST 限流）
- 限流自动冷却 90s 继续；500 轮保护

## 10. 失效自动上报（开源协作）

- 探针：`button.wy-btn/.lib-single-item/.page-next/app-course-task-stu/.courseList/.uniteTitle` 连续 10 轮全缺（约 2-3 分钟）判定失效
- 上报：GitHub API 创建 issue（版本/打码页面/时间），**需知情同意书授权**（consent + consentVersion='1.0' 双门禁），24h 去重
- 打码：页面路径课程/用户 ID 替换占位符，剥离 query/hash

## 11. GUI（莱茵生命风）

- 配色：冷白 #F4F6F8 + 墨蓝灰 #33475C + 钢蓝 #3D6B99，无渐变
- 元素：六边形 LOGO（CSS clip-path）、分组标签（Operation/Data/Config）、双面板（主面板 + 设置面板独立）
- 流程：首次启用 → 知情同意书（默认不上报）→ 使用引导（6 步）→ 正常使用
- 字号 13px 基准，正文可复制，面板可拖动/关闭（悬浮重开按钮）

## 12. 版本历史

| 版本 | 说明 |
| --- | --- |
| 1.1.2 | 全新身份（TSH自动刷课/namespace/存储键/文件名全换）；知情同意书版本化、失效检测防误报、GUI 重写 |
| 1.0.0 | 清理死代码、加载容错、翻页 URL 校验、弹窗白名单 |
| 0.9.x | 右箭头全自动；降频；限流自动冷却恢复 |
| 0.7.x | 查成绩 + 刷时长 + AI 接入 |
| 0.6.x | 基于 2026 实测 DOM 重写 |

## 13. 已知限制

- 跨单元展开（目录树）受 isTrusted 限制无法自动化——右箭头翻页已绕开此限制实现全自动
- 拖拽/口语/角色扮演/视频未在当前课程实测（基于结构实现）
- 站点改版可能导致失效（失效上报自动通知）

## 14. 测试方法论

- 独立 Playwright 注入脚本（@grant none 与油猴环境等价）
- XHR/fetch hook 捕获真实签名请求 → 重放验证
- 签名构造：页面内 CryptoJS + localStorage currUser（serverTime）
- 冷却实测：触发 530 → 60s 探测恢复
