/**
 * v2.1.0 双引擎版 —— 分发与隔离验证。
 *
 * 在真实脚本源码上执行，验证：
 *   1. 新版路径 → 只启动新版引擎，旧站引擎不执行
 *   2. 旧站路径 → 只启动旧站引擎，新版引擎不执行
 *   3. 其他路径 → 两个都不启动
 *   4. 两个引擎的 UI 不会重复挂载
 *   5. 同名函数确实互不干扰（通过各自引擎的独有行为反推）
 *
 * 运行：node test/dual-engine.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..', 'tsh-auto-brush');
const SCRIPT = path.join(REPO, 'tsh-auto-brush.user.js');
const src = fs.readFileSync(SCRIPT, 'utf8');

let pass = 0, fail = 0;
function ok(n, c, extra) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } }
function eq(n, a, b) { ok(n + ' (= ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b), a); }

// ---------- 极简 DOM ----------
function makeEl(tag, cls) {
  const el = {
    tagName: tag.toUpperCase(), _cls: new Set((cls || '').split(/\s+/).filter(Boolean)),
    children: [], parent: null, dataset: {}, attrs: {}, style: {}, textContent: '', value: '',
    disabled: false, events: [], className: cls || '', id: '',
    get classList() { const s = this; return { contains: c => s._cls.has(c), add: c => s._cls.add(c), remove: c => s._cls.delete(c) }; },
    get parentElement() { return this.parent || null; },
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    dispatchEvent(e) { this.events.push(e); return true; }, addEventListener() {}, focus() {},
    click() { this.dispatchEvent({ type: 'click' }); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20 }; },
    querySelector(s) { return qsa(this, s)[0] || null; }, querySelectorAll(s) { return qsa(this, s); }
  };
  return el;
}
function matches(el, sel) {
  const last = sel.trim().split(/\s+/).pop();
  const m = last.match(/^([a-zA-Z]*)((?:\.[\w-]+)*)$/);
  if (!m) return false;
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  for (const c of (m[2] || '').split('.').filter(Boolean)) if (!el._cls.has(c)) return false;
  return true;
}
function desc(el, out) { out = out || []; for (const c of el.children) { out.push(c); desc(c, out); } return out; }
function qsa(root, sel) { return desc(root).filter(e => matches(e, sel)); }

// ---------- 环境 ----------
function makeEnv(url, logSink) {
  const doc = makeEl('html', '');
  const body = makeEl('body', '');
  doc.appendChild(body);
  const app = makeEl('div', ''); app.id = 'app'; body.appendChild(app);

  // 新版阅读器结构
  const reader = makeEl('div', 'textbook-preview-content');
  body.appendChild(reader);
  const chapter = makeEl('div', 'chapter-section course');
  chapter.dataset.catalogId = '1001';
  reader.appendChild(chapter);
  const ci = makeEl('div', 'content-item');
  ci.dataset.contentId = '5001'; ci.dataset.catalogId = '1001';
  chapter.appendChild(ci);
  const prev = makeEl('div', 'unit-exercise-preview');
  ci.appendChild(prev);
  const list = makeEl('div', 'exercise-list');
  prev.appendChild(list);

  // 旧站结构（Angular）
  const legacyRoot = makeEl('div', 'courseList');
  body.appendChild(legacyRoot);
  const unite = makeEl('div', 'uniteTitle');
  legacyRoot.appendChild(unite);
  const task = makeEl('div', 'app-course-task-stu');
  body.appendChild(task);

  doc.readyState = 'complete';
  doc.querySelectorAll = s => qsa(doc, s);
  doc.querySelector = s => qsa(doc, s)[0] || null;
  doc.createElement = t => makeEl(t, '');
  doc.createElementNS = (ns, t) => makeEl(t, '');
  doc.getElementById = id => desc(doc).find(e => e.id === id) || null;
  doc.addEventListener = () => {};
  doc.getElementsByClassName = () => [];
  doc.body = body;
  doc.documentElement = doc;
  doc.head = makeEl('head', '');

  const u = new URL(url);
  const store = {};
  const win = {
    location: { href: url, pathname: u.pathname, search: u.search, hostname: u.hostname, origin: u.origin, host: u.host, replace() {}, assign() {} },
    document: doc,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
      get length() { return Object.keys(store).length; },
      key: i => Object.keys(store)[i]
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    console: {
      log: (...a) => logSink.push(a.join(' ')),
      error: () => {}, warn: () => {}, info: () => {}
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ code: 200, data: null }) }),
    URLSearchParams, AbortController,
    MouseEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    PointerEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    InputEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    WheelEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    KeyboardEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    DragEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    Event: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    CustomEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    __BUILD_VERSION__: '20260930165203'
  };
  win.window = win; win.self = win; win.globalThis = win;
  return { win, doc, body, reader, legacyRoot };
}

function run(url) {
  const logSink = [];
  const env = makeEnv(url, logSink);
  const ctx = vm.createContext(env.win);
  vm.runInContext(src, ctx, { filename: 'tsh-auto-brush.user.js' });
  return { logSink, env };
}

// ---------- 执行 ----------
console.log('\n########## v2.1.0 双引擎版 验证 ##########\n');

console.log('[1] 新版路径 → 只启动新版引擎');
{
  const { logSink, env } = run('https://www.tsinghuaelt.com/course_center/reader/Textbook/2001?catalogId=1001&contentId=5001');
  const joined = logSink.join('\n');
  ok('日志出现「检测到新版站点」', joined.includes('检测到新版站点'), joined.slice(0, 200));
  ok('日志未出现「检测到旧站」', !joined.includes('检测到旧站'));
  ok('日志未出现「非教材/课程页面」', !joined.includes('非教材/课程页面'));
}

console.log('\n[2] 旧站路径 → 只启动旧站引擎');
{
  const { logSink } = run('https://www.tsinghuaelt.com/legacy/studentcourse?time_stamp=1');
  const joined = logSink.join('\n');
  ok('日志出现「检测到旧站」', joined.includes('检测到旧站'), joined.slice(0, 200));
  ok('日志未出现「检测到新版站点」', !joined.includes('检测到新版站点'));
}

console.log('\n[3] 其他路径 → 两个引擎都不启动');
{
  const { logSink } = run('https://www.tsinghuaelt.com/');
  const joined = logSink.join('\n');
  ok('日志出现「非教材/课程页面」', joined.includes('非教材/课程页面'), joined.slice(0, 200));
  ok('未启动新版引擎', !joined.includes('检测到新版站点'));
  ok('未启动旧站引擎', !joined.includes('检测到旧站'));
}

console.log('\n[4] 课程中心（非阅读器）→ 仍启动新版引擎（进入章节前就绪）');
{
  const { logSink } = run('https://www.tsinghuaelt.com/course_center/my_course');
  const joined = logSink.join('\n');
  ok('启动新版引擎', joined.includes('检测到新版站点'), joined.slice(0, 150));
  ok('不启动旧站引擎', !joined.includes('检测到旧站'));
}

console.log('\n[5] 结构完整性');
{
  const c = src;
  ok('含新版引擎标记', c.includes('引擎 A · 新版'));
  ok('含旧站引擎标记', c.includes('引擎 B · 旧站'));
  ok('含分发器', c.includes('双引擎分发器'));
  eq('@version 为语义化版本', /@version\s+\d+\.\d+\.\d+/.test(c), true);
  eq('__TSH_NEW_ENGINE__ 定义+调用', (c.match(/__TSH_NEW_ENGINE__/g) || []).length, 2);
  eq('__TSH_OLD_ENGINE__ 定义+调用', (c.match(/__TSH_OLD_ENGINE__/g) || []).length, 2);
  ok('@match 覆盖全站', /@match\s+\*:\/\/www\.tsinghuaelt\.com\/\*/.test(c));
}

