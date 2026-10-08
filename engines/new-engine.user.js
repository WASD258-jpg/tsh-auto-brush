// ==UserScript==
// @name         TSH自动刷课
// @version      2.3.0
// @namespace    wasd258-jpg.tsh-autobrush
// @description  清华社英语在线自动刷课（双引擎版）。自动识别站点版本：新版 /course_center/reader/ 与旧站 /legacy/ 均支持，装一次即可。功能：自动答题+章节推进+查成绩+学习时长保活。新版支持单选/多选/判断/填空/下拉/拖拽；语音题需真人录音。含结构自检。
// @author       WASD258-jpg
// @match        *://www.tsinghuaelt.com/*
// @run-at       document-idle
// @grant        none
// @license      GPL-3.0-only
// @icon         https://www.tsinghuaelt.com/favicon.ico
// @homepageURL  https://github.com/WASD258-jpg/tsh-auto-brush
// @supportURL   https://github.com/WASD258-jpg/tsh-auto-brush/issues
// @updateURL    https://github.com/WASD258-jpg/tsh-auto-brush/raw/main/tsh-auto-brush.user.js
// @downloadURL  https://github.com/WASD258-jpg/tsh-auto-brush/raw/main/tsh-auto-brush.user.js
// ==/UserScript==

/*
 * 新版引擎（独立源码）—— 由 build-dual.js 组装进双引擎版。
 * 修改请改本文件，不要改构建产物 tsh-auto-brush.user.js。
 */

(function () {
'use strict';

const SCRIPT_VERSION = '2.3.0'; // 与 @version 保持一致

// ============================================================================
// 1. 新站契约常量（逆向自线上产物，构建版本 20260930165203）
// ============================================================================

const API_BASE = 'https://zhjyapi.tsinghuaelt.com/elt-user';
const TOKEN_KEY = 'eltUserToken';          // localStorage 令牌键
const TOKEN_HEADER = 'elt-user-token';     // 对应请求头名
const REFRESH_KEY = 'eltsUserRefreshToken';
const REFRESH_HEADER = 'elt-user-refresh-token';

// contentType：1=教材(Textbook) 2=学生课程(StudentCourse)
const CT = { TEXTBOOK: 1, STUDENT_COURSE: 2 };

// 阅读器路由类型（router param :type）
const RT = { TEXTBOOK: 'Textbook', STUDENT_COURSE: 'StudentCourse', PUBLIC_COURSE: 'PublicCourse' };

// 题型枚举（站点变量 Q 的字符串值）
const TYPE = {
    SINGLE: 'choice_single',
    MULTIPLE: 'choice_multiple',
    FILL: 'fill_base',
    FILL_DIALOG: 'fill_dialog',
    FILL_IMAGE: 'fill_image',
    FILL_CLOZE: 'fill_word_selection',
    FILL_CLOZE_MN: 'fill_mchoosen',
    JUDGE: 'judge_basic',
    JUDGE_HIGH: 'judge_advanced',
    WRITING: 'essay_writing',
    TRANSLATE: 'essay_translate',
    QA: 'essay_questions_answers',
    CORRECT: 'correction_error',
    DRAG_ONE: 'matching_onetoonedrag',
    DRAG_MANY: 'matching_onetomanydrag',
    DRAG_FILL: 'matching_dragfillblank',
    DROP_IMG: 'matching_imagedropdown',
    DROP_PARA: 'matching_paragraphdropdown',
    COMBINED: 'combined_basic',
    READING: 'combined_read_comprehension',
    ORAL_SPEAK: 'oral_simple_speak',
    ORAL_FOLLOW: 'oral_follow_along',      // 注意：CSS 类名 listen-repeat-view 对应的就是它
    ORAL_ROLEPLAY: 'oral_roleplay',
    ORAL_WORDS: 'oral_vocabulary_learning'
};

// 走「裸标量」编码的题型（parseAnswer / parseDoRecord 只对这两个走该分支）。
// 陷阱：judge_advanced 不在此列 —— 它的 doRecord 是 JSON 数组。
const BARE_SCALAR_TYPES = new Set([TYPE.SINGLE, TYPE.JUDGE]);

// 语音评测类题型（驰声 chivox 实时评测，必须真人录音）
const SPEECH_TYPE_LIST = [TYPE.ORAL_SPEAK, TYPE.ORAL_FOLLOW, TYPE.ORAL_ROLEPLAY, TYPE.ORAL_WORDS];

// 站点 createDoRecord 的空初值形态（用于判断"是否已作答"）
const EMPTY_AS_STRING = new Set([TYPE.SINGLE, TYPE.JUDGE, TYPE.ORAL_SPEAK]);
const EMPTY_AS_OBJECT = new Set([TYPE.WRITING, TYPE.TRANSLATE, TYPE.QA, TYPE.ORAL_ROLEPLAY]);

// 课程学习模式（站点变量 Hq）。它决定**成绩如何取值**，因而决定作答策略：
//   自由模式   learnMode=1 → 学习成绩记录**末次**答题结果（反复提交会覆盖）
//   闯关模式   learnMode=2 → 学习成绩记录**最高**答题结果（反复提交取最好）
// 教师端配置界面原文（course-manage-main）：
//   自由：「学生答对即时显示答案与解析，答错 N 次后显示答案与解析，学习成绩记录末次答题结果。」
//   闯关：「学生任务过关后显示答案与解析，学习成绩记录最高答题结果。」
const LEARN_MODE = { FREE: 1, BREAKTHROUGH: 2 };

// 题目状态枚举（站点变量 Z）
const ST = {
    PREVIEW_BASIC: 1, PREVIEW_COMPOSING: 2, PREVIEW_COMPOSED: 3, PREVIEW_SIMPLE: 16,
    EXAM_DOING: 4, EXAM_FINISH: 5, EXAM_DONE_MARK: 6, EXAM_DONE_MARKED: 7,
    EXAM_DONE_MARKED_NO_ANSWER: 8, EXAM_ANALYSIS: 9,
    COURSE_DOING: 10, COURSE_FINISH: 11, COURSE_DONE_MARKED: 12,
    COURSE_DONE_MARKED_NO_ANSWER: 13, COURSE_ANALYSIS: 14, COURSE_ANALYSIS_NOT: 15
};

// 站点自身节流常量（逆自称常量 Me/Ne/Pe）
const AI_ASSESS_INTERVAL_MS = 3000;
const AI_ASSESS_MAX_TRIES = 30;
const CONTENT_REPORT_INTERVAL_MS = 1000;

// ============================================================================
// 2. 工具函数
// ============================================================================

const $ = (s, p) => Array.from((p || document).querySelectorAll(s));
const $1 = (s, p) => (p || document).querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a));
const log = (...a) => { try { console.log('[刷课]', ...a); } catch (e) {} };

// 派发完整鼠标序列（antd 组件监听 pointer/mouse 组合，顺序须与真实浏览器一致）
function click(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
}
function clickSeq(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 }, base)));
    el.dispatchEvent(new MouseEvent('mousedown', Object.assign({ button: 0, buttons: 1 }, base)));
    el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 }, base)));
    el.dispatchEvent(new MouseEvent('mouseup', Object.assign({ button: 0, buttons: 0 }, base)));
    el.dispatchEvent(new MouseEvent('click', Object.assign({ button: 0, buttons: 0 }, base)));
    return true;
}
// 写入文本（适配 React/Vue 受控组件：先置原生值再派发 input/change）
function fillInput(el, val) {
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, val); else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}
// 派发焦点类事件。FocusEvent 在部分环境（如离线测试的 mock DOM）不存在，
// 退回普通 Event —— 站点只读事件类型与 relatedTarget（undefined/null 均可）。
function fireFocusEvent(el, type) {
    if (!el) return false;
    let ev;
    try { ev = new FocusEvent(type, { bubbles: true, relatedTarget: null }); }
    catch (e) { ev = new Event(type, { bubbles: true }); }
    try { el.dispatchEvent(ev); } catch (e) {}
    return true;
}

// 写入 contenteditable（新站填空题主体是 span.zty-exercise-item-fill-blank-do）
//
// 【实测】只做 textContent + input + blur 是**不够**的：DOM 会有值，但站点的
// doRecord 不更新，点提交时被前端硬门禁拦下（提示「已完成 0 题」）。
//
// 站点填空题组件（产物 src-DZ23PK2 的 Ij()）在容器 #do_{id} 上绑定：
//   input    → O()  用 span.id 作 key 写入 doRecord，并置 changed = true
//   focusout → M()  置 focus = false，若 inner 也为 false 则 emit doRecordChange
//   mouseout → j()  置 inner = false，若 focus 也为 false 则 emit doRecordChange
// 即必须让 changed / focus / inner 三个标志依次就位，才会真正提交作答。
// 注意监听的是 focusout（冒泡）而非 blur。
function fillEditable(el, val) {
    if (!el) return false;
    try { el.focus(); } catch (e) {}
    fireFocusEvent(el, 'focusin');
    el.textContent = val;
    el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: val
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    fireFocusEvent(el, 'focusout');
    try { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); } catch (e) {
        el.dispatchEvent(new Event('mouseout', { bubbles: true }));
    }
    return true;
}

// ============================================================================
// 3. API 层（新站契约）
// ============================================================================

function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
}
function getRefreshToken() {
    try { return localStorage.getItem(REFRESH_KEY) || ''; } catch (e) { return ''; }
}

// 统一请求：自动带 elt-user-token，解析 {code,data,message}
//
// 【已证实的限流契约】站点全局拦截器对 429 只做提示 + reject，**无重试、无退避**：
//   if (status===429 || data.code===429) { error('提交过于频繁，请休息一下，1分钟后再试'); reject() }
// 因此脚本必须自己实现冷却，否则连击只会持续吃 429。
const RATE_LIMIT_COOLDOWN_MS = 60000;   // 与站点提示文案一致：1 分钟
let rateLimitedUntil = 0;

function isRateLimited() { return Date.now() < rateLimitedUntil; }
function rateLimitRemainSec() { return Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000)); }
function enterRateLimit() { rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS; }

async function api(path, opts) {
    opts = opts || {};
    // 冷却期内不发请求（读接口豁免，避免正常浏览被阻断）
    if (isRateLimited() && opts.method && opts.method !== 'GET') {
        return { code: 429, message: '本地冷却中（剩余 ' + rateLimitRemainSec() + 's）', data: null, _localCooldown: true };
    }
    const url = API_BASE + path;
    const qs = opts.params
        ? '?' + Object.entries(opts.params)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
            .join('&')
        : '';
    const headers = { 'Content-Type': 'application/json;charset=UTF-8', 'Accept-Language': 'zh-CN' };
    const tok = getToken();
    if (tok) headers[TOKEN_HEADER] = tok;

    const init = { method: opts.method || 'GET', headers, credentials: 'omit' };
    if (opts.data !== undefined) init.body = JSON.stringify(opts.data);

    let resp;
    try {
        resp = await fetch(url + qs, init);
    } catch (e) {
        return { code: -1, message: '网络错误：' + e.message, data: null };
    }
    let body;
    try { body = await resp.json(); } catch (e) { return { code: resp.status, message: '响应非 JSON（HTTP ' + resp.status + '）', data: null }; }

    // 限流：进入本地冷却
    if (resp.status === 429 || (body && body.code === 429)) {
        enterRateLimit();
        return { code: 429, message: '触发限流，已冷却 ' + (RATE_LIMIT_COOLDOWN_MS / 1000) + 's', data: null, _rateLimited: true };
    }

    // 令牌过期：尝试刷新一次后重试
    if (body && body.code === 401 && !opts._retried) {
        const ok = await refreshToken();
        if (ok) { opts._retried = true; return api(path, opts); }
    }
    return body;
}

async function refreshToken() {
    const t = getToken(), rt = getRefreshToken();
    if (!t || !rt) return false;
    try {
        const resp = await fetch(API_BASE + '/user/refresh/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json;charset=UTF-8', [TOKEN_HEADER]: t, [REFRESH_HEADER]: rt },
            body: '{}'
        });
        const b = await resp.json();
        if (b && b.code === 200 && b.data && b.data.token) {
            localStorage.setItem(TOKEN_KEY, b.data.token);
            if (b.data.refreshToken) localStorage.setItem(REFRESH_KEY, b.data.refreshToken);
            return true;
        }
    } catch (e) {}
    return false;
}

// --- 内容与题目 ---
const apiGetContent = (bizId, catalogId, contentType) =>
    api('/textbook/course/' + bizId + '/content/' + catalogId + '/list', { params: { content_type: contentType } });

const apiGetExercise = (contentId, contentType, bizId, userId) =>
    api('/question/echo/content/' + contentId + '/answer', {
        params: { content_type: contentType, biz_id: bizId, user_id: userId || undefined }
    });

const apiSubmitAnswer = (payload) => api('/question/submit/answer', { method: 'POST', data: payload });

const apiMarkContentDone = (courseId, catalogId, contentId) =>
    api('/user/study/course/content/record', { method: 'POST', data: { courseId, catalogId, contentId } });

const apiSaveStudyTime = (bizId, contentType, catalogId) =>
    api('/user/study/time/record', { method: 'POST', data: { bizId, contentType, catalogId } });

const apiGetReadRecord = (bizId, contentType) =>
    api('/user/study/read/record', { params: { biz_id: bizId, content_type: contentType } });

const apiSaveReadRecord = (bizId, contentType, catalogId, contentId) =>
    api('/user/study/read/record', { method: 'POST', data: { bizId, contentType, catalogId, contentId } });

const apiLoadProgress = (courseId, catalogId) =>
    api('/user/study/course/' + courseId, { params: { catalog_id: catalogId } });

const apiGetAssessStatus = (courseId, catalogId) =>
    api('/user/study/course/' + courseId + '/ai/assess/status', { params: { catalog_id: catalogId } });

const apiGetCatalogWithProgress = (courseId, userId, type) =>
    api('/course/' + courseId + '/catalog/list/with/progress', { params: { user_id: userId, type: type } });

const apiGetCatalog = (courseId, type, status) =>
    api('/course/' + courseId + '/catalog/list', { params: { type: type, status: status } });

const apiGetUserInfo = () => api('/user/info');

// 课程详情：携带**判分规则**（learnMode / freeShowAnswer / passShowAnswer /
// errorNumShow / caculateToGrade / learnTimeLimit）。
// 阅读器页面自身也调这个接口；实测其返回里这些字段齐全。
const apiGetCourseDetail = (courseId) => api('/course/' + courseId + '/detail');

// ============================================================================
// 4. 路由与页面识别
// ============================================================================

