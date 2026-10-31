/**
 * 穿书状态栏：Web Component（Shadow DOM 隔离）
 *
 * 设计约定
 *  - 只管「把 state 画出来」，不碰小说数据、不认识 SillyTavern
 *  - 所有交互只 dispatch 一个 'ni-tb-act' 事件：detail = { act, payload }
 *  - 外观走 CSS 变量 + skin 对象，位置走槽位表
 */

/** 槽位表（百分比，相对组件宽度/高度） */
export const NI_TB_LAYOUT = {
    bar:    { x: 0,  y: 0,  w: 100, h: 9 },
    actions:{ x: 4,  y: 10, w: 92,  h: 9 },
    card:   { x: 3,  y: 21, w: 66,  h: 68 },
    next:   { x: 71, y: 21, w: 26,  h: 68 },
    footer: { x: 4,  y: 91, w: 92,  h: 8 }
};

const CSS = `
:host {
    --tb-accent: #c05a62;
    --tb-text: #5a5a6a;
    --tb-title: #1a1a1a;
    --tb-bar-bg: #ffffff;
    --tb-card-bg: #ffffff;
    --tb-card-line: #e8e8ec;
    --tb-radius: 12px;
    --tb-card-h: 200px;
    --tb-card-pad: 13px;
    --tb-veil: 0;
    display: block;
    margin: 8px 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
    user-select: none;
    color: var(--tb-text);
}
.shell {
    position: relative;
    border-radius: 16px;
    border: 0.5px solid var(--tb-card-line);
    background-color: var(--tb-bar-bg);
    background-image: var(--tb-art, none);
    background-size: 100% 100%;
    background-position: center;
    background-repeat: no-repeat;
    overflow: hidden;
    /* 上传底图没留边时是 0；自动识别到面板区后由 skin.pad 撑出内边距 */
    padding: var(--tb-pad-t, 0px) var(--tb-pad-r, 0px) var(--tb-pad-b, 0px) var(--tb-pad-l, 0px);
    box-sizing: border-box;
}

/* ── 顶栏 ───────────────────────────── */
.bar {
    display: flex; align-items: center; gap: 7px;
    padding: 10px 13px 8px;
    background: var(--tb-bar-bg);
    cursor: pointer;
}
.pin { width: 6px; height: 6px; border-radius: 50%; background: var(--tb-accent); flex: 0 0 auto; }
.status { font-size: 11px; font-weight: 600; color: var(--tb-accent); flex: 0 0 auto; }
.curtitle { font-size: 12.5px; font-weight: 600; color: var(--tb-title); flex: 1 1 auto; min-width: 0;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { font-size: 10.5px; color: var(--tb-text); opacity: .8; margin-left: auto; flex: 0 0 auto; }
.chev { transition: transform .25s ease; font-size: 13px; opacity: .6; flex: 0 0 auto; }
.chev.open { transform: rotate(180deg); }

/* ── 按钮行 ─────────────────────────── */
.body { display: none; }
.body.open { display: block; }
.actions {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 11px 4px;
    background: var(--tb-bar-bg);
}
.icon-btn {
    width: 30px; height: 26px; border-radius: 8px; border: 0.5px solid var(--tb-card-line);
    background: var(--tb-card-bg); color: var(--tb-text);
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 12px; cursor: pointer; flex: 0 0 auto;
}
.sep { color: var(--tb-card-line); font-size: 11px; }
.spacer { flex: 1 1 auto; }
.pill {
    display: inline-flex; align-items: center; gap: 4px;
    height: 26px; padding: 0 10px; border-radius: 13px;
    border: 0.5px solid var(--tb-card-line); background: var(--tb-card-bg);
    color: var(--tb-text); font-size: 11.5px; cursor: pointer; flex: 0 0 auto;
}
.pill.on { border-color: var(--tb-accent); color: var(--tb-accent); background: color-mix(in srgb, var(--tb-accent) 10%, transparent); }
.pill:disabled { opacity: .5; cursor: default; }

/* ── 卡片轮播 ───────────────────────── */
.deck {
    position: relative;
    height: var(--tb-card-h);
    margin: 6px 10px 8px;
    overflow: hidden;
}
.card {
    position: absolute; top: 0; height: 100%;
    box-sizing: border-box;
    padding: var(--tb-card-pad) 14px;
    border-radius: var(--tb-radius);
    border: 0.5px solid var(--tb-card-line);
    background: var(--tb-card-bg);
    overflow-y: auto; overflow-x: hidden;
    overscroll-behavior: contain; touch-action: pan-y;
    scrollbar-width: thin;
    cursor: pointer;
    transition: left .34s cubic-bezier(.4,0,.2,1), width .34s cubic-bezier(.4,0,.2,1), opacity .3s;
}
.card.active { border-color: var(--tb-accent); box-shadow: 0 6px 20px rgba(90,70,130,.14); cursor: default; z-index: 2; }
.card.side { opacity: .72; }
.card.side:hover { opacity: .9; }
.card.done { opacity: .82; }
.card::-webkit-scrollbar { width: 4px; }
.card::-webkit-scrollbar-thumb { background: var(--tb-accent); border-radius: 2px; opacity: .5; }
.card::-webkit-scrollbar-track { background: transparent; }

.num { font-size: 10.5px; color: var(--tb-text); opacity: .78; }
.num-meta { opacity: .7; }
.type {
    display: inline-block; margin-top: 6px; padding: 1px 7px; border-radius: 8px;
    font-size: 9.5px; background: rgba(208,100,110,.12); color: var(--tb-accent);
}
.type.sub { background: rgba(90,140,200,.12); }
.type.turn { background: rgba(230,160,60,.14); }
.title { margin: 7px 0 5px; font-size: 13px; font-weight: 600; line-height: 1.35; color: var(--tb-title); }
.desc { font-size: 11px; line-height: 1.55; color: var(--tb-text); white-space: pre-wrap; }
.extras { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
.extra { font-size: 10px; line-height: 1.45; color: var(--tb-text); opacity: .85;
         overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.extra i { opacity: .6; margin-right: 3px; }
.check {
    position: absolute; top: 9px; right: 10px;
    width: 15px; height: 15px; border-radius: 50%;
    border: 1.5px solid var(--tb-card-line); box-sizing: border-box;
}
.check.on {
    border-color: var(--tb-accent);
    background: var(--tb-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--tb-accent) 22%, transparent);
}

/* ── 底栏 ───────────────────────────── */
.footer {
    display: flex; align-items: center; gap: 6px;
    margin: 0 10px 10px; padding: 7px 10px;
    border-radius: 10px; border: 0.5px solid var(--tb-card-line);
    background: var(--tb-bar-bg);
    font-size: 10.5px; color: var(--tb-text);
}
.footer .grow { flex: 1 1 auto; }
.footer .run {
    height: 22px; padding: 0 9px; border-radius: 11px; border: 0.5px solid var(--tb-card-line);
    background: var(--tb-card-bg); color: var(--tb-text); font-size: 10.5px; cursor: pointer;
}
.empty { padding: 18px 12px; font-size: 11px; color: var(--tb-text); opacity: .7; text-align: center; }
`;

