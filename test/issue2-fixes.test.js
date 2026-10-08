/**
 * issue #2 修复验证。
 *
 * 报告者（moon-waiter）在真实新版 reader 页做了受控对照，指出 5 个问题：
 *   1. 自检缺 contenteditable 探针
 *   2. 选项数探针正常（已由报告者交叉验证，无需修）
 *   3. 两轮自检计数差异大（2 vs 17 题卡）→ 渲染时机问题
 *   4. 题卡只列前 5 条，缺题型分布汇总
 *   5. pagination 类名被教材封面占用 + .pagination-btn 在新版 0 命中
 *   6. 探针未区分「类名不存在」与「元素存在但类名不同」
 *
 * 运行：node test/issue2-fixes.test.js
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { buildPage, makeEnv, loadScript, makeEl, qsa } = require('./harness');

const SCRIPT = path.resolve(__dirname, '..', '..', 'tsh-auto-brush', 'tsh-auto-brush.user.js');
const src = fs.readFileSync(SCRIPT, 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };
const eq = (n, a, b) => ok(n + ' (= ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b), a);

const READER_URL = 'https://www.tsinghuaelt.com/course_center/reader/StudentCourse/2001?catalogId=1001&contentId=5001';
const noopFetch = async () => ({ ok: true, status: 200, json: async () => ({ code: 200, data: { questionVOList: [], questionAnswerItemVOList: [], answerCount: 0 } }) });

(async () => {
  console.log('\n########## issue #2 修复验证 ##########\n');

  // ---------- 1. 自检新增 contenteditable 探针（第 1 条） ----------
  console.log('[1] 自检包含 contenteditable 探针');
  {
    const env = makeEnv(buildPage(), READER_URL, noopFetch);
    const T = await loadScript(env);
    const out = await T.selfCheck();
    ok('自检输出含 contenteditable 计数', out.includes('contenteditable'), out.split('\n').filter(l => l.includes('content')).slice(0, 3));
    ok('语义宽匹配段存在', out.includes('语义宽匹配'));
  }

  // ---------- 2. 题型分布汇总（第 4 条） ----------
  console.log('\n[2] 题型分布汇总');
  {
    const env = makeEnv(buildPage(), READER_URL, noopFetch);
    const T = await loadScript(env);
    const out = await T.selfCheck();
    ok('含「题型分布」行', out.includes('题型分布'));
    ok('分布为「类型 ×N」格式', /题型分布：.+(×\d+)/.test(out), out.split('\n').find(l => l.includes('题型分布')));
    ok('不再只列 5 条（改为 8 条 + 提示）', out.includes('仅列前') || !out.includes('#5 '), out.split('\n').filter(l => /^  #/.test(l)).length);
  }

  // ---------- 3. 渲染稳定性（第 3 条） ----------
  console.log('\n[3] 渲染稳定性检测');
  {
    const env = makeEnv(buildPage(), READER_URL, noopFetch);
    const T = await loadScript(env);
    const out = await T.selfCheck();
    ok('含「渲染稳定性」段', out.includes('渲染稳定性'));
    ok('报告题卡初次→稳定后数量', /题卡数：初次 \d+ → 稳定后 \d+/.test(out), out.split('\n').find(l => l.includes('题卡数：初次')));
    ok('含稳定/超时判定', /（已稳定）|（超时未稳定/.test(out));
  }

  // ---------- 4. 探针未命中时给出宽匹配提示（第 6 条） ----------
  console.log('\n[4] 未命中时区分「不存在」与「类名不同」');
  {
    const env = makeEnv(buildPage(), READER_URL, noopFetch);
    const T = await loadScript(env);
    const out = await T.selfCheck();
    // buildPage 里没有 .pagination-btn，应给出宽匹配提示
    const pgLine = out.split('\n').find(l => l.includes('.pagination-btn →'));
    ok('未命中的探针行存在', !!pgLine, pgLine);
  }

  // ---------- 5. 分页栏模式诊断（第 5 条） ----------
  console.log('\n[5] 分页栏渲染条件诊断');
  {
    // buildPage 默认含分页栏，拿不到"无分页按钮"分支 —— 需构造一个无分页的页面
    const page = buildPage();
    // 移除分页栏（模拟流式滚动模式）
    const bar = page.reader.querySelector('.b6-pg-bar');
    if (bar) bar.remove();
    const env = makeEnv(page, READER_URL, noopFetch);
    const T = await loadScript(env);
    const out = await T.selfCheck();

    ok('报告 .preview-navbar 状态', out.includes('preview-navbar'));
    ok('分页按钮数为 0', /分页按钮\(\.pagination-btn\)：0 个/.test(out),
       out.split('\n').find(l => l.includes('分页按钮')));
    ok('无分页按钮时给出原因说明（不是类名错误）',
       out.includes('这不代表类名错误') || out.includes('分页栏仅在'),
       out.split('\n').filter(l => l.includes('说明')).slice(0, 2));
  }

  // ---------- 6. 取题接口输出脱敏（安全） ----------
  console.log('\n[6] 取题接口输出脱敏（不回显答案内容）');
  {
    const page = buildPage();
    const env = makeEnv(page, READER_URL, async (url) => {
      if (String(url).includes('/question/echo/content/')) {
        return { ok: true, status: 200, json: async () => ({ code: 200, data: {
          answerCount: 0,
          questionVOList: [{ id: 9001, type: 'choice_single', obSub: 'ob' }],
          questionAnswerItemVOList: [{ questionId: 9001, answer: 'SECRET_ANSWER_VALUE', userAnswer: '', overWriteUserAnswer: '', answerStatus: 0 }]
        } }) };
      }
      return { ok: true, status: 200, json: async () => ({ code: 200, data: null }) };
    });
    const T = await loadScript(env);
    const out = await T.selfCheck();
    ok('不泄露答案内容', !out.includes('SECRET_ANSWER_VALUE'), '输出中出现了答案明文');
    ok('以长度/类型代替内容', /answer=\(string, len \d+\)/.test(out), out.split('\n').find(l => l.includes('首条答案字段')));
  }

  // ---------- 7. 主循环等待渲染稳定（第 3 条的功能修复） ----------
  console.log('\n[7] 主循环取题前等待渲染稳定');
  {
    ok('doOneRound 内调用 waitForStableRender', /await waitForStableRender\(5000\)/.test(src));
    ok('selfCheck 内调用 waitForStableRender', /const stab = await waitForStableRender/.test(src));
  }

  // ---------- 8. 新增 SEL 项（第 5/6 条） ----------
  console.log('\n[8] SEL 补入真实类名');
  {
    const env = makeEnv(buildPage(), READER_URL, noopFetch);
    const T = await loadScript(env);
    eq('answerAccount', T.SEL.answerAccount, '.unit-exercise-answer-account');
    eq('exerciseActions', T.SEL.exerciseActions, '.exercise-actions');
    eq('previewNavbar', T.SEL.previewNavbar, '.preview-navbar');
    ok('保留 answerCount 作兼容', !!T.SEL.answerCount);
  }

  console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