// 阅读器路由：/course_center/reader/{Textbook|StudentCourse|PublicCourse}/{bizId}?catalogId=&contentId=
function parseReaderRoute() {
    const m = location.pathname.match(/\/course_center\/reader\/([^/]+)\/(\d+)/i);
    if (!m) return null;
    const q = new URLSearchParams(location.search);
    const rawType = m[1];
    let contentType = CT.TEXTBOOK;
    // 【登录态实测修正】路由段实际是带下划线的 student_course / public_course。
    // 原正则 /studentcourse/ 因下划线永远不匹配，导致 contentType 恒为 1，
    // 取题接口随之返回 80020「内容项不存在！」。
    // 实测：content_type=2 时 student_course 取题返回 200。
    if (/student_?course/i.test(rawType)) contentType = CT.STUDENT_COURSE;
    else if (/public_?course/i.test(rawType)) contentType = CT.STUDENT_COURSE; // 公共课与课程同走 content_type=2
    return {
        type: rawType,
        contentType: contentType,
        bizId: m[2],
        catalogId: q.get('catalogId') ? Number(q.get('catalogId')) : null,
        contentId: q.get('contentId') ? Number(q.get('contentId')) : null
    };
}

// 页面识别（新站 DOM）
const SEL = {
    readerRoot: '.textbook-preview-content',
    chapterSection: '.chapter-section',
    contentItem: '.content-item',
    exercisePreview: '.unit-exercise-preview',
    exerciseList: '.exercise-list',
    exerciseItem: '.exercise-item',
    exerciseContent: '.exercise-content',
    exerciseView: '.exercise-view',
    paginationBtn: '.pagination-btn',
    // 【登录态实测修正】站点并不存在 .pagination-btn-wrap。
    // 实测结构：div.preview-pagination 下同时挂着 2 个 button.pagination-btn
    // 与 1 个 .pagination-text（计数 "25/377"），即计数 span 与按钮是**同容器兄弟**，
    // 而非原先推断的「计数 span 包着 wrap」。
    paginationWrap: '.preview-pagination',
    // 答题计数：产物中 exercise-actions 内渲染的两个容器为
    //   hae = { class: 'unit-exercise-answer-account' }（作答情况/次数）
    //   gae = { class: 'right-button' }（右侧按钮区）
    // 旧命名 answer-count 在产物中仅 1 处且非独立类，保留作兼容探测。
    // 另注：分页栏位于 .preview-navbar 内，仅在「预览模式 + 总页数>0」时渲染。
    answerCount: '.answer-count',
    answerAccount: '.unit-exercise-answer-account',
    exerciseActions: '.exercise-actions',
    previewNavbar: '.preview-navbar'
};

function isReaderPage() {
    return !!parseReaderRoute() && !!$1(SEL.readerRoot);
}
function isCoursePage() {
    // 兼容：未进入具体阅读器但在课程中心
    return /\/course_center\//.test(location.pathname);
}

// ============================================================================
// 4bis. 课程判分策略 —— 作答前必须先分清模式
// ============================================================================
//
// 【为什么必须先分清】
// 学习模式决定「反复提交」的后果，因而决定脚本敢不敢试错：
//   自由模式 → 成绩记**末次**：中途提交的错答案会成为最终成绩，除非最后一次答对
//   闯关模式 → 成绩记**最高**：反复提交不会拉低成绩
// 另有 errorNumShow 决定要答错几次服务端才下发标准答案。
//
// 【证据】教师端配置界面（course-manage-main）对两种模式的原文说明见 LEARN_MODE 注释；
// 字段本身来自 GET /course/{id}/detail，阅读器页面自身也调这个接口。
//
// 【保守原则】读不到策略时一律视为「不可试错」，宁可不做也不冒险改成绩。

let coursePolicy = null;

// 拉取并缓存当前课程的判分策略
async function loadCoursePolicy(force) {
    const r = parseReaderRoute();
    if (!r) return null;
    const key = r.bizId + '|' + r.contentType;
    if (!force && coursePolicy && coursePolicy.key === key) return coursePolicy;

    const resp = await apiGetCourseDetail(r.bizId);
    if (!resp || resp.code !== 200 || !resp.data) {
        coursePolicy = { key: key, loaded: false, error: (resp && resp.message) || '未知错误' };
        return coursePolicy;
    }
    const d = resp.data;
    coursePolicy = {
        key: key,
        loaded: true,
        learnMode: Number(d.learnMode),
        freeShowAnswer: Number(d.freeShowAnswer),
        passShowAnswer: Number(d.passShowAnswer),
        errorNumShow: Number(d.errorNumShow),
        caculateToGrade: Number(d.caculateToGrade),
        learnTimeLimit: Number(d.learnTimeLimit)
    };
    log('课程判分策略', coursePolicy);
    return coursePolicy;
}

// 由策略推导出「该模式下反复提交是否安全」
function strategyOf(p) {
    if (!p || !p.loaded) {
        return {
            mode: '未知', retrySafe: false, gradeBy: '-',
            note: '未能读到课程设置，出于安全考虑不做试错提交'
        };
    }
    if (p.learnMode === LEARN_MODE.BREAKTHROUGH) {
        return {
            mode: '闯关模式', retrySafe: true, gradeBy: '最高',
            note: '成绩记录最高答题结果 —— 反复提交不会拉低成绩；任务达标后显示答案与解析'
        };
    }
    if (p.learnMode === LEARN_MODE.FREE) {
        return {
            mode: '自由模式', retrySafe: false, gradeBy: '末次',
            note: '成绩记录末次答题结果 —— 中途的错误提交会成为最终成绩，除非最后一次答对'
        };
    }
    return {
        mode: '未知(' + p.learnMode + ')', retrySafe: false, gradeBy: '-',
        note: '未识别的学习模式，不做试错提交'
    };
}

// 服务端在答错几次后下发标准答案（未配置时保守取 1，即不依赖试错）
function answerRevealThreshold(p) {
    if (!p || !p.loaded) return Infinity;          // 读不到 → 永不试错
    const n = Number(p.errorNumShow);
    return Number.isFinite(n) && n > 0 ? n : Infinity;
}
// 取顶层题卡。
// 【关键】组合题（combined_basic / combined_read_comprehension）的子题同样带
// `.exercise-item` 类，并以 `data-child-question-id` 标识，**嵌在父题卡片内部**
// （站点模板：div.exercise-item[data-child-question-id] 位于父题 div.exercise-item 之内）。
// 若直接 querySelectorAll('.exercise-item') 会把子题一并收进来，导致题卡索引错位、
// 答案与题目错配。因此必须过滤掉"祖先中已有 .exercise-item"的节点。
function getExerciseItems() {
    const root = $1(SEL.readerRoot);
    if (!root) return [];
    let items = $(SEL.exerciseItem, root);
    if (!items.length) items = $(SEL.exercisePreview + ' ' + SEL.exerciseItem);
    if (!items.length) return [];
    const top = items.filter(el => {
        let p = el.parentElement;
        while (p && p !== root) {
            if (p.classList && p.classList.contains('exercise-item')) return false;
            p = p.parentElement;
        }
        return true;
    });
    return top.length ? top : items;
}

// ============================================================================
// 5. 题型识别与作答
// ============================================================================

// 从题目卡片 DOM 推断题型（选择器取自线上构建产物的类名）
function detectType(el) {
    if (!el) return null;
    const has = s => !!$1(s, el);
    // 语音类优先判定（其 DOM 特征最独特）
    if (has('.role-play-course-container')) return TYPE.ORAL_ROLEPLAY;
    if (has('.zty-exercise-view-main.listen-repeat-view')) return TYPE.ORAL_FOLLOW;
    if (has('.oral-brief-course-do') || has('.oral-brief-course-done')) return TYPE.ORAL_SPEAK;
    if (has('.drag-drop-container')) return TYPE.DRAG_ONE;
    if (has('.judge-option-item')) return TYPE.JUDGE;
    if (has('.zty-exercise-item-fill-blank-do') || has('span.zty-exercise-item-fill-blank-do')) return TYPE.FILL;
    if (has('input[type="radio"]') || has('.ant-radio-wrapper') || has('.ant-radio-group')) return TYPE.SINGLE;
    if (has('input[type="checkbox"]') || has('.ant-checkbox-wrapper') || has('.ant-checkbox-group')) return TYPE.MULTIPLE;
    if (has('textarea')) return TYPE.WRITING;
    if (has('input[type="text"]') || has('input:not([type])')) return TYPE.FILL;
    if (has('.ant-select')) return TYPE.DROP_PARA;
    return null;
}

// 语音评测类题型：走驰声 chivox 实时评测（wss://cloud.chivox.com + 麦克风采集 + 服务端打分），
// 结构上无法靠填 DOM 作答，必须真实录音。识别出来是为了明确跳过并告知用户，而非静默失败。
const SPEECH_TYPES = new Set(SPEECH_TYPE_LIST);
function isSpeechType(type) { return SPEECH_TYPES.has(type); }
function cardNeedsSpeech(el) {
    return isSpeechType(detectType(el)) ||
        !!$1('.oral-brief-course-do, .listen-repeat-view, .role-play-course-container, .avatar-view-container', el);
}

// 读取卡片内的选项元素
// 【登录态实测修正】线上选择题里 .option-line 命中数为 0，
// 真正的选项容器是 antd 的 .ant-radio-wrapper / .ant-checkbox-wrapper；
// .option-content 属于**拖拽题**的投放项，故降为次选，.option-line 仅作历史兼容。
function getOptions(el) {
    let opts = $('.ant-radio-wrapper, .ant-checkbox-wrapper', el);
    if (opts.length) return opts;
    opts = $('.option-content', el);
    if (opts.length) return opts;
    opts = $('.option-line', el);
    return opts;
}

// 点击选项（优先点内部可聚焦控件，antd 需要点到 input 才触发表单变更）
function selectOption(optEl) {
    if (!optEl) return false;
    const input = $1('input', optEl);
    if (input && !input.disabled) {
        clickSeq(optEl);
        // antd 受控组件：直接点 input 更可靠
        try { input.click(); } catch (e) {}
        return true;
    }
    const inner = $1('.option-content', optEl) || optEl;
    return clickSeq(inner);
}

// 把"刚写入 DOM 的作答"回写进 currentResp，让 hasUserAnswer() 能立即反映。
//
// 【为什么需要】hasUserAnswer() 读的是 currentResp 里的 doRecord，而 doRecord 来自服务端。
// 填充只改了 DOM 的话，刚填的题仍会被判为「未作答」—— 流程就会停在提交之前，
// 表现是"AI 已作答但一个请求都不发"。
//
// 编码规则与站点 stringifyField 一致（DEVELOPMENT §6.1.1）：
//   裸串原样 / 非空数组或对象 JSON.stringify / 空数组 → 空串
function stringifyDoRecord(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.length ? JSON.stringify(value) : '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function markAnswered(q, value, card) {
    if (!q) return;
    // 填空类在站点的线格式是 [{idx, answer}]，idx 就是题干里每个空 span 的 id
    // （实测与 extension[].idx 一致）。若写成裸值数组，服务端会整题判错：
    // 实测提交 ["surrogate","hyena",…] 得到 rightRate 0，而 [{idx,answer},…] 才是正常格式。
    if (card && AI_FILL_TYPES.has(q.type)) {
        const blanks = $('.zty-exercise-item-fill-blank-do', card);
        const vals = Array.isArray(value) ? value : [value];
        if (blanks.length) {
            q.doRecord = JSON.stringify(blanks.map((b, i) => ({
                idx: b.id,
                answer: String(vals[i] == null ? '' : vals[i])
            })));
            return;
        }
    }
    q.doRecord = stringifyDoRecord(value);
}

// 读取标准答案（来自取题接口的 questionAnswerItemVOList[].answer）
// 结构：{ questionId, answer, userAnswer, overWriteUserAnswer, answerStatus, analysis }
function buildAnswerMap(respData) {
    const map = new Map();
    if (!respData) return map;
    const list = respData.questionAnswerItemVOList || [];
    list.forEach(it => {
        const id = Number(it.questionId);
        if (!Number.isFinite(id)) return;
        map.set(id, {
            answer: it.answer,
            userAnswer: it.userAnswer,
            overWrite: it.overWriteUserAnswer,
            status: it.answerStatus
        });
    });
    return map;
}

// 解析 doRecord / answer。
// 【站点契约，已证实】parseAnswer / parseDoRecord 只对 choice_single 与 judge_basic
// 走「裸标量」分支；其余题型（**含 judge_advanced**）若为字符串则 JSON.parse。
function decodeUserAnswer(raw, type) {
    if (raw === undefined || raw === null) return null;
    if (BARE_SCALAR_TYPES.has(type)) return raw;
    if (typeof raw === 'string') { try { return JSON.parse(raw); } catch (e) { return raw; } }
    return raw;
}

// 把标准答案（可能是 JSON 字符串）解码为可比较结构
function decodeAnswer(raw, type) {
    return decodeUserAnswer(raw, type);
}

// 填空类的"标准答案"是结构化数组，需要摊平成每个空一个字符串。
//
// 【实测】服务端下发的是：
//   [{"group":"group_1","idx":"…","standardAnswer":"wild","val":"wild"},
//    {"group":"group_2","idx":"…","standardAnswer":"habitat(s)","val":"habitats; habitat"}, …]
// 而 applyAnswer 的填空分支按"字符串数组"逐空写入，直接喂会得到 "[object Object]"。
// 取值优先级：standardAnswer → val 的第一个分号项。
// 另外有些题是**答案多样**的主观填空（standardAnswer = "Answers will vary."），
// 这类无法自动作答，返回 null 交由调用方跳过。
const ANSWER_VARIES_RE = /answers?\s+will\s+vary|answers?\s+may\s+vary|言之有理|答案不唯一/i;

function normalizeFillAnswer(raw) {
    let v = raw;
    if (typeof v === 'string') {
        const s = v.trim();
        if (!s) return null;
        try { v = JSON.parse(s); } catch (e) { return s; }   // 普通文本答案
    }
    if (Array.isArray(v)) {
        const structured = v.some(x => x && typeof x === 'object' &&
            (x.standardAnswer !== undefined || x.val !== undefined));
        if (!structured) return v.map(x => String(x == null ? '' : x));
        const out = v.map(x => {
            if (!x || typeof x !== 'object') return String(x == null ? '' : x);
            const sa = String(x.standardAnswer == null ? '' : x.standardAnswer).trim();
            if (sa) return sa;
            const vals = String(x.val == null ? '' : x.val).split(';').map(t => t.trim()).filter(Boolean);
            return vals[0] || '';
        });
        // 全部为空、或出现"答案多样"提示 → 无法自动作答
        if (!out.some(s => s)) return null;
        if (out.some(s => ANSWER_VARIES_RE.test(s))) return null;
        return out;
    }
    if (v && typeof v === 'object') {
        const sa = String(v.standardAnswer == null ? '' : v.standardAnswer).trim();
        if (sa) return ANSWER_VARIES_RE.test(sa) ? null : sa;
        const vals = String(v.val == null ? '' : v.val).split(';').map(t => t.trim()).filter(Boolean);
        return vals[0] || null;
    }
    return v == null ? null : String(v);
}

// ============================================================================
// 6. AI 答题（支持 OpenAI 与 Anthropic 两种请求格式）
// ============================================================================

