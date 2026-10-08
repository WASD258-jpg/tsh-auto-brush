/**
 * 离线冒烟测试：用 Node vm 执行【真实】tsh-auto-brush.user.js 源码，
 * 提供最小 DOM / location / localStorage / fetch 桩，验证核心逻辑。
 *
 * 做法：把脚本 IIFE 末尾的 `setTimeout(mkUI, 1500)` 替换为导出内部符号，
 * 保证测的是真实代码路径，不是副本。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT = path.resolve(__dirname, '..', 'tsh-auto-brush.user.js');
const raw = fs.readFileSync(SCRIPT, 'utf8');

// --- 1. 构造可断言的虚拟 DOM ---
// 极简元素模型：只实现脚本用到的 querySelector/All、classList、dataset、dispatchEvent
function makeEl(tag, cls, extra) {
  const el = {
    tagName: tag.toUpperCase(),
    _cls: new Set((cls || '').split(/\s+/).filter(Boolean)),
    children: [],
    parent: null,
    dataset: {},
    attrs: {},
    textContent: '',
    value: '',
    disabled: false,
    events: [],
    className: cls || '',
    style: { setProperty() {}, },
    get classList() {
      const self = this;
      return {
        contains: c => self._cls.has(c),
        add: c => self._cls.add(c),
        remove: c => self._cls.delete(c)
      };
    },
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    // 真实 DOM 用 parentElement；脚本按标准 API 遍历祖先，桩必须提供
    get parentElement() { return this.parent || null; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
    setAttribute(k, v) {
      this.attrs[k] = v;
      if (k === 'id') this.id = v;
      if (k === 'class') { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); this.className = v; }
    },
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    // innerHTML：脚本用 panel.innerHTML = '<div id=...>...</div>' 构造 UI，
    // 若不实现解析，#b6-hd 等元素永远取不到，会掩盖真实行为。
    // 这里实现一个够用的解析器：只处理标签、id、class，忽略文本与属性细节。
    set innerHTML(html) {
      this.children = [];
      const stack = [this];
      const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[^>]*)?)\/?>|([^<]+)/g;
      let m;
      while ((m = re.exec(String(html))) !== null) {
        const isClose = m[0].startsWith('</');
        const tag = m[1];
        if (!tag) continue;                       // 纯文本：忽略
        if (isClose) {
          if (stack.length > 1) stack.pop();
          continue;
        }
        const el = makeEl(tag, '');
        const attrStr = m[2] || '';
        const idm = attrStr.match(/\bid\s*=\s*"([^"]*)"/);
        if (idm) { el.id = idm[1]; el.attrs.id = idm[1]; }
        const clm = attrStr.match(/\bclass\s*=\s*"([^"]*)"/);
        if (clm) { el.className = clm[1]; el._cls = new Set(clm[1].split(/\s+/).filter(Boolean)); el.attrs['class'] = clm[1]; }
        const parent = stack[stack.length - 1];
        parent.children.push(el);
        el.parent = parent;
        // 自闭合标签不入栈
        if (!/\/>$/.test(m[0]) && !['input', 'img', 'br', 'hr', 'meta', 'link'].includes(tag.toLowerCase())) {
          stack.push(el);
        }
      }
    },
    get innerHTML() { return ''; },
    dispatchEvent(e) { this.events.push(e); return true; },
    addEventListener() {},
    focus() {},
    click() { this.dispatchEvent({ type: 'click' }); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20 }; },
    querySelector(s) { return qsa(this, s)[0] || null; },
    querySelectorAll(s) { return qsa(this, s); }
  };
  if (extra) Object.assign(el, extra);
  return el;
}

// 选择器匹配：支持 "#id"、"tag"、".class"、".a.b"、"tag.class"、"[attr]"、
// 以及后代选择器 ".a .b"（简化为只匹配最后一段）
function matches(el, sel) {
  sel = sel.trim();
  const parts = sel.split(/\s+/);
  let last = parts[parts.length - 1];

  // 复合选择器可能带多个部分，逐个处理：#id.class / tag[a=b] 等
  // 1) id
  const idm = last.match(/#([\w-]+)/);
  if (idm) {
    if (el.id !== idm[1]) return false;
    last = last.replace(idm[0], '');
  }
  // 2) 属性选择器 [attr] 或 [attr="v"]（本桩只需支持是否存在）
  const attrRe = /\[([\w-]+)(?:[~^$*|]?=(?:"([^"]*)"|'([^']*)'|[^\]]*))?\]/g;
  let am;
  while ((am = attrRe.exec(last)) !== null) {
    const name = am[1];
    const want = am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : undefined);
    const got = (el.attrs && el.attrs[name] !== undefined) ? el.attrs[name]
      : (name === 'id' ? el.id : undefined);
    if (got === undefined || got === null) return false;
    if (want !== undefined && String(got) !== want) return false;
  }
  last = last.replace(attrRe, '');

  // 3) 剩下的 tag + class
  const m = last.match(/^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)$/);
  if (!m) return last === '' ? true : false;
  const tag = m[1];
  const classes = (m[2] || '').split('.').filter(Boolean);
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  for (const c of classes) if (!el._cls.has(c)) return false;
  return true;
}
function descendants(el, out) {
  out = out || [];
  for (const c of el.children) { out.push(c); descendants(c, out); }
  return out;
}
function qsa(root, sel) {
  return descendants(root).filter(e => matches(e, sel));
}

// --- 2. 组装测试页面 DOM（对照逆向得到的新站结构）---
function buildPage() {
  const doc = makeEl('html', '');
  const body = makeEl('body', '');
  doc.appendChild(body);

  const reader = makeEl('div', 'textbook-preview-content');
  body.appendChild(reader);

  const chapter = makeEl('div', 'chapter-section course');
  chapter.dataset.catalogId = '1001';
  reader.appendChild(chapter);

  const contentItem = makeEl('div', 'content-item');
  contentItem.dataset.contentId = '5001';
  contentItem.dataset.catalogId = '1001';
  chapter.appendChild(contentItem);

  const preview = makeEl('div', 'unit-exercise-preview');
  contentItem.appendChild(preview);

  const list = makeEl('div', 'exercise-list');
  preview.appendChild(list);

  // 题卡 1：单选（两个选项 + 一个 Submit 按钮）
  // 忠实模拟站点 <Radio value={e.idx}>：input.value 是 option 的 idx 值（"0"/"1"），
  // 而界面显示的是字母 A/B。answer/doRecord 的线格式就是这些 idx 值。
  const item1 = makeEl('div', 'exercise-item');
  list.appendChild(item1);
  const ec1 = makeEl('div', 'exercise-content');
  item1.appendChild(ec1);
  const ev1 = makeEl('div', 'exercise-view');
  ec1.appendChild(ev1);
  ev1.appendChild(makeEl('div', 'instruction'));
  ev1.appendChild(makeEl('div', 'annex-list'));
  const rg1 = makeEl('div', 'ant-radio-group');
  ev1.appendChild(rg1);
  for (let i = 0; i < 2; i++) {
    const label = makeEl('label', 'ant-radio-wrapper');
    const input = makeEl('input', '');
    input.attrs.type = 'radio';
    input.value = String(i);              // ← 站点 value={e.idx}
    input.attrs.value = String(i);
    label.appendChild(input);
    label.appendChild(makeEl('div', 'option-content'));
    rg1.appendChild(label);
  }

  // 题卡 2：填空（contenteditable 空）
  const item2 = makeEl('div', 'exercise-item');
  list.appendChild(item2);
  const ec2 = makeEl('div', 'exercise-content');
  item2.appendChild(ec2);
  const ev2 = makeEl('div', 'exercise-view');
  ec2.appendChild(ev2);
  const blank = makeEl('div', 'zty-exercise-item-fill-blank-do');
  ev2.appendChild(blank);

  // 题卡 3：判断题 —— 站点用 <Radio value="1">A、正确</Radio> / <Radio value="0">B、错误</Radio>
  const item3 = makeEl('div', 'exercise-item');
  list.appendChild(item3);
  const ec3 = makeEl('div', 'exercise-content');
  item3.appendChild(ec3);
  const ev3 = makeEl('div', 'exercise-view');
  ec3.appendChild(ev3);
  const judgeWrap = makeEl('div', 'judge-right');
  ev3.appendChild(judgeWrap);
  const judgeItem = makeEl('div', 'judge-option-item');
  judgeWrap.appendChild(judgeItem);
  for (const v of ['1', '0']) {
    const line = makeEl('div', 'option-line');
    const label = makeEl('label', 'ant-radio-wrapper');
    const input = makeEl('input', '');
    input.attrs.type = 'radio';
    input.value = v;
    input.attrs.value = v;
    label.appendChild(input);
    line.appendChild(label);
    judgeItem.appendChild(line);
  }

  // 题卡 4：拖拽题（onetoonedrag）—— 投放区 + 可拖项，结构对照站点契约
  //   div.drag-drop-container > div.drop-zone-list > div.drop-zone-item-wrapper
  //   div.drag-item-list > div.drag-item[draggable="true"]
  const item4 = makeEl('div', 'exercise-item');
  list.appendChild(item4);
  const ec4 = makeEl('div', 'exercise-content');
  item4.appendChild(ec4);
  const ev4 = makeEl('div', 'exercise-view');
  ec4.appendChild(ev4);
  const ddc = makeEl('div', 'drag-drop-container');
  ev4.appendChild(ddc);
  const dzList = makeEl('div', 'drop-zone-list');
  ddc.appendChild(dzList);
  const zones4 = [];
  for (let i = 0; i < 2; i++) {
    const z = makeEl('div', 'drop-zone-item-wrapper');
    z.dataset.idx = 'z' + i;
    dzList.appendChild(z);
    zones4.push(z);
  }
  const dragList = makeEl('div', 'drag-item-list');
  ddc.appendChild(dragList);
  const drags4 = [];
  for (let i = 0; i < 2; i++) {
    const d = makeEl('div', 'drag-item drag-item-with-handle');
    d.attrs.draggable = 'true';
    d.dataset.idx = 'd' + i;
    dragList.appendChild(d);
    drags4.push(d);
  }

  // 题卡 5：组合题（combined_basic）—— 父题内嵌子题，子题同样带 .exercise-item
  // 这是 getExerciseItems() 必须过滤的场景：否则子题会被误当作独立题卡
  const item5 = makeEl('div', 'exercise-item');
  list.appendChild(item5);
  const ec5 = makeEl('div', 'exercise-content');
  item5.appendChild(ec5);
  const ev5 = makeEl('div', 'exercise-view');
  ec5.appendChild(ev5);
  const childWrap = makeEl('div', 'combination-question-course-do');
  ev5.appendChild(childWrap);
  const children5 = [];
  for (let i = 0; i < 2; i++) {
    const child = makeEl('div', 'exercise-item');
    child.dataset.childQuestionId = String(9100 + i);
    const cc = makeEl('div', 'exercise-content');
    child.appendChild(cc);
    const cv = makeEl('div', 'exercise-view');
    cc.appendChild(cv);
    const rg = makeEl('div', 'ant-radio-group');
    cv.appendChild(rg);
    for (let j = 0; j < 2; j++) {
      const label = makeEl('label', 'ant-radio-wrapper');
      const inp = makeEl('input', '');
      inp.attrs.type = 'radio';
      inp.value = String(j);
      inp.attrs.value = String(j);
      label.appendChild(inp);
      rg.appendChild(label);
    }
    childWrap.appendChild(child);
    children5.push(child);
  }

  // 提交按钮 + 分页按钮
  const actions = makeEl('div', 'exercise-actions');
  preview.appendChild(actions);
  const submitBtn = makeEl('button', 'ant-btn ant-btn-block');
  submitBtn.textContent = 'Submit';
  actions.appendChild(submitBtn);

  // 分页栏：忠实模拟站点结构（src 偏移 1572234）
  //   div[ button.pagination-btn(左), span.pagination-text("n/总数"), span.pagination-btn-wrap[ button.pagination-btn(右) ] ]
  // 即：计数 span 与 wrap 是**兄弟**，wrap 只包右按钮。
  const pgBar = makeEl('div', 'b6-pg-bar');
  reader.appendChild(pgBar);
  const pgLeft = makeEl('button', 'pagination-btn');
  pgLeft.appendChild(makeEl('span', 'pagination-left'));
  const pgCounter = makeEl('span', 'pagination-text');
  pgCounter.textContent = '1/10';
  const pgWrap = makeEl('span', 'pagination-btn-wrap');
  const pgRight = makeEl('button', 'pagination-btn');
  pgRight.appendChild(makeEl('span', 'pagination-right'));
  pgWrap.appendChild(pgRight);
  pgBar.appendChild(pgLeft);
  pgBar.appendChild(pgCounter);
  pgBar.appendChild(pgWrap);

  doc.body = body;
  return { doc, reader, item1, item2, item3, item4, item5, children5, zones4, drags4, submitBtn, pgLeft, pgRight, pgWrap, pgCounter, blank };
}

// --- 3. 环境桩 ---
function makeEnv(page, url, fetchImpl) {
  const listeners = {};
  const location = {
    href: url,
    pathname: new URL(url).pathname,
    search: new URL(url).search,
    hostname: 'www.tsinghuaelt.com',
    origin: 'https://www.tsinghuaelt.com'
  };
  const store = { eltUserToken: 'FAKE_TOKEN_123' };

  const doc = page.doc;
  doc.readyState = 'complete';
  doc.querySelectorAll = s => qsa(doc, s);
  doc.querySelector = s => qsa(doc, s)[0] || null;
  doc.createElement = t => makeEl(t, '');
  doc.addEventListener = () => {};
  doc.getElementsByClassName = () => [];

  const win = {
    location,
    document: doc,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    addEventListener: () => {},
    dispatchEvent: () => true,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: fetchImpl,
    URLSearchParams,
    MouseEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    PointerEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    InputEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    WheelEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    KeyboardEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    DragEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    Event: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    CustomEvent: class { constructor(t, o) { Object.assign(this, { type: t }, o || {}); } },
    AbortController,
    __BUILD_VERSION__: '20260930165203'
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  return win;
}

// --- 4. 执行脚本并导出内部符号 ---
//
// 脚本演进过两种形态：
//   v2.0.0：单一 IIFE，末尾 setTimeout(mkUI, 1500);
//   v2.1.0：双引擎版，两个引擎各自包一个函数，末尾同样各有一个 setTimeout(mkUI, 1500);
//
// 测试目标是**新版引擎**，因此必须注入到引擎 A 内部，而不是文件里第一处出现的位置
// —— 在双引擎版中，若注入到旧站引擎会拿到错误的符号表（detectEnvironment 等不存在）。
async function loadScript(win) {
  const EXPORT_HOOK = 'globalThis.__TEST__ = { parseReaderRoute, decodeAnswer, buildAnswerMap, flattenForSubmit, detectType, getOptions, applyAnswer, hasUserAnswer, loadCurrentExercise, SEL, TYPE, ST, api, findSubmitButton, clickPagination, getExerciseItems, isReaderPage, checkScriptValidity, selfCheck, pageSignature, isSpeechType, cardNeedsSpeech, resolveOptionIndexes, getOptionValues, paginationCounter, isRateLimited, rateLimitRemainSec, enterRateLimit, RATE_LIMIT_COOLDOWN_MS, keepAliveTick, STUDY_ACTIVITY_EVENTS, normalizeDragPairs, applyDragAnswer, BARE_SCALAR_TYPES, EMPTY_AS_STRING, EMPTY_AS_OBJECT, simulateDragDrop, makeDataTransfer, detectEnvironment, waitForStableRender, classSummary, formatScore, fetchScore, formatDuration, formatRank, findNextTarget, startAutoRun, autoAdvance, getAutoRun, setAutoRun, currentCourseId, gotoContent, AUTO_RUN_KEY, fetchMyCourses, resolveCourseId, fillCourseSelect, isSubjective, AI_ESSAY_TYPES, gradedKindOf, retryUntilAnswer };';
  let src = raw;

  const tailRe = /[ \t]*setTimeout\(mkUI,\s*1500\);/;
  if (!tailRe.test(src)) throw new Error('未找到脚本出口，无法注入测试钩子');

  // 双引擎版：定位引擎 A（新版）的范围，只在其内部替换
  const engineAStart = src.indexOf('function __TSH_NEW_ENGINE__()');
  if (engineAStart >= 0) {
    const engineBStart = src.indexOf('function __TSH_OLD_ENGINE__()');
    const segEnd = engineBStart > engineAStart ? engineBStart : src.length;
    const head = src.slice(0, engineAStart);
    let seg = src.slice(engineAStart, segEnd);
    const rest = src.slice(segEnd);
    if (!tailRe.test(seg)) throw new Error('新版引擎内未找到出口');
    seg = seg.replace(tailRe, EXPORT_HOOK);
    src = head + seg + rest;
  } else {
    // 单引擎版：直接替换
    src = src.replace(tailRe, EXPORT_HOOK);
  }

  const ctx = vm.createContext(win);
  vm.runInContext(src, ctx, { filename: 'tsh-auto-brush.user.js' });
  return win.__TEST__;
}

module.exports = { makeEl, buildPage, makeEnv, loadScript, qsa, matches, SCRIPT };