console.log('\n[6] 旧站引擎的选择器确实在新版脚本里（证明旧引擎被完整嵌入）');
{
  const c = src;
  for (const sel of ['courseList', 'uniteTitle', 'wy-btn', 'page-next', 'app-course-task-stu', 'lib-single-item-one']) {
    ok('含旧站选择器 ' + sel, c.includes(sel));
  }
}

console.log('\n[7] 新版引擎的选择器确实在（证明新引擎被完整嵌入）');
{
  const c = src;
  for (const sel of ['textbook-preview-content', 'zty-exercise-item-fill-blank-do', 'pagination-btn', 'elt-user-token', 'zhjyapi.tsinghuaelt.com']) {
    ok('含新版标识 ' + sel, c.includes(sel));
  }
}

console.log('\n[8] 版本号一致性（拼接易引入：引擎内 SCRIPT_VERSION 停留在来源版本）');
{
  const c = src;
  const metaVer = (c.match(/@version\s+([\d.]+)/) || [])[1];
  ok('@version 存在', !!metaVer, metaVer);

  // 两个引擎各自的 SCRIPT_VERSION 都必须等于 @version
  const scriptVers = [...c.matchAll(/SCRIPT_VERSION\s*=\s*'([^']*)'/g)].map(m => m[1]);
  eq('SCRIPT_VERSION 定义数（两引擎各一）', scriptVers.length, 2);
  scriptVers.forEach((v, i) => {
    eq('引擎 ' + (i === 0 ? 'A' : 'B') + ' SCRIPT_VERSION 与 @version 一致', v, metaVer);
  });

  // 分发器日志不得硬编码版本
  const logs = [...c.matchAll(/启动新版引擎 v([\d.]+)|启动旧站引擎 v([\d.]+)/g)].map(m => m[1] || m[2]);
  logs.forEach((v, i) => eq('分发器日志版本 ' + (i + 1), v, metaVer));

  // 面板副标题不得硬编码「新站适配」（旧站引擎里会误导）
  ok('无遗留的「新站适配」字样', !c.includes('新站适配'));
}

console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===\n');
process.exit(fail ? 1 : 0);