const AI_STORAGE_KEY = 'tsh_auto_brush_ai';
let aiConfig = { enabled: false, baseUrl: '', apiKey: '', model: '', format: 'auto' };
function loadAiConfig() {
    try { const s = localStorage.getItem(AI_STORAGE_KEY); if (s) aiConfig = Object.assign(aiConfig, JSON.parse(s)); } catch (e) {}
}
function saveAiConfig() {
    try { localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(aiConfig)); } catch (e) {}
}
function aiEnabled() { return !!(aiConfig.enabled && aiConfig.baseUrl && aiConfig.apiKey && aiConfig.model); }

// 请求格式：显式指定优先，否则按 baseUrl 推断。
// 含 /anthropic 的地址走 Messages 格式 —— 例如 DeepSeek 的
// https://api.deepseek.com/anthropic 与 CommandCode 的 /provider/v1（其模型只接受 Messages）。
// 【实测】CommandCode 对 /chat/completions 会直接报
//   Model "…" must be called via /provider/v1/messages (Anthropic Messages shape).
function aiFormat() {
    const f = aiConfig.format;
    if (f === 'anthropic' || f === 'openai') return f;
    return /anthropic|commandcode/i.test(aiConfig.baseUrl || '') ? 'anthropic' : 'openai';
}

// 组装端点：baseUrl 末尾已带 /v1 时不重复追加（两种填法都容错）
function aiEndpoint() {
    const base = (aiConfig.baseUrl || '').replace(/\/+$/, '');
    const hasVersion = /\/v\d+$/.test(base);
    if (aiFormat() === 'anthropic') return base + (hasVersion ? '/messages' : '/v1/messages');
    return base + (hasVersion ? '/chat/completions' : '/v1/chat/completions');
}

// 输出额度（max_tokens）。
//
// 【实测】推理模型会先用大量输出 token 写思维链，额度给小了会导致
// **思维链吃光额度、正文一个字都不产出**（stop_reason = max_tokens）：
//   max_tokens=4096  → thinking 17271 字，text 为空        ✗
//   max_tokens=8192  → thinking 5762 字 + 正文正常         ✓
//   max_tokens=32000 → 正常，但模型思考更久
// 所以默认给足；可用 aiConfig.maxTokens 覆盖。
function aiMaxTokens() {
    const n = Number(aiConfig.maxTokens);
    if (Number.isFinite(n) && n >= 1024) return Math.floor(n);
    return 16384;
}

async function aiAsk(prompt) {
    if (!aiEnabled()) return null;
    const fmt = aiFormat();
    const url = aiEndpoint();
    const ctrl = new AbortController();
    // 超时要给足：推理模型会先写很长的思维链，实测单次可达 15s 以上，
    // 25s 会在复杂题上误判为超时。
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
        let headers, body;
        if (fmt === 'anthropic') {
            // Anthropic Messages：鉴权用 x-api-key，另需 anthropic-version
            headers = {
                'Content-Type': 'application/json',
                'x-api-key': aiConfig.apiKey,
                'anthropic-version': '2023-06-01'
            };
            body = {
                model: aiConfig.model,
                max_tokens: aiMaxTokens(),
                temperature: 0.1,
                messages: [{ role: 'user', content: prompt }]
            };
            // 【实测】不要禁用思维链。
            // deepseek-flash 等推理模型会先输出很长的 thinking；禁用后虽然快（0.9s），
            // 但答案质量明显下降（把整句当答案，而非题目要的词/短语）。
            // 正确做法是**给足输出额度**让思维链自然跑完。
            // 至于「额度被思维链吃光导致无正文」：那是额度不足所致，
            // 实测 4096 时 thinking 17271 字把额度耗尽、text 为空；
            // 8192 起即正常产出，故默认取更大的值（见 aiMaxTokens()）。
            if (aiConfig.thinking === 'off') body.thinking = { type: 'disabled' };
        } else {
            headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + aiConfig.apiKey };
            body = {
                model: aiConfig.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: aiMaxTokens()
            };
        }
        const resp = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: ctrl.signal });
        if (!resp.ok) {
            let detail = '';
            try { detail = (await resp.text()).slice(0, 160); } catch (e) {}
            throw new Error('HTTP ' + resp.status + (detail ? ' ' + detail : ''));
        }
        const data = await resp.json();
        let c = '';
        if (fmt === 'anthropic') {
            // 只取 text 块；thinking 块不是答案正文
            c = Array.isArray(data && data.content)
                ? data.content.filter(x => x && x.type === 'text').map(x => x.text || '').join('')
                : '';
            if (!c.trim()) {
                const kinds = Array.isArray(data && data.content) ? data.content.map(x => x && x.type) : [];
                log('AI 无正文输出', 'stop=' + (data && data.stop_reason), 'blocks=' + JSON.stringify(kinds));
                return null;
            }
        } else {
            c = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
        }
        return typeof c === 'string' && c.trim() ? c.trim() : null;
    } catch (e) {
        status('AI 请求失败（' + (e.name === 'AbortError' ? '超时' : '网络') + '）');
        return null;
    } finally { clearTimeout(timer); }
}

// ---- AI 补答 ----
//
// 【登录态实测结论 · 2026-10-08，志愿者学生账号实测】
//   GET  /question/echo/content/{contentId}/answer
//        → questionVOList[].answer            恒为 ""（抽样 40 个内容项，40/40 为空）
//        → questionAnswerItemVOList[].answer  **仅在答错累计到 errorNumShow 次后**
//                                             由服务端下发标准答案（见 §11.3）
//   POST /question/submit/answer
//        → 响应 answer 同为 ""，只回 rightRate 表示对错
//
// 即：**标准答案不是没有，而是有门槛**。因此存在两条拿分的路：
//   · AI 补答（本条）—— 一次答对，最快
//   · 试错取答案（retryUntilAnswer）—— 站点直接给答案，但要先答错若干次
// 两者可并存：AI 优先，未覆盖的题再由试错兜底（仅限闯关模式）。
//
// 未配置 AI 且模式不安全时，脚本**不伪造作答**：提交空答案只会撞站点前端硬门禁
// （请完成所有习题后再提交），徒增无效请求 —— 此时明确停下并告知用户。

const AI_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const AI_FILL_TYPES = new Set([TYPE.FILL, TYPE.FILL_DIALOG, TYPE.FILL_IMAGE, TYPE.FILL_CLOZE, TYPE.FILL_CLOZE_MN]);
const AI_ESSAY_TYPES = new Set([TYPE.WRITING, TYPE.TRANSLATE, TYPE.QA]);

// 判断是否「主观题」——决定用 AI 还是用轮询。
//
// 【实测依据】两条路互补，混用只是浪费：
//   · 客观题（obSub === 'ob'）：服务端会下发权威 standardAnswer，轮询即可拿到，
//     且比 AI 更准（实测同一题 AI 五个空全错，轮询拿到的全对），且零 token 成本。
//   · 主观题（obSub === 'sub'）：answerStatus 恒为 -1，服务端**不下发答案**
//     （实测返回 "Answers will vary." 或整句参考），轮询对它完全无效 ——
//     这才是 AI 唯一真正必要的场景。
function isSubjective(q) {
    if (!q) return false;
    if (q.children && q.children.length) return q.children.some(isSubjective);
    if (String(q.obSub || '').toLowerCase() === 'sub') return true;
    return AI_ESSAY_TYPES.has(q.type);      // 写作 / 翻译 / 问答
}

function htmlToText(html) {
    if (!html) return '';
    const d = document.createElement('div');
    d.innerHTML = String(html);
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

// extension 在接口里是 JSON 字符串；fill_base 等题型为空串，解析失败返回 null
function parseExtension(q) {
    let ext = q && q.extension;
    if (ext === '' || ext === undefined || ext === null) return null;
    if (typeof ext === 'string') { try { return JSON.parse(ext); } catch (e) { return null; } }
    return ext;
}

// 填空题的空位数：题干里的 .zty-exercise-item-fill-blank / data-group-id
function countBlanks(q) {
    const html = String(q.stem || '');
    const m = html.match(/data-group-id=/g);
    return m ? m.length : 0;
}

// 构造给 AI 的题目描述；不支持的题型返回 null
function buildAIPrompt(q) {
    const type = q.type;
    const stem = htmlToText(q.stem || q.stemNoLabel || '');
    const ext = parseExtension(q);

    // 【关键】听力题的题干往往在音频里，文本 stem 为空 —— 但接口会把音频原文
    // 放在 attachmentList[].script，题干说明放在 instruction。
    // 不喂这两项，AI 只能瞎猜（实测 deepseek 会直接说「missing actual question」）。
    const context = [];
    if (q.instruction) {
        const ins = htmlToText(q.instruction);
        if (ins && ins !== stem) context.push('题目说明：' + ins);
    }
    const scripts = (q.attachmentList || [])
        .map(a => a && a.script ? htmlToText(a.script) : '')
        .filter(Boolean);
    if (scripts.length) context.push('听力原文/材料：\n' + scripts.join('\n---\n'));
    if (q.material) {
        const mat = htmlToText(q.material);
        if (mat) context.push('材料：' + mat);
    }

    if (type === TYPE.SINGLE || type === TYPE.MULTIPLE) {
        const opts = Array.isArray(ext) ? ext : [];
        if (!opts.length) return null;
        const L = [];
        L.push(type === TYPE.SINGLE ? '这是一道英语单选题（只有一个正确选项）。' : '这是一道英语多选题（可能有多个正确选项）。');
        if (stem) L.push('题目：' + stem);
        context.forEach(c => L.push(c));
        L.push('选项：');
        opts.forEach((o, i) => L.push(AI_LETTERS[i] + '. ' + htmlToText(o.val)));
        L.push('');
        L.push(type === TYPE.SINGLE
            ? '只回答一个选项字母，例如：B'
            : '只回答选项字母，多个用逗号分隔，例如：A,C。注意：多选题务必给出全部正确选项。');
        return L.join('\n');
    }

    if (type === TYPE.JUDGE) {
        const L = ['这是一道英语判断题。'];
        if (stem) L.push('题目：' + stem);
        context.forEach(c => L.push(c));
        L.push('');
        L.push('只回答 A 或 B：A 表示正确，B 表示错误。');
        return L.join('\n');
    }

    if (AI_FILL_TYPES.has(type)) {
        const n = countBlanks(q);
        const L = ['这是一道英语填空题，请根据句意填出每个空。'];
        if (stem) L.push('题目：' + stem);
        context.forEach(c => L.push(c));
        L.push('');
        L.push(n > 0
            ? '共有 ' + n + ' 个空。每行只写一个空的答案，不要编号，不要解释。'
            : '每行只写一个空的答案，不要编号，不要解释。');
        return L.join('\n');
    }

    if (AI_ESSAY_TYPES.has(type)) {
        const what = type === TYPE.WRITING ? '英语写作'
            : (type === TYPE.TRANSLATE ? '英汉互译' : '英语问答题');
        const L = ['这是一道' + what + '题，请直接给出答案正文。'];
        if (stem) L.push('题目：' + stem);
        context.forEach(c => L.push(c));
        L.push('');
        L.push('只输出答案正文本身，不要任何解释或前后缀。');
        return L.join('\n');
    }

    return null;
}

// 把 AI 的自由文本解析成 applyAnswer 需要的 value
function aiAnswerToValue(reply, q) {
    const type = q.type;
    const raw = String(reply == null ? '' : reply).trim();
    if (!raw) return null;
    const ext = parseExtension(q);

    if (type === TYPE.SINGLE || type === TYPE.MULTIPLE) {
        const opts = Array.isArray(ext) ? ext : [];
        // 优先匹配选项字母
        let letters = (raw.toUpperCase().match(/[A-Z]/g) || []).filter(l => AI_LETTERS.indexOf(l) >= 0);
        // 兜底：AI 直接回了选项原文
        if (!letters.length && opts.length) {
            const hits = [];
            opts.forEach((o, i) => { if (raw.indexOf(htmlToText(o.val)) >= 0) hits.push(i); });
            if (hits.length) {
                return type === TYPE.MULTIPLE ? hits.map(i => optionValue(opts, i)) : optionValue(opts, hits[0]);
            }
            return null;
        }
        if (!letters.length) return null;
        // 去重并保序
        letters = letters.filter((v, i) => letters.indexOf(v) === i);
        const vals = letters.map(l => optionValue(opts, AI_LETTERS.indexOf(l)));
        return type === TYPE.MULTIPLE ? vals : vals[0];
    }

    if (type === TYPE.JUDGE) {
        // 站点判断题的提交值是裸标量 "1"(正确) / "0"(错误)
        if (/^\s*(A|T|TRUE|对|正确|是)\b/i.test(raw) || /^(A|T)$/i.test(raw)) return '1';
        if (/^\s*(B|F|FALSE|错|错误|否)\b/i.test(raw) || /^(B|F)$/i.test(raw)) return '0';
        return null;
    }

    if (AI_FILL_TYPES.has(type)) {
        const parts = raw.split(/\r?\n/)
            .map(s => s.replace(/^\s*(?:\d+[.、)]|[-*])\s*/, '').trim())
            .filter(Boolean);
        if (!parts.length) return null;
        return parts.length > 1 ? parts : parts[0];
    }

    if (AI_ESSAY_TYPES.has(type)) {
        return { answer: raw, annex: [] };
    }

    return null;
}

// 选项 i 对应的站点提交值：优先 extension[].idx（实测为 UUID），缺失时退回下标
function optionValue(opts, i) {
    const o = opts[i];
    if (o && o.idx !== undefined && o.idx !== null && o.idx !== '') return String(o.idx);
    return String(i);
}

// 对给定题目逐题调用 AI 并写入 DOM
async function fillByAI(questions) {
    const items = getExerciseItems();
    const list = (currentResp && currentResp.questionVOList) || [];
    if (!items.length || !questions.length) return { filled: 0, total: questions.length, failed: [] };

    let filled = 0;
    const failed = [];
    for (const q of questions) {
        const card = items.find(c => c.dataset && Number(c.dataset.questionId) === Number(q.id))
            || items[list.findIndex(x => Number(x.id) === Number(q.id))];
        if (!card) { failed.push(q.type + '#' + q.id + '（未找到题卡）'); continue; }

        const prompt = buildAIPrompt(q);
        if (!prompt) { failed.push(q.type + '#' + q.id + '（题型暂未支持）'); continue; }

        const reply = await aiAsk(prompt);
        if (!reply) { failed.push(q.type + '#' + q.id + '（AI 无响应）'); continue; }

        const value = aiAnswerToValue(reply, q);
        if (value === null) { failed.push(q.type + '#' + q.id + '（答案解析失败）'); continue; }

        const ok = applyAnswer(card, q.type, value);
        if (ok) { markAnswered(q, value, card); filled++; } else failed.push(q.type + '#' + q.id + '（写入失败）');
        await sleep(rnd(400, 900));   // 控制节奏，避免触发站点限流
    }
    return { filled, total: questions.length, failed };
}

// ============================================================================
// 7. 章节推进
// ============================================================================