/** 组装 state → HTML（纯函数，方便快照测试） */
export function niStoryBarHTML(state) {
    const s = state || {};
    const nodes = Array.isArray(s.nodes) ? s.nodes : [];
    const cur = Math.max(0, Math.min(nodes.length - 1, Number(s.cur) || 0));
    const active = nodes[cur] || null;
    const next = nodes[cur + 1] || null;
    const prev = nodes[cur - 1] || null;

    const bar = `
      <div class="bar" data-act="toggle">
        <span class="pin"></span>
        <span class="status">${esc(s.status || '进行中')}</span>
        <span class="curtitle">${esc(s.title || active?.title || '')}</span>
        <span class="meta">${esc(s.meta || '')}</span>
        <span class="chev${s.open ? ' open' : ''}">▾</span>
      </div>`;

    const actions = `
      <div class="actions">
        <button class="icon-btn" data-act="stage" title="切换阶段">☰</button>
        <span class="sep">/</span>
        <button class="icon-btn" data-act="node" title="切换节点">⚑</button>
        <span class="spacer"></span>
        <button class="pill${s.auto ? ' on' : ''}" data-act="auto" title="自动推进">✦ 自动</button>
        <button class="pill" data-act="infer" title="推演"${s.inferDisabled ? ' disabled' : ''}>◔ 推演</button>
        <button class="pill${s.paused ? ' on' : ''}" data-act="pause" title="暂停">❚❚ 暂停</button>
      </div>`;

    const cards = [];
    if (prev) cards.push(cardHTML(prev, 'side', cur - 1));
    if (active) cards.push(cardHTML(active, 'active', cur));
    if (next) cards.push(cardHTML(next, 'side next', cur + 1));
    const deck = `<div class="deck" data-deck>${cards.join('') || '<div class="empty">还没有剧情节点</div>'}</div>`;

    const footer = `
      <div class="footer">
        <span>◎ 后台动向 ${Number(s.offCount) || 0} 条</span>
        <span class="grow"></span>
        <button class="run" data-act="off">推演</button>
        <span class="chev" data-act="off">▾</span>
      </div>`;

    return `<div class="shell">${bar}<div class="body${s.open ? ' open' : ''}">${actions}${deck}${s.extraHtml || ''}${footer}</div></div>`;
}

