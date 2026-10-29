// 回归测试：召回屏蔽·全局（一键屏蔽之前阶段 / 多选阶段）
// 通过 createStoryController 直接驱动真实 UI 逻辑，配一套极简假 DOM。
// 注意：只用 read/write/edit 工具改本文件，别用 PowerShell Get-Content/Set-Content 往返（中文会乱码）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN_ROOT, pluginPath, readPlugin } from './_paths.mjs';
import { pathToFileURL } from 'node:url';

const SRC = pluginPath('lib/story-data.js');

let pass = 0;
let fail = 0;
const check = (label, fn) => {
    try {
        const result = fn();
        if (result === true || result === undefined) { pass++; console.log('  ok   ' + label); }
        else { fail++; console.log('  FAIL ' + label + ' -> ' + result); }
    } catch (e) { fail++; console.log('  FAIL ' + label + ' -> 抛错: ' + e.message); }
};

// ─────────────────────────── 极简假 DOM ───────────────────────────
const camel = key => key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

class El {
    constructor(tag = 'div') {
        this.tagName = String(tag).toUpperCase();
        this.attributes = {};
        this.children = [];
        this.parent = null;
        this.className = '';
        this.style = {};
        this._checked = false;
        this.disabled = false;
        this._text = '';
        this.dataset = new Proxy({}, {
            get: (t, k) => (k in t ? t[k] : this.attributes['data-' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())]),
        });
    }
    // 真实 DOM 里 checked 是属性（property）；这里让它与 checked 属性保持同步，
    // 这样 innerHTML 里能看见勾选状态，querySelectorAll('.x:checked') 也能命中。
    get checked() { return this._checked; }
    set checked(value) {
        this._checked = !!value;
        if (this._checked) this.attributes.checked = 'checked';
        else delete this.attributes.checked;
    }
    get id() { return this.attributes.id || ''; }
    get classList() {
        const self = this;
        return {
            contains: name => self.classList._list().includes(name),
            add: name => { const l = self.classList._list(); if (!l.includes(name)) l.push(name); self.className = l.join(' '); },
            remove: name => { self.className = self.classList._list().filter(n => n !== name).join(' '); },
            toggle: (name, force) => {
                const has = self.classList._list().includes(name);
                const want = force === undefined ? !has : !!force;
                if (want) self.classList.add(name); else self.classList.remove(name);
                return want;
            },
            _list: () => String(self.className || '').split(/\s+/).filter(Boolean),
        };
    }
    get textContent() {
        return this._text + this.children.map(c => c.textContent).join('');
    }
    set textContent(value) {
        this.children = [];
        this._text = String(value ?? '');
    }
    get innerHTML() { return this._html ?? this._serialize(); }
    set innerHTML(html) {
        this._html = String(html ?? '');
        this.children = [];
        this._text = '';
        this.parseInto(this._html);
    }
    _serialize() {
        const attrs = Object.entries(this.attributes).map(([k, v]) => ` ${k}="${v}"`).join('');
        const cls = this.className ? ` class="${this.className}"` : '';
        return `<${this.tagName.toLowerCase()}${this.id ? ` id="${this.id}"` : ''}${cls}${attrs}>`
            + this._text + this.children.map(c => c._serialize()).join('') + `</${this.tagName.toLowerCase()}>`;
    }
    parseInto(html) {
        const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^">]*"|'[^'>]*'|[^\s">]+))?)*)\s*(\/?)>/g;
        const stack = [];
        let last = 0;
        let m;
        const addText = text => {
            if (!text.trim()) return;
            const target = stack[stack.length - 1];
            if (target) target._text += text;
        };
        while ((m = re.exec(html))) {
            addText(html.slice(last, m.index));
            last = re.lastIndex;
            const [full, tag, rawAttrs, selfClose] = m;
            const closing = full.startsWith('</');
            const lower = tag.toLowerCase();
            if (closing) {
                for (let i = stack.length - 1; i >= 0; i--) {
                    if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
                }
                continue;
            }
            const el = new El(lower);
            const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^">]*)"|'([^'>]*)'|([^\s">]+)))?/g;
            let a;
            while ((a = attrRe.exec(rawAttrs || ''))) {
                const key = a[1].toLowerCase();
                const value = a[2] ?? a[3] ?? a[4] ?? '';
                el.attributes[key] = value;
                el.dataset[camel(key.replace(/^data-/, ''))] = value;
                if (key === 'class') el.className = value;
                if (key === 'checked') el.checked = true;
                if (key === 'disabled') { el.disabled = true; el.attributes.disabled = 'disabled'; }
            }
            if (stack.length) { stack[stack.length - 1].children.push(el); el.parent = stack[stack.length - 1]; }
            else this.children.push(el);
            if (!selfClose) stack.push(el);
        }
        addText(html.slice(last));
    }
    descendants(out = []) {
        this.children.forEach(child => { out.push(child); child.descendants(out); });
        return out;
    }
    matches(selector) { return matchesSelector(this, selector); }
    closest(selector) {
        let node = this;
        while (node) { if (matchesSelector(node, selector)) return node; node = node.parent; }
        return null;
    }
    querySelector(selector) {
        for (const part of String(selector).split(/\s+/).filter(Boolean)) {
            const hit = this.descendants().find(el => matchesSelector(el, part));
            if (!hit) return null;
            return hit;
        }
        return null;
    }
    querySelectorAll(selector) {
        const parts = String(selector).split(/\s+/).filter(Boolean);
        let current = this.descendants();
        for (const part of parts) {
            current = current.flatMap(el => el.descendants().filter(child => matchesSelector(child, part)));
        }
        return current;
    }
    replaceWith(next) {
        if (!this.parent) return;
        const idx = this.parent.children.indexOf(this);
        if (idx < 0) return;
        this.parent.children[idx] = next;
        next.parent = this.parent;
    }
    get firstElementChild() { return this.children[0] || null; }
    appendChild(el) { this.children.push(el); el.parent = this; return el; }
}