// 点击分页按钮：dir='next' | 'prev'
//
// 【关键契约，已证实】阅读器内部**完全不改 URL**（全文无 location/href/history 写入）。
// 翻页只改内存状态：左按钮 `Se--`、右按钮 `Se++`，由 watcher 触发滚动与内容切换。
// 因此 URL 变化**不能**作为翻页判据，只能靠页面内容签名与分页计数文本。
//
// 另：右按钮在下一条目 lock 为真时 `disabled`（闯关模式未达标），此时视为无法前进。
async function clickPagination(dir) {
    const btns = $(SEL.paginationBtn);
    if (!btns.length) return false;

    // 站点用 pagination-left / pagination-right 图标类区分方向
    let target = null;
    for (const b of btns) {
        const isLeft = !!$1('.pagination-left', b) || /left/i.test(b.className);
        const isRight = !!$1('.pagination-right', b) || /right/i.test(b.className);
        if (dir === 'next' && isRight) target = b;
        if (dir === 'prev' && isLeft) target = b;
    }
    // 兜底：最后一个按钮视为"下一页"
    if (!target && dir === 'next' && btns.length >= 2) target = btns[btns.length - 1];
    if (!target) return false;

    // 站点自身用 disabled 表达"不可前进"（含 lock 未解锁）
    if (target.disabled || target.getAttribute('disabled') !== null) return false;

    const beforeCounter = paginationCounter();
    const beforeSig = pageSignature();
    clickSeq(target);

    for (let i = 0; i < 30; i++) {
        await sleep(200);
        // 判据 1：分页计数文本变化（如 "3/42" → "4/42"）—— 最直接、最可靠
        const c = paginationCounter();
        if (c && c !== beforeCounter) return true;
        // 判据 2：页面内容签名变化（激活节点 / contentId / 正文长度）
        if (pageSignature() !== beforeSig) return true;
    }
    return false;
}

// 读取分页计数文本。
// 【登录态实测修正】原注释描述的
//   div[ button(左), span(计数), span.pagination-btn-wrap[button(右)] ]
// 与线上不符：.pagination-btn-wrap 命中数为 0。
// 实测真实结构为单一容器：
//   div.preview-pagination[ button.pagination-btn, button.pagination-btn, span.pagination-text ]
// 计数文本形如 "25/377"（实测样例）。
function paginationCounter() {
    // 优先：直接按站点类名取
    const direct = $1('.pagination-text');
    if (direct) {
        const s = (direct.textContent || '').trim();
        if (/^\d+\s*\/\s*\d+$/.test(s)) return s;
    }
    // 其次：从容器（.preview-pagination）的子节点里找 n/m 形态
    const wrap = $1(SEL.paginationWrap) || $1('.pagination-btn-wrap') || $1(SEL.paginationBtn);
    if (!wrap) return '';
    const parent = wrap.parentElement;
    for (const scope of [wrap, parent]) {
        if (!scope) continue;
        for (const c of Array.from(scope.children)) {
            const s = (c.textContent || '').trim();
            if (/^\d+\s*\/\s*\d+$/.test(s)) return s;
        }
    }
    // 兜底：从容器自身文本里提取
    const m = (wrap.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
    return m ? m[0] : '';
}

// 页面内容签名：用于判断翻页是否真的生效（不依赖 URL 变化）
function pageSignature() {
    const activeChapter = $1('.chapter-section.active, .chapter-section.course.active, .chapter-section[data-active="true"]');
    const firstItem = $1(SEL.contentItem);
    const counter = paginationCounter();
    return [
        activeChapter && activeChapter.dataset && activeChapter.dataset.catalogId,
        firstItem && firstItem.dataset && firstItem.dataset.contentId,
        counter,
        $1(SEL.exercisePreview) ? getExerciseItems().length : 0,
        // 内容文本长度作为兜底信号（整章滚动时文本会变）
        ($1(SEL.readerRoot) ? ($1(SEL.readerRoot).textContent || '').length : 0)
    ].join('|');
}

// 通过路由跳转到指定 catalog（DOM 翻页失败时的兜底）
function gotoCatalog(catalogId, contentId) {
    const r = parseReaderRoute();
    if (!r) return false;
    const q = new URLSearchParams();
    q.set('catalogId', String(catalogId));
    if (contentId) q.set('contentId', String(contentId));
    location.href = '/course_center/reader/' + r.type + '/' + r.bizId + '?' + q.toString();
    return true;
}

// ============================================================================
// 8. 答题主流程
// ============================================================================

let lastAnswerMap = new Map();  // 最近一次取题拿到的标准答案
let currentResp = null;         // 最近一次取题响应

// 复刻站点 T()/E()：把 questionAnswerItemVOList 合并进 questionVOList 元素。
//
// 【为什么必须做】`doRecord` / `overWriteUserAnswer` / `userAnswer` 只存在于
// questionAnswerItemVOList 的元素上；questionVOList 的元素里根本没有这些字段。
// 站点前端会先把两者按 questionId 合并（见 src-DZ23PK2 的 T/E），再据此判断
// 「这题答过没有」。引擎此前漏了这一步，导致 hasUserAnswer() 恒为 false ——
// 已作答的题也会被当成未答，从而反复重做。
function mergeAnswerItems(data) {
    if (!data) return data;
    const list = data.questionVOList || [];
    const items = data.questionAnswerItemVOList || [];
    const byId = new Map();
    items.forEach(it => byId.set(Number(it.questionId), it));
    const apply = (q) => {
        const n = byId.get(Number(q.id));
        if (n) {
            q.doRecord = n.overWriteUserAnswer || n.userAnswer || '';
            q.answer = n.answer || '';
            q.answerStatus = n.answerStatus;
            q.analysis = n.analysis;
            q.assessStatus = n.assessStatus;
        }
        if (q.children && q.children.length) q.children.forEach(apply);
    };
    list.forEach(apply);
    return data;
}

// 拉取当前章节题目（含标准答案）
async function loadCurrentExercise() {
    const r = parseReaderRoute();
    if (!r || !r.contentId) return null;
    const resp = await apiGetExercise(r.contentId, r.contentType, r.bizId, null);
    if (!resp || resp.code !== 200 || !resp.data) {
        status('取题失败：' + (resp && resp.message ? resp.message : '未知错误'));
        return null;
    }
    mergeAnswerItems(resp.data);        // ← 先合并，hasUserAnswer() 才能正确判断
    currentResp = resp.data;
    lastAnswerMap = buildAnswerMap(resp.data);
    const n = (resp.data.questionVOList || []).length;
    const k = lastAnswerMap.size;
    const done = (resp.data.questionVOList || []).filter(hasUserAnswer).length;
    log('取题成功：题目 ' + n + '，已答 ' + done + '，答案条目 ' + k, resp.data);
    return resp.data;
}

// 判断某道题是否已有作答
// 判定某道题（含子题）是否已有作答。
// 站点契约：createDoRecord 按题型给空初值 —— 裸串题型为 ''，多数题型为 []，
// 主观题为 {answer:'',annex:[]}，角色扮演为 {roleId:'',answer:[]}。
// 组合题需递归看子题。
function hasUserAnswer(q) {
    if (!q) return false;
    if (q.children && q.children.length) {
        return q.children.some(hasUserAnswer);
    }
    const type = q.type;
    const raw = (q.doRecord !== undefined && q.doRecord !== null && q.doRecord !== '')
        ? q.doRecord
        : q.overWriteUserAnswer || q.userAnswer || '';

    if (raw === '' || raw === null || raw === undefined) return false;

    let v = raw;
    if (typeof v === 'string' && !BARE_SCALAR_TYPES.has(type)) {
        const s = v.trim();
        if (!s) return false;
        try { v = JSON.parse(s); } catch (e) { return true; }   // 非 JSON 的裸串视为已答
    }
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') {
        // 主观题 {answer, annex} / 角色扮演 {roleId, answer}
        const ans = v.answer;
        if (Array.isArray(ans)) return ans.length > 0;
        if (typeof ans === 'string') return ans.trim().length > 0;
        if (ans !== undefined && ans !== null) return true;
        return Object.keys(v).some(k => {
            const x = v[k];
            if (Array.isArray(x)) return x.length > 0;
            if (typeof x === 'string') return x.trim().length > 0;
            return x !== undefined && x !== null;
        });
    }
    return true;
}

// 用标准答案填充当前页面所有题卡
async function fillByAnswerMap() {
    const items = getExerciseItems();
    if (!items.length) return { filled: 0, total: 0 };
    if (!lastAnswerMap.size) return { filled: 0, total: items.length };

    const list = (currentResp && currentResp.questionVOList) || [];
    let filled = 0;

    for (let i = 0; i < items.length; i++) {
        const card = items[i];
        const q = list[i] || list.find(x => Number(x.id) === Number(card.dataset.questionId));
        if (!q) continue;

        const type = q.type || detectType(card);
        const ans = lastAnswerMap.get(Number(q.id));
        if (!ans || ans.answer === undefined || ans.answer === null || ans.answer === '') continue;

        // 填空类的答案是结构化数组，需要摊平；"答案多样"的主观填空返回 null 跳过
        const value = AI_FILL_TYPES.has(type) ? normalizeFillAnswer(ans.answer) : decodeAnswer(ans.answer, type);
        if (value === null || value === undefined) continue;

        const ok = applyAnswer(card, type, value);
        if (ok) { markAnswered(q, value, card); filled++; }
        await sleep(rnd(120, 260));
    }
    return { filled, total: items.length };
}

// 按题型把答案写入 DOM
// 取出卡片内各选项对应的"提交值"。
// 关键证据（src-DqZ23PK2.js，SingleChoiceCourseDone / 判断分支）：
//   <RadioGroup value={doRecord}>
//     {extension.map((e,t) => <Radio value={e.idx}>{yO(t)}. {e.val}</Radio>)}   // 显示字母，值却是 idx
//     判断题特例：<Radio value="1">A、正确</Radio> <Radio value="0">B、错误</Radio>
//   单选回显：extension.findIndex(t => t.idx === answer)
//   多选回显：Array.isArray(answer) && answer.includes(e.idx)
// 即 answer / doRecord 的线格式是 option 的 **idx 值**，不是字母。
// 因此优先读 DOM 上真实的 input.value 来匹配，而不是猜字母映射。
function getOptionValues(card) {
    const opts = getOptions(card);
    return opts.map((o, i) => {
        const input = $1('input', o);
        if (input && input.value !== undefined && input.value !== '') return String(input.value);
        const radio = $1('[value]', o);
        if (radio && radio.getAttribute('value') !== null) return String(radio.getAttribute('value'));
        return String(i);
    });
}

// 把答案值解析为"要点击的选项下标"列表。
// 兼容三种形态：站点 idx 值、字母 A/B、纯下标。
function resolveOptionIndexes(card, value) {
    const opts = getOptions(card);
    if (!opts.length) return [];
    const values = getOptionValues(card);
    const raws = Array.isArray(value) ? value : [value];
    const out = [];
    for (const raw of raws) {
        if (raw === undefined || raw === null) continue;
        const s = String(raw).trim();
        if (!s) continue;
        // 1) 直接匹配 DOM 上的提交值（最可靠）
        let idx = values.indexOf(s);
        // 2) 数字形态：先当 idx 值匹配，再当 0-based 下标
        if (idx < 0 && /^\d+$/.test(s)) {
            const n = Number(s);
            idx = values.indexOf(String(n));
            if (idx < 0 && n >= 0 && n < opts.length) idx = n;
        }
        // 3) 字母形态：转 0-based 下标（仅当答案确实用字母表示时）
        if (idx < 0 && /^[A-Za-z]$/.test(s)) {
            const n = s.toUpperCase().charCodeAt(0) - 65;
            if (n >= 0 && n < opts.length) idx = n;
        }
        // 4) 布尔/中文形态（判断题）
        if (idx < 0) {
            if (/^(true|对|正确|1)$/i.test(s)) idx = values.indexOf('1') >= 0 ? values.indexOf('1') : 0;
            else if (/^(false|错|错误|0)$/i.test(s)) idx = values.indexOf('0') >= 0 ? values.indexOf('0') : 1;
        }
        if (idx >= 0 && idx < opts.length && out.indexOf(idx) < 0) out.push(idx);
    }
    return out;
}

// ---- 拖拽类作答（matching_onetoonedrag / matching_onetomanydrag / matching_dragfillblank）----
//
// 【站点契约，已证实】事件序列（DragDropOneCourseDo @855532 / 组合式函数 MR @844180）：
//   dragstart  → dataTransfer.setData('text/plain', item.idx)，effectAllowed='move'
//   dragover   → preventDefault()，dropEffect='move'
//   dragenter  → 记录 activeDropZoneId
//   drop       → 读 dataTransfer.getData('text/plain') 写入 answer
//
// 投放区结构：div.drag-drop-container > div.drop-zone-list > div.drop-zone-item-wrapper
//             （绑定 onDrop / onDragover / onDragenter / onDragleave）
// 可拖项结构：div.drag-item-list > div.drag-item.drag-item-with-handle[draggable="true"]
//             （绑定 onDragstart / onDragend）
//
// 字段语义（与命名直觉相反，以代码为准）：
//   extension.drag    → 投放目标（drop-zone-item-wrapper）
//   extension.dragged → 可拖拽项（drag-item[draggable]）
//
// answer 形状：
//   onetoonedrag / onetomanydrag → [{ idx:"<投放区idx>", answer:["<拖拽项idx>", ...] }]
//   dragfillblank                → [{ idx:"<blankId>",  answer:"<拖拽项idx>" }]（扁平）
function applyDragAnswer(card, type, value) {
    try {
        const pairs = normalizeDragPairs(type, value);
        if (!pairs.length) return false;

        if (type === TYPE.DRAG_FILL) {
            // 拖拽填空：目标是题干内的 span.blank-placeholder[data-blank-id]
            let any = false;
            pairs.forEach(p => {
                const target = $1('.blank-placeholder[data-blank-id="' + p.zone + '"], .inline-answer[data-blank-id="' + p.zone + '"]', card);
                const src = findDragSource(card, p.item);
                if (target && src) { simulateDragDrop(src, target, p.item); any = true; }
            });
            return any;
        }

        // 普通拖拽：目标是 div.drop-zone-item-wrapper（按 extension.drag 的 idx 匹配）
        const zones = $('.drop-zone-item-wrapper', card);
        if (!zones.length) return false;
        let any = false;
        pairs.forEach(p => {
            const zone = findDropZone(card, zones, p.zone);
            const src = findDragSource(card, p.item);
            if (zone && src) { simulateDragDrop(src, zone, p.item); any = true; }
        });
        return any;
    } catch (e) {
        log('拖拽作答失败', type, e);
        return false;
    }
}

// 归一化拖拽答案为 [{zone, item}]，兼容两种站点形状
function normalizeDragPairs(type, value) {
    const out = [];
    let v = value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return out; } }
    if (!Array.isArray(v)) return out;
    v.forEach(entry => {
        if (!entry || entry.idx === undefined) return;
        const zone = String(entry.idx);
        if (type === TYPE.DRAG_FILL) {
            // 扁平：answer 是单项字符串
            const it = Array.isArray(entry.answer) ? entry.answer[0] : entry.answer;
            if (it !== undefined && it !== null && it !== '') out.push({ zone, item: String(it) });
        } else {
            const arr = Array.isArray(entry.answer) ? entry.answer : [entry.answer];
            arr.forEach(it => {
                if (it !== undefined && it !== null && it !== '') out.push({ zone, item: String(it) });
            });
        }
    });
    return out;
}

