/**
 * 回归测试：查成绩的输出必须是中文可读，不得直接暴露接口的英文字段名。
 *
 * 症状（用户报告）：点「查成绩」，面板显示的是
 *   classNum: 39 / courseNum: 39 / courseScoreCourseRank: 9 / duration: 4150 / score: 1.02
 * 也就是把接口原始字段名原样打印了出来。
 *
 * 运行：node test/score-format.test.js
 */
const { buildPage, makeEnv, loadScript } = require('./harness');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '\n      → ' + JSON.stringify(extra) : '')); }
}

const READER_URL = 'https://www.tsinghuaelt.com/course_center/reader/student_course/2095675591799939073?catalogId=13049&contentId=23881';

// 真实接口返回（2026-10-08 实测，已脱敏）
const OVERVIEW_RESP = {
  code: 200, message: 'ok',
  data: {
    classNum: 39, courseNum: 39,
    courseProgressCourseRank: 9, courseProgressOrgRank: 9,
    courseScoreCourseRank: 9, courseScoreOrgRank: 9,
    courseStudyUseTimeCourseRank: 8, courseStudyUseTimeOrgRank: 8,
    duration: 4150, progress: 2, score: '1.02'
  }
};

// 课程名/模式来自学生视角接口；教师视角的 class/base/info 实测返回 403
const COURSE_DETAIL_RESP = {
  code: 200, message: 'ok',
  data: {
    id: '2095675591799939073', title: '新世界交互英语（第二版）',
    courseClassName: '默认班级', teacherName: '袁文娟',
    learnMode: 1, errorNumShow: 3, caculateToGrade: 1, learnTimeLimit: 0
  }
};

const UNIT_LIST_RESP = {
  code: 200, message: 'ok',
  data: [
    { id: 13049, title: 'Unit 1 Conservation', score: '1.02', progress: 5, duration: 4150, children: [] },
    { id: 13050, title: 'Unit 2', score: '0', progress: 0, duration: 0, children: [] }
  ]
};

function makeFetch(recorder) {
  return async function (url) {
    const u = String(url);
    recorder.push(u);
    if (u.includes('/study/situation/overview')) return { ok: true, status: 200, json: async () => OVERVIEW_RESP };
    if (u.includes('/study/situation/unit/list')) return { ok: true, status: 200, json: async () => UNIT_LIST_RESP };
    if (u.includes('/student/course/')) return { ok: true, status: 200, json: async () => COURSE_DETAIL_RESP };
    if (u.includes('/class/base/info')) return { ok: true, status: 200, json: async () => ({ code: 403, message: '您没有该操作权限', data: null }) };
    return { ok: true, status: 200, json: async () => ({ code: 200, message: 'ok', data: {} }) };
  };
}

(async function main() {
  console.log('\n=== 查成绩输出格式回归测试 ===\n');

  const page = buildPage();
  const calls = [];
  const win = makeEnv(page, READER_URL, makeFetch(calls));
  const T = await loadScript(win);

  if (!T || !T.formatScore) {
    console.log('  ✗ 无法取得 formatScore（测试钩子未导出）');
    process.exit(1);
  }

  // 用 fetchScore 的真实返回结构喂进去 —— 之前这里传的是旧结构 {overview, base}，
  // 漏了 detail，导致课程名是空的却被弱断言放过（假绿）。
  const payload = {
    courseId: '2095675591799939073',
    overview: OVERVIEW_RESP.data,
    detail: COURSE_DETAIL_RESP.data,
    units: UNIT_LIST_RESP.data
  };
  const out = T.formatScore(payload);
  console.log('  --- 实际输出 ---');
  String(out).split('\n').forEach(l => console.log('  | ' + l));
  console.log('  ---\n');

  // 1. 不得出现接口原始英文字段名
  const LEAKED = [
    'classNum', 'courseNum', 'courseProgressCourseRank', 'courseProgressOrgRank',
    'courseScoreCourseRank', 'courseScoreOrgRank', 'courseStudyUseTimeCourseRank',
    'courseStudyUseTimeOrgRank', 'duration', 'progress', 'score'
  ];
  const leaked = LEAKED.filter(k => new RegExp('(^|[^A-Za-z])' + k + '\\s*:', 'm').test(String(out)));
  ok('不暴露接口英文字段名', leaked.length === 0, leaked);

  // 2. 必须给出中文标签
  for (const label of ['成绩', '进度', '时长']) {
    ok('包含中文标签「' + label + '」', String(out).includes(label));
  }

  // 3. 数值要正确呈现（不是把对象 JSON 化）
  ok('成绩值正确呈现', String(out).includes('1.02'));
  ok('进度为百分比形式', /\b2\s*%/.test(String(out)));

  // 4. 时长要可读，而不是裸秒数
  ok('时长不是裸秒数 4150', !/\b4150\b/.test(String(out)));
  ok('时长以时分形式呈现', /(1\s*小时|69\s*分|1:09|1时)/.test(String(out)));

  // 5. 排名要呈现为 x/y
  ok('排名呈现为 x/y 形式', /\b9\s*\/\s*39\b/.test(String(out)));

  // 6. 课程信息必须真的取到（不依赖 403 的 class/base/info）
  ok('显示课程名', String(out).includes('新世界交互英语'));
  ok('显示班级', String(out).includes('默认班级'));
  ok('显示教师', String(out).includes('袁文娟'));
  ok('显示学习模式', /自由模式/.test(String(out)));
  ok('不显示「查询失败」', !/查询失败/.test(String(out)));

  // 7. 单元明细
  ok('显示各单元', String(out).includes('各单元') && String(out).includes('Unit 1 Conservation'));

  // 8. 回归保护：fetchScore 不得再打那个 403 的接口
  const calls2 = [];
  const win2 = makeEnv(buildPage(), READER_URL, makeFetch(calls2));
  const T2 = await loadScript(win2);
  await T2.fetchScore();
  ok('不再请求 403 的 /class/base/info', !calls2.some(u => u.includes('/class/base/info')), calls2);

  console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\n异常:', e && e.stack || e); process.exit(1); });