function matchesSelector(el, selector) {
    const s = String(selector).trim();
    if (s.startsWith('#')) return el.attributes.id === s.slice(1);
    // 类名 + 伪类（.foo:checked）
    const clsPseudo = /^\.([A-Za-z0-9_-]+)(?::([a-z-]+))?$/.exec(s);
    if (clsPseudo) {
        if (!String(el.className || '').split(/\s+/).includes(clsPseudo[1])) return false;
        if (clsPseudo[2] === 'checked') return !!el.checked;
        return true;
    }
    const attr = /^\[([a-zA-Z-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(s);
    if (attr) {
        if (!(attr[1] in el.attributes)) return false;
        return attr[2] === undefined ? true : el.attributes[attr[1]] === attr[2];
    }
    const withPseudo = /^([a-zA-Z-]+)?(?::([a-z-]+))?$/.exec(s);
    if (withPseudo) {
        if (withPseudo[1] && el.tagName !== withPseudo[1].toUpperCase()) return false;
        if (withPseudo[2] === 'checked') return !!el.checked;
        return true;
    }
    return false;
}

function makeFakeDom() {
    const root = new El('body');
    root.innerHTML = `
      <div id="ni-pg-stage" class="on">
        <div id="ni-stage-list"></div>
        <div id="ni-stage-block-hint"></div>
        <button id="ni-stage-block-prev"></button>
        <button id="ni-stage-block-pick-stages"></button>
        <button id="ni-stage-block-apply"></button>
        <div id="ni-stage-active-lbl"></div>
        <div id="ni-stage-pagination">
          <input id="ni-stage-page-size" value="20">
          <input id="ni-stage-page-current" value="1">
          <button id="ni-stage-page-prev"></button>
          <button id="ni-stage-page-next"></button>
        </div>
      </div>`;
    const document = {
        querySelector: sel => root.querySelector(sel),
        querySelectorAll: sel => root.querySelectorAll(sel),
        createElement: tag => new El(tag),
    };
    return { root, document };
}

// ─────────────────────────── 被测代码 ───────────────────────────
const source = fs.readFileSync(SRC, 'utf8');
const head = source.slice(0, source.indexOf('export function createStoryController'));
// 顶部可能已经 import 了同目录模块，临时文件在 tmp 里找不到同级文件，
// 这里把所有 './xxx.js' 相对路径统一改写成绝对 file:// URL（新增依赖不用再改测试）。
const libDir = pluginPath('lib');
const toFileUrl = name => pathToFileURL(path.resolve(libDir, name)).href;
const headPatched = head.replace(/from '\.\/([A-Za-z0-9._-]+\.js)'/g, (m, name) => `from '${toFileUrl(name)}'`);
const probePath = path.join(os.tmpdir(), `ni-story-probe-${Date.now()}.mjs`);
fs.writeFileSync(probePath, headPatched, 'utf8');
const storyMod = await import(pathToFileURL(probePath).href);
const { createStoryController } = await import(pathToFileURL(SRC).href);

function buildHarness({ anchorStage = 8, total = 8 } = {}) {
    const { root, document } = makeFakeDom();
    const plots = { main: [], sub: [], pivot: [] };
    for (let i = 1; i <= total; i++) {
        plots.main.push({ title: `第${i}阶段节点`, body: `第${i}阶段正文`, stageIdx: i, _chunkIdx: i });
    }
    const S = {
        plots,
        stageMap: {},
        stageMapN: total,
        stageStates: {},
        stageSummaries: {},
        stageTitles: {},
        stageVecDone: {},
        chunkStatus: [],
        chunkTexts: [],
    };
    for (let i = 1; i <= total; i++) {
        S.stageStates[i] = true;
        S.stageVecDone[i] = true;
        S.stageTitles[i] = `第${i}阶段`;
    }
    const settings = { blockedRecallNodes: {}, blockedRecallStages: {} };
    const fakeWindow = {};
    if (anchorStage != null) {
        // 穿书模式：当前阶段取自「当前进行节点」所在阶段，这也正是线上取当前阶段的口径。
        settings.transBookMode = true;
        fakeWindow.niGetTbNodes = () => [{ stageIdx: anchorStage }];
        fakeWindow.niTbGetInjectionNode = nodes => nodes[0];
    }
    const saveCalls = { count: 0 };
    const controller = createStoryController({
        state: S,
        query: sel => document.querySelector(sel),
        document,
        globalWindow: fakeWindow,
        extensionSettings: { NovelInjector: settings },
        extensionName: 'NovelInjector',
        escapeHtml: v => String(v ?? ''),
        escapeAttr: v => String(v ?? ''),
        saveSettings: () => { saveCalls.count++; },
        canUseDerived: () => true,
        toastr: { info() {}, success() {}, warning() {} },
    });
    controller.buildStages({ force: true });
    return { controller, S, settings, root, document, saveCalls, tbNodes: fakeWindow.niGetTbNodes, q: sel => root.querySelector(sel), qa: sel => root.querySelectorAll(sel) };
}

console.log('===== 召回屏蔽·全局（一键屏蔽之前阶段 / 多选阶段）=====');

// ── G1 初始状态 ────────────────────────────────────────────────
console.log('\n[G1] 初始状态：识别当前阶段与「之前阶段」范围');
{
    const h = buildHarness({ anchorStage: 8 });
    check('当前阶段识别为第 8 阶段', () => h.q('#ni-stage-block-hint').textContent.includes('第 8 阶段') || h.q('#ni-stage-block-hint').textContent);
    check('「一键屏蔽之前阶段」按钮初始为未激活并可用', () => {
        const btn = h.q('#ni-stage-block-prev');
        if (!btn) return '按钮不存在';
        if (btn.classList.contains('on')) return '初始却是激活态';
        if (btn.disabled) return '不该禁用';
        return true;
    });
    check('提示写明可屏蔽第 1 ～ 7 阶段', () => h.q('#ni-stage-block-hint').textContent.includes('第 1 ～ 7 阶段') || h.q('#ni-stage-block-hint').textContent);
    check('每个阶段卡片都有「召回屏蔽」行', () => {
        const rows = h.qa('#ni-stage-list .ni-stage-block-row');
        return rows.length === 8 || `只有 ${rows.length} 行`;
    });
}

// ── G2 一键屏蔽之前阶段 ────────────────────────────────────────
console.log('\n[G2] 一键屏蔽之前阶段：只屏蔽当前阶段之前，当前与之后不受影响');
{
    const h = buildHarness({ anchorStage: 8 });
    h.controller.niApplyStageBlockAction('block-prev');
    check('第 1 ～ 7 阶段整段屏蔽', () => {
        const blocked = Object.keys(h.settings.blockedRecallStages).map(Number).sort((a, b) => a - b);
        return blocked.join(',') === '1,2,3,4,5,6,7' || blocked.join(',');
    });
    check('第 8 阶段（当前）没有被屏蔽', () => h.settings.blockedRecallStages['8'] === undefined || '当前阶段被误屏蔽');
    check('按钮切换为「解除之前阶段屏蔽」并进入激活态', () => {
        const btn = h.q('#ni-stage-block-prev');
        if (!btn.classList.contains('on')) return '未进入激活态';
        return btn.innerHTML.includes('解除') || btn.innerHTML;
    });
    check('提示写明已全部屏蔽', () => h.q('#ni-stage-block-hint').textContent.includes('已全部整段屏蔽') || h.q('#ni-stage-block-hint').textContent);
    check('被屏蔽阶段卡片显示「整段已屏蔽」', () => {
        const rows = h.qa('#ni-stage-list .ni-stage-block-row');
        const stage1 = rows.find(r => r.dataset.stageIdx === '1');
        return stage1?.innerHTML.includes('整段已屏蔽') || '第 1 阶段没有整段已屏蔽标记';
    });
    check('屏蔽后调用了设置保存', () => h.saveCalls.count >= 1);
    check('屏蔽状态确实会被召回侧读取（collectFullyBlockedChunkIdxs 认得阶段 1）', () => {
        const ctx = storyMod.niBuildBlockedRecallContext(h.settings);
        if (!ctx.isStageBlocked(1)) return '阶段 1 在召回侧没被判为屏蔽';
        return ctx.isStageBlocked(8) === false || '阶段 8 被判为屏蔽';
    });
}

// ── G3 再点一次 = 解除 ────────────────────────────────────────
console.log('\n[G3] 再点一次：解除之前阶段的整段屏蔽');
{
    const h = buildHarness({ anchorStage: 8 });
    h.controller.niApplyStageBlockAction('block-prev');
    h.controller.niApplyStageBlockAction('block-prev');
    check('之前阶段全部解除屏蔽', () => Object.keys(h.settings.blockedRecallStages).length === 0 || Object.keys(h.settings.blockedRecallStages).join(','));
    check('按钮回到未激活态', () => !h.q('#ni-stage-block-prev').classList.contains('on'));
    check('提示回到「可一键屏蔽」文案', () => h.q('#ni-stage-block-hint').textContent.includes('点「一键屏蔽之前阶段」') || h.q('#ni-stage-block-hint').textContent);
}

// ── G4 部分已屏蔽时只补屏蔽剩下的 ──────────────────────────────
console.log('\n[G4] 手动屏蔽第 3 阶段后点一键屏蔽：补齐其余阶段，不重复标记');
{
    const h = buildHarness({ anchorStage: 8 });
    h.settings.blockedRecallStages = { 3: true };
    h.controller.niRefreshStageBlockToolbar();
    check('提示显示已屏蔽 1/7', () => h.q('#ni-stage-block-hint').textContent.includes('1/7') || h.q('#ni-stage-block-hint').textContent);
    h.controller.niApplyStageBlockAction('block-prev');
    check('补齐为 1 ～ 7 全部屏蔽', () => {
        const blocked = Object.keys(h.settings.blockedRecallStages).map(Number).sort((a, b) => a - b);
        return blocked.join(',') === '1,2,3,4,5,6,7' || blocked.join(',');
    });
}

// ── G5 边界：第 1 阶段没有「之前阶段」 ─────────────────────────
console.log('\n[G5] 边界：当前就是第 1 阶段时按钮禁用，不误屏蔽任何阶段');
{
    const h = buildHarness({ anchorStage: 1 });
    check('按钮被禁用', () => h.q('#ni-stage-block-prev').disabled === true || '按钮没禁用');
    check('提示说明它之前没有可屏蔽的阶段', () => h.q('#ni-stage-block-hint').textContent.includes('没有可屏蔽的阶段') || h.q('#ni-stage-block-hint').textContent);
    h.controller.niApplyStageBlockAction('block-prev');
    check('点下去也不会屏蔽任何阶段', () => Object.keys(h.settings.blockedRecallStages).length === 0 || Object.keys(h.settings.blockedRecallStages).join(','));
}

// ── G6 多选阶段模式 ───────────────────────────────────────────
console.log('\n[G6] 多选阶段：勾选任意几个阶段后一次性屏蔽');
{
    const h = buildHarness({ anchorStage: 8 });
    check('默认不显示阶段勾选框', () => h.qa('.ni-stg-block-chk').length === 0 || `已显示 ${h.qa('.ni-stg-block-chk').length} 个`);
    check('默认「屏蔽勾选的阶段」按钮隐藏', () => h.q('#ni-stage-block-apply').style.display === 'none' || h.q('#ni-stage-block-apply').style.display);
    h.controller.niApplyStageBlockAction('toggle-pick');
    check('进入多选后每个阶段卡片出现勾选框', () => {
        const boxes = h.qa('#ni-stage-list .ni-stg-block-chk');
        return boxes.length === 8 || `只有 ${boxes.length} 个勾选框`;
    });
    check('「多选阶段」按钮进入激活态', () => h.q('#ni-stage-block-pick-stages').classList.contains('on'));
    check('「屏蔽勾选的阶段」按钮显示出来但不可用（没勾选）', () => {
        const btn = h.q('#ni-stage-block-apply');
        if (btn.style.display === 'none') return '仍然隐藏';
        return btn.disabled === true || '空勾选时却可用';
    });
    // 勾选第 2、5 阶段
    h.qa('#ni-stage-list .ni-stg-block-chk').forEach(box => {
        if (box.dataset.stageIdx === '2' || box.dataset.stageIdx === '5') box.checked = true;
    });
    h.controller.niRefreshStageBlockToolbar();
    check('计数随勾选更新为 2', () => h.q('#ni-stage-block-apply').innerHTML.includes('（2）') || h.q('#ni-stage-block-apply').innerHTML);
    h.controller.niApplyStageBlockAction('apply-picked');
    check('只有勾选的第 2、5 阶段被屏蔽', () => {
        const blocked = Object.keys(h.settings.blockedRecallStages).map(Number).sort((a, b) => a - b);
        return blocked.join(',') === '2,5' || blocked.join(',');
    });
    check('被屏蔽阶段在多选模式下的勾选框为选中态', () => {
        const boxes = h.qa('#ni-stage-list .ni-stg-block-chk').filter(b => b.dataset.stageIdx === '2' || b.dataset.stageIdx === '5');
        return boxes.every(b => b.checked) || '勾选框没反映屏蔽状态';
    });
}

// ── G7 取消勾选 / 退出多选 ────────────────────────────────────
console.log('\n[G7] 取消勾选与退出多选：不会偷偷屏蔽用户取消掉的阶段');
{
    const h = buildHarness({ anchorStage: 8 });
    h.controller.niApplyStageBlockAction('toggle-pick');
    h.qa('#ni-stage-list .ni-stg-block-chk').forEach(box => {
        if (box.dataset.stageIdx === '2') box.checked = true;
    });
    h.controller.niApplyStageBlockAction('apply-picked');
    check('第 2 阶段被屏蔽', () => h.settings.blockedRecallStages['2'] === true);
    // 取消勾选后再点一次
    h.qa('#ni-stage-list .ni-stg-block-chk').forEach(box => {
        if (box.dataset.stageIdx === '2') box.checked = false;
    });
    h.controller.niApplyStageBlockAction('apply-picked');
    check('取消勾选后不再新增屏蔽项（第 2 阶段仍在，因为没有解除动作）', () => {
        const blocked = Object.keys(h.settings.blockedRecallStages);
        return blocked.join(',') === '2' || blocked.join(',');
    });
    h.controller.niApplyStageBlockAction('toggle-pick');
    check('退出多选后勾选框消失', () => h.qa('.ni-stg-block-chk').length === 0 || `还有 ${h.qa('.ni-stg-block-chk').length} 个`);
    check('退出多选后按钮隐藏', () => h.q('#ni-stage-block-apply').style.display === 'none');
}

// ── G8 环境：没有穿书节点时按「最高开启阶段」当当前阶段 ────────
console.log('\n[G8] 普通模式：当前阶段 = 最后一个开启的阶段');
{
    const h = buildHarness({ anchorStage: null, total: 6 });
    h.controller.buildStages({ force: true });
    check('没有穿书节点时识别为最后一阶段（第 6）', () => h.q('#ni-stage-block-hint').textContent.includes('第 6 阶段') || h.q('#ni-stage-block-hint').textContent);
    h.controller.niApplyStageBlockAction('block-prev');
    check('屏蔽 1 ～ 5，保留第 6', () => {
        const blocked = Object.keys(h.settings.blockedRecallStages).map(Number).sort((a, b) => a - b);
        return blocked.join(',') === '1,2,3,4,5' || blocked.join(',');
    });
    // 只开启第 2 阶段时，当前阶段应变成第 2
    Object.keys(h.S.stageStates).forEach(k => { h.S.stageStates[k] = false; });
    h.S.stageStates[2] = true;
    h.controller.niRefreshStageBlockToolbar();
    check('只开第 2 阶段时当前阶段变成第 2', () => h.q('#ni-stage-block-hint').textContent.includes('第 2 阶段') || h.q('#ni-stage-block-hint').textContent);
}

// ── G9 接线核对（源码级） ─────────────────────────────────────
console.log('\n[G9] 接线核对：模板按钮、事件绑定、导出');
{
    const indexSrc = fs.readFileSync(pluginPath('index.js'), 'utf8');
    const tplSrc = fs.readFileSync(pluginPath('template.html'), 'utf8');
    check('模板里有全局屏蔽工具条', () => tplSrc.includes('id="ni-stage-block-prev"') && tplSrc.includes('id="ni-stage-block-pick-stages"'));
    check('模板按钮用 data-stage-block-action（不与单阶段按钮冲突）', () => {
        const seg = tplSrc.slice(tplSrc.indexOf('ni-stage-block-bar'));
        const block = seg.slice(0, seg.indexOf('</div>'));
        return block.includes('data-stage-block-action') && !block.includes('data-block-action="') || '混用了 data-block-action';
    });
    check('index.js 绑定了 [data-stage-block-action]', () => indexSrc.includes("'[data-stage-block-action]'"));
    check('index.js 绑定了阶段勾选框', () => indexSrc.includes("'.ni-stg-block-chk'"));
    check('index.js 导入了 niApplyStageBlockAction 与 niRefreshStageBlockToolbar', () => indexSrc.includes('niApplyStageBlockAction,') && indexSrc.includes('niRefreshStageBlockToolbar,'));
    // 不断言相邻两行（中间随时可能插进别的刷新调用），只断言两者都在 syncSettingsToUI 里
    // 而且工具条刷新排在「当前阶段全量直注」刷新之后，避免以后再加一个刷新函数就误报。
    check('打开设置面板时会刷新工具条', () => {
        const start = indexSrc.indexOf('function syncSettingsToUI');
        const end = indexSrc.indexOf('function ', start + 10);
        const body = indexSrc.slice(start, end > start ? end : start + 4000);
        const fullInjectIdx = body.indexOf('niUpdateStageFullInjectUI();');
        const toolbarIdx = body.indexOf('niRefreshStageBlockToolbar();');
        return (fullInjectIdx > 0 && toolbarIdx > fullInjectIdx) || 'syncSettingsToUI 里没有按顺序刷新工具条';
    });
    check('story-data 工厂导出了两个新函数', () => source.includes('niApplyStageBlockAction,') && source.includes('niRefreshStageBlockToolbar,'));
    check('buildStages 渲染后会刷新工具条', () => source.includes("list.innerHTML = html.join('');\n        niRefreshStageBlockToolbar();"));
}

// ── G10 整段屏蔽时清理同阶段的节点级屏蔽（对称性） ─────────────
console.log('\n[G10] 单阶段「一键屏蔽本阶段」：顺手清掉该阶段已勾选的节点屏蔽');
{
    const h = buildHarness({ anchorStage: 8 });
    const n2 = storyMod.niPlotNodeId(h.S.plots.main[1], 'main', 1);
    h.controller.niToggleBlockMode(2);
    h.controller.niApplyBlockAction('apply-checked', 2, [n2]);
    check('先逐节点屏蔽第 2 阶段的节点', () => h.settings.blockedRecallNodes[n2] === true || JSON.stringify(h.settings.blockedRecallNodes));
    h.controller.niApplyBlockAction('stage-block', 2);
    check('整段屏蔽生效', () => h.settings.blockedRecallStages['2'] === true);
    check('节点级屏蔽被顺手清掉（解除整段后不会冒出忘了的节点屏蔽）', () => {
        const ids = Object.keys(h.settings.blockedRecallNodes);
        return ids.length === 0 || `还留着 ${ids.join(',')}`;
    });
    check('该阶段的勾选行显示「整段已屏蔽」', () => {
        const row = h.q('#ni-si-2 .ni-stage-block-row');
        return row.innerHTML.includes('整段已屏蔽') || row.innerHTML;
    });
    check('再点同一阶段的节点多选并勾选后屏蔽，仍然只保留整段屏蔽', () => {
        h.controller.niToggleBlockMode(2);
        h.controller.niApplyBlockAction('apply-checked', 2, [n2]);
        h.controller.niApplyBlockAction('stage-block', 2);
        return Object.keys(h.settings.blockedRecallNodes).length === 0 || JSON.stringify(h.settings.blockedRecallNodes);
    });
    check('解除整段屏蔽后没有任何遗留的节点屏蔽', () => {
        h.controller.niApplyBlockAction('unblock-all', 2);
        return (h.settings.blockedRecallStages['2'] === undefined && Object.keys(h.settings.blockedRecallNodes).length === 0) || JSON.stringify(h.settings);
    });
}

// ── G11 多选阶段的按钮语义翻转：勾选已屏蔽阶段 = 解除 ─────────
console.log('\n[G11] 多选阶段：勾选的都是已屏蔽阶段时，按钮翻转成「解除勾选的阶段屏蔽」');
{
    const h = buildHarness({ anchorStage: 8 });
    h.controller.niApplyStageBlockAction('toggle-pick');
    h.qa('#ni-stage-list .ni-stg-block-chk').forEach(box => {
        if (box.dataset.stageIdx === '2' || box.dataset.stageIdx === '5') box.checked = true;
    });
    h.controller.niApplyStageBlockAction('apply-picked');
    check('先屏蔽第 2、5 阶段', () => h.settings.blockedRecallStages['2'] === true && h.settings.blockedRecallStages['5'] === true);
    // 勾选状态会随整表重绘保留（已屏蔽阶段默认勾选），此时按钮应变成解除
    h.controller.niRefreshStageBlockToolbar();
    check('按钮文案翻转为解除', () => h.q('#ni-stage-block-apply').innerHTML.includes('解除勾选的阶段屏蔽') || h.q('#ni-stage-block-apply').innerHTML);
    check('按钮加上 unblock 样式类', () => h.q('#ni-stage-block-apply').classList.contains('unblock') || `class=${h.q('#ni-stage-block-apply').className}`);
    h.controller.niApplyStageBlockAction('apply-picked');
    check('再点一次就解除这两个阶段的屏蔽（不再是死角）', () => {
        const blocked = Object.keys(h.settings.blockedRecallStages);
        return blocked.length === 0 || `还屏蔽着 ${blocked.join(',')}`;
    });
    check('解除后按钮回到「屏蔽勾选的阶段」且计数归零', () => {
        const btn = h.q('#ni-stage-block-apply');
        return (btn.innerHTML.includes('屏蔽勾选的阶段') && !btn.innerHTML.includes('（') && !btn.classList.contains('unblock')) || btn.innerHTML;
    });
    // 混合勾选（一个已屏蔽 + 一个未屏蔽）时按「补齐屏蔽」处理
    h.qa('#ni-stage-list .ni-stg-block-chk').forEach(box => {
        if (box.dataset.stageIdx === '3') box.checked = true;
    });
    h.controller.niApplyStageBlockAction('apply-picked');
    check('只勾第 3 阶段时执行屏蔽', () => h.settings.blockedRecallStages['3'] === true || JSON.stringify(h.settings.blockedRecallStages));
}

// ── G12 接线核对：新增清理逻辑出现在源码里 ────────────────────
console.log('\n[G12] 接线核对：整段屏蔽的清理与按钮翻转语义');
{
    check('单阶段 stage-block 会先清理节点级屏蔽', () => {
        const seg = source.slice(source.indexOf("if (action === 'stage-block') {"));
        return seg.slice(0, 400).includes('niMutateBlockedNodes(niCollectStageNodeIds(stageIdx), false)') || seg.slice(0, 400);
    });
    check('apply-picked 支持解除（wantUnblock）', () => source.includes('const wantUnblock = blockedPicked.length === valid.length;'));
    check('工具条按钮有 unblock 态', () => fs.readFileSync(pluginPath('style.css'), 'utf8').includes('.ni-block-btn.unblock'));
}

console.log(`\n===== 结果：${pass} 项通过，${fail} 项失败 =====`);
process.exitCode = fail ? 1 : 0;