// 按 extension.drag 的顺序找到投放区（站点按 extension.drag 渲染 drop-zone-item-wrapper）
function findDropZone(card, zones, zoneIdx) {
    // 优先：按 data 属性匹配（若站点渲染了 idx）
    const byData = $1('[data-idx="' + zoneIdx + '"]', card) ||
        $1('[data-drop-zone-idx="' + zoneIdx + '"]', card);
    if (byData) return byData;
    // 兜底：按 extension.drag 数组下标定位
    const ext = getCardExtension(card);
    if (ext && Array.isArray(ext.drag)) {
        const i = ext.drag.findIndex(d => String(d.idx) === zoneIdx);
        if (i >= 0 && zones[i]) return zones[i];
    }
    return null;
}

// 找到可拖拽项元素（按 extension.dragged 的 idx 定位到 div.drag-item[draggable]）
function findDragSource(card, itemIdx) {
    const draggables = $('.drag-item[draggable="true"], .drag-item', card);
    if (!draggables.length) return null;
    const byData = $1('[data-idx="' + itemIdx + '"]', card);
    if (byData) return byData;
    const ext = getCardExtension(card);
    if (ext && Array.isArray(ext.dragged)) {
        const i = ext.dragged.findIndex(d => String(d.idx) === itemIdx);
        if (i >= 0 && draggables[i]) return draggables[i];
    }
    return null;
}

// 从当前题目数据里取 extension（可能为 JSON 字符串）
function getCardExtension(card) {
    const list = (currentResp && currentResp.questionVOList) || [];
    const id = card && card.dataset ? card.dataset.questionId : null;
    const q = (id && list.find(x => Number(x.id) === Number(id))) ||
        list[getExerciseItems().indexOf(card)];
    if (!q) return null;
    let ext = q.extension;
    if (typeof ext === 'string') { try { ext = JSON.parse(ext); } catch (e) { return null; } }
    return ext || null;
}

// 构造并派发完整 DnD 事件序列（含 dataTransfer 桩，因为脚本无法持有真实 DataTransfer）
function simulateDragDrop(srcEl, dstEl, payload) {
    const dt = makeDataTransfer();
    dt.setData('text/plain', String(payload));

    fireDragEvent(srcEl, 'dragstart', dt);
    fireDragEvent(dstEl, 'dragenter', dt);
    fireDragEvent(dstEl, 'dragover', dt);
    fireDragEvent(dstEl, 'drop', dt);
    fireDragEvent(srcEl, 'dragend', dt);
    return true;
}

// 最小 DataTransfer 实现（站点只用到 setData/getData/effectAllowed/dropEffect）
function makeDataTransfer() {
    const store = {};
    return {
        effectAllowed: '',
        dropEffect: '',
        files: [],
        types: [],
        setData(k, v) { store[k] = String(v); if (this.types.indexOf(k) < 0) this.types.push(k); },
        getData(k) { return store[k] === undefined ? '' : store[k]; },
        clearData() { Object.keys(store).forEach(k => delete store[k]); },
        setDragImage() {}
    };
}

// 派发拖拽事件并挂上 dataTransfer（DragEvent 在部分环境不可构造，退回 Event + 属性注入）
function fireDragEvent(el, type, dt) {
    if (!el) return false;
    let ev;
    try {
        ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
    } catch (e) {
        ev = new Event(type, { bubbles: true, cancelable: true });
    }
    // 兜底：确保 dataTransfer 一定可读（站点直接读 e.dataTransfer）
    try {
        if (!ev.dataTransfer) Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    } catch (e) {}
    el.dispatchEvent(ev);
    return true;
}

// 按题型把答案写入 DOM
function applyAnswer(card, type, value) {
    try {
        switch (type) {
            case TYPE.SINGLE:
            case TYPE.JUDGE: {
                const idxs = resolveOptionIndexes(card, value);
                if (!idxs.length) return false;
                return selectOption(getOptions(card)[idxs[0]]);
            }
            case TYPE.JUDGE_HIGH: {
                // 多小题判断：doRecord 是数组（每子题一个答案），不是裸标量
                const arr = Array.isArray(value) ? value : [value];
                const rows = $('.judge-option-item', card);
                if (!rows.length) return false;
                let any = false;
                rows.forEach((row, i) => {
                    if (arr[i] === undefined) return;
                    // 【登录态实测修正】.option-line 线上不存在，优先 antd 选项容器
                    const opts = $('.ant-radio-wrapper', row).length ? $('.ant-radio-wrapper', row)
                        : ($('.option-line', row).length ? $('.option-line', row) : $('label', row));
                    const idxs = resolveOptionIndexes(row, arr[i]);
                    if (idxs.length && opts[idxs[0]]) { selectOption(opts[idxs[0]]); any = true; }
                });
                return any;
            }
            case TYPE.MULTIPLE: {
                const idxs = resolveOptionIndexes(card, value);
                if (!idxs.length) return false;
                const opts = getOptions(card);
                let any = false;
                for (const i of idxs) { if (selectOption(opts[i])) any = true; }
                return any;
            }
            case TYPE.FILL:
            case TYPE.FILL_DIALOG:
            case TYPE.FILL_IMAGE:
            case TYPE.FILL_CLOZE:
            case TYPE.FILL_CLOZE_MN: {
                const blanks = $('.zty-exercise-item-fill-blank-do', card);
                if (!blanks.length) {
                    const inputs = $('input[type="text"], input:not([type])', card);
                    if (!inputs.length) return false;
                    const arr = Array.isArray(value) ? value : [value];
                    inputs.forEach((inp, i) => { if (arr[i] !== undefined) fillInput(inp, String(arr[i])); });
                    return true;
                }
                const arr = Array.isArray(value) ? value
                    : (value && typeof value === 'object' ? Object.values(value) : String(value).split('|'));
                blanks.forEach((b, i) => { if (arr[i] !== undefined) fillEditable(b, String(arr[i])); });
                return true;
            }
            case TYPE.DROP_PARA:
            case TYPE.DROP_IMG: {
                const selects = $('.ant-select', card);
                if (!selects.length) return false;
                const arr = Array.isArray(value) ? value : [value];
                selects.forEach((sel, i) => {
                    if (arr[i] === undefined) return;
                    clickSeq(sel);
                    const opt = $('.ant-select-item-option')[Number(arr[i]) - 1] || $('.ant-select-item-option')[0];
                    if (opt) clickSeq(opt);
                });
                return true;
            }
            case TYPE.WRITING:
            case TYPE.TRANSLATE:
            case TYPE.QA:
            case TYPE.CORRECT: {
                // 主观题：doRecord 形态为 {answer, annex}；答案是文本
                const text = (value && typeof value === 'object' && !Array.isArray(value))
                    ? (value.answer || '')
                    : (Array.isArray(value) ? value.join('') : String(value || ''));
                if (!String(text).trim()) return false;
                const ta = $1('textarea', card);
                if (ta) return fillInput(ta, String(text));
                const ce = $1('[contenteditable="true"]', card) ||
                    $1('.zty-exercise-item-fill-blank-do', card);
                if (ce) return fillEditable(ce, String(text));
                const inp = $1('input[type="text"], input:not([type])', card);
                if (inp) return fillInput(inp, String(text));
                return false;
            }
            case TYPE.DRAG_ONE:
            case TYPE.DRAG_MANY:
            case TYPE.DRAG_FILL: {
                return applyDragAnswer(card, type, value);
            }
            default:
                // 未适配题型：记录但不阻断
                return false;
        }
    } catch (e) {
        log('填充失败', type, e);
        return false;
    }
}

// 点击提交按钮（antd a-button，文案 Submit）
function findSubmitButton() {
    const btns = $('button.ant-btn, button', $1(SEL.exercisePreview) || document);
    for (const b of btns) {
        const t = (b.textContent || '').trim();
        if (/^Submit$/i.test(t) || /^提交$/.test(t)) return b;
    }
    return null;
}
function findRetryButton() {
    const btns = $('button.ant-btn, button', $1(SEL.exercisePreview) || document);
    for (const b of btns) {
        const t = (b.textContent || '').trim();
        if (/^Retry$/i.test(t) || /^重做$/.test(t)) return b;
    }
    return null;
}

// 提交：优先走页面真实按钮（保证站点状态机同步），失败则回退到直接调接口
async function submitAnswers() {
    const btn = findSubmitButton();
    if (btn && !btn.disabled) {
        clickSeq(btn);
        await sleep(rnd(900, 1500));
        return true;
    }
    // 无按钮（可能未答完/已提交）：尝试直接调接口
    const r = parseReaderRoute();
    if (!r || !r.contentId || !currentResp) return false;
    const qs = currentResp.questionVOList || [];
    if (!qs.length) return false;
    const map = new Map();
    // 优先取 questionVOList 上的 doRecord（包含刚刚填充的作答），再退回 answerItem。
    // 顺序不能反 —— 否则刚填的内容会被服务端的旧值盖掉。
    (currentResp.questionVOList || []).forEach(q => {
        const id = Number(q.id);
        if (q.doRecord !== undefined && q.doRecord !== null && q.doRecord !== '') {
            map.set(id, q.doRecord);
            return;
        }
        const it = (currentResp.questionAnswerItemVOList || []).find(x => Number(x.questionId) === id);
        if (it) map.set(id, it.overWriteUserAnswer || it.userAnswer || it.answer || '');
    });
    const questionItemList = flattenForSubmit(qs, map);
    const payload = { bizId: r.bizId, contentType: r.contentType, catalogId: r.catalogId, contentId: r.contentId, questionItemList };
    const resp = await apiSubmitAnswer(payload);
    if (resp && resp.code === 200) {
        currentResp.questionAnswerItemVOList = resp.data || currentResp.questionAnswerItemVOList;
        lastAnswerMap = buildAnswerMap(currentResp);
        await apiMarkContentDone(r.bizId, r.catalogId, r.contentId);
        return true;
    }
    status('提交失败：' + (resp && resp.message ? resp.message : '未知'));
    return false;
}

// 展平组合题（复刻站点 le() 行为）
function flattenForSubmit(list, answerMap) {
    const out = [];
    (list || []).forEach(q => {
        if (q.children && q.children.length) {
            out.push(...flattenForSubmit(q.children, answerMap));
            return;
        }
        out.push({ questionId: Number(q.id), userAnswer: answerMap.get(Number(q.id)) || '' });
    });
    return out;
}

// ---- 试错取答案（仅在「成绩记最高」的模式下自动启用）----
//
// 【机制，实测】服务端只在作答次数累计到 errorNumShow 次后，才在
// questionAnswerItemVOList[].answer 下发标准答案（见 DEVELOPMENT §11.3）。
// 因此必须先制造「答错」，才可能拿到答案。
//
// 【风险控制 —— 本函数只允许在闯关模式下调用】
// 自由模式记「末次」：试错中途的错误提交会成为最终成绩，只有最后一次答对才能挽回；
// 若中途因限流或页面变动而中断，成绩就停在错误值上。
// 闯关模式记「最高」：反复提交不会拉低成绩，试错无副作用。
// 调用方必须先经 strategyOf() 判定 retrySafe。
//
// 【闭环要求】拿到答案后**必须再提交一次正确答案**，否则成绩仍是上一次的错误值。

// 给未作答的题填一个"占位答案"，使站点的前端硬门禁（请完成所有习题后再提交）得以通过
function fillPlaceholder(card, type) {
    try {
        if (type === TYPE.SINGLE || type === TYPE.MULTIPLE || type === TYPE.JUDGE) {
            const opts = getOptions(card);
            if (!opts.length) return false;
            return selectOption(opts[0]);
        }
        if (type === TYPE.FILL || type === TYPE.FILL_DIALOG || type === TYPE.FILL_IMAGE ||
            type === TYPE.FILL_CLOZE || type === TYPE.FILL_CLOZE_MN) {
            const blanks = $('.zty-exercise-item-fill-blank-do', card);
            if (blanks.length) { blanks.forEach(b => fillEditable(b, 'a')); return true; }
            const inputs = $('input[type="text"], input:not([type])', card);
            if (inputs.length) { inputs.forEach(i => fillInput(i, 'a')); return true; }
            return false;
        }
        if (AI_ESSAY_TYPES.has(type)) {
            const ta = $1('textarea', card) || $1('[contenteditable="true"]', card);
            if (ta) { fillInput(ta, 'a'); return true; }
            return false;
        }
        return false;   // 其余题型（拖拽等）无法用占位通过，交由调用方跳过
    } catch (e) {
        return false;
    }
}

// 确保题目处于「作答态」。
//
// 【实测】已作答的题会渲染成**查看态**：填空题的元素是
// span.zty-exercise-item-fill-blank-**done**（done），而不是 zty-exercise-item-fill-blank-**do**（do）。
// 查看态下题卡没有可写的作答元素，直接填答案会「写入 0 个空」而静默失败，
// 随后提交的仍是上一轮的旧答案 —— 表现为「拿到了服务端标准答案却拿不到分」。
// 必须先点 Retry 回到作答态。
async function ensureEditableState() {
    if ($1('.zty-exercise-item-fill-blank-do, .ant-radio-wrapper, .option-content, .drag-drop-container')) {
        return true;                       // 已有可写作答元素
    }
    const retry = findRetryButton();
    if (!retry || retry.disabled) return false;
    clickSeq(retry);
    await sleep(rnd(1500, 2600));
    return !!$1('.zty-exercise-item-fill-blank-do, .ant-radio-wrapper, .option-content, .drag-drop-container');
}

