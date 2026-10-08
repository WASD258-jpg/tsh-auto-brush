/**
 * 构建双引擎版脚本。
 *
 * 架构（v2.1.1 起分离）：
 *   engines/new-engine.user.js      ← 新版引擎源码（独立维护，随 issue 修复更新）
 *   engines/legacy-engine.user.js   ← 旧站引擎源码（沿用 v1.1.2，未再改动）
 *   tsh-auto-brush.user.js          ← 构建产物（不要手改，改 engines/ 后重新构建）
 *
 * 为什么分离：此前新版引擎源码只存在于双引擎版内部，导致
 *   - build 从固定 git 提交取源 → 会丢掉后续所有修复
 *   - build 从工作区取源 → 会把双引擎版当成新版引擎，自我嵌套
 * 分离后两个问题都消失。
 *
 * 组装策略：不做代码合并（会引入 20 处同名函数覆盖），而是
 *   1. 两个引擎各自包在独立 function 内，不共享作用域
 *   2. 前置轻量分发器，按 location.pathname 只启动一个
 *
 * 运行：node test/build-dual.js
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const OUT = path.join(REPO, 'tsh-auto-brush.user.js');
const ENGINES = path.join(REPO, 'engines');

const VERSION = fs.readFileSync(path.join(ENGINES, 'new-engine.user.js'), 'utf8')
  .match(/@version\s+([\d.]+)/)[1];

// ---------- 读取两个引擎源码 ----------
function loadEngine(file) {
  const src = fs.readFileSync(path.join(ENGINES, file), 'utf8');
  const metaEnd = src.indexOf('// ==/UserScript==');
  const afterMeta = src.slice(metaEnd + '// ==/UserScript=='.length);
  const iifeStart = afterMeta.indexOf('(function () {');
  const iifeEnd = afterMeta.lastIndexOf('})();');
  if (iifeStart < 0 || iifeEnd < 0) throw new Error(file + ': 未找到 IIFE 边界');
  return afterMeta.slice(iifeStart + '(function () {'.length, iifeEnd);
}

const newBodyRaw = loadEngine('new-engine.user.js');
const oldBodyRaw = loadEngine('legacy-engine.user.js');

// 两个引擎各自的 SCRIPT_VERSION 停留在其来源版本（新版 2.1.x / 旧站 1.1.2），
// 与合并后的 @version 不一致 —— 会导致面板显示错版本、失效上报的 issue
// 标题标错版本。构建时统一注入为当前版本。
function injectVersion(body, label) {
  const re = /const SCRIPT_VERSION = '[^']*';/;
  if (!re.test(body)) throw new Error(label + ': 未找到 SCRIPT_VERSION 定义');
  const before = body.match(re)[0];
  const after = body.replace(re, "const SCRIPT_VERSION = '" + VERSION + "';");
  console.log('  ' + label + ': ' + before + '  →  ' + after.match(re)[0]);
  return after;
}
const newBody = injectVersion(newBodyRaw, '新版引擎');
const oldBody = injectVersion(oldBodyRaw, '旧站引擎');

console.log('版本:', VERSION);
console.log('新版引擎主体:', newBody.length, '字符');
console.log('旧站引擎主体:', oldBody.length, '字符');

// 面板副标题按引擎区分（旧版曾统一写「新站适配」，在旧站引擎下会误导）
const newBodyFinal = newBody.replace(/· 新站适配/g, '· 新版');
const oldBodyFinal = oldBody.replace(/· 新站适配/g, '· 旧站');

// ---------- 组装 ----------
function indent(text, n) {
  const pad = ' '.repeat(n);
  return text.split('\n').map(l => (l.trim() ? pad + l : l)).join('\n');
}

const DISPATCHER = `
// ============================================================================
// 双引擎分发器
// ============================================================================
//
// 本站点是双轨运行：/legacy/ 为 Angular 旧站，/course_center/ 为 Vue3 新版。
// 登录时由统一认证中心按账号属性分流，因此不同用户看到的是两套完全不同的前端。
//
// 本脚本同时内置两套引擎，按当前路径只启动其中一套：
//   - 新版引擎 → /course_center/
//   - 旧站引擎 → /legacy/
//
// 两个引擎各自包在独立函数内，不共享作用域，因此共 20 处同名函数
// （detectType / doOneRound / mkUI / click / status 等）不会互相覆盖。
// 存储键保持共用：两版的 aiConfig / reportConfig 结构完全一致，属共享配置。

(function () {
    'use strict';

    var path = location.pathname;

    // 新版：整个 /course_center/ 命名空间（含 reader 与课程中心各页）。
    // 不能只匹配 /course_center/reader/ —— 用户进入章节前的过渡页同属新版，
    // 引擎应在这些页面就绪并在进入章节后接管。
    var isNewSite = /^\\/course_center\\//i.test(path);

    // 旧站：/legacy/ 前缀。同时兼顾 /legacy 无尾斜杠的边界情况。
    var isLegacySite = /^\\/legacy(\\/|$|\\?)/.test(path);

    // 供排错使用：在 Console 里执行 window.__TSH_BRUSH__ 可查看状态
    globalThis.__TSH_BRUSH__ = {
        version: '${VERSION}',
        engine: isNewSite ? 'new' : (isLegacySite ? 'legacy' : 'idle'),
        path: path
    };

    if (isNewSite) {
        try { console.log('[刷课] 检测到新版站点，启动新版引擎 v${VERSION}'); } catch (e) {}
        __TSH_NEW_ENGINE__();
        return;
    }

    if (isLegacySite) {
        try { console.log('[刷课] 检测到旧站 /legacy/，启动旧站引擎 v${VERSION}'); } catch (e) {}
        __TSH_OLD_ENGINE__();
        return;
    }

    try { console.log('[刷课] 非教材/课程页面，脚本待命（进入阅读器后自动启用）'); } catch (e) {}
})();
`;

const META = `// ==UserScript==
// @name         TSH自动刷课
// @version      ${VERSION}
// @namespace    wasd258-jpg.tsh-autobrush
// @description  清华社英语在线自动刷课（双引擎版）。自动识别站点版本：新版 /course_center/ 与旧站 /legacy/ 均支持，装一次即可。功能：自动答题+章节推进+查成绩+学习时长保活。新版支持单选/多选/判断/填空/下拉/拖拽；语音题需真人录音。含结构自检。
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
 * v${VERSION} —— 双引擎版（构建产物）
 *
 * ⚠ 本文件由 test/build-dual.js 从 engines/ 目录组装生成，请勿直接编辑。
 *   修改逻辑请改：
 *     engines/new-engine.user.js    （新版引擎）
 *     engines/legacy-engine.user.js （旧站引擎）
 *   然后运行 node test/build-dual.js 重新构建。
 *
 * 背景：站点自 2026-09 起双轨运行。
 *   /legacy/       → Angular 7 旧站（未下线）
 *   /course_center/ → Vue3 新版「智慧版」
 * 登录由统一认证中心按账号属性分流（type=3 的账号被送往旧站），
 * 因此不同用户可能落在不同前端上。本版把两套引擎都内置，按路径只启动一套，
 * 用户无需再判断该装哪个版本。
 *
 * 已知边界：
 *   - 新版引擎未在登录态由作者实测（作者账号被分流至旧站，无新版权限）
 *   - 语音题（口语/跟读/角色扮演）走驰声实时评测，需真人录音，脚本会提示跳过
 *   - 作业/考试模块的反作弊机制脚本不触碰
 */

// ============================================================================
// 引擎 A · 新版站点（/course_center/）—— 包裹在独立作用域内
// ============================================================================
function __TSH_NEW_ENGINE__() {
${indent(newBodyFinal, 4)}
}

// ============================================================================
// 引擎 B · 旧站站点（/legacy/）—— 包裹在独立作用域内
// ============================================================================
function __TSH_OLD_ENGINE__() {
${indent(oldBodyFinal, 4)}
}
${DISPATCHER}`;

fs.writeFileSync(OUT, META, 'utf8');
console.log('\n已写入:', OUT);
console.log('大小:', fs.statSync(OUT).size, 'bytes');
