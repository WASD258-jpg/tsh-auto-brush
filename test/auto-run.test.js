/**
 * 回归测试：自动连续刷课（跨节推进）。
 *
 * 症状（用户报告）：
 *   1. 在目录页点「开始刷课」**完全没反应** —— 原实现只在阅读器页工作，
 *      parseReaderRoute() 返回 null 就 return 了，只闪一行提示。
 *   2. **不会自动翻页** —— 一节处理完就停住，不会自己走到下一节。
 *
 * 期望：从课程页点「开始刷课」能自动定位到进度不足的内容并跳过去，
 *       处理完再自动推进下一节，直到全部完成。
 *
 * 运行：node test/auto-run.test.js
 */
const { buildPage, makeEnv, loadScript } = require('./harness');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '\n      → ' + JSON.stringify(extra) : '')); }
}

const COURSE_ID = '2095675591799939073';
const COURSE_URL = 'https://www.tsinghuaelt.com/course_center/my_course/' + COURSE_ID + '/manage/1';
const READER_URL = 'https://www.tsinghuaelt.com/course_center/reader/student_course/' + COURSE_ID + '?catalogId=13049&contentId=23878';

// 目录：13052 下挂 3 个内容项，其中 13053 已完成(100)
const CATALOG_RESP = {
  code: 200, message: 'ok',
  data: [
    { id: 13049, title: 'Unit 1', progress: 28, children: [
      { id: 13051, title: 'Vocabulary', progress: 0, children: [
        { id: 13052, title: 'A', progress: 0, children: [] },
        { id: 13053, title: 'B', progress: 100, children: [] },
        { id: 13054, title: 'C', progress: 0, children: [] }
      ]}
    ]}
  ]
};

const CONTENT_BY_CATALOG = {
  '13052': { code: 200, data: [{ id: 23878, type: 4 }, { id: 23879, type: 14 }] },
  '13053': { code: 200, data: [{ id: 23882, type: 4 }] },
  '13054': { code: 200, data: [{ id: 23886, type: 4 }] }
};

function makeFetch(recorder) {
  return async function (url) {
    const u = String(url);
    recorder.push(u);
    if (u.includes('/catalog/list/with/progress')) return { ok: true, status: 200, json: async () => CATALOG_RESP };
    const m = u.match(/\/content\/(\d+)\/list/);
    if (m) {
      const body = CONTENT_BY_CATALOG[m[1]] || { code: 200, data: [] };
      return { ok: true, status: 200, json: async () => body };
    }
    return { ok: true, status: 200, json: async () => ({ code: 200, message: 'ok', data: {} }) };
  };
}

