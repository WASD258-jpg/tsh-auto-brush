/**
 * 冒烟测试：执行真实脚本源码，断言核心逻辑。
 * 运行：node test/smoke.test.js
 */
const { buildPage, makeEnv, loadScript, makeEl } = require('./harness');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + ' (= ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b), a); }

const READER_URL = 'https://www.tsinghuaelt.com/course_center/reader/Textbook/2001?catalogId=1001&contentId=5001';

// 模拟站点取题响应（对照逆向得到的字段名）
const EXERCISE_RESP = {
  code: 200, message: 'ok',
  data: {
    answerCount: 0,
    questionVOList: [
      { id: 9001, type: 'choice_single', obSub: 'ob', doRecord: '', answer: '', children: [] },
      { id: 9002, type: 'fill_base', obSub: 'ob', doRecord: '', answer: '', children: [] }
    ],
    questionAnswerItemVOList: [
      { questionId: 9001, answer: 'A', userAnswer: '', overWriteUserAnswer: '', answerStatus: 0 },
      { questionId: 9002, answer: '["hello"]', userAnswer: '', overWriteUserAnswer: '', answerStatus: 0 }
    ]
  }
};

function makeFetch(recorder) {
  return async function (url, init) {
    recorder.push({ url, method: (init && init.method) || 'GET', body: init && init.body, headers: (init && init.headers) || {} });
    const u = String(url);
    if (u.includes('/question/echo/content/')) {
      return { ok: true, status: 200, json: async () => EXERCISE_RESP };
    }
    if (u.includes('/question/submit/answer')) {
      return {
        ok: true, status: 200, json: async () => ({
          code: 200, message: 'ok',
          data: [{ questionId: 9001, answer: 'A', userAnswer: 'A', answerStatus: 1 },
                 { questionId: 9002, answer: '["hello"]', userAnswer: '["hello"]', answerStatus: 1 }]
        })
      };
    }
    if (u.includes('/user/study/time/record') || u.includes('/user/study/course/content/record') || u.includes('/user/study/read/record')) {
      return { ok: true, status: 200, json: async () => ({ code: 200, message: 'ok', data: null }) };
    }
    return { ok: true, status: 200, json: async () => ({ code: 200, message: 'ok', data: {} }) };
  };
}