function cardHTML(node, cls, idx) {
    const typeCls = node.typeKind === 'sub' ? ' sub' : node.typeKind === 'turn' ? ' turn' : '';
    const extras = (node.extras || []).map(t =>
        `<div class="extra"><i>◌</i>${esc(t)}</div>`).join('');
    return `
      <div class="card ${cls}${node.done ? ' done' : ''}" data-idx="${idx}">
        <div class="num">节点 ${esc(node.num || '')} <span class="num-meta">${esc(node.meta || '')}</span></div>
        <div class="type${typeCls}">${esc(node.type || '主线')}</div>
        <div class="title">${esc(node.title || '')}</div>
        <div class="desc">${esc(node.desc || '')}</div>
        ${extras ? `<div class="extras">${extras}</div>` : ''}
        <div class="check${node.done ? ' on' : ''}"></div>
      </div>`;
}

function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Node 里（跑测试）没有 HTMLElement，用一个空基类顶替，保证纯函数部分可测
const NiElementBase = (typeof HTMLElement !== 'undefined') ? HTMLElement : class {};

/** 自定义元素：属性/方法都走 setState，内部自己 diff 重绘 */
export class NiStoryBar extends NiElementBase {
    constructor() {
        super();
        if (this.attachShadow) this.attachShadow({ mode: 'open' });
        this._state = {};
        this._dragging = null;
    }

    connectedCallback() {
        this.render();
    }

    set state(v) { this._state = v || {}; this.render(); }
    get state() { return this._state; }

    render() {
        const root = this.shadowRoot;
        root.innerHTML = `<style>${CSS}</style>${niStoryBarHTML(this._state)}`;
        this._applyArt();
        this._positionCards();
        this._bind();
    }

