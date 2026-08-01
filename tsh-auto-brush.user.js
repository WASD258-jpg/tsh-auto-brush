// ==UserScript==
// @name         TSH自动刷课
// @version      1.1.2
// @namespace    wasd258-jpg.tsh-autobrush
// @description  清华社英语在线视听说自动刷课（TSH自动刷课）: 全自动答题+翻页跨单元+AI优先出答案+查成绩+刷学习时长+站点改版失效自动上报。适配单选/多选/判断/下拉/填空/拖拽/跟读/口语/角色扮演/视频。
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

(function () {
    'use strict';

    // ================= 工具函数 =================
    const $ = (s, p) => Array.from((p || document).querySelectorAll(s));
    const $1 = (s, p) => (p || document).querySelector(s);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const rnd = (a, b) => a + Math.floor(Math.random() * (b - a));

    const WORDS = ['good', 'well', 'nice', 'great', 'fine', 'best', 'better', 'happy', 'easy', 'hard', 'true', 'right', 'morning', 'evening', 'work', 'study', 'play', 'talk', 'listen', 'speak', 'English'];
    const rw = () => WORDS[rnd(0, WORDS.length)];

    // 派发 click（实测对 Angular (click) 绑定有效）
    function click(el) {
        if (!el) return false;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
    }
    // 完整鼠标序列（部分组件监听 pointer/mouse 组合，顺序须与真实浏览器一致）
    function clickSeq(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        try {
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, button: 0 }));
            el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y, button: 0 }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        } catch (e) { click(el); }
        return true;
    }

    // 填写 input / contenteditable span（实测填空是 span[contenteditable]，必须设 textContent 并派发 input）
    function fill(el, val) {
        if (!el) return;
        try {
            if (el.tagName === 'SPAN' || el.isContentEditable || el.hasAttribute('contenteditable')) {
                el.textContent = val;
            } else {
                const proto = Object.getPrototypeOf(el);
                const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
                if (desc && desc.set) desc.set.call(el, val); else el.value = val;
            }
        } catch (e) {
            try { el.value = val; } catch (e2) {}
        }
        ['input', 'change', 'blur', 'keyup'].forEach(et => {
            el.dispatchEvent(new Event(et, { bubbles: true, cancelable: true }));
        });
    }

    // ================= 脚本有效性检测 + GitHub Issue 上报 =================
    // 用途：开源托管时，若网站改版导致脚本失效，自动向 GitHub 发 issue（需用户同意；24h 去重防刷）
    const SCRIPT_VERSION = '1.1.2'; // 与 @version 保持一致
    const REPORT_KEY = 'tsh_auto_brush_report';
    let reportConfig = { consent: null, consentVersion: '', enabled: false, owner: '', repo: '', token: '', lastReport: 0 };
    function loadReportConfig() {
        try {
            const s = localStorage.getItem(REPORT_KEY);
            if (s) reportConfig = Object.assign(reportConfig, JSON.parse(s));
        } catch (e) {}
    }
    function saveReportConfig() {
        try { localStorage.setItem(REPORT_KEY, JSON.stringify(reportConfig)); } catch (e) {}
    }
    // 知情同意书：首次启用弹出（默认不授权上报；同意后才显示并可用上报设置，仍默认关闭）
    function showConsentModal(force) {
        const granted = reportConfig.consent === true && reportConfig.consentVersion === '1.0';
        if (!force && granted) return; // 已按当前版本同意书授权（force=重新授权）
        if ($1('#b6-consent')) return;
        const m = document.createElement('div');
        m.id = 'b6-consent';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(30,40,50,.5);z-index:2147483647;display:flex;align-items:center;justify-content:center;font:13px/1.7 "Microsoft YaHei",sans-serif';
        m.innerHTML =
            '<div style="width:420px;max-width:92vw;background:#F7F9FB;border:1px solid #CBD6E0;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);overflow:hidden">' +
            '<div style="background:#33475C;color:#F0F4F7;padding:12px 16px;font-weight:600;font-size:14px;letter-spacing:1px">知情同意书</div>' +
            '<div style="padding:14px 16px;color:#2B3A49;max-height:55vh;overflow:auto">' +
            '<p style="margin:0 0 8px">本脚本在以下情况下可能向第三方发送数据，请阅读后授权：</p>' +
            '<ol style="padding-left:18px;margin:0 0 8px">' +
            '<li>失效自动上报：网站改版导致脚本失效时，可自动向 GitHub 提交 issue。内容仅含脚本版本、打码页面路径、检测结果、时间，24 小时内同版本仅上报一次。</li>' +
            '<li>AI 答题（可选）：启用后，题目文本发送至您自行配置的 AI 服务商。</li>' +
            '<li>凭据存储：AI Key 与 GitHub Token 明文保存在本地浏览器 localStorage，建议使用最小权限令牌。</li>' +
            '</ol>' +
            '<p style="margin:0">默认<strong>不启用</strong>失效自动上报；授权后仍可在设置面板随时开关或撤销。</p>' +
            '</div>' +
            '<div style="padding:12px 16px;border-top:1px solid #E3E8EE;display:flex;gap:8px;justify-content:flex-end">' +
            '<button id="b6-consent-no" style="padding:7px 14px;background:#fff;color:#5A6B7A;border:1px solid #CBD6E0;border-radius:5px;cursor:pointer">拒绝</button>' +
            '<button id="b6-consent-yes" style="padding:7px 14px;background:#3D6B99;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:600">同意并继续</button>' +
            '</div></div>';
        document.body.appendChild(m);
        $1('#b6-consent-yes').addEventListener('click', () => {
            reportConfig.consent = true;
            reportConfig.consentVersion = '1.0';
            saveReportConfig();
            m.remove();
            syncReportArea();
            maybeShowGuide();
        });
        $1('#b6-consent-no').addEventListener('click', () => {
            reportConfig.consent = false;
            reportConfig.consentVersion = '';
            saveReportConfig();
            m.remove();
            syncReportArea();
            maybeShowGuide();
        });
    }

    // 上报区显隐：仅在知情同意书授权（consent=true）后显示表单；未授权显示授权入口（默认不允许）
    function syncReportArea() {
        const form = $1('#b6-rp-form'), auth = $1('#b6-rp-auth');
        if (!form || !auth) return;
        const granted = reportConfig.consent === true && reportConfig.consentVersion === '1.0';
        form.style.display = granted ? 'block' : 'none';
        auth.style.display = granted ? 'none' : 'block';
    }

    // 首次使用引导（知情同意书之后弹出；可随时经主面板"?"重新查看）
    const GUIDE_KEY = 'tsh_auto_brush_guide';
    function maybeShowGuide() {
        try { if (localStorage.getItem(GUIDE_KEY) === '1') return; } catch (e) {}
        showGuide();
    }
    function showGuide() {
        if ($1('#b6-guide')) return;
        const m = document.createElement('div');
        m.id = 'b6-guide';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(30,40,50,.5);z-index:2147483647;display:flex;align-items:center;justify-content:center;font:13px/1.7 "Microsoft YaHei",sans-serif';
        m.innerHTML =
            '<div style="width:440px;max-width:92vw;background:#F7F9FB;border:1px solid #CBD6E0;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);overflow:hidden">' +
            '<div style="display:flex;align-items:center;gap:8px;padding:12px 16px;background:#33475C;color:#F0F4F7;font-weight:600;font-size:14px;letter-spacing:1px">' +
            '<span style="width:20px;height:20px;background:#7C93A8;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);display:inline-flex;align-items:center;justify-content:center;font-size:9px;color:#F4F7FA">R</span>' +
            '使用引导</div>' +
            '<div style="padding:14px 16px;color:#2B3A49;max-height:58vh;overflow:auto">' +
            '<ol style="padding-left:18px;margin:0">' +
            '<li style="margin-bottom:8px"><strong>登录</strong>：打开 www.tsinghuaelt.com 并登录。</li>' +
            '<li style="margin-bottom:8px"><strong>开始刷课</strong>：进入任意练习页，点面板"开始刷课"挂机即可。脚本自动答题、翻页、跨任务/跨单元推进，刷完整门课自动停止。</li>' +
            '<li style="margin-bottom:8px"><strong>AI 答题（可选）</strong>：点主面板"设置"打开设置面板，启用并填入 API 配置；AI 出答案，失败自动回退试错法，答题不中断。</li>' +
            '<li style="margin-bottom:8px"><strong>查成绩 / 刷时长</strong>：随时点主面板对应按钮查看进度；刷学习时长需在练习页挂机。</li>' +
            '<li style="margin-bottom:8px"><strong>失效上报</strong>：需先在知情同意书授权（默认关闭），再在设置面板填写 GitHub 信息并启用。</li>' +
            '<li><strong>限流自动恢复</strong>：偶发"系统繁忙"会冷却约 90 秒自动继续，无需操作。</li>' +
            '</ol>' +
            '</div>' +
            '<div style="padding:12px 16px;border-top:1px solid #E3E8EE;display:flex;gap:8px;justify-content:flex-end">' +
            '<button id="b6-guide-ok" style="padding:7px 16px;background:#3D6B99;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:600">开始使用</button>' +
            '</div></div>';
        document.body.appendChild(m);
        $1('#b6-guide-ok').addEventListener('click', () => {
            try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) {}
            m.remove();
        });
    }
    // 核心 DOM 探针：在课程/练习页上，关键选择器应至少命中 1 个；全缺 → 站点改版
    function checkScriptValidity() {
        if (!/tsinghuaelt\.com/.test(location.hostname)) return true; // 非本站不判
        if (document.readyState !== 'complete') return true; // 页面加载中不判定（避免误报失效）
        const probes = ['button.wy-btn', '.lib-single-item', '.page-next', 'app-course-task-stu', '.courseList', '.uniteTitle'];
        return probes.some(s => $1(s)) === true;
    }
    // 上报 GitHub issue（24h 去重）
    async function reportIssue(reason) {
        if (!reportConfig.enabled || !reportConfig.owner || !reportConfig.repo || !reportConfig.token || reportConfig.consent !== true || reportConfig.consentVersion !== '1.0') return false;
        const now = Date.now();
        if (now - reportConfig.lastReport < 86400000) return false; // 24h 去重
        const title = '[自动报告] 清华社刷课脚本可能失效 v' + SCRIPT_VERSION;
        // 打码页面：剥离 query/hash，数字型课程/用户 ID 替换为占位符（公开 issue 可见，防泄漏）
        const pathMasked = location.pathname
            .replace(/course-study-student\/\d+\/(\d+)/, 'course-study-student/{bookId}/{courseId}')
            .replace(/course-student\/(\d+)\/study/, 'course-student/{courseId}/study');
        const safePage = location.origin + pathMasked;
        const body = [
            '**脚本版本**：v' + SCRIPT_VERSION,
            '**站点**：https://www.tsinghuaelt.com',
            '**页面**：' + safePage.slice(0, 120),
            '**时间**：' + new Date().toLocaleString('zh-CN'),
            '**检测**：核心 DOM 探针全未命中（站点可能改版）',
            '**原因**：' + (reason || '脚本失效检测触发')
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
                body: JSON.stringify({ title: title, body: body })
            });
            if (resp.ok) {
                reportConfig.lastReport = now;
                saveReportConfig();
                status('已自动上报 issue（24h 内不再重复）');
                return true;
            }
            status('上报失败（HTTP ' + resp.status + '，检查 token 权限）');
        } catch (e) {
            status('上报失败（网络）');
        }
        return false;
    }

    // ================= AI 配置与调用（OpenAI 兼容） =================
    const AI_STORAGE_KEY = 'tsh_auto_brush_ai';
    const AMAP = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9 };
    let aiConfig = { enabled: false, baseUrl: '', apiKey: '', model: '' };
    function loadAiConfig() {
        try {
            const s = localStorage.getItem(AI_STORAGE_KEY);
            if (s) aiConfig = Object.assign(aiConfig, JSON.parse(s));
        } catch (e) {}
    }
    function saveAiConfig() {
        try { localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(aiConfig)); } catch (e) {}
    }
    function aiEnabled() {
        return !!(aiConfig.enabled && aiConfig.baseUrl && aiConfig.apiKey && aiConfig.model);
    }
    // OpenAI 兼容 chat/completions 调用，返回文本内容；失败/超时返回 null
    async function aiAsk(prompt) {
        if (!aiEnabled()) return null;
        const url = aiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + aiConfig.apiKey },
                body: JSON.stringify({
                    model: aiConfig.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    max_tokens: 1024
                }),
                signal: ctrl.signal
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            const content = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
            return typeof content === 'string' ? content.trim() : null;
        } catch (e) {
            // 网络超时 / 连接失败 / 限流等：提示并回退试错法（不中断答题）
            status('AI 请求失败（' + (e.name === 'AbortError' ? '超时' : '网络/连接') + '），已回退试错法');
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    // ================= 成绩查询与学习时长（综合成绩） =================
    // 请求签名（与站点拦截器同算法；依赖页面暴露的 window.CryptoJS）
    function makeSigned(url) {
        try {
            const cu = JSON.parse(localStorage.getItem('tsinghuayingyu-front.currUser') || '{}');
            if (!cu.id || typeof window.CryptoJS === 'undefined') return null;
            const f = (crypto.randomUUID ? crypto.randomUUID() : 'x'.repeat(36));
            const rid = Math.floor(100000 + Math.random() * 900000) + '';
            const m = url + (url.indexOf('?') > -1 ? '&' : '?')
                + 'clientTime=' + f + '&diResU=' + cu.id + '&diLoohcs=' + cu.schoolId
                + '&version=3.0.149&request_id=' + rid;
            const x = m.split('?')[1].split('&').map(k => k.split('=')[0]).sort().join('');
            return { url: m, sign: CryptoJS.MD5((cu.serverTime || '') + f + x + cu.id).toString() };
        } catch (e) { return null; }
    }
    function getCourseId() {
        // 练习页 /course-study-student/{bookId}/{courseId}/... 与 主页 /course-student/{courseId}/study
        let m = location.pathname.match(/course-study-student\/\d+\/(\d+)/);
        if (m) return m[1];
        m = location.pathname.match(/course-student\/(\d+)\/study/);
        return m ? m[1] : null;
    }
    // 查综合成绩（POST /tsenglish/course/stuGeneralScore；注意 POST 有约 1 次/秒频率限制）
    async function fetchScore() {
        const courseId = getCourseId();
        const cu = JSON.parse(localStorage.getItem('tsinghuayingyu-front.currUser') || '{}');
        if (!courseId || !cu.id) return null;
        const s = makeSigned('/tsenglish/course/stuGeneralScore?id=' + courseId + '&userId=' + cu.id);
        if (!s) return null;
        const res = await fetch(s.url, { method: 'POST', headers: { 'sign': s.sign, 'Content-Type': 'application/json' }, body: '{}' });
        const body = await res.text();
        // 频率限制（HTTP 530）或业务拦截提示
        if (res.status === 530 || body.indexOf('系统繁忙') > -1 || body.indexOf('频繁') > -1) {
            return { blocked: true };
        }
        if (res.status !== 200) return null;
        try { return JSON.parse(body); } catch (e) { return null; }
    }
    function formatScore(data) {
        if (data && data.blocked) return '⚠ 触发频率限制（HTTP 530），请等待 30 秒后再试，勿连续点击';
        if (!data || !data.object) return '查询失败（需在课程页且已登录）';
        const cv = data.object.courseScoreVo, ev = data.object.examSetVo, sv = data.object.stuScoreVo;
        if (!cv || !ev || !sv) return '返回数据异常';
        const lines = [];
        lines.push('综合成绩: ' + cv.score + ' 分 | 排名 ' + cv.rank);
        lines.push('最高 ' + cv.maxScore + ' / 最低 ' + cv.minScore + ' / 平均 ' + cv.avgScore);
        const dims = [
            ['学习时长', sv.studyTimeScore, ev.studyTimeRate, sv.studyTime],
            ['完成率', sv.completeScore, ev.completeRate, sv.complete + '%'],
            ['学习得分', sv.studyScore, ev.studyScoreRate, ''],
            ['作业', sv.homeworkScore, ev.homeworkScoreRate, ''],
            ['测试', sv.testScore, ev.testRate, ''],
            ['期末', sv.endScore, ev.endRate, '']
        ];
        for (const [name, score, rate, extra] of dims) {
            if (rate > 0) lines.push(name + ': ' + score + '/' + rate + (extra ? '（' + extra + '）' : ''));
        }
        return lines.join('\n');
    }

    // ---- 学习时长刷取 ----
    // 机制：页面 setInterval 每 10 秒自动上报 course/studyTimeCountNew（挂机即涨）；
    // 后端对高频重放去重（实测 30 次 300ms 间隔不累计），只能按真实时间节奏累计。
    // 本模块：hook 捕获页面真实上报地址（含 stuKey），并兜底定时重放（页面切走也尽量续报）。
    let studyReport = null;   // 捕获的 {method, url, sign}（每次页面上报自动刷新）
    let studyTimer = null;
    let studyCount = 0;
    function hookStudyReport() {
        try {
            const origOpen = XMLHttpRequest.prototype.open;
            const origSet = XMLHttpRequest.prototype.setRequestHeader;
            const origSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; this.__u = u; this.__h = {}; return origOpen.apply(this, arguments); };
            XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
                if (!this.__h) this.__h = {};
                if (k.toLowerCase() === 'sign') this.__h.sign = v;
                return origSet.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function (b) {
                // 每次捕获刷新（不一次性锁死），确保拿到最新 URL+sign，且校验 sign 存在
                if (this.__u && this.__u.indexOf('studyTimeCountNew') > -1 && this.__h.sign) {
                    studyReport = { method: this.__m || 'GET', url: this.__u, sign: this.__h.sign };
                }
                return origSend.apply(this, arguments);
            };
        } catch (e) {}
    }
    function startStudyFarm() {
        if (studyTimer) return;
        hookStudyReport();
        studyCount = 0;
        studyTimer = setInterval(async () => {
            // 离开练习页则自动停止（防 SPA 路由后上报旧地址）
            if (!isExercisePage()) { stopStudyFarm(); return; }
            if (studyReport) {
                try {
                    await fetch(studyReport.url, {
                        method: studyReport.method,
                        headers: studyReport.sign ? { 'sign': studyReport.sign } : {}
                    });
                    studyCount++;
                    status('刷时长中 第' + studyCount + ' 次（挂机累计）');
                } catch (e) { status('刷时长上报失败: ' + e.message); }
            } else {
                status('等待捕获学习时长上报地址...');
            }
        }, 10000);
        status('刷时长开始（每10秒上报，挂机累计）');
    }
    function stopStudyFarm() {
        if (studyTimer) { clearInterval(studyTimer); studyTimer = null; }
        const b = $1('#b6-farm');
        if (b) { b.textContent = '刷学习时长'; b.style.background = '#fff'; }
        status('刷时长已停止');
    }

    // ================= 页面识别 =================
    function isCourseHome() {
        return /\/course-student\/\d+\/study/.test(location.pathname)
            || /\/studentcourse/.test(location.pathname)
            || !!$1('.courseList') || !!$1('.uniteTitle');
    }
    function isExercisePage() {
        return location.pathname.indexOf('/course-study-student/') !== -1 || !!$1('app-course-task-stu');
    }

    // ================= 题型检测 =================
    function detectType() {
        if ($1('lib-video-exercise-cs-study') || $1('#J_prismPlayer') || $1('.prism-player')) return 'video';
        if ($1('lib-listen-and-repeat-exercise-cs-study') || $('.lib-listen-container').length) return 'listen_repeat';
        if ($1('lib-oral-brief-exercise-cs-study') || $1('lib-free-assess-exercise-cs-study') || $1('lib-paragraph-assess-exercise-cs-study')) return 'oral';
        if ($1('lib-role-play-exercise-cs-study') || $('.lib-role-select-item').length) return 'roleplay';
        if ($1('lib-judge-exercise-cs-study') || $('.lib-judge-radio').length) return 'judge';
        if ($1('lib-drop-down-exercise-cs-study') || $('.lib-drop-down-container').length || $('.lib-drop-down-item-select').length) return 'dropdown';
        if ($1('lib-fill-blank-exercise-cs-study') || $('.lib-fill-blank-do-input-left').length) return 'fill';
        if ($1('lib-drag-drop-one-exercise-cs-study') || $1('lib-drag-drop-many-exercise-cs-study') || $1('lib-paragraph-drop-exercise-cs-study') || $('.lib-drag-box').length || $('.lib-drag-item').length) return 'drag';
        if ($1('lib-multiple-choice-exercise-cs-study') || $1('lib-single-choice-exercise-cs-study')) {
            // 多选组件名或 no-choices 图标
            if ($1('lib-multiple-choice-exercise-cs-study') || $('.lib-single-item-img img[src*="no-choices"]').length) return 'multiple';
            return 'single';
        }
        if ($('.lib-single-box').length) {
            return $('.lib-single-item-img img[src*="no-choices"]').length ? 'multiple' : 'single';
        }
        if ($('.lib-textarea-container').length || $('.img-blank-answer').length) return 'listen_fill';
        return 'unknown';
    }

    // 页面是否处于"已作答完成"状态（按钮只剩 Retry，且无 Submit）
    function isAnsweredState() {
        const btns = $('button.wy-btn').map(b => (b.textContent || '').trim());
        return btns.includes('Retry') && !btns.includes('Submit');
    }
    // 是否处于可作答状态（有 Submit 按钮）
    function isAnsweringState() {
        return $('button.wy-btn').some(b => (b.textContent || '').trim() === 'Submit');
    }

    // ================= 按钮 =================
    function findBtn(texts) {
        const all = $('button.wy-btn, button.ant-btn, .wy-course-btn-right button, button[class*="btn"]');
        for (const b of all) {
            if (!b.isConnected) continue;
            const st = getComputedStyle(b);
            if (st.display === 'none' || st.visibility === 'hidden') continue;
            const t = (b.textContent || '').replace(/\s+/g, '').toLowerCase();
            for (const tx of texts) {
                if (t.indexOf(tx.toLowerCase()) >= 0) return b;
            }
        }
        return null;
    }
    async function clickSubmit() {
        await sleep(rnd(800, 2000));
        const b = findBtn(['Submit', '提交']);
        if (b) { click(b); await sleep(rnd(1500, 3500)); return true; }
        return false;
    }

    // 智能提交：先播放页面音频（听力题需播完才能提交），点击 Submit，并确认提交成功（按钮变 Retry）
    async function submitSmart() {
        await sleep(rnd(600, 1500));
        const audio = $1('lib-audio-player audio, .show-audio audio, audio');
        if (audio) {
            try {
                audio.muted = true; // 静音播放，绕过浏览器自动播放策略
                const p = audio.play();
                if (p && p.catch) p.catch(() => {});
                audio.playbackRate = 4;
            } catch (e) {}
            await sleep(rnd(2000, 3500));
            // 播放被拦截（仍处于暂停）→ 直接快进到结尾
            if (audio.paused) {
                try { audio.currentTime = (audio.duration || 60) - 1; } catch (e) {}
            }
        }
        let b = findBtn(['Submit', '提交']);
        if (b) { click(b); }
        await sleep(rnd(2500, 4000));
        if (isAnsweredState()) return true;
        // 首次提交未生效：尝试快进音频后，等待 3 秒（频率限制窗口）再重试一次
        if (audio) {
            try { audio.currentTime = (audio.duration || 60) - 1; } catch (e) {}
        }
        await sleep(3000);
        b = findBtn(['Submit', '提交']);
        if (b) { click(b); await sleep(rnd(3000, 4000)); }
        if (isAnsweredState()) return true;
        // 二次提交仍失败 → 疑似触发频率限制（HTTP 530 / 系统繁忙），标记停止
        rateLimited = true;
        return false;
    }
    async function clickRetry() {
        await sleep(rnd(800, 1500));
        const b = findBtn(['Retry', '重试', '重做']);
        if (b) { click(b); await sleep(rnd(1500, 3000)); return true; }
        return false;
    }

    // ================= AI 猜测（按题型构造 prompt） =================
    // 单选/多选：返回每题字母答案数组（如 ['A','BC']）；失败返回 null
    async function aiGuessChoice(groups, isMultiple) {
        if (!aiEnabled()) return null;
        const lines = [];
        groups.forEach((g, i) => {
            const stem = $1('.exercise-content, .default-stem-content, [class*="stem"]', g);
            const items = $('.lib-single-item', g);
            const opts = items.map((it, j) => {
                const label = $1('.lib-single-item-order', it);
                return (label ? (label.textContent || '').trim() : String.fromCharCode(65 + j)) + '. ' + (it.textContent || '').trim().replace(/\s+/g, ' ');
            });
            lines.push('题目' + (i + 1) + '：' + (stem ? (stem.textContent || '').trim().replace(/\s+/g, ' ') : '(无文字题目，可能是听力题，请根据选项语义推断)'));
            lines.push('选项：' + opts.join('  '));
        });
        const prompt = '你是英语在线学习平台的答题助手。根据题目和选项，给出正确答案的字母。'
            + (isMultiple ? '多选题：每行输出该题所有正确字母，用逗号分隔（如 A,C,D）。' : '单选题：每行只输出一个字母（如 A）。')
            + '严格按题目顺序输出，每题一行，不要输出任何解释或其他文字。\n\n' + lines.join('\n');
        const out = await aiAsk(prompt);
        if (!out) return null;
        const answers = out.split(/\n+/).map(l => (l.match(/[A-Ja-j]/g) || []).map(x => x.toUpperCase()).join('')).filter(Boolean);
        return answers.length ? answers : null;
    }

    // 判断：返回每行 T/F
    async function aiGuessJudge(rows) {
        if (!aiEnabled()) return null;
        const lines = rows.map((r, i) => (i + 1) + '. ' + (r.textContent || '').trim().replace(/\s+/g, ' '));
        const prompt = '判断以下英语句子描述的正误（True/False）。严格按题目顺序，每行只输出 T 或 F，不要输出任何解释或其他文字。\n\n' + lines.join('\n');
        const out = await aiAsk(prompt);
        if (!out) return null;
        const answers = out.split(/\n+/).map(l => { const m = l.match(/[TFtf]/); return m ? m[0].toUpperCase() : ''; }).filter(Boolean);
        return answers.length ? answers : null;
    }

    // 下拉：返回每空答案文本
    async function aiGuessDropdown(sels) {
        if (!aiEnabled()) return null;
        const words = $('.lib-select-word-list-content-item-main').map(w => (w.textContent || '').trim()).filter(Boolean);
        const dir = $1('.exercise-directiveContent');
        const lines = sels.map((sel, i) => {
            const item = sel.closest('.lib-drop-down-item');
            const numEl = item ? $1('.lib-drop-down-item-content', item) : null;
            return '空' + (i + 1) + '：' + (numEl ? (numEl.textContent || '').trim() : '');
        });
        const prompt = '你是英语在线学习平台的答题助手。根据题干和候选词，为每个空选择正确的单词。'
            + '候选词：' + (words.join(', ') || '(无)')
            + '\n严格按空的顺序，每行输出一个空对应的词，不要输出任何解释或其他文字。\n\n'
            + '题干：' + (dir ? (dir.textContent || '').trim().replace(/\s+/g, ' ') : '(无文字题干)') + '\n'
            + lines.join('\n');
        const out = await aiAsk(prompt);
        if (!out) return null;
        const answers = out.split(/\n+/).map(l => l.replace(/^\d+[.、)\s]+/, '').trim()).filter(Boolean);
        return answers.length ? answers : null;
    }

    // 填空：返回每空答案文本
    async function aiGuessFill(inputs) {
        if (!aiEnabled()) return null;
        const dir = $1('.exercise-directiveContent');
        const prompt = '你是英语在线学习平台的答题助手。根据题干上下文，填写每个空。'
            + '严格按空的顺序，每行输出一个空的答案（可以是不定冠词、介词、动词形式等），不要输出任何解释或其他文字。\n\n'
            + '题干：' + (dir ? (dir.textContent || '').trim().replace(/\s+/g, ' ') : '(无文字题干，请根据上下文推断)')
            + '\n共 ' + inputs.length + ' 个空，请输出 ' + inputs.length + ' 行。';
        const out = await aiAsk(prompt);
        if (!out) return null;
        const answers = out.split(/\n+/).map(l => l.replace(/^\d+[.、)\s]+/, '').trim()).filter(Boolean);
        return answers.length ? answers : null;
    }

    // ================= 单选/多选 =================
    // 每题组：lib-adap-group/lib-adap-exercise 外层容器 > 内层题型组件；取最内层组件
    function getQuizGroups() {
        const innerSel = 'lib-single-choice-exercise-cs-study, lib-single-choice-exercise-tb-study, lib-multiple-choice-exercise-cs-study';
        let groups = $('lib-adap-group-exercise-cs-study, lib-adap-exercise-cs-study, ' + innerSel);
        // 去重：保留不含任何内层组件的组（即最内层题型组件本身）
        groups = groups.filter(g => !g.querySelector(innerSel));
        if (groups.length === 0) {
            // 直接单选容器
            const boxes = $('.lib-single-box');
            groups = boxes;
        }
        return groups;
    }

    function optionLetter(orderText) {
        const m = (orderText || '').match(/[A-Ha-h]/);
        return m ? m[0].toUpperCase() : null;
    }

    // 点击某组的第 idx 个选项（单选点击 p，实测有效）
    function clickOption(group, idx) {
        const items = $('.lib-single-item', group);
        const it = items[idx];
        if (!it) return false;
        const p = $1('p.lib-single-item-one, .lib-single-item-content', it);
        click(p || it);
        return true;
    }

    // 从已提交的 DOM 读正确答案（.lib-single-cs-answer span）
    function readChoiceAnswers() {
        const groups = getQuizGroups();
        const answers = [];
        for (const g of groups) {
            const spans = $('.lib-single-cs-answer span', g);
            if (spans.length) {
                answers.push(spans.map(s => (s.textContent || '').trim()).filter(Boolean).join(''));
            } else {
                answers.push('');
            }
        }
        return answers;
    }

    async function solveChoice(isMultiple) {
        const groups = getQuizGroups();
        if (groups.length === 0) return 'no-groups';
        // ---- 试错：优先 AI 猜测，失败则随机 ----
        const aiAns = await aiGuessChoice(groups, isMultiple);
        if (aiAns) status('AI 答案: ' + aiAns.join(', '));
        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            const items = $('.lib-single-item', g);
            if (items.length === 0) continue;
            const guess = aiAns && aiAns[i];
            if (guess) {
                // AI 答案直接点选
                for (const ch of guess) {
                    const idx = AMAP[ch.toUpperCase()];
                    if (idx !== undefined) { clickOption(g, idx); await sleep(rnd(150, 350)); }
                }
            } else if (isMultiple) {
                // 多选随机选 1~3 个
                const n = rnd(1, Math.min(3, items.length) + 1);
                const chosen = new Set();
                for (let k = 0; k < n; k++) {
                    let idx = rnd(0, items.length);
                    if (chosen.has(idx)) { k--; continue; }
                    chosen.add(idx);
                    clickOption(g, idx);
                }
            } else {
                clickOption(g, rnd(0, items.length));
            }
            await sleep(rnd(150, 400));
        }
        await submitSmart();
        // ---- 读答案 ----
        const answers = readChoiceAnswers();
        if (!answers.length || answers.every(a => !a)) {
            // fallback：从 wy-lib-right 标记读
            return 'no-answer';
        }
        // ---- Retry 重做 ----
        if (!await clickRetry()) return 'no-retry';
        await sleep(rnd(500, 1200));
        // ---- 按答案填 ----
        const groups2 = getQuizGroups();
        for (let i = 0; i < groups2.length; i++) {
            const g = groups2[i];
            const ans = answers[i] || '';
            for (const ch of ans) {
                const idx = AMAP[ch.toUpperCase()];
                if (idx !== undefined) { clickOption(g, idx); await sleep(rnd(120, 300)); }
            }
        }
        await sleep(rnd(300, 800));
        await submitSmart();
        return 'done';
    }

    // ================= 判断 =================
    async function solveJudge() {
        const rows = $('.lib-judge-left-item');
        const cols = $('.lib-judge-right-item-text');
        if (rows.length === 0 || cols.length === 0) return 'no-structure';
        // 每行 T/F 列数（实测为 2）
        const colCount = $('.lib-judge-right-item').length ? ($('.lib-judge-right-item')[0].querySelectorAll('.lib-judge-right-item-i').length || 2) : 2;
        // ---- 试错：优先 AI 猜测，失败每行点第一列 ----
        const aiAns = await aiGuessJudge(rows);
        if (aiAns) status('AI 答案: ' + aiAns.join(','));
        const radios = $('.lib-judge-radio');
        for (let i = 0; i < rows.length; i++) {
            if (aiAns && aiAns[i]) {
                // 按 AI 答案点对应列
                for (let c = 0; c < colCount; c++) {
                    const radio = radios[i * colCount + c];
                    if (!radio) continue;
                    const item = radio.closest('.lib-judge-right-item-i');
                    const txt = item ? $1('.lib-judge-right-item-text', item) : null;
                    if (txt && (txt.textContent || '').trim() === aiAns[i]) { clickSeq(radio); break; }
                }
            } else {
                const r = radios[i * colCount];
                if (r) clickSeq(r);
            }
            await sleep(rnd(150, 350));
        }
        await submitSmart();
        // ---- 读答案：Key 区或 wy-lib-right 标记 ----
        const keys = [];
        const keyTexts = $('.lib-judge-info .lib-judge-info-text, .lib-judge-info-text');
        if (keyTexts.length) {
            for (const k of keyTexts) keys.push((k.textContent || '').trim());
        } else {
            // fallback: 从每行的 wy-lib-right 读
            const rightRows = $('.lib-judge-right-item');
            for (const rr of rightRows) {
                const correct = $1('.wy-lib-right, .lib-judge-right-item-i.lib-judge-right', rr);
                if (correct) {
                    const txt = $1('.lib-judge-right-item-text', correct);
                    keys.push(txt ? (txt.textContent || '').trim() : '');
                } else keys.push('');
            }
        }
        if (!keys.length || keys.every(k => !k)) return 'no-answer';
        // ---- Retry ----
        if (!await clickRetry()) return 'no-retry';
        await sleep(rnd(500, 1200));
        // ---- 按答案填 ----
        const radios2 = $('.lib-judge-radio');
        for (let i = 0; i < keys.length; i++) {
            const want = keys[i];
            for (let c = 0; c < colCount; c++) {
                const radio = radios2[i * colCount + c];
                if (!radio) continue;
                const item = radio.closest('.lib-judge-right-item-i');
                const txt = item ? $1('.lib-judge-right-item-text', item) : null;
                if (txt && (txt.textContent || '').trim() === want) { clickSeq(radio); await sleep(rnd(150, 350)); }
            }
        }
        await sleep(rnd(300, 800));
        await submitSmart();
        return 'done';
    }

    // ================= 下拉 =================
    // 取当前展开的 nz-select 下拉选项（下拉渲染在 body，同一时刻通常只有一个展开）
    function getOpenDropdownOptions() {
        const dd = $1('.ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-select-dropdown:not([style*="display: none"])');
        return dd ? $('.ant-select-item-option, .ant-select-dropdown-menu-item', dd) : [];
    }

    async function solveDropdown() {
        const sels = $('.lib-drop-down-item-select nz-select, .lib-drop-down-item-select .ant-select, .ant-select');
        if (sels.length === 0) return 'no-selects';
        // ---- 试错：优先 AI 猜测，失败随机选 ----
        const aiAns = await aiGuessDropdown(sels);
        if (aiAns) status('AI 答案: ' + aiAns.join(', '));
        for (let i = 0; i < sels.length; i++) {
            const sel = sels[i];
            const trigger = $1('.ant-select-selection, .ant-select', sel) || sel;
            clickSeq(trigger);
            await sleep(rnd(400, 800));
            const opts = getOpenDropdownOptions();
            if (!opts.length) continue;
            let picked = null;
            if (aiAns && aiAns[i]) {
                picked = opts.find(o => (o.textContent || '').trim() === aiAns[i]) || null;
            }
            if (picked) clickSeq(picked);
            else clickSeq(opts[rnd(0, opts.length)]);
            await sleep(rnd(200, 400));
        }
        await submitSmart();
        // ---- 读答案：每个 .lib-edit-score.lib-edit-score-tb 里 Key 后的 span ----
        const keys = [];
        $('.lib-edit-score.lib-edit-score-tb span.wy-lib-cs-key, .lib-edit-score span.wy-lib-cs-key').forEach(k => {
            const next = k.nextElementSibling;
            if (next) keys.push((next.textContent || '').trim());
        });
        if (!keys.length) {
            // fallback: 选项 wy-lib-right 标记
            const items = $('.lib-drop-down-item');
            for (const it of items) {
                const right = $1('.wy-lib-right', it);
                keys.push(right ? (right.textContent || '').trim() : '');
            }
        }
        if (!keys.length || keys.every(k => !k)) return 'no-answer';
        // ---- Retry ----
        if (!await clickRetry()) return 'no-retry';
        await sleep(rnd(500, 1200));
        // ---- 按答案填 ----
        const sels2 = $('.lib-drop-down-item-select nz-select, .lib-drop-down-item-select .ant-select, .ant-select');
        for (let i = 0; i < sels2.length && i < keys.length; i++) {
            const sel = sels2[i];
            const trigger = $1('.ant-select-selection, .ant-select', sel) || sel;
            clickSeq(trigger);
            await sleep(rnd(400, 800));
            const opts = getOpenDropdownOptions();
            for (const o of opts) {
                if ((o.textContent || '').trim() === keys[i]) { clickSeq(o); break; }
            }
            await sleep(rnd(200, 400));
        }
        await sleep(rnd(300, 800));
        await submitSmart();
        return 'done';
    }

    // ================= 填空 =================
    async function solveFill() {
        let inputs = $('.lib-fill-blank-do-input-left, .lib-textarea-container textarea, .img-blank-answer input');
        if (inputs.length === 0) return 'no-inputs';
        // ---- 试错：优先 AI 猜测，失败随机填 ----
        const aiAns = await aiGuessFill(inputs);
        if (aiAns) status('AI 答案: ' + aiAns.join(', '));
        for (let i = 0; i < inputs.length; i++) {
            fill(inputs[i], (aiAns && aiAns[i]) ? aiAns[i] : rw());
            await sleep(rnd(100, 250));
        }
        await submitSmart();
        // ---- 读答案：优先 .lib-edit-score.lib-edit-score-tb 的 Key 后 span（与下拉题同结构），兜底旧 data-type 结构 ----
        let anyVary = false;
        const ans = [];
        $('.lib-edit-score.lib-edit-score-tb span.wy-lib-cs-key, .lib-edit-score span.wy-lib-cs-key').forEach(k => {
            const next = k.nextElementSibling;
            if (!next) return;
            const t = (next.textContent || '').trim();
            if (t.toLowerCase().indexOf('vary') >= 0) { anyVary = true; ans.push('*ANY*'); }
            else ans.push(t);
        });
        if (!ans.length) {
            $('.lib-edit-score span[data-type="1"]').forEach(el => {
                const t = (el.textContent || '').trim();
                if (t.toLowerCase().indexOf('vary') >= 0) { anyVary = true; ans.push('*ANY*'); }
                else ans.push(t);
            });
        }
        if (!ans.length) return 'no-answer';
        // ---- Retry ----
        if (!await clickRetry()) return 'no-retry';
        await sleep(rnd(500, 1200));
        // ---- 按答案填 ----
        const inputs2 = $('.lib-fill-blank-do-input-left, .lib-textarea-container textarea, .img-blank-answer input');
        for (let i = 0; i < inputs2.length; i++) {
            const v = ans[i] === '*ANY*' ? rw() : (ans[i] || rw());
            fill(inputs2[i], v);
            await sleep(rnd(100, 250));
        }
        await sleep(rnd(300, 800));
        await submitSmart();
        return 'done';
    }

    // ================= 跟读/录音 =================
    async function solveListenRepeat() {
        // 每个句子：点"录音" → 录 1.5~3 秒 → 点"停止"（出现"播放"按钮即录音成功）
        const items = $('.lib-listen-item');
        for (const item of items) {
            const rec = $1('img[title="录音"], .lib-listen-item-right-img img:last-child', item);
            if (rec) {
                clickSeq(rec);
                await sleep(rnd(1500, 2500));
                const stop = $1('img[title="停止"]', item);
                if (stop) clickSeq(stop);
                await sleep(rnd(400, 900));
            }
        }
        await sleep(rnd(2000, 4000)); // 等录音上传/评测
        await submitSmart();
        return 'done';
    }

    // ================= 口语 =================
    async function solveOral() {
        // 找录音按钮：完成"录音 → 停止"
        const recBtn = $1('img[title="录音"], .lib-oral-img, [class*="record"]');
        if (recBtn) {
            clickSeq(recBtn);
            await sleep(rnd(2000, 3000));
            const stop = $1('img[title="停止"]');
            if (stop) clickSeq(stop);
        }
        await sleep(rnd(2000, 4000));
        await submitSmart();
        return 'done';
    }

    // ================= 角色扮演 =================
    async function solveRoleplay() {
        const items = $('.lib-role-select-item');
        if (items.length) { clickSeq(items[0]); await sleep(rnd(400, 800)); }
        const start = $1('.lib-role-select-start button, button[class*="start"]');
        if (start) { click(start); await sleep(rnd(2000, 4000)); }
        // 对话/录音兜底：若出现录音按钮，录几秒后停止
        const recBtn = $1('img[title="录音"]');
        if (recBtn) {
            clickSeq(recBtn);
            await sleep(rnd(2000, 3000));
            const stop = $1('img[title="停止"]');
            if (stop) clickSeq(stop);
            await sleep(rnd(1000, 2000));
        }
        await submitSmart();
        return 'done';
    }

    // ================= 拖拽 =================
    async function solveDrag() {
        const items = $('.lib-drag-item, [class*="drag-item"]');
        const zones = $('.lib-drag-item-place, .lib-drop-zone, [class*="drop-zone"], .blank, .lib-drag-ffzz');
        if (items.length === 0) return 'no-items';
        // 用 pointer 事件模拟拖拽
        async function dragTo(from, to) {
            if (!from || !to) return;
            const fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect();
            const sx = fr.left + fr.width / 2, sy = fr.top + fr.height / 2;
            const tx = tr.left + tr.width / 2, ty = tr.top + tr.height / 2;
            from.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: sx, clientY: sy, button: 0, pointerId: 1 }));
            await sleep(80);
            const steps = 10;
            for (let i = 1; i <= steps; i++) {
                const x = sx + (tx - sx) * i / steps, y = sy + (ty - sy) * i / steps;
                from.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
                await sleep(30);
            }
            to.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: tx, clientY: ty, button: 0, pointerId: 1 }));
            await sleep(150);
        }
        // ---- 试错 ----
        for (let i = 0; i < Math.min(items.length, zones.length); i++) {
            await dragTo(items[i], zones[i]);
            await sleep(rnd(150, 350));
        }
        await submitSmart();
        // ---- 读答案 ----
        let ans = [];
        $('.lib-drag-answer span, .lib-drag-answer-box span, [class*="drag-answer"] span').forEach(el => ans.push((el.textContent || '').trim()));
        if (!ans.length || ans.every(a => !a)) return 'no-answer';
        if (!await clickRetry()) return 'no-retry';
        await sleep(rnd(500, 1200));
        // ---- 按答案填 ----
        const items2 = $('.lib-drag-item, [class*="drag-item"]');
        const zones2 = $('.lib-drag-item-place, .lib-drop-zone, [class*="drop-zone"], .blank, .lib-drag-ffzz');
        for (let j = 0; j < ans.length && j < zones2.length; j++) {
            for (let k = 0; k < items2.length; k++) {
                if ((items2[k].textContent || '').trim() === ans[j]) { await dragTo(items2[k], zones2[j]); break; }
            }
        }
        await sleep(rnd(300, 800));
        await submitSmart();
        return 'done';
    }

    // ================= 视频 =================
    async function solveVideo() {
        const v = $1('#J_prismPlayer video') || $1('.prism-player video') || $1('video');
        if (v) {
            try {
                v.muted = true;
                v.playbackRate = 16;
                if (v.paused) v.play().catch(() => {});
                if (v.duration && v.duration > 5) v.currentTime = v.duration - 2;
            } catch (e) {}
        }
        const bigBtn = $1('.prism-big-play-btn, .prism-player .prism-big-play-btn');
        if (bigBtn) click(bigBtn);
        await sleep(rnd(6000, 10000));
        if (v && v.duration && v.duration > 5) { try { v.currentTime = v.duration - 1; } catch (e) {} }
        // Aliplayer 直接跳结尾
        try {
            const player = window['player'] || null;
            if (player && player.seek) player.seek(player.getDuration ? player.getDuration() - 1 : 999999);
        } catch (e) {}
        await sleep(rnd(3000, 5000));
        // 提交/下一步（音频视频题需播完，用 submitSmart 统一处理）
        if (isAnsweringState()) await submitSmart();
        return 'done';
    }

    // ================= 听力图片填空（遗留题型） =================
    async function solveListenFill() {
        const inputs = $('.lib-textarea-container textarea, .img-blank-answer input');
        for (const el of inputs) { fill(el, rw()); await sleep(rnd(100, 250)); }
        await submitSmart();
        const ans = [];
        // 与 solveFill 统一：Key 后 span 优先，兜底 data-type
        $('.lib-edit-score.lib-edit-score-tb span.wy-lib-cs-key, .lib-edit-score span.wy-lib-cs-key').forEach(k => {
            const next = k.nextElementSibling;
            if (next) ans.push((next.textContent || '').trim());
        });
        if (!ans.length) {
            $('.lib-edit-score span[data-type="1"]').forEach(el => ans.push((el.textContent || '').trim()));
        }
        if (ans.length && await clickRetry()) {
            await sleep(rnd(500, 1200));
            const inputs2 = $('.lib-textarea-container textarea, .img-blank-answer input');
            for (let i = 0; i < inputs2.length; i++) { fill(inputs2[i], ans[i] || rw()); await sleep(rnd(100, 250)); }
            await sleep(rnd(300, 800));
            await submitSmart();
        }
        return 'done';
    }

    // ================= 练习页主流程 =================
    async function doExercise() {
        // 关闭可能的弹窗
        closeModals();
        const type = detectType();
        status('题型: ' + type);
        let result = 'unknown';
        try {
            switch (type) {
                case 'single': result = await solveChoice(false); break;
                case 'multiple': result = await solveChoice(true); break;
                case 'judge': result = await solveJudge(); break;
                case 'dropdown': result = await solveDropdown(); break;
                case 'fill': result = await solveFill(); break;
                case 'listen_repeat': result = await solveListenRepeat(); break;
                case 'oral': result = await solveOral(); break;
                case 'roleplay': result = await solveRoleplay(); break;
                case 'drag': result = await solveDrag(); break;
                case 'video': result = await solveVideo(); break;
                case 'listen_fill': result = await solveListenFill(); break;
                default: {
                    // 无题型组件：可能只有按钮（纯展示页/听力页），直接点下一步
                    if (isAnsweringState()) await clickSubmit();
                    else result = 'no-type';
                }
            }
        } catch (e) {
            status('错误: ' + e.message);
            result = 'error:' + e.message;
        }
        return result;
    }

    function closeModals() {
        // 关闭 antd 弹窗（自由模式提示等）
        $('.ant-modal:not(.ant-modal-confirm) .ant-modal-close').forEach(b => b.click());
        // 确认弹窗：仅自动确认无害文案；"系统繁忙"类反作弊弹窗不自动点（交给 detectBusy 冷却处理）
        $('.ant-modal-confirm .ant-btn-primary').forEach(b => {
            if (/^(知道了|好的|确定|继续|OK|关闭)$/i.test((b.textContent || '').trim())) b.click();
        });
    }

    // 轮询等待 URL path 变化（Angular 路由跳转可能较慢），返回是否切换成功
    async function waitUrlChange(from, timeoutMs) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            await sleep(500);
            if (location.href.split('?')[0] !== from) return true;
        }
        return false;
    }

    // ================= 课程主页导航（入口：从主页进入练习页，右箭头接管后续全部翻页/跨任务） =================
    async function navigateFromHome() {
        const urlBefore = location.href.split('?')[0];
        // 若在课程列表页（studentcourse），先点进课程主页（注意：绑定在 .course-title 子级，.course-list-item 父级点击无效）
        if (/\/studentcourse/.test(location.pathname)) {
            const card = $1('.course-title');
            if (card) clickSeq(card);
            if (!await waitUrlChange(urlBefore, 10000)) {
                const card2 = $1('.course-title');
                if (card2) clickSeq(card2);
                if (!await waitUrlChange(urlBefore, 10000)) {
                    status('未进入课程主页，请在课程列表页手动点开课程');
                    return false;
                }
            }
        }
        // 点"继续学习"进入上次学习位置（右箭头会自动推进后续所有任务/单元，无需目录导航）
        const cont = $('.topBtn button, .course-top button, button.btn.ant-btn');
        for (const b of cont) {
            if ((b.textContent || '').includes('继续学习')) {
                click(b);
                await waitUrlChange(location.href.split('?')[0], 8000);
                if (isExercisePage()) return true;
                break;
            }
        }
        status('未进入练习页，请在课程页手动点开一个练习后点"开始刷课"');
        return false;
    }


    // ================= 练习页翻页（右箭头，全自动核心） =================
    // 右上角 .page-next 右箭头：JS 点击有效，自动跨任务/跨单元前进（实测 42/42 → 1/41 跨 Unit）
    // 注意：翻页会触发 record_for_detail 等 POST（限流约 1 次/秒），间隔必须 ≥4 秒
    async function clickNextArrow() {
        const arrows = $('.page-next');
        if (!arrows.length) return false;
        const next = arrows[arrows.length - 1]; // 最后一个 = 右箭头（tx_page_right）
        const st = getComputedStyle(next);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        const urlBefore = location.href.split('?')[0];
        click(next);
        await sleep(rnd(4000, 6000)); // 降频：翻页触发 POST 加载，间隔 4~6s 规避限流
        // 以 URL 变化判定翻页生效（比"箭头隐藏"可靠）；慢路由再轮询 8s 兑底
        if (location.href.split('?')[0] !== urlBefore) return true;
        const t0 = Date.now();
        while (Date.now() - t0 < 8000) {
            await sleep(500);
            if (location.href.split('?')[0] !== urlBefore) return true;
        }
        return false; // URL 未变化 → 视为最后一页/点击无效（调用方做 3 轮容错）
    }

    // ================= 主循环 =================
    let running = false;
    let timer = null;
    let noBtnRounds = 0; // 连续无翻页轮次（页面加载/最后一页确认计数）
    let roundCount = 0; // 总轮次（反作弊保护）
    let rateLimited = false; // 疑似触发频率限制（HTTP 530 / 系统繁忙）
    let invalidRounds = 0; // 脚本有效性检测：连续失效轮数
    let cooldownUntil = 0; // 限流冷却截止时间戳（实测冷却约 60s，取 90s 余量）
    const MAX_ROUNDS = 1000; // 右箭头模式轮次放宽（刷完整门课 300+ 页 + 提交重试余量）

    // 触发限流冷却：不停止，冷却 90 秒后自动继续（实测 530 冷却约 1 分钟）
    function enterCooldown(msg) {
        cooldownUntil = Date.now() + 90000;
        status(msg + '，冷却 90 秒后自动继续');
    }

    // 检测页面出现"系统繁忙"等反作弊拦截提示（HTTP 530 或业务提示）
    function detectBusy() {
        return !!Array.from(document.querySelectorAll('body *')).some(el =>
            el.children.length === 0 && /系统繁忙|频繁|操作失败|请稍后|访问过于|请求过快|530/.test(el.textContent || ''));
    }

    // 停止并提示（无未完成项/反作弊拦截等场景，避免无限空转）
    function stopRun(msg) {
        running = false;
        if (timer) clearTimeout(timer);
        const b = $1('#b6-start');
        if (b) b.textContent = '开始刷课';
        setBusy(false);
        if (msg) status(msg); // 空消息：保留调用方已设置的状态提示
    }

    async function doOneRound() {
        closeModals();
        // 限流冷却中：等待自动恢复（不停止）
        if (cooldownUntil > Date.now()) {
            const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
            status('限流冷却中 ' + left + 's，稍后自动继续');
            return;
        }
        if (detectBusy()) { enterCooldown('检测到"系统繁忙"（限流拦截）'); return; }
        // 脚本有效性检测：连续 5 轮核心 DOM 全缺 → 站点改版 → 上报 issue + 停止
        if (isCourseHome() || isExercisePage()) {
            if (!checkScriptValidity()) {
                invalidRounds++;
                if (invalidRounds >= 10) {
                    const reported = await reportIssue('核心 DOM 探针连续 10 轮未命中');
                    stopRun('脚本可能已失效（站点结构不匹配），' + (reported ? '已自动上报 issue' : '请检查/更新脚本'));
                    return;
                }
                status('检测到页面结构异常（' + invalidRounds + '/10），等待确认...');
            } else {
                invalidRounds = 0;
            }
        }
        roundCount++;
        if (roundCount > MAX_ROUNDS) { stopRun('达到最大轮次保护(' + MAX_ROUNDS + ')，已停止'); return; }
        if (isExercisePage()) {
            if (isAnsweringState()) {
                // 有题可答：答题（AI/试错+提交）
                noBtnRounds = 0;
                await doExercise();
                if (rateLimited) { rateLimited = false; enterCooldown('提交疑似触发限流'); return; }
                // 提交后仍可作答（锁定/未生效）→ 翻页跳过（3 轮容错，防加载瞬间误停）
                if (isAnsweringState()) {
                    status('提交未生效，翻下一页');
                    if (!await clickNextArrow()) {
                        noBtnRounds++;
                        if (noBtnRounds >= 3) { noBtnRounds = 0; stopRun(); }
                    }
                }
                return;
            }
            // 已答/展示/无按钮状态：翻下一页（右箭头自动跨任务跨单元）
            status('翻下一页');
            if (!await clickNextArrow()) {
                // 无箭头/URL 未变：可能是页面渲染中（Angular 懒加载），连续 3 轮（约 30~45s）才判最后一页
                noBtnRounds++;
                if (noBtnRounds >= 3) { noBtnRounds = 0; stopRun('已到最后一页，全部完成'); }
                else status('未检测到下一页（' + noBtnRounds + '/3），等待后重试');
            }
            return;
        }
        if (isCourseHome()) {
            status('课程主页：进入任务');
            const ok = await navigateFromHome();
            if (!ok) stopRun(); // navigateFromHome 已设置具体状态
            return;
        }
        status('非课程页面');
    }

    async function loop() {
        if (!running) return;
        setBusy(true);
        try {
            await doOneRound();
        } catch (e) {
            status('循环错误: ' + e.message);
        }
        setBusy(false);
        if (running) timer = setTimeout(loop, rnd(8000, 12000)); // 降频：右箭头翻页模式，拉长循环间隔规避限流
    }

    // ================= 状态/UI =================
    let statusEl = null;
    function status(m) {
        if (statusEl) statusEl.textContent = m;
        try { console.log('[刷课]', m); } catch (e) {}
    }
    function setBusy(b) {
        const btns = $('#b6-root button');
        btns.forEach(btn => { btn.disabled = b; btn.style.opacity = b ? '0.6' : '1'; });
    }

    function mkUI() {
        if ($1('#b6-root')) return;
        const root = document.createElement('div');
        root.id = 'b6-root';
        // 莱茵生命风格：冷白 + 墨蓝灰 + 钢蓝强调（无渐变、扁平、科研工程感）
        const css = document.createElement('style');
        css.textContent = [
            '#b6-root * { box-sizing: border-box; margin: 0; padding: 0; }',
            '#b6-root { font: 13px/1.7 "Microsoft YaHei", system-ui, sans-serif; }',
            '#b6-panel { position: fixed; top: 80px; right: 16px; width: 320px; background: #F4F6F8; border: 1px solid #CBD6E0; border-radius: 10px; box-shadow: 0 6px 20px rgba(43,58,73,.15); z-index: 2147483647; overflow: hidden; }',
            '#b6-hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #33475C; color: #F0F4F7; cursor: move; user-select: none; }',
            '#b6-hex { width: 22px; height: 22px; flex: 0 0 22px; background: #7C93A8; clip-path: polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%); display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; color: #F4F7FA; }',
            '#b6-hd-title { font-size: 13.5px; font-weight: 600; letter-spacing: 1px; }',
            '#b6-hd-sub { font-size: 9px; opacity: .72; letter-spacing: 2px; }',
            '#b6-x { cursor: pointer; padding: 0 2px; font-size: 14px; color: #9FB4C6; }',
            '#b6-x:hover { color: #fff; }',
            '#b6-set-btn { cursor: pointer; padding: 2px 6px; font-size: 11px; border: 1px solid #7C93A8; border-radius: 4px; color: #D6E3EC; }',
            '#b6-set-btn:hover { background: #46607A; color: #fff; }',
            '#b6-guide-btn { cursor: pointer; padding: 0 5px; font-size: 13px; color: #D6E3EC; border: 1px solid #7C93A8; border-radius: 50%; }',
            '#b6-guide-btn:hover { background: #46607A; color: #fff; }',
            '#b6-reopen { position: fixed; top: 80px; right: 16px; width: 28px; height: 28px; background: #33475C; color: #F0F4F7; clip-path: polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%); display: none; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; cursor: pointer; z-index: 2147483647; }',
            '#b6-reopen:hover { background: #46607A; }',
            '#b6-bd { padding: 12px; user-select: text; -webkit-user-select: text; }',
            '#b6-status { text-align: center; padding: 8px 10px; margin-bottom: 12px; background: #E8EDF3; border: 1px solid #D5DEE6; border-radius: 6px; font-size: 12px; font-weight: 600; color: #2B3A49; word-break: break-all; user-select: text; -webkit-user-select: text; }',
            '.b6-group { margin-bottom: 13px; }',
            '.b6-glabel { display: flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 700; letter-spacing: 1.5px; color: #4A6A85; margin-bottom: 7px; text-transform: uppercase; user-select: none; }',
            '.b6-glabel::before { content: ""; width: 6px; height: 6px; background: #7C93A8; clip-path: polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%); }',
            '.b6-btn { display: block; width: 100%; padding: 9px; border-radius: 6px; cursor: pointer; font-size: 13px; border: 1px solid; transition: all .15s; user-select: none; }',
            '#b6-start { background: #3D6B99; color: #fff; border-color: #3D6B99; font-weight: 600; margin-bottom: 6px; }',
            '#b6-start:hover { background: #33587E; }',
            '#b6-one, #b6-score, #b6-farm { background: #fff; color: #33587E; border-color: #CBD6E0; margin-bottom: 6px; }',
            '#b6-one:hover, #b6-score:hover, #b6-farm:hover { background: #E9EEF3; }',
            '#b6-score-out { margin-top: 6px; padding: 8px 9px; background: #F7F9FB; border: 1px dashed #CBD6E0; border-radius: 6px; font: 11.5px/1.6 Consolas,monospace; white-space: pre-wrap; word-break: break-all; color: #2B3A49; display: none; user-select: text; -webkit-user-select: text; }',
            '.b6-in { width: 100%; padding: 6px 8px; font-size: 12px; margin-bottom: 5px; border: 1px solid #D5DEE6; border-radius: 4px; background: #fff; color: #2B3A49; }',
            '.b6-in:focus { outline: none; border-color: #4A7BA6; }',
            '.b6-label { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; font-size: 12px; color: #33587E; cursor: pointer; user-select: none; }',
            '.b6-sm-btn { padding: 6px; border-radius: 4px; cursor: pointer; font-size: 12px; border: 1px solid #CBD6E0; background: #fff; color: #33587E; user-select: none; }',
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
            '    <div id="b6-hd-sub">自动刷课</div>' +
            '  </div>' +
            '  <div id="b6-guide-btn" title="使用引导">?</div>' +
            '  <div id="b6-set-btn" title="设置">设置</div>' +
            '  <div id="b6-x">&times;</div>' +
            '</div>' +
            '<div id="b6-reopen" title="展开面板">R</div>' +
            '<div id="b6-bd">' +
            '  <div id="b6-status">就绪</div>' +
            '  <div class="b6-group">' +
            '    <div class="b6-glabel">Operation · 执行</div>' +
            '    <button id="b6-start" class="b6-btn">开始刷课</button>' +
            '    <button id="b6-one" class="b6-btn">做一题</button>' +
            '  </div>' +
            '  <div class="b6-group">' +
            '    <div class="b6-glabel">Data · 数据</div>' +
            '    <button id="b6-score" class="b6-btn">查成绩</button>' +
            '    <button id="b6-farm" class="b6-btn">刷学习时长</button>' +
            '    <pre id="b6-score-out"></pre>' +
            '  </div>' +
            '</div>';
        root.appendChild(panel);

        // 独立设置面板（从主面板"设置"按钮打开）
        const sp = document.createElement('div');
        sp.id = 'b6-settings';
        sp.style.cssText = 'position:fixed;top:80px;right:350px;width:320px;background:#F4F6F8;border:1px solid #CBD6E0;border-radius:10px;box-shadow:0 6px 20px rgba(43,58,73,.15);z-index:2147483647;overflow:hidden;display:none';
        sp.innerHTML =
            '<div id="b6-s-hd" style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#33475C;color:#F0F4F7;cursor:move;user-select:none">' +
            '  <div style="flex:1;font-size:13.5px;font-weight:600;letter-spacing:1px">CONFIG · 设置</div>' +
            '  <div id="b6-s-x" style="cursor:pointer;padding:0 2px;font-size:14px;color:#9FB4C6">&times;</div>' +
            '</div>' +
            '<div style="padding:12px">' +
            '  <div class="b6-glabel">AI · 答题引擎</div>' +
            '  <label class="b6-label"><input type="checkbox" id="b6-ai-en" style="margin:0"> 启用 AI 答题</label>' +
            '  <input id="b6-ai-url" class="b6-in" placeholder="API Base URL（如 deepseek v1）">' +
            '  <input id="b6-ai-key" class="b6-in" type="password" placeholder="API Key">' +
            '  <input id="b6-ai-model" class="b6-in" placeholder="模型名（如 deepseek-chat）">' +
            '  <button id="b6-ai-save" class="b6-sm-btn" style="width:100%">保存 AI 设置</button>' +
            '  <div class="b6-glabel" style="margin-top:12px">Report · 失效上报</div>' +
            '  <div id="b6-rp-auth" style="display:none">' +
            '    <p style="font-size:12px;color:#7A8EA0;margin-bottom:6px">失效自动上报未授权（默认关闭）。</p>' +
            '    <button id="b6-rp-consent" class="b6-sm-btn" style="width:100%">查看知情同意书并授权</button>' +
            '  </div>' +
            '  <div id="b6-rp-form" style="display:none">' +
            '    <label class="b6-label"><input type="checkbox" id="b6-rp-en" style="margin:0"> 失效自动上报 issue</label>' +
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

        // 元素引用
        const hd = $1('#b6-hd'), xb = $1('#b6-x');
        const setBtn = $1('#b6-set-btn'), sPanel = $1('#b6-settings'), sX = $1('#b6-s-x');
        statusEl = $1('#b6-status');
        const startBtn = $1('#b6-start'), oneBtn = $1('#b6-one');
        const scoreBtn = $1('#b6-score'), farmBtn = $1('#b6-farm'), scoreOut = $1('#b6-score-out');

        // 拖动
        let dragging = false, dx = 0, dy = 0, px = 0, py = 0;
        hd.addEventListener('pointerdown', e => {
            dragging = true; dx = e.clientX; dy = e.clientY;
            px = panel.offsetLeft; py = panel.offsetTop;
            e.preventDefault();
        });
        document.addEventListener('pointermove', e => {
            if (!dragging) return;
            panel.style.left = (px + e.clientX - dx) + 'px';
            panel.style.top = (py + e.clientY - dy) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('pointerup', () => { dragging = false; });

        startBtn.addEventListener('click', () => {
            if (running) {
                running = false; if (timer) clearTimeout(timer);
                if (studyTimer) stopStudyFarm();
                startBtn.textContent = '开始刷课';
                status('已停止');
            } else {
                running = true;
                roundCount = 0;
                rateLimited = false;
                cooldownUntil = 0;
                startBtn.textContent = '停止';
                status('运行中');
                loop();
            }
        });
        oneBtn.addEventListener('click', async () => {
            status('执行...');
            await doOneRound();
            status('完成');
        });
        xb.addEventListener('click', () => { if (studyTimer) stopStudyFarm(); panel.style.display = 'none'; $1('#b6-reopen').style.display = 'flex'; });
        $1('#b6-reopen').addEventListener('click', () => {
            $1('#b6-reopen').style.display = 'none';
            panel.style.display = 'block';
        });
        // 设置面板：打开/关闭 + 拖动
        setBtn.addEventListener('click', () => {
            sPanel.style.display = sPanel.style.display === 'none' ? 'block' : 'none';
        });
        sX.addEventListener('click', () => { sPanel.style.display = 'none'; });
        {
            let dragging = false, dx = 0, dy = 0, px = 0, py = 0;
            const sHd = $1('#b6-s-hd');
            sHd.addEventListener('pointerdown', e => {
                dragging = true; dx = e.clientX; dy = e.clientY;
                px = sPanel.offsetLeft; py = sPanel.offsetTop;
                e.preventDefault();
            });
            document.addEventListener('pointermove', e => {
                if (!dragging) return;
                sPanel.style.left = (px + e.clientX - dx) + 'px';
                sPanel.style.top = (py + e.clientY - dy) + 'px';
                sPanel.style.right = 'auto';
            });
            document.addEventListener('pointerup', () => { dragging = false; });
        }
        // 上报授权入口：重新弹出知情同意书
        $1('#b6-rp-consent').addEventListener('click', () => showConsentModal(true));
        // 使用引导入口
        $1('#b6-guide-btn').addEventListener('click', () => showGuide());

        // 查成绩（POST 有频率限制：点击后冷却 3 秒，防止连续查询触发 HTTP 530 反作弊拦截）
        let scoreCooldown = false;
        scoreBtn.addEventListener('click', async () => {
            if (scoreCooldown) { status('查询冷却中，请稍候...'); return; }
            scoreCooldown = true;
            scoreBtn.disabled = true;
            scoreBtn.style.opacity = '0.6';
            status('查询中...');
            const data = await fetchScore();
            scoreOut.textContent = formatScore(data);
            scoreOut.style.display = 'block';
            status(data && data.blocked ? '触发频率限制，已停止查询' : '成绩查询完成');
            setTimeout(() => { scoreCooldown = false; scoreBtn.disabled = false; scoreBtn.style.opacity = '1'; }, 3000);
        });
        // 刷学习时长（挂机累计；后端按真实时间节奏去重，无法加速）
        farmBtn.addEventListener('click', () => {
            if (studyTimer) {
                stopStudyFarm();
                farmBtn.textContent = '刷学习时长';
                farmBtn.style.background = '#fff';
            } else {
                if (!isExercisePage()) { status('请先进入练习页再刷时长'); return; }
                startStudyFarm();
                farmBtn.textContent = '停止刷时长';
                farmBtn.style.background = '#E9EEF3';
            }
        });

        // AI 设置：加载 + 保存
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

        // 失效上报设置：加载 + 保存 + 测试（上报区显隐由知情同意书授权控制，默认不允许）
        loadReportConfig();
        syncReportArea();
        $1('#b6-rp-en').checked = reportConfig.enabled;
        $1('#b6-rp-owner').value = reportConfig.owner;
        $1('#b6-rp-repo').value = reportConfig.repo;
        $1('#b6-rp-token').value = reportConfig.token;
        $1('#b6-rp-save').addEventListener('click', () => {
            reportConfig.enabled = $1('#b6-rp-en').checked;
            reportConfig.owner = $1('#b6-rp-owner').value.trim();
            reportConfig.repo = $1('#b6-rp-repo').value.trim();
            reportConfig.token = $1('#b6-rp-token').value.trim();
            saveReportConfig();
            status('失效上报设置已保存' + (reportConfig.enabled ? '（已启用）' : '（未启用）'));
        });
        $1('#b6-rp-test').addEventListener('click', async () => {
            reportConfig.enabled = $1('#b6-rp-en').checked;
            reportConfig.owner = $1('#b6-rp-owner').value.trim();
            reportConfig.repo = $1('#b6-rp-repo').value.trim();
            reportConfig.token = $1('#b6-rp-token').value.trim();
            saveReportConfig();
            status('发送测试 issue...');
            const ok = await reportIssue('手动测试上报');
            status(ok ? '测试 issue 已发送' : '测试失败（检查 owner/repo/token 权限）');
        });

        // 首次启用：未按当前版本同意书授权则弹知情同意书（引导在其关闭后弹出）；已授权用户直接看引导
        if (reportConfig.consent !== true || reportConfig.consentVersion !== '1.0') {
            showConsentModal();
        } else {
            maybeShowGuide();
        }
    }

    setTimeout(mkUI, 1500);
})();