(async function main() {
  console.log('\n=== TSH 自动刷课 v2.0.0 冒烟测试 ===\n');

  const page = buildPage();
  const calls = [];
  const win = makeEnv(page, READER_URL, makeFetch(calls));
  const T = await loadScript(win);

  console.log('[1] 路由解析');
  const route = T.parseReaderRoute();
  eq('type', route.type, 'Textbook');
  eq('contentType', route.contentType, 1);
  eq('bizId', route.bizId, '2001');
  eq('catalogId', route.catalogId, 1001);
  eq('contentId', route.contentId, 5001);

  console.log('\n[2] 路由类型 → contentType 映射');
  const env2 = makeEnv(buildPage(), 'https://www.tsinghuaelt.com/course_center/reader/StudentCourse/3001?catalogId=7&contentId=8', makeFetch([]));
  const T2 = await loadScript(env2);
  eq('StudentCourse → contentType 2', T2.parseReaderRoute().contentType, 2);
  eq('StudentCourse → bizId', T2.parseReaderRoute().bizId, '3001');

  console.log('\n[3] 答案解码');
  eq('单选裸标量', T.decodeAnswer('A', T.TYPE.SINGLE), 'A');
  eq('判断裸标量', T.decodeAnswer('true', T.TYPE.JUDGE), 'true');
  eq('填空 JSON 字符串 → 数组', T.decodeAnswer('["hello"]', T.TYPE.FILL), ['hello']);
  eq('已解析对象原样返回', T.decodeAnswer({ a: 1 }, T.TYPE.FILL), { a: 1 });

  console.log('\n[4] 答案映射构建');
  const map = T.buildAnswerMap(EXERCISE_RESP.data);
  eq('映射条目数', map.size, 2);
  eq('9001 标准答案', map.get(9001).answer, 'A');
  eq('9002 标准答案', map.get(9002).answer, '["hello"]');

  console.log('\n[5] DOM 识别');
  ok('isReaderPage() 为真', T.isReaderPage() === true);
  // 5 个顶层题卡：单选/填空/判断/拖拽/组合题
  // 组合题内含 2 个子题（同样带 .exercise-item），必须被过滤掉，否则索引错位
  eq('顶层题卡数（组合题子题已过滤）', T.getExerciseItems().length, 5);
  eq('题卡0 推断题型=单选', T.detectType(T.getExerciseItems()[0]), T.TYPE.SINGLE);
  eq('题卡1 推断题型=填空', T.detectType(T.getExerciseItems()[1]), T.TYPE.FILL);
  eq('题卡2 推断题型=判断', T.detectType(T.getExerciseItems()[2]), T.TYPE.JUDGE);
  eq('题卡3 推断题型=拖拽', T.detectType(T.getExerciseItems()[3]), T.TYPE.DRAG_ONE);
  eq('题卡0 选项数', T.getOptions(T.getExerciseItems()[0]).length, 2);
  ok('Submit 按钮可定位', !!T.findSubmitButton());
  ok('checkScriptValidity() 为真', T.checkScriptValidity() === true);

  console.log('\n[6] 取题接口');
  const data = await T.loadCurrentExercise();
  ok('取题成功', !!data);
  eq('题目数', (data.questionVOList || []).length, 2);
  const getCall = calls.find(c => c.url.includes('/question/echo/content/'));
  ok('请求 URL 含 contentId', getCall && getCall.url.includes('/question/echo/content/5001/answer'));
  ok('请求带 content_type=1', getCall && getCall.url.includes('content_type=1'));
  ok('请求带 biz_id=2001', getCall && getCall.url.includes('biz_id=2001'));
  ok('请求头带 elt-user-token', getCall && getCall.headers['elt-user-token'] === 'FAKE_TOKEN_123');

  console.log('\n[7] 作答填充');
  const items = T.getExerciseItems();
  // 站点线格式：answer/doRecord 是 option 的 idx 值（对照 <Radio value={e.idx}>）
  eq('选项提交值取自 DOM', T.getOptionValues(items[0]), ['0', '1']);
  eq('answer="1" → 选中第 2 项', T.resolveOptionIndexes(items[0], '1'), [1]);
  eq('answer="0" → 选中第 1 项', T.resolveOptionIndexes(items[0], '0'), [0]);
  eq('字母 "B" 仍可解析 → 第 2 项', T.resolveOptionIndexes(items[0], 'B'), [1]);
  const okSingle = T.applyAnswer(items[0], T.TYPE.SINGLE, '1');
  ok('单选填充返回 true', okSingle === true);
  const okFill = T.applyAnswer(items[1], T.TYPE.FILL, ['hello']);
  ok('填空填充返回 true', okFill === true);
  eq('填空写入内容', page.blank.textContent, 'hello');
  // 判断题：站点值是 "1"/"0"，不是 true/false
  eq('判断题选项值', T.getOptionValues(items[2]), ['1', '0']);
  eq('判断 answer="1"（正确）', T.resolveOptionIndexes(items[2], '1'), [0]);
  eq('判断 answer="0"（错误）', T.resolveOptionIndexes(items[2], '0'), [1]);
  ok('判断 answer="1" 可填充', T.applyAnswer(items[2], T.TYPE.JUDGE, '1') === true);
  // 多选：answer 是 idx 数组
  eq('多选 idx 数组', T.resolveOptionIndexes(items[0], ['0', '1']), [0, 1]);

  console.log('\n[7b] 拖拽类作答（事件序列：dragstart → dragenter → dragover → drop → dragend）');
  {
    const pD = buildPage();
    const envD = makeEnv(pD, READER_URL, makeFetch([]));
    const TD = await loadScript(envD);
    eq('拖拽题卡识别', TD.detectType(pD.item4), 'matching_onetoonedrag');

    // 归一化：onetoonedrag 的 [{idx, answer:[...]}] 形状
    const pairs = TD.normalizeDragPairs('matching_onetoonedrag', [{ idx: 'z0', answer: ['d1'] }]);
    eq('归一化得 1 对', pairs.length, 1);
    eq('投放区 idx', pairs[0].zone, 'z0');
    eq('拖拽项 idx', pairs[0].item, 'd1');

    // dragfillblank 是扁平形状
    const flat = TD.normalizeDragPairs('matching_dragfillblank', [{ idx: 'b1', answer: 'd2' }]);
    eq('拖拽填空扁平归一化', flat.length, 1);
    eq('拖拽填空 item 为字符串', flat[0].item, 'd2');

    // 事件序列验证
    const seq = [];
    ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend'].forEach(n => {
      pD.item4.addEventListener = null;
    });
    // 直接观察两个元素收到的事件类型
    const src = pD.drags4[1], dst = pD.zones4[0];
    const dt = TD.makeDataTransfer();
    dt.setData('text/plain', 'd1');
    eq('dataTransfer 写入后可读', dt.getData('text/plain'), 'd1');
    TD.simulateDragDrop(src, dst, 'd1');
    const srcTypes = src.events.map(e => e.type);
    const dstTypes = dst.events.map(e => e.type);
    ok('源元素收到 dragstart', srcTypes.includes('dragstart'), srcTypes);
    ok('源元素收到 dragend', srcTypes.includes('dragend'), srcTypes);
    ok('目标收到 dragenter', dstTypes.includes('dragenter'), dstTypes);
    ok('目标收到 dragover', dstTypes.includes('dragover'), dstTypes);
    ok('目标收到 drop', dstTypes.includes('drop'), dstTypes);
    ok('dragstart 携带 dataTransfer', src.events[0].dataTransfer !== undefined);
    eq('dataTransfer 载荷正确', src.events[0].dataTransfer.getData('text/plain'), 'd1');
  }

  console.log('\n[7c] 组合题子题过滤（防索引错位）');
  {
    const pC = buildPage();
    const envC = makeEnv(pC, READER_URL, makeFetch([]));
    const TC = await loadScript(envC);
    const items = TC.getExerciseItems();
    eq('顶层题卡不含子题', items.length, 5);
    ok('父题在列表中', items.indexOf(pC.item5) >= 0);
    ok('子题0 被排除', items.indexOf(pC.children5[0]) < 0);
    ok('子题1 被排除', items.indexOf(pC.children5[1]) < 0);
    // 若不过滤，DOM 中实际有 7 个 .exercise-item（5 顶层 + 2 子题）
    eq('DOM 中实际 exercise-item 总数（含子题）', envC.document.querySelectorAll('.exercise-item').length, 7);
  }

  console.log('\n[8] 提交载荷构造');  const flattened = T.flattenForSubmit(
    [{ id: 1, children: [] }, { id: 2, children: [{ id: 21, children: [] }, { id: 22, children: [] }] }],
    new Map([[1, 'A'], [21, 'x'], [22, 'y']])
  );
  eq('组合题展平后条目数', flattened.length, 3);
  eq('展平项0', flattened[0], { questionId: 1, userAnswer: 'A' });
  eq('展平项含子题', flattened[1], { questionId: 21, userAnswer: 'x' });
  ok('questionId 为数字', typeof flattened[0].questionId === 'number');

  console.log('\n[9] 已作答判定');
  ok('空 doRecord → 未作答', T.hasUserAnswer({ doRecord: '' }) === false);
  ok('有 doRecord → 已作答', T.hasUserAnswer({ doRecord: 'A' }) === true);
  ok('数组答案 → 已作答', T.hasUserAnswer({ doRecord: ['a'] }) === true);
  ok('回退 userAnswer 字段', T.hasUserAnswer({ userAnswer: 'B' }) === true);

  console.log('\n[9b] 语音题识别（驰声评测，须跳过）');
  {
    const p2 = buildPage();
    // 追加一张口语题卡片
    const listEl = p2.reader.querySelector('.exercise-list');
    const oralItem = makeEl('div', 'exercise-item');
    listEl.appendChild(oralItem);
    const oc = makeEl('div', 'exercise-view');
    oralItem.appendChild(oc);
    oc.appendChild(makeEl('div', 'oral-brief-course-do'));

    const envO = makeEnv(p2, READER_URL, makeFetch([]));
    const TO = await loadScript(envO);
    const items2 = TO.getExerciseItems();
    // buildPage 现有 5 张顶层卡（单选/填空/判断/拖拽/组合），追加 1 张口语卡 → 6
    eq('题卡数含语音题', items2.length, 6);
    const lastIdx = items2.length - 1;
    // 站点真实题型字符串（CSS 类名 listen-repeat-view 对应的是 oral_follow_along）
    eq('语音卡推断为 oral_simple_speak', TO.detectType(items2[lastIdx]), 'oral_simple_speak');
    ok('isSpeechType(oral_simple_speak)', TO.isSpeechType('oral_simple_speak') === true);
    ok('isSpeechType(oral_follow_along)', TO.isSpeechType('oral_follow_along') === true);
    ok('isSpeechType(oral_roleplay)', TO.isSpeechType('oral_roleplay') === true);
    ok('isSpeechType(oral_vocabulary_learning)', TO.isSpeechType('oral_vocabulary_learning') === true);
    ok('isSpeechType(choice_single) 为假', TO.isSpeechType('choice_single') === false);
    ok('cardNeedsSpeech 命中语音卡', TO.cardNeedsSpeech(items2[lastIdx]) === true);
    ok('cardNeedsSpeech 不误判单选卡', TO.cardNeedsSpeech(items2[0]) === false);
  }

  console.log('\n[10] 分页判定 —— 契约：翻页不改 URL，只改内存状态');
  {
    // 站点真实行为（FLOW-CONTRACTS §3.2 已证实）：阅读器内部完全不写 location/history。
    // 翻页只改 Se（分页下标）→ 计数文本与内容变化，URL 保持不变。
    const p = buildPage();
    const envA = makeEnv(p, READER_URL, makeFetch([]));
    p.pgRight.dispatchEvent = function (e) {
      if (e && e.type === 'click') {
        // 只改计数文本与内容，绝不碰 URL
        p.pgCounter.textContent = '2/10';
        const ci = p.reader.querySelector('.content-item');
        if (ci) ci.dataset.contentId = '5002';
      }
      return true;
    };
    const TA = await loadScript(envA);
    const moved = await TA.clickPagination('next');
    ok('计数文本变化 → 判定翻页成功', moved === true);
    eq('计数文本已更新', p.pgCounter.textContent, '2/10');
    ok('URL 保持完全不变（契约要求）', envA.location.href === READER_URL, envA.location.href);
  }

  {
    // 末页：按钮 disabled（站点用 disabled 表达"不可前进"，含 lock 未解锁）
    const p = buildPage();
    const envB = makeEnv(p, READER_URL, makeFetch([]));
    p.pgRight.disabled = true;
    const TB = await loadScript(envB);
    ok('右按钮 disabled → 判定 false', (await TB.clickPagination('next')) === false);
  }

  {
    // 末页：按钮可点但什么都不发生
    const p = buildPage();
    const envC = makeEnv(p, READER_URL, makeFetch([]));
    p.pgRight.dispatchEvent = function () { return true; };
    const TC = await loadScript(envC);
    ok('点击无任何变化 → 判定 false', (await TC.clickPagination('next')) === false);
  }

  console.log('\n[10b] 结构自检');
  const chk = await T.selfCheck();
  ok('自检输出含路由段', chk.includes('== 路由 =='));
  ok('自检输出含 DOM 探针段', chk.includes('== DOM 探针 =='));
  ok('自检输出含题卡段', chk.includes('== 题卡 =='));
  ok('自检输出含取题接口段', chk.includes('== 取题接口 =='));

  console.log('\n[10c] 分页计数与限流冷却');
  {
    const p3 = buildPage();
    const env3 = makeEnv(p3, READER_URL, makeFetch([]));
    const T3 = await loadScript(env3);
    eq('计数文本解析', T3.paginationCounter(), '1/10');
    // 站点 429 契约：全局拦截器只提示不重试 → 脚本须自建冷却
    eq('冷却时长 = 60s（与站点文案一致）', T3.RATE_LIMIT_COOLDOWN_MS, 60000);
    ok('初始不在冷却中', T3.isRateLimited() === false);
    T3.enterRateLimit();
    ok('进入冷却后 isRateLimited 为真', T3.isRateLimited() === true);
    ok('剩余冷却秒数 > 0 且 <= 60', T3.rateLimitRemainSec() > 0 && T3.rateLimitRemainSec() <= 60);
    // 冷却期内写请求应被本地拦截，不发网络
    const callsBefore = calls.length;
    const rlResp = await T3.api('/question/submit/answer', { method: 'POST', data: {} });
    eq('冷却期写请求返回 429', rlResp.code, 429);
    ok('冷却期写请求未发出网络调用', calls.length === callsBefore);
  }

  console.log('\n[10e] 运行环境检测');
  {
    // v2.1.0 起为双引擎版：按路径只启动一个引擎。
    // 旧站路径下新版引擎不执行，因此 __TEST__ 不会被定义 —— 这是正确行为，
    // 而非故障。旧站能力由旧站引擎提供，已在 dual-engine.test.js 中单独验证。
    const e1 = makeEnv(buildPage(), READER_URL, makeFetch([]));
    const T1 = await loadScript(e1);
    eq('新版阅读器 kind', T1.detectEnvironment().kind, 'reader');

    // 课程中心（未进章节）—— 仍在同一域名下，新版引擎会加载但识别为非阅读器
    const e3 = makeEnv(buildPage(), 'https://www.tsinghuaelt.com/course_center/my_course', makeFetch([]));
    const T3 = await loadScript(e3);
    eq('课程中心 kind', T3.detectEnvironment().kind, 'course_center');

    // 旧站路径：双引擎版下旧站引擎接管，新版引擎不启动
    {
      const legacyUrl = 'https://www.tsinghuaelt.com/legacy/studentcourse?time_stamp=1';
      const e2 = makeEnv(buildPage(), legacyUrl, makeFetch([]));
      const T2 = await loadScript(e2);
      ok('旧站路径下新版引擎不启动（__TEST__ 未定义）', T2 === undefined,
         T2 ? Object.keys(T2).slice(0, 5) : undefined);
    }
  }

  console.log('\n[10d] 时长保活（站点自身每 10s 上报，脚本仅防 10 分钟空闲熔断）');  {
    const p4 = buildPage();
    const events = [];
    const env4 = makeEnv(p4, READER_URL, makeFetch([]));
    // 记录派发到 window 的事件
    env4.dispatchEvent = e => { events.push(e.type); return true; };
    const T4 = await loadScript(env4);
    ok('保活事件列表非空', T4.STUDY_ACTIVITY_EVENTS.length > 0);
    ok('保活含 mousemove', T4.STUDY_ACTIVITY_EVENTS.includes('mousemove'));
    ok('保活含 scroll（站点以 capture 监听）', T4.STUDY_ACTIVITY_EVENTS.includes('scroll'));
    const before = events.length;
    T4.keepAliveTick();
    ok('keepAliveTick 派发了事件', events.length > before, { before, after: events.length });
    ok('派发含 mousemove', events.includes('mousemove'));
  }

  console.log('\n[11] 引擎隔离检查（v2.1.0 双引擎版）');
  const fs = require('fs');
  const src = fs.readFileSync(require('./harness').SCRIPT, 'utf8');

  // v2.1.0 起同时内置两套引擎，旧站标识**应当存在**（属于旧站引擎）。
  // 关键是隔离正确：旧站标识只应出现在引擎 B 区间内，不得泄漏到引擎 A（新版引擎）。
  const aStart = src.indexOf('function __TSH_NEW_ENGINE__()');
  const bStart = src.indexOf('function __TSH_OLD_ENGINE__()');
  ok('定位到引擎 A（新版）', aStart >= 0);
  ok('定位到引擎 B（旧站）', bStart > aStart);

  if (aStart >= 0 && bStart > aStart) {
    // 引擎 A 区间内不得含旧站标识（版本号等除外）
    const engineA = src.slice(aStart, bStart);
    const legacyMarkers = ['app-course-task-stu', '.page-next', 'wy-btn', 'lib-single-item',
                           '.courseList', '.uniteTitle', 'studyTimeCountNew', 'sea-fetch-path'];
    legacyMarkers.forEach(k => ok('引擎 A（新版）不含旧站标识 ' + k, !engineA.includes(k)));

    // 引擎 B 区间内不得含新站标识
    const engineB = src.slice(bStart);
    const newMarkers = ['zhjyapi.tsinghuaelt.com', 'elt-user-token', 'zty-exercise-item-fill-blank-do'];
    newMarkers.forEach(k => ok('引擎 B（旧站）不含新站标识 ' + k, !engineB.includes(k)));

    // 引擎 B 内应确实含旧站选择器（证明旧引擎被完整嵌入）
    ok('引擎 B 含旧站选择器 courseList', engineB.includes('courseList'));
    ok('引擎 B 含旧站接口 studyTimeCountNew', engineB.includes('studyTimeCountNew'));
  }

  console.log('\n[12] 元数据');
  // 版本号动态读取，避免每次升版都要改测试（此前写死 2.1.0 导致升版即失败）
  const metaVer = (src.match(/@version\s+([\d.]+)/) || [])[1];
  ok('@version 存在且为语义化版本 (' + metaVer + ')', !!metaVer && /^\d+\.\d+\.\d+$/.test(metaVer));
  const sv = [...src.matchAll(/SCRIPT_VERSION\s*=\s*'([^']*)'/g)].map(m => m[1]);
  ok('SCRIPT_VERSION 均与 @version 一致', sv.length > 0 && sv.every(v => v === metaVer), sv);
  ok('@match 覆盖站点', /@match\s+\*:\/\/www\.tsinghuaelt\.com\/\*/.test(src));
  ok('含双引擎分发器', src.includes('双引擎分发器'));
  ok('@description 说明双引擎', /双引擎/.test(src.slice(0, 2000)));

  console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