// 循环：填占位 → 提交 → 重新取题 → 直到服务端下发答案 → 填正确答案 → 再提交一次
async function retryUntilAnswer(route, questions, threshold) {
    if (!Number.isFinite(threshold)) return false;
    const maxCalls = threshold + 3;

    for (let calls = 0; calls < maxCalls; calls++) {
        const map = buildAnswerMap(currentResp);
        // "答案可用"= 有答案，且填空题的答案能真正摊平成每空一项。
        // 注意：主观填空可能下发 "Answers will vary."，非空但无法作答，
        // 只看非空会误判为"已齐"从而卡住。
        const usable = (q) => {
            const a = map.get(Number(q.id));
            if (!a || !a.answer) return false;
            if (AI_FILL_TYPES.has(q.type)) return normalizeFillAnswer(a.answer) !== null;
            return true;
        };
        const missing = questions.filter(q => !usable(q));

        if (!missing.length) {
            // 答案已齐 → 先回到作答态（查看态下无法写入），再填入并提交
            if (!(await ensureEditableState())) {
                log('无法进入作答态，放弃回填');
                return false;
            }
            const r = await fillByAnswerMap();
            log('试错取得答案，回填', r);
            if (!r.filled) return false;
            await sleep(rnd(400, 800));
            if (questions.filter(q => !hasUserAnswer(q)).length) return false;
            await submitAnswers();
            return true;
        }

        // 尚未下发答案 → 只为**真正没作答的**题补占位，然后提交以累计作答次数。
        //
        // 【关键】不能对已有作答的题填占位：AI 可能已经答对，占位会把它盖掉。
        // 只补空位，其余保持原样，这样每轮提交都保住当前最好结果。
        // 注意：AI 已填满时没有空位可补，但**仍然要提交**才能累计次数，
        // 因此这里不能用"是否补了占位"作为继续条件。
        const items = getExerciseItems();
        questions.forEach((q, i) => {
            if (hasUserAnswer(q)) return;                    // 已作答（含 AI 刚填的）→ 不动
            const card = items.find(c => c.dataset && Number(c.dataset.questionId) === Number(q.id)) || items[i];
            if (card && fillPlaceholder(card, q.type)) markAnswered(q, 'a', card);
        });
        if (!items.length) return false;
        if (questions.some(q => !hasUserAnswer(q))) return false;   // 仍有无法写入的题

        await sleep(rnd(600, 1200));                          // 节流：站点无退避，必须自控节奏
        const ok = await submitAnswers();
        if (!ok) return false;
        status('试错取答案 第 ' + (calls + 1) + '/' + maxCalls + ' 次（服务端在答错 ' + threshold + ' 次后下发答案）');

        await sleep(rnd(1600, 2800));
        if (!(await loadCurrentExercise())) return false;     // 重新取题，看答案是否已下发
    }
    return false;
}

// ============================================================================
// 9. 学习时长（防空闲熔断）
// ============================================================================
//
// 【关键契约，已证实】站点**自身**已经在自动上报时长，无需脚本代劳：
//   Be(){ F.value = setInterval(() => { ze() || onSaveStudyTime(catalogId) }, 1e4) }   // 每 10 秒
//   function ze(){ return Date.now() - Le >= Ede }                                     // Ede = 6e5
//   Le 由 mousedown/mousemove/wheel/keydown/touchstart/touchmove/scroll 重置
//
// 即：只要页面开着且**用户在 10 分钟内有任何交互**，站点自己就会上报。
// 空闲 ≥ 10 分钟则跳过本次上报（熔断）。
//
// 因此脚本的正确职责不是"代刷"，而是**防止空闲熔断**：周期性派发无害的用户活动
// 事件，让站点自身的计时器保持活跃。这比直接重放上报接口更稳妥——
// 上报接口体 {bizId, contentType, catalogId} 与站点完全一致，
// 但由页面自己按节奏发出，不会产生异常密集的请求。
const STUDY_ACTIVITY_INTERVAL_MS = 60000;   // 每分钟轻推一次，远低于 10 分钟熔断阈值
const STUDY_ACTIVITY_EVENTS = ['mousemove', 'wheel', 'keydown', 'scroll'];

let studyTimer = null;
let studyCount = 0;