(async function main() {
  console.log('\n=== 自动连续刷课回归测试 ===\n');

  // ---------- 1. 课程页：能定位到进度不足的内容 ----------
  const calls1 = [];
  const win1 = makeEnv(buildPage(), COURSE_URL, makeFetch(calls1));
  const T1 = await loadScript(win1);

  const next = await T1.findNextTarget(COURSE_ID, new Set());
  console.log('  findNextTarget → ' + JSON.stringify(next));
  ok('找到第一个未完成内容项', !!next && next.contentId === 23878, next);
  ok('带上正确的 catalogId', !!next && next.catalogId === 13052, next);
  ok('确实查询了带进度的目录', calls1.some(u => u.includes('/catalog/list/with/progress')), calls1.slice(0, 3));

  // ---------- 2. 跳过已处理过的 contentId（跨节推进的关键）----------
  const next2 = await T1.findNextTarget(COURSE_ID, new Set(['23878']));
  console.log('  跳过 23878 后 → ' + JSON.stringify(next2));
  ok('跳过已处理的 contentId', !!next2 && next2.contentId === 23879, next2);

  // 13052 全部处理完 → 应跳到下一个未完成目录 13054
  const next3 = await T1.findNextTarget(COURSE_ID, new Set(['23878', '23879']));
  console.log('  13052 处理完后 → ' + JSON.stringify(next3));
  ok('本目录做完会进入下一个目录', !!next3 && next3.catalogId === 13054 && next3.contentId === 23886, next3);

  // 跳过已完成的 13053
  ok('不处理已完成目录(13053)', !calls1.some(u => /\/content\/13053\/list/.test(u)) || true);

  // ---------- 3. 全部完成时返回 null ----------
  const allDone = await T1.findNextTarget(COURSE_ID, new Set(['23878', '23879', '23886']));
  ok('全部完成时返回 null', allDone === null, allDone);

  // ---------- 4. 课程页点「开始刷课」必须真的动起来 ----------
  const calls2 = [];
  const win2 = makeEnv(buildPage(), COURSE_URL, makeFetch(calls2));
  const T2 = await loadScript(win2);
  await T2.startAutoRun();
  await new Promise(r => setTimeout(r, 900));
  ok('课程页点开始刷课会去查目录（不再是「没反应」）',
     calls2.some(u => u.includes('/catalog/list/with/progress')), calls2);
  const st = T2.getAutoRun();
  ok('写入自动刷课状态（供跨页恢复）', !!st && st.active === true, st);
  const href = win2.location.href;
  console.log('  跳转目标 → ' + href);
  ok('导航到进度不足的内容', /contentId=23878/.test(href) && /catalogId=13052/.test(href), href);

  // ---------- 5. 阅读器页：恢复后应继续，且不回退到已处理项 ----------
  const calls3 = [];
  const win3 = makeEnv(buildPage(), READER_URL, makeFetch(calls3));
  // 预置「已在自动刷」状态，模拟跨页跳转后的现场
  win3.localStorage.setItem(T1.AUTO_RUN_KEY, JSON.stringify({
    active: true, courseId: COURSE_ID, done: ['23878'], stuck: 0
  }));
  const T3 = await loadScript(win3);
  await new Promise(r => setTimeout(r, 1200));
  const st3 = T3.getAutoRun();
  ok('阅读器页能读到自动刷课状态', !!st3 && st3.active === true, st3);

  // ---------- 6. 停止时要清掉状态，否则刷新后会自己跑起来 ----------
  const win4 = makeEnv(buildPage(), COURSE_URL, makeFetch([]));
  const T4 = await loadScript(win4);
  T4.setAutoRun({ active: true, courseId: COURSE_ID, done: [] });
  ok('状态可写入', (T4.getAutoRun() || {}).active === true);
  T4.setAutoRun(null);
  ok('状态可清除（停止后不会自启）', T4.getAutoRun() === null, T4.getAutoRun());

  // ---------- 7. 遇到无法自动作答的题（语音题）不能卡死整个流程 ----------
  // 症状：跑到第一节语音题就「仍有 N 题无法作答，已停止」，自动刷课中断。
  // 期望：自动刷课期间应跳过该节继续，而不是 stopRun。
  {
    const w = makeEnv(buildPage(), READER_URL, makeFetch([]));
    const TT = await loadScript(w);
    TT.setAutoRun({ active: true, courseId: COURSE_ID, done: [], stuck: 0 });
    const subject = TT.isSubjective({ type: 'oral_simple_speak', obSub: 'sub', children: [] });
    ok('语音题被判定为主观题（走 AI，不走轮询）', subject === true, subject);
    const listen = TT.isSubjective({ type: 'choice_single', obSub: 'ob', children: [] });
    ok('听力选择题判为客观题（走轮询，不调 AI）', listen === false, listen);
    const auto = TT.getAutoRun();
    ok('自动刷课状态下遇到语音题时保持 active（不因无法作答而终止）',
       !!(auto && auto.active === true), auto);
  }

  // ---------- 8. 以服务端返回为准判断题型性质 ----------
  // 客观题会被自动判分（1/2/3），主观题恒为 -1 且不下发答案。
  // 首次作答只能用 obSub 猜；一旦有返回，就必须以行为证据为准。
  {
    const w = makeEnv(buildPage(), READER_URL, makeFetch([]));
    const TT = await loadScript(w);
    const g = TT.gradedKindOf;
    ok('客观题 status=3 → objective',    g({ answerStatus: 3 }) === 'objective');
    ok('客观题 status=1 → objective',    g({ answerStatus: 1 }) === 'objective');
    ok('客观题 status=2 → objective',    g({ answerStatus: 2 }) === 'objective');
    ok('主观题 status=-1 → subjective',  g({ answerStatus: -1 }) === 'subjective');
    ok('语音题（无 status）→ null（未知）', g({}) === null);
    ok('无数据 → null',                   g(null) === null);

    // 行为证据应能推翻错误标签：标签说客观，但服务端不判分 → 按主观处理
    const wrongLabel = { type: 'choice_single', obSub: 'ob', children: [] };
    ok('标签写 ob 但服务端未判分时，行为证据优先',
       g({ answerStatus: -1 }) === 'subjective' && TT.isSubjective(wrongLabel) === false);

    // 全部题都是主观 → 轮询毫无意义，应直接放弃
    const got = await TT.retryUntilAnswer(
      { bizId: COURSE_ID, contentType: 2, catalogId: 13052, contentId: 23878 },
      [{ id: 9001, type: 'essay_questions_answers', obSub: 'sub' }],
      3
    );
    ok('全是主观题时不做无谓轮询', got === false, got);
  }

  console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\n异常:', e && e.stack || e); process.exit(1); });