    _applyArt() {
        const skin = this._state.skin || {};
        const shell = this.shadowRoot.querySelector('.shell');
        if (!shell) return;
        const el = this;
        const vars = {
            '--tb-accent': skin.accent, '--tb-text': skin.text, '--tb-title': skin.title,
            '--tb-bar-bg': skin.barBg, '--tb-card-bg': skin.cardBg, '--tb-card-line': skin.cardLine,
            '--tb-radius': skin.radius != null ? skin.radius + 'px' : null,
            '--tb-card-h': skin.cardH != null ? skin.cardH + 'px' : null,
            '--tb-card-pad': skin.cardPad != null ? skin.cardPad + 'px' : null
        };
        // 底图自带内框时，用百分比撑出内边距，内容自动落进画好的面板里；
        // 用户也可以在设置里开「强制留边」，让满屏装饰图也留一圈
        const pad = skin.pad || null;
        const force = Number(skin.forcePad) || 0;
        if (force > 0) {
            ['t', 'r', 'b', 'l'].forEach((k) => { vars['--tb-pad-' + k] = force + '%'; });
        } else if (pad && (pad.t || pad.r || pad.b || pad.l)) {
            ['t', 'r', 'b', 'l'].forEach((k) => {
                const v = Number(pad[k]) || 0;
                vars['--tb-pad-' + k] = v > 0 ? v + '%' : '0px';
            });
        } else {
            ['t', 'r', 'b', 'l'].forEach((k) => vars['--tb-pad-' + k] = '0px');
        }
        Object.entries(vars).forEach(([k, v]) => {
            if (v) el.style.setProperty(k, v);
            else el.style.removeProperty(k);
        });
        if (skin.art) {
            const veil = Number(skin.veil) || 0;
            const layer = veil > 0
                ? `linear-gradient(rgba(255,255,255,${veil}), rgba(255,255,255,${veil})), url('${skin.art}')`
                : `url('${skin.art}')`;
            el.style.setProperty('--tb-art', layer);
        } else {
            el.style.removeProperty('--tb-art');
        }
    }

    /** 按槽位摆放卡片：active 居中偏左，右边露下一张 */
    _positionCards() {
        const deck = this.shadowRoot.querySelector('[data-deck]');
        if (!deck) return;
        const W = deck.clientWidth || 320;
        const gap = 8;
        const nextW = Math.round(W * 0.26);
        const cardW = Math.round(W - nextW - gap);
        deck.querySelectorAll('.card').forEach((el) => {
            const isActive = el.classList.contains('active');
            const isNext = el.classList.contains('next');
            el.style.width = (isActive ? cardW : nextW) + 'px';
            if (isActive) el.style.left = '0px';
            else if (isNext) el.style.left = (cardW + gap) + 'px';
            else el.style.left = (-nextW - gap) + 'px';
        });
    }

    _bind() {
        const root = this.shadowRoot;
        root.addEventListener('click', (e) => {
            const actEl = e.target.closest?.('[data-act]');
            if (actEl) {
                this._emit(actEl.dataset.act);
                return;
            }
            const card = e.target.closest?.('.card');
            if (card && !card.classList.contains('active')) {
                this._emit('pick', Number(card.dataset.idx));
            }
        });

        // 左右滑动：横向位移够大就切相邻卡；纵向让卡片自己滚
        const deck = root.querySelector('[data-deck]');
        if (!deck) return;
        let sx = 0, sy = 0, on = false;
        deck.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            on = true; sx = e.clientX; sy = e.clientY;
        });
        deck.addEventListener('pointerup', (e) => {
            if (!on) return;
            on = false;
            const dx = e.clientX - sx, dy = e.clientY - sy;
            if (Math.abs(dx) < 32 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
            this._emit(dx < 0 ? 'next' : 'prev');
        });
        deck.addEventListener('pointercancel', () => { on = false; });
    }

    _emit(act, payload) {
        this.dispatchEvent(new CustomEvent('ni-tb-act', {
            detail: { act, payload },
            bubbles: true,
            composed: true
        }));
    }
}

export function niDefineStoryBar(tag = 'ni-storybar') {
    if (typeof customElements === 'undefined') return null;
    const existing = customElements.get(tag);
    if (existing) return existing;
    customElements.define(tag, NiStoryBar);
    return NiStoryBar;
}