function keepAliveTick() {
    // 派发 capture 阶段的用户活动事件（站点以 {capture:true, passive:true} 监听）
    for (const name of STUDY_ACTIVITY_EVENTS) {
        try {
            const ev = name === 'keydown'
                ? new KeyboardEvent(name, { bubbles: true, cancelable: true })
                : (name === 'wheel'
                    ? new WheelEvent(name, { bubbles: true, cancelable: true, deltaY: 0 })
                    : new MouseEvent(name, { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
            window.dispatchEvent(ev);
        } catch (e) { /* 事件构造失败不致命 */ }
    }
    studyCount++;
    status('保活中 第' + studyCount + ' 次（防 10 分钟空闲熔断，站点自身每 10s 上报）');
}

function startStudyFarm() {
    if (studyTimer) return;
    const r = parseReaderRoute();
    if (!r) { status('请先进入阅读器页面再开启时长保活'); return; }
    studyCount = 0;
    keepAliveTick();   // 立即推一次，避免刚开启就处于空闲态
    studyTimer = setInterval(() => {
        if (!parseReaderRoute()) { stopStudyFarm(); return; }
        keepAliveTick();
    }, STUDY_ACTIVITY_INTERVAL_MS);
    status('时长保活已开启（站点自身每 10s 上报，本功能仅防空闲熔断）');
}
function stopStudyFarm() {
    if (studyTimer) { clearInterval(studyTimer); studyTimer = null; }
    studyCount = 0;
}

// 主动补一次时长上报（可选，用于页面切走等场景的兜底）
async function reportStudyTimeOnce() {
    const r = parseReaderRoute();
    if (!r || !r.catalogId) return false;
    const resp = await apiSaveStudyTime(r.bizId, r.contentType, r.catalogId);
    return !!(resp && resp.code === 200);
}

// ============================================================================
// 9b. 运行环境自检（装错版本的友好提示）
// ============================================================================
//
// 站点是双轨的：/legacy/ 是 Angular 旧站，/course_center/reader/ 才是本脚本适配的新版。
// 平台按账号属性分流（uc.izhixue.cn 返回 type=3 的账号会被送往旧站）。
// 装错版本时脚本不会报错、也不会做任何事 —— 所以在面板上明确说明，避免用户困惑。
function detectEnvironment() {
    const path = location.pathname;
    if (/^\/legacy\//.test(path) || path.indexOf('/legacy') === 0) {
        return {
            kind: 'legacy',
            msg: '检测到旧站（/legacy/）——本版 v' + SCRIPT_VERSION +
                 ' 只适配新版。旧站请改用 v1.1.2。'
        };
    }
    if (/\/course_center\/reader\//i.test(path)) {
        return { kind: 'reader', msg: '新版阅读器 —— 环境正常' };
    }
    if (/\/course_center\//.test(path)) {
        return { kind: 'course_center', msg: '课程中心 —— 请进入具体教材/课程章节' };
    }
    return { kind: 'other', msg: '非教材页面' };
}

// ============================================================================
// 10. 成绩查询（新站接口）
// ============================================================================

// 新站成绩接口：/course/{courseId}/study/situation/overview 与 /course/{id}/class/base/info
async function fetchScore() {
    const r = parseReaderRoute();
    if (!r) return null;
    const courseId = r.contentType === CT.STUDENT_COURSE ? r.bizId : null;
    if (!courseId) return { unsupported: true };

    const overview = await api('/course/' + courseId + '/study/situation/overview', { params: {} });
    const base = await api('/course/' + courseId + '/class/base/info', { params: {} });
    if (!overview || overview.code !== 200) {
        return { error: overview && overview.message ? overview.message : '查询失败' };
    }
    return { overview: overview.data, base: base && base.data };
}

function formatScore(d) {
    if (!d) return '查询失败（需在课程阅读器页面且已登录）';
    if (d.unsupported) return '成绩查询仅支持「学生课程」，当前为教材页面';
    if (d.error) return '查询失败：' + d.error;
    const lines = [];
    if (d.base) {
        lines.push('课程：' + (d.base.courseName || d.base.name || '—'));
    }
    const o = d.overview || {};
    const flat = (obj, prefix) => {
        Object.entries(obj || {}).forEach(([k, v]) => {
            if (v === null || v === undefined) return;
            if (typeof v === 'object') return; // 只展示一层标量
            lines.push((prefix ? prefix + '.' : '') + k + ': ' + v);
        });
    };
    flat(o, '');
    if (lines.length <= 1) lines.push('接口返回：' + JSON.stringify(o).slice(0, 400));
    return lines.join('\n');
}

// ============================================================================
// 11. 结构自检（关键：作者无法登录实测，交由用户反馈）
// ============================================================================
//
// 设计要点（来自 issue #2 的实测反馈）：
//   1. 统计前先等渲染稳定 —— 首轮自检曾只数到 2 个题卡，实际有 17 个；
//      若照首轮结果推进，只会处理 2/17 的内容。
//   2. 输出「DOM 快照规模」作为可信度依据，让读者能判断这次统计是否可靠。
//   3. 探针区分「类名不存在」与「元素存在但类名不同」——
//      按语义宽匹配一次，把命中元素的 class 打印出来。
//   4. 题卡不只列前 5 条，另给题型分布汇总。

// 等待内容渲染稳定：连续两次采样题卡数不再增长，或超时
async function waitForStableRender(maxMs) {
    const deadline = Date.now() + (maxMs || 6000);
    let prev = -1, stable = 0;
    while (Date.now() < deadline) {
        const n = $(SEL.exerciseItem).length;
        if (n > 0 && n === prev) {
            stable++;
            if (stable >= 2) return { stable: true, items: n, waited: true };
        } else {
            stable = 0;
        }
        prev = n;
        await sleep(400);
    }
    return { stable: false, items: $(SEL.exerciseItem).length, waited: true };
}

// 取某选择器命中元素的 class 摘要（最多 6 个不同值）
function classSummary(sel, limit) {
    const els = $(sel);
    if (!els.length) return null;
    const set = new Set();
    els.forEach(el => {
        const c = (el.className || '').toString().trim();
        if (c) set.add(c.length > 60 ? c.slice(0, 60) + '…' : c);
    });
    return Array.from(set).slice(0, limit || 6);
}

async function selfCheck() {
    const out = [];
    const route = parseReaderRoute();

    out.push('== 环境 ==');
    out.push('URL: ' + location.pathname + (location.search || ''));
    out.push('脚本版本: v' + SCRIPT_VERSION + '（' + detectEnvironment().kind + ' 引擎）');
    out.push('');

    out.push('== 路由 ==');
    out.push(route ? JSON.stringify(route) : '未匹配阅读器路由：' + location.pathname);
    out.push('');

    // 判分策略 —— 决定反复提交的后果，是作答策略的前提
    out.push('== 课程判分策略 ==');
    if (route) {
        const p = await loadCoursePolicy(true);
        const st = strategyOf(p);
        if (p && p.loaded) {
            out.push('学习模式: ' + st.mode + '（learnMode=' + p.learnMode + '）');
            out.push('成绩取值: 记' + st.gradeBy + '答题结果');
            out.push('反复提交: ' + (st.retrySafe ? '安全（记最高，不会拉低成绩）' : '有风险（记末次，错误提交会成为最终成绩）'));
            out.push('显示答案: freeShowAnswer=' + p.freeShowAnswer + ' passShowAnswer=' + p.passShowAnswer);
            out.push('答案下发阈值 errorNumShow: ' + p.errorNumShow + '（答错达该次数后服务端下发标准答案）');
            out.push('计入成绩 caculateToGrade: ' + p.caculateToGrade + '；学习时长限制 learnTimeLimit: ' + p.learnTimeLimit);
            out.push('说明: ' + st.note);
        } else {
            out.push('读取失败：' + ((p && p.error) || '未知') + '（将按最保守策略执行，不做试错提交）');
        }
    } else {
        out.push('跳过（非阅读器页面）');
    }
    out.push('');
    out.push('== 令牌 ==');
    out.push('localStorage.' + TOKEN_KEY + '：' + (getToken() ? '存在（' + getToken().length + ' 字符）' : '缺失'));
    out.push('');

    // ---- 渲染稳定性（issue #2 第 3 条）----
    out.push('== 渲染稳定性 ==');
    const before = $(SEL.exerciseItem).length;
    const stab = await waitForStableRender(6000);
    const after = $(SEL.exerciseItem).length;
    out.push('题卡数：初次 ' + before + ' → 稳定后 ' + after +
        (stab.stable ? '（已稳定）' : '（超时未稳定，结果可能偏少）'));
    if (after > before) {
        out.push('注意：初次统计偏少 ' + (after - before) + ' 个，已采用稳定后的数值');
    }
    out.push('');

    out.push('== DOM 探针 ==');
    for (const [name, sel] of Object.entries(SEL)) {
        const n = $(sel).length;
        let line = sel + ' → ' + n + (n ? ' 命中' : ' 未命中');
        if (!n) {
            // 未命中时尝试宽匹配，区分「不存在」与「类名不同」
            const kw = sel.replace(/^\./, '').split('-')[0];
            if (kw && kw.length >= 3) {
                const loose = classSummary('[class*="' + kw + '"]', 4);
                if (loose && loose.length) line += '  ⚠ 宽匹配 [class*="' + kw + '"] 命中：' + loose.join(' | ');
            }
        }
        out.push(line);
    }
    out.push('');
    out.push('== 语义宽匹配（校准类名用）==');
    for (const kw of ['fill', 'blank', 'option', 'answer', 'pagination', 'choice', 'contenteditable']) {
        const sel = kw === 'contenteditable' ? '[contenteditable]' : '[class*="' + kw + '"]';
        const n = $(sel).length;
        out.push('  ' + sel + ' → ' + n + (n ? ('  ' + (classSummary(sel, 3) || []).join(' | ')) : ''));
    }
    out.push('');

    // ---- 题卡 + 题型分布（issue #2 第 4 条）----
    const items = getExerciseItems();
    out.push('== 题卡 == 共 ' + items.length + ' 个');
    const dist = {};
    const details = [];
    items.forEach((el, i) => {
        const t = detectType(el) || '未知';
        dist[t] = (dist[t] || 0) + 1;
        if (i < 8) {
            details.push('  #' + i + ' 推断题型=' + t +
                ' 选项数=' + getOptions(el).length +
                ' 填空数=' + $('.zty-exercise-item-fill-blank-do', el).length +
                ' contenteditable=' + $('[contenteditable="true"]', el).length);
        }
    });
    if (details.length) out.push(details.join('\n'));
    if (items.length > details.length) {
        out.push('  …（仅列前 ' + details.length + ' 条，其余见下方分布）');
    }
    out.push('  题型分布：' + (Object.keys(dist).length
        ? Object.entries(dist).map(([k, v]) => k + ' ×' + v).join(' / ')
        : '（无）'));
    out.push('');

    // ---- 按钮 ----
    out.push('== 按钮 ==');
    const sub = findSubmitButton(), ret = findRetryButton();
    out.push('Submit 按钮：' + (sub ? '存在' + (sub.disabled ? '（禁用）' : '') : '未找到'));
    out.push('Retry 按钮：' + (ret ? '存在' : '未找到'));

    // 分页按钮的渲染条件（已从产物证实）：
    //   分页栏位于 div.preview-navbar 内，且受「预览模式 && 总页数>0」控制。
    //   流式滚动模式（readMode==='stream'）下不渲染分页栏，此时 0 命中是正常的，
    //   并非类名错误。故一并打印导航栏状态以便区分。
    const hasNavbar = !!$1('.preview-navbar');
    out.push('分页按钮(' + SEL.paginationBtn + ')：' + $(SEL.paginationBtn).length + ' 个');
    out.push('分页计数(' + SEL.paginationWrap + ')：' + $(SEL.paginationWrap).length + ' 个');
    out.push('分页栏容器(.preview-navbar)：' + (hasNavbar ? '存在' : '不存在'));
    if (!$(SEL.paginationBtn).length) {
        out.push('  → 说明：分页栏仅在「预览模式 + 总页数>0」时渲染；' +
            (hasNavbar ? '当前有导航栏但无分页按钮，可能非分页模式' : '当前无导航栏，可能为流式滚动模式') +
            '。这不代表类名错误。');
    }
    const pc = paginationCounter();
    out.push('分页计数文本：' + (pc ? pc : '（未读到）'));
    const pgLoose = classSummary('[class*="pagination"]', 5);
    if (pgLoose) out.push('  宽匹配 [class*="pagination"] 命中：' + pgLoose.join(' | '));
    out.push('');

    // ---- 取题接口（脱敏：只报字段名与长度，不报答案内容）----
    if (route && route.contentId) {
        out.push('== 取题接口 ==');
        const data = await loadCurrentExercise();
        if (data) {
            out.push('questionVOList: ' + (data.questionVOList || []).length + ' 题');
            out.push('answerCount: ' + data.answerCount);
            out.push('questionAnswerItemVOList: ' + (data.questionAnswerItemVOList || []).length + ' 条');
            const first = (data.questionVOList || [])[0];
            if (first) out.push('首题字段：' + Object.keys(first).join(', '));
            out.push('首题 type=' + (first && first.type) + ' obSub=' + (first && first.obSub));
            const firstAns = (data.questionAnswerItemVOList || [])[0];
            if (firstAns) {
                // 只报字段名与类型/长度，不回显答案内容（自检输出会贴到公开 issue）
                const desc = Object.keys(firstAns).map(k => {
                    const v = firstAns[k];
                    if (v === null || v === undefined) return k + '=null';
                    if (Array.isArray(v)) return k + '=[array×' + v.length + ']';
                    if (typeof v === 'object') return k + '={obj}';
                    return k + '=(' + typeof v + ', len ' + String(v).length + ')';
                });
                out.push('首条答案字段：' + desc.join(', '));
            }
        } else {
            out.push('取题失败');
        }
    } else {
        out.push('== 取题接口 ==');
        out.push('跳过（URL 无 contentId）');
    }
    return out.join('\n');
}

// ============================================================================
// 12. 脚本有效性检测 + GitHub Issue 上报
// ============================================================================

const REPORT_KEY = 'tsh_auto_brush_report';
let reportConfig = { consent: null, consentVersion: '', enabled: false, owner: '', repo: '', token: '', lastReport: 0 };
function loadReportConfig() {
    try { const s = localStorage.getItem(REPORT_KEY); if (s) reportConfig = Object.assign(reportConfig, JSON.parse(s)); } catch (e) {}
}
function saveReportConfig() {
    try { localStorage.setItem(REPORT_KEY, JSON.stringify(reportConfig)); } catch (e) {}
}

// 探针：对照【新站】结构。v2.0.0 起改为新站选择器。
function checkScriptValidity() {
    if (!/tsinghuaelt\.com/.test(location.hostname)) return true;
    if (document.readyState !== 'complete') return true;
    // 只在阅读器页面判定（其他页面没有这些结构是正常的，不算失效）
    if (!parseReaderRoute()) return true;
    const probes = [SEL.readerRoot, SEL.exercisePreview, SEL.exerciseItem, SEL.paginationBtn, SEL.chapterSection];
    return probes.some(s => $1(s)) === true;
}

async function reportIssue(reason) {
    if (!reportConfig.enabled || !reportConfig.owner || !reportConfig.repo || !reportConfig.token ||
        reportConfig.consent !== true || reportConfig.consentVersion !== '1.0') return false;
    const now = Date.now();
    if (now - reportConfig.lastReport < 86400000) return false;

    const title = '[自动报告] 清华社刷课脚本可能失效 v' + SCRIPT_VERSION;
    const pathMasked = location.pathname.replace(/\/reader\/([^/]+)\/\d+/, '/reader/$1/{bizId}');
    const body = [
        '**脚本版本**：v' + SCRIPT_VERSION,
        '**站点**：' + location.origin,
        '**页面**：' + (location.origin + pathMasked).slice(0, 120),
        '**构建版本**：' + (window.__BUILD_VERSION__ || '未知'),
        '**时间**：' + new Date().toLocaleString('zh-CN'),
        '**检测**：核心 DOM 探针全未命中（站点可能再次改版）',
        '**原因**：' + (reason || '脚本失效检测触发'),
        '',
        '<details><summary>结构自检</summary>',
        '',
        '```',
        (await selfCheck()).slice(0, 3000),
        '```',
        '</details>'
    ].join('\n');

    try {
        const resp = await fetch('https://api.github.com/repos/' + reportConfig.owner + '/' + reportConfig.repo + '/issues', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + reportConfig.token,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({ title, body })
        });
        if (resp.ok) {
            reportConfig.lastReport = now;
            saveReportConfig();
            status('已自动上报 issue（24h 内不再重复）');
            return true;
        }
        status('上报失败（HTTP ' + resp.status + '，检查 token 权限）');
    } catch (e) { status('上报失败（网络）'); }
    return false;
}

// ============================================================================
// 13. 主循环
// ============================================================================

let running = false;
let timer = null;
let roundCount = 0;
let noProgressRounds = 0;
let invalidRounds = 0;
let statusEl = null;
const MAX_ROUNDS = 500;

async function doOneRound() {
    // 限流冷却（站点自身无退避，必须由脚本控制节奏）
    if (isRateLimited()) {
        status('限流冷却中 ' + rateLimitRemainSec() + 's，稍后自动继续');
        return;
    }
    const route = parseReaderRoute();
    if (!route) {
        if (isCoursePage()) { status('请在课程中打开具体教材/课程章节'); return; }
        status('当前不是阅读器页面，请进入教材/课程阅读页');
        return;
    }
    // 有效性检测（仅阅读器页）
    if (!checkScriptValidity()) {
        invalidRounds++;
        if (invalidRounds >= 10) {
            const reported = await reportIssue('核心 DOM 探针连续 10 轮未命中');
            stopRun('脚本可能已失效（站点结构不匹配），' + (reported ? '已自动上报 issue' : '请检查/更新脚本'));
            return;
        }
        status('页面结构异常（' + invalidRounds + '/10），等待确认...');
    } else {
        invalidRounds = 0;
    }

    roundCount++;
    if (roundCount > MAX_ROUNDS) { stopRun('达到最大轮次保护(' + MAX_ROUNDS + ')，已停止'); return; }

    // 0) 判分策略 —— 必须在作答之前分清模式
    //
    // 自由模式记「末次」、闯关模式记「最高」，这直接决定反复提交的后果。
    // 读不到策略时按最保守处理（不试错），宁可少做也不冒险改成绩。
    const policy = await loadCoursePolicy();
    const strat = strategyOf(policy);
    if (!policy || !policy.loaded) {
        status('未能读取课程设置（' + ((policy && policy.error) || '未知') + '），本次按最保守策略执行');
    } else {
        log('判分策略', strat, policy);
    }

    // 1) 取题（含标准答案）
    //
    // 取题前先等题卡渲染稳定（issue #2 实测反馈）：
    // 页面内容异步加载，首轮可能只渲染出 2 个题卡而实际有 17 个。
    // 若按未稳定的快照推进，只会处理其中一小部分内容。
    await waitForStableRender(5000);

    const data = await loadCurrentExercise();
    if (!data) {
        noProgressRounds++;
        if (noProgressRounds >= 3) { noProgressRounds = 0; stopRun('连续取题失败，已停止'); }
        return;
    }

    const questions = data.questionVOList || [];
    if (questions.length) {
        // 语音评测题需真实录音，无法自动作答 —— 明确告知并跳过，避免误判为脚本故障
        const speechCards = getExerciseItems().filter(cardNeedsSpeech);
        if (speechCards.length) {
            status('本节含 ' + speechCards.length + ' 道语音题（需真人录音），无法自动作答，直接跳过');
            log('语音题卡片', speechCards);
            await sleep(rnd(600, 1000));
            // 标记内容完成并尝试翻页，让用户自行处理语音题
            if (route.catalogId) await apiMarkContentDone(route.bizId, route.catalogId, route.contentId || 0);
            const movedBySpeech = await clickPagination('next');
            if (!movedBySpeech) {
                noProgressRounds++;
                if (noProgressRounds >= 3) { noProgressRounds = 0; stopRun('遇到语音题且无法翻页，已停止'); }
            } else { noProgressRounds = 0; }
            return;
        }

        // 判定是否已全部作答
        const unanswered = questions.filter(q => !hasUserAnswer(q));
        if (unanswered.length) {
            status('作答中（未答 ' + unanswered.length + '/' + questions.length + '）· '
                + strat.mode + '（成绩记' + strat.gradeBy + '）');

            // 路径 1：页面下发了答案就直接填。
            // 注意：标准答案只在作答次数达到 errorNumShow 后才由服务端下发，
            // 未必在首次取题时就有（见 DEVELOPMENT §11.3）。
            const r = await fillByAnswerMap();
            log('页面答案填充结果', r);
            await sleep(rnd(300, 600));

            // 路径 2：AI 补答 —— **只针对主观题**。
            //
            // 客观题不需要 AI：轮询就能从服务端拿到权威 standardAnswer，
            // 比 AI 更准（实测同一题 AI 五空全错、轮询得到的全对），且零 token 成本。
            // 主观题才是 AI 唯一必要的场景 —— 服务端对它们不下发答案。
            let left = questions.filter(q => !hasUserAnswer(q));
            const subjectiveLeft = left.filter(isSubjective);
            if (subjectiveLeft.length) {
                if (aiEnabled()) {
                    status('主观题 ' + subjectiveLeft.length + ' 道（服务端不下发答案），改用 AI 作答');
                    const ai = await fillByAI(subjectiveLeft);
                    log('AI 补答结果', ai);
                    if (ai.failed && ai.failed.length) log('AI 未覆盖的题', ai.failed);
                    await sleep(rnd(400, 800));
                } else {
                    status('本节含 ' + subjectiveLeft.length + ' 道主观题，服务端不下发答案 —— 需配置 AI 才能作答');
                }
                left = questions.filter(q => !hasUserAnswer(q));
            }
            const objectivePending = left.filter(q => !isSubjective(q)).length;
            if (objectivePending) {
                log('客观题 ' + objectivePending + ' 道交由轮询取权威答案（不调用 AI）');
            }

            if (!getExerciseItems().length) { status('未找到题卡元素'); return; }

            // 路径 3：试错取答案。
            //
            // 【为什么即便 AI 已填满也要走这一步】AI 的作答只是"当前最优猜测" ——
            // 实测同一道填空题 AI 五个空全判错（rightRate 0），而服务端下发的
            // standardAnswer 才是权威答案。因此**没有官方答案就继续轮询**，
            // 拿到后重填并提交，这才是保证满分的路径。
            //
            // 【机制】服务端在作答次数累计到 errorNumShow 次后，才在
            // questionAnswerItemVOList[].answer 下发标准答案（选择题与填空题均已实测）。
            //
            // 【关于自由模式】成绩记「末次」，理论上有风险；但本流程每一轮都**保留当前最优答案**
            // 只补空白（见 retryUntilAnswer），并最终用服务端答案闭环提交，
            // 因此实际是单调改善：中途中断最多停在当前水平，不会比不试错更差。
            const amap = buildAnswerMap(currentResp);
            const hasOfficialAnswer = questions.length > 0 && questions.every(q => {
                const a = amap.get(Number(q.id));
                return !!(a && a.answer);
            });
            const threshold = answerRevealThreshold(policy);

            if (!hasOfficialAnswer) {
                if (!Number.isFinite(threshold)) {
                    status('未能确定答案下发阈值（errorNumShow 缺失），跳过试错，按当前作答提交');
                } else {
                    if (!strat.retrySafe) {
                        status('【' + strat.mode + '】成绩记' + strat.gradeBy
                            + ' —— 保持当前答案不变，只补空白，拿到服务端答案后闭环覆盖');
                    }
                    status('试错取答案：服务端在答错 ' + threshold + ' 次后下发标准答案');
                    const got = await retryUntilAnswer(route, questions, threshold);
                    if (!got) status('试错未取得标准答案，按当前作答提交');
                    left = questions.filter(q => !hasUserAnswer(q));
                }
            }

            // 站点前端有硬门禁：未答完提交会被拦下（请完成所有习题后再提交）。
            if (left.length) {
                stopRun('仍有 ' + left.length + ' 题无法作答，已停止以免空提交。');
                return;
            }

            await submitAnswers();
            noProgressRounds = 0;
            return;
        }
        // 已全部作答：doRecord 有值即说明服务端已记录。
        //
        // 但如果存在**答错的题**（answerStatus 不是 1）、且服务端已下发标准答案，
        // 就值得重做一次把它覆盖掉 —— 否则这一节的分数会永久停在错误值上。
        // 这正是「拿分」的关键：站点既然后来给了正确答案，就没有理由让它白给。
        const doneMap = buildAnswerMap(currentResp);
        const redoList = questions.filter(q => {
            const a = doneMap.get(Number(q.id));
            if (!a) return false;
            const st = Number(a.status);
            if (st === 1) return false;        // 已答对
            if (st === -1) return false;       // 主观题，服务端不自动判分
            return !!a.answer;                 // 答错 且 有官方答案 → 可覆盖
        });

        if (redoList.length) {
            status('本节有 ' + redoList.length + ' 题答错且服务端已下发标准答案，重做覆盖');
            if (await ensureEditableState()) {
                const rr = await fillByAnswerMap();
                log('重做回填', rr);
                if (rr.filled) {
                    await sleep(rnd(400, 800));
                    await submitAnswers();
                    noProgressRounds = 0;
                    return;
                }
                status('重做未能填入答案（可能在查看态下无可写元素）');
            } else {
                status('无法进入作答态，跳过重做');
            }
        }

        status('本节已作答完成（成绩记' + strat.gradeBy + '），推进下一节');
        noProgressRounds = 0;
        if (route.catalogId) await apiMarkContentDone(route.bizId, route.catalogId, route.contentId || 0);
        const movedNext = await clickPagination('next');
        if (!movedNext) {
            noProgressRounds++;
            if (noProgressRounds >= 3) { noProgressRounds = 0; stopRun('已到最后一页，全部完成'); }
            else status('未检测到下一页（' + noProgressRounds + '/3），等待后重试');
        }
        return;
    }

    // 2) 无题（阅读类内容）：标记完成 + 翻页
    if (route.catalogId) {
        await apiMarkContentDone(route.bizId, route.catalogId, route.contentId || 0);
    }
    status('翻下一页');
    const moved = await clickPagination('next');
    if (!moved) {
        noProgressRounds++;
        if (noProgressRounds >= 3) { noProgressRounds = 0; stopRun('已到最后一页，全部完成'); }
        else status('未检测到下一页（' + noProgressRounds + '/3），等待后重试');
    } else {
        noProgressRounds = 0;
    }
}

async function loop() {
    if (!running) return;
    try {
        await doOneRound();
    } catch (e) {
        log('轮次异常', e);
        status('轮次异常：' + (e && e.message ? e.message : e));
    }
    if (!running) return;
    timer = setTimeout(loop, rnd(6000, 10000));
}

function stopRun(msg) {
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
    const b = $1('#b6-start');
    if (b) b.textContent = '开始刷课';
    status(msg || '已停止');
}

function status(m) {
    if (statusEl) statusEl.textContent = m;
    try { console.log('[刷课]', m); } catch (e) {}
}

// ============================================================================
// 14. GUI
// ============================================================================

function mkUI() {
    if ($1('#b6-root')) return;
    const root = document.createElement('div');
    root.id = 'b6-root';
    const css = document.createElement('style');
    css.textContent = [
        '#b6-root * { box-sizing: border-box; margin: 0; padding: 0; }',
        '#b6-root { font: 13px/1.7 "Microsoft YaHei", system-ui, sans-serif; }',
        '#b6-panel { position: fixed; top: 80px; right: 16px; width: 330px; background: #F4F6F8; border: 1px solid #CBD6E0; border-radius: 10px; box-shadow: 0 6px 20px rgba(43,58,73,.15); z-index: 2147483647; overflow: hidden; }',
        '#b6-hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #33475C; color: #F0F4F7; cursor: move; user-select: none; }',
        '#b6-hex { width: 22px; height: 22px; flex: 0 0 22px; background: #7C93A8; clip-path: polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%); display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; color: #F4F7FA; }',
        '#b6-hd-title { font-size: 13.5px; font-weight: 600; letter-spacing: 1px; }',
        '#b6-hd-sub { font-size: 9px; opacity: .72; letter-spacing: 2px; }',
        '#b6-x { cursor: pointer; padding: 0 2px; font-size: 14px; color: #9FB4C6; }',
        '#b6-x:hover { color: #fff; }',
        '#b6-set-btn { cursor: pointer; padding: 2px 6px; font-size: 11px; border: 1px solid #7C93A8; border-radius: 4px; color: #D6E3EC; }',
        '#b6-set-btn:hover { background: #46607A; color: #fff; }',
        '#b6-reopen { position: fixed; top: 80px; right: 16px; width: 28px; height: 28px; background: #33475C; color: #F0F4F7; clip-path: polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%); display: none; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; cursor: pointer; z-index: 2147483647; }',
        '#b6-bd { padding: 12px; user-select: text; -webkit-user-select: text; }',
        '#b6-status { text-align: center; padding: 8px 10px; margin-bottom: 12px; background: #E8EDF3; border: 1px solid #D5DEE6; border-radius: 6px; font-size: 12px; font-weight: 600; color: #2B3A49; word-break: break-all; }',
        '.b6-group { margin-bottom: 13px; }',
        '.b6-glabel { display: flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 700; letter-spacing: 1.5px; color: #4A6A85; margin-bottom: 7px; text-transform: uppercase; }',
        '.b6-glabel::before { content: ""; width: 6px; height: 6px; background: #7C93A8; clip-path: polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%); }',
        '.b6-btn { display: block; width: 100%; padding: 9px; border-radius: 6px; cursor: pointer; font-size: 13px; border: 1px solid; transition: all .15s; }',
        '#b6-start { background: #3D6B99; color: #fff; border-color: #3D6B99; font-weight: 600; margin-bottom: 6px; }',
        '#b6-start:hover { background: #33587E; }',
        '#b6-one, #b6-score, #b6-farm, #b6-check { background: #fff; color: #33587E; border-color: #CBD6E0; margin-bottom: 6px; }',
        '#b6-one:hover, #b6-score:hover, #b6-farm:hover, #b6-check:hover { background: #E9EEF3; }',
        '#b6-out { margin-top: 6px; padding: 8px 9px; background: #F7F9FB; border: 1px dashed #CBD6E0; border-radius: 6px; font: 11px/1.55 Consolas,monospace; white-space: pre-wrap; word-break: break-all; color: #2B3A49; display: none; max-height: 320px; overflow: auto; }',
        '.b6-in { width: 100%; padding: 6px 8px; font-size: 12px; margin-bottom: 5px; border: 1px solid #D5DEE6; border-radius: 4px; background: #fff; color: #2B3A49; }',
        '.b6-label { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; font-size: 12px; color: #33587E; cursor: pointer; }',
        '.b6-sm-btn { padding: 6px; border-radius: 4px; cursor: pointer; font-size: 12px; border: 1px solid #CBD6E0; background: #fff; color: #33587E; }',
        '.b6-sm-btn:hover { background: #E9EEF3; }',
        '.b6-row { display: flex; gap: 4px; }'
    ].join('\n');
    root.appendChild(css);

    const panel = document.createElement('div');
    panel.id = 'b6-panel';
    panel.innerHTML =
        '<div id="b6-hd">' +
        '  <div id="b6-hex">R</div>' +
        '  <div style="flex:1">' +
        '    <div id="b6-hd-title">TSH AUTO STUDY</div>' +
        '    <div id="b6-hd-sub">v' + SCRIPT_VERSION + ' · 新版</div>' +
        '  </div>' +
        '  <div id="b6-set-btn" title="设置">设置</div>' +
        '  <div id="b6-x">&times;</div>' +
        '</div>' +
        '<div id="b6-reopen" title="展开面板">R</div>' +
        '<div id="b6-bd">' +
        '  <div id="b6-status">就绪</div>' +
        '  <div class="b6-group">' +
        '    <div class="b6-glabel">Operation · 执行</div>' +
        '    <button id="b6-start" class="b6-btn">开始刷课</button>' +
        '    <button id="b6-one" class="b6-btn">做一轮</button>' +
        '  </div>' +
        '  <div class="b6-group">' +
        '    <div class="b6-glabel">Data · 数据</div>' +
        '    <button id="b6-score" class="b6-btn">查成绩</button>' +
        '    <button id="b6-farm" class="b6-btn">时长保活（防空闲熔断）</button>' +
        '    <button id="b6-check" class="b6-btn">结构自检（排错用）</button>' +
        '    <pre id="b6-out"></pre>' +
        '  </div>' +
        '</div>';
    root.appendChild(panel);

    const sp = document.createElement('div');
    sp.id = 'b6-settings';
    sp.style.cssText = 'position:fixed;top:80px;right:360px;width:330px;background:#F4F6F8;border:1px solid #CBD6E0;border-radius:10px;box-shadow:0 6px 20px rgba(43,58,73,.15);z-index:2147483647;overflow:hidden;display:none';
    sp.innerHTML =
        '<div id="b6-s-hd" style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#33475C;color:#F0F4F7;cursor:move">' +
        '  <div style="flex:1;font-size:13.5px;font-weight:600;letter-spacing:1px">CONFIG · 设置</div>' +
        '  <div id="b6-s-x" style="cursor:pointer;padding:0 2px;font-size:14px;color:#9FB4C6">&times;</div>' +
        '</div>' +
        '<div style="padding:12px">' +
        '  <div class="b6-glabel">AI · 答题兜底</div>' +
        '  <p style="font-size:11px;color:#7A8EA0;margin-bottom:6px">仅在页面未下发标准答案时使用。</p>' +
        '  <label class="b6-label"><input type="checkbox" id="b6-ai-en"> 启用 AI 补答</label>' +
        '  <input id="b6-ai-url" class="b6-in" placeholder="API Base URL（OpenAI 兼容）">' +
        '  <input id="b6-ai-key" class="b6-in" type="password" placeholder="API Key">' +
        '  <input id="b6-ai-model" class="b6-in" placeholder="模型名">' +
        '  <button id="b6-ai-save" class="b6-sm-btn" style="width:100%">保存 AI 设置</button>' +
        '  <div class="b6-glabel" style="margin-top:12px">Report · 失效上报</div>' +
        '  <div id="b6-rp-auth" style="display:none">' +
        '    <p style="font-size:12px;color:#7A8EA0;margin-bottom:6px">失效自动上报未授权（默认关闭）。</p>' +
        '    <button id="b6-rp-consent" class="b6-sm-btn" style="width:100%">查看知情同意书并授权</button>' +
        '  </div>' +
        '  <div id="b6-rp-form" style="display:none">' +
        '    <label class="b6-label"><input type="checkbox" id="b6-rp-en"> 失效自动上报 issue</label>' +
        '    <input id="b6-rp-owner" class="b6-in" placeholder="GitHub 用户名">' +
        '    <input id="b6-rp-repo" class="b6-in" placeholder="仓库名">' +
        '    <input id="b6-rp-token" class="b6-in" type="password" placeholder="GitHub Token（Issues: write）">' +
        '    <div class="b6-row">' +
        '      <button id="b6-rp-save" class="b6-sm-btn" style="flex:1">保存设置</button>' +
        '      <button id="b6-rp-test" class="b6-sm-btn" style="flex:1;color:#B3544B">发测试 issue</button>' +
        '    </div>' +
        '  </div>' +
        '</div>';
    root.appendChild(sp);
    document.body.appendChild(root);

    statusEl = $1('#b6-status');
    const out = $1('#b6-out');
    const show = t => { out.textContent = t; out.style.display = 'block'; };

    // 拖动
    const mkDrag = (handle, target) => {
        let dragging = false, dx = 0, dy = 0, px = 0, py = 0;
        handle.addEventListener('pointerdown', e => {
            dragging = true; dx = e.clientX; dy = e.clientY;
            px = target.offsetLeft; py = target.offsetTop; e.preventDefault();
        });
        document.addEventListener('pointermove', e => {
            if (!dragging) return;
            target.style.left = (px + e.clientX - dx) + 'px';
            target.style.top = (py + e.clientY - dy) + 'px';
            target.style.right = 'auto';
        });
        document.addEventListener('pointerup', () => { dragging = false; });
    };
    mkDrag($1('#b6-hd'), panel);
    mkDrag($1('#b6-s-hd'), sp);

    $1('#b6-start').addEventListener('click', () => {
        const b = $1('#b6-start');
        if (running) { stopRun('已停止'); return; }
        running = true; roundCount = 0; noProgressRounds = 0; invalidRounds = 0;
        b.textContent = '停止';
        status('运行中');
        loop();
    });
    $1('#b6-one').addEventListener('click', async () => {
        status('执行一轮...');
        await doOneRound();
        status('本轮完成');
    });
    $1('#b6-x').addEventListener('click', () => {
        if (studyTimer) stopStudyFarm();
        panel.style.display = 'none';
        $1('#b6-reopen').style.display = 'flex';
    });
    $1('#b6-reopen').addEventListener('click', () => {
        $1('#b6-reopen').style.display = 'none';
        panel.style.display = 'block';
    });
    $1('#b6-set-btn').addEventListener('click', () => {
        sp.style.display = sp.style.display === 'none' ? 'block' : 'none';
    });
    $1('#b6-s-x').addEventListener('click', () => { sp.style.display = 'none'; });

    // 结构自检
    $1('#b6-check').addEventListener('click', async () => {
        status('自检中...');
        show('自检中，请稍候...');
        try { show(await selfCheck()); status('自检完成，可复制结果反馈'); }
        catch (e) { show('自检异常：' + e.message); status('自检异常'); }
    });

    // 查成绩
    let scoreCooldown = false;
    $1('#b6-score').addEventListener('click', async () => {
        if (scoreCooldown) { status('查询冷却中...'); return; }
        scoreCooldown = true;
        status('查询中...');
        const d = await fetchScore();
        show(formatScore(d));
        status('成绩查询完成');
        setTimeout(() => { scoreCooldown = false; }, 3000);
    });

    // 时长保活（站点自身每 10s 上报，本功能仅防 10 分钟空闲熔断）
    $1('#b6-farm').addEventListener('click', () => {
        const b = $1('#b6-farm');
        if (studyTimer) { stopStudyFarm(); b.textContent = '时长保活（防空闲熔断）'; }
        else { startStudyFarm(); b.textContent = studyTimer ? '停止保活' : '时长保活（防空闲熔断）'; }
    });

    // AI 设置
    loadAiConfig();
    $1('#b6-ai-en').checked = aiConfig.enabled;
    $1('#b6-ai-url').value = aiConfig.baseUrl;
    $1('#b6-ai-key').value = aiConfig.apiKey;
    $1('#b6-ai-model').value = aiConfig.model;
    $1('#b6-ai-save').addEventListener('click', () => {
        aiConfig.enabled = $1('#b6-ai-en').checked;
        aiConfig.baseUrl = $1('#b6-ai-url').value.trim();
        aiConfig.apiKey = $1('#b6-ai-key').value.trim();
        aiConfig.model = $1('#b6-ai-model').value.trim();
        saveAiConfig();
        status('AI 设置已保存' + (aiConfig.enabled ? '（已启用）' : '（未启用）'));
    });

    // 上报设置
    loadReportConfig();
    const syncRp = () => {
        const granted = reportConfig.consent === true && reportConfig.consentVersion === '1.0';
        $1('#b6-rp-auth').style.display = granted ? 'none' : 'block';
        $1('#b6-rp-form').style.display = granted ? 'block' : 'none';
    };
    syncRp();
    $1('#b6-rp-en').checked = reportConfig.enabled;
    $1('#b6-rp-owner').value = reportConfig.owner;
    $1('#b6-rp-repo').value = reportConfig.repo;
    $1('#b6-rp-token').value = reportConfig.token;
    $1('#b6-rp-consent').addEventListener('click', () => {
        reportConfig.consent = true;
        reportConfig.consentVersion = '1.0';
        saveReportConfig(); syncRp();
        status('已授权失效上报（仍默认关闭）');
    });
    $1('#b6-rp-save').addEventListener('click', () => {
        reportConfig.enabled = $1('#b6-rp-en').checked;
        reportConfig.owner = $1('#b6-rp-owner').value.trim();
        reportConfig.repo = $1('#b6-rp-repo').value.trim();
        reportConfig.token = $1('#b6-rp-token').value.trim();
        saveReportConfig();
        status('上报设置已保存' + (reportConfig.enabled ? '（已启用）' : '（未启用）'));
    });
    $1('#b6-rp-test').addEventListener('click', async () => {
        reportConfig.enabled = $1('#b6-rp-en').checked;
        reportConfig.owner = $1('#b6-rp-owner').value.trim();
        reportConfig.repo = $1('#b6-rp-repo').value.trim();
        reportConfig.token = $1('#b6-rp-token').value.trim();
        saveReportConfig();
        status('发送测试 issue...');
        const ok = await reportIssue('手动测试上报');
        status(ok ? '测试 issue 已发送' : '测试失败（检查 owner/repo/token）');
    });

    log('v' + SCRIPT_VERSION + ' 已加载');

    // 环境提示：装错版本（落在旧站）时直接说明，避免用户以为脚本坏了
    const env = detectEnvironment();
    log('运行环境:', env.kind, '|', env.msg);
    if (env.kind === 'legacy') {
        status('⚠ ' + env.msg);
        const b = $1('#b6-start');
        if (b) { b.disabled = true; b.style.opacity = '0.5'; b.textContent = '本版不支持旧站'; }
        const one = $1('#b6-one');
        if (one) { one.disabled = true; one.style.opacity = '0.5'; }
        const farm = $1('#b6-farm');
        if (farm) { farm.disabled = true; farm.style.opacity = '0.5'; }
    } else {
        status(env.msg);
    }
}

// SPA 路由变化时不重建 UI（面板是 fixed 常驻）
setTimeout(mkUI, 1500);
})();
