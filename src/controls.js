// Настройка сенсорного управления: расположение и размер каждой кнопки и джойстика,
// общая прозрачность и размер, чувствительность обзора. Всё хранится на устройстве.

const KEY = 'sunrise-bay-controls';
const DEFAULTS = { opacity: 0.85, size: 1, look: 1, pos: {} };

export class Controls {
  constructor(game) {
    this.game = game;
    this.cfg = this.load();
    this.touch = document.getElementById('touch');
    this.items = [document.getElementById('joy'), ...this.touch.querySelectorAll('.tbtn')];
    this.base = new Map();
    for (const el of this.items) {
      const cs = getComputedStyle(el);
      this.base.set(el, { w: parseFloat(cs.width) || 66, h: parseFloat(cs.height) || 66, f: parseFloat(cs.fontSize) || 15 });
    }
    this.ui();
    this.apply();
    addEventListener('resize', () => this.apply());
  }

  id(el) { return el.id === 'joy' ? 'joy' : el.dataset.code; }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s) return { ...DEFAULTS, ...s, pos: s.pos || {} };
    } catch (e) { /* хранилище недоступно */ }
    return { ...DEFAULTS, pos: {} };
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.cfg)); } catch (e) { /* нет */ } }

  // Применить размеры, положения и прозрачность.
  apply() {
    const c = this.cfg;
    this.touch.style.setProperty('--tb-opacity', c.opacity);
    this.game.input.lookSens = c.look;
    for (const el of this.items) {
      const b = this.base.get(el), p = c.pos[this.id(el)] || {};
      const s = c.size * (p.s || 1);
      el.style.width = b.w * s + 'px'; el.style.height = b.h * s + 'px';
      if (el.id !== 'joy') el.style.fontSize = b.f * Math.sqrt(s) + 'px';
      if (p.l != null) {
        const w = b.w * s, h = b.h * s;
        el.style.left = Math.min(Math.max(0, p.l * innerWidth), innerWidth - w) + 'px';
        el.style.top = Math.min(Math.max(0, p.t * innerHeight), innerHeight - h) + 'px';
        el.style.right = 'auto'; el.style.bottom = 'auto';
      } else {
        el.style.left = el.style.top = '';
        el.style.right = el.style.bottom = '';
        if (el.dataset.r) { el.style.right = el.dataset.r; el.style.bottom = el.dataset.b; }
      }
    }
  }

  ui() {
    const $ = (id) => document.getElementById(id);
    this.panel = $('setpanel'); this.tools = $('edittools'); this.selName = $('editsel');
    // запомнить исходные позиции из разметки, чтобы «Сбросить» их вернул
    for (const el of this.items) if (el.style.right) { el.dataset.r = el.style.right; el.dataset.b = el.style.bottom; }
    const open = (e) => { e.stopPropagation(); this.open(); };
    $('setbtn').addEventListener('click', open);
    $('hudset').addEventListener('click', open);
    $('setclose').addEventListener('click', () => { this.panel.style.display = 'none'; });
    $('setedit').addEventListener('click', () => this.edit(true));
    $('setreset').addEventListener('click', () => { this.cfg = { ...DEFAULTS, pos: {} }; this.save(); this.apply(); this.sync(); });
    for (const [id, key] of [['setopacity', 'opacity'], ['setsize', 'size'], ['setlook', 'look']]) {
      $(id).addEventListener('input', (e) => { this.cfg[key] = +e.target.value; this.apply(); this.save(); });
    }
    $('editminus').addEventListener('click', () => this.scaleSel(-0.1));
    $('editplus').addEventListener('click', () => this.scaleSel(0.1));
    $('editdone').addEventListener('click', () => this.edit(false));
    // пешком и в машине разные кнопки (удар/оружие или газ/тормоз) — настраиваются по очереди
    $('editmode').addEventListener('click', () => {
      const car = document.body.classList.toggle('editcar');
      $('editmode').textContent = car ? 'Сейчас: в машине → пешком' : 'Сейчас: пешком → в машине';
      for (const el of document.querySelectorAll('.tbtn[data-foot]')) el.textContent = car ? el.dataset.car : el.dataset.foot;
      this.select(document.getElementById('joy'));
    });
    $('editreset').addEventListener('click', () => { this.cfg.pos = {}; this.save(); this.apply(); });
    // перетаскивание в режиме настройки
    for (const el of this.items) {
      el.addEventListener('pointerdown', (e) => {
        if (!this.editing) return;
        e.preventDefault(); e.stopPropagation();
        this.select(el);
        const r = el.getBoundingClientRect();
        this.drag = { el, dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
        el.setPointerCapture?.(e.pointerId);
      });
      el.addEventListener('pointermove', (e) => {
        const d = this.drag;
        if (!d || d.el !== el || d.id !== e.pointerId) return;
        const r = el.getBoundingClientRect();
        const x = Math.min(Math.max(0, e.clientX - d.dx), innerWidth - r.width);
        const y = Math.min(Math.max(0, e.clientY - d.dy), innerHeight - r.height);
        el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
        const p = this.cfg.pos[this.id(el)] || (this.cfg.pos[this.id(el)] = {});
        p.l = x / innerWidth; p.t = y / innerHeight;
      });
      const end = (e) => { if (this.drag && this.drag.el === el) { this.drag = null; this.save(); } void e; };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    }
  }

  sync() {
    const $ = (id) => document.getElementById(id);
    $('setopacity').value = this.cfg.opacity; $('setsize').value = this.cfg.size; $('setlook').value = this.cfg.look;
  }

  open() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.sync();
    this.panel.style.display = 'flex';
  }

  edit(on) {
    this.editing = on;
    document.body.classList.toggle('editing', on);
    document.body.classList.remove('editcar');
    this.game.touchInCar = undefined;   // вернуть подписи кнопок по текущему режиму
    document.getElementById('editmode').textContent = 'Сейчас: пешком → в машине';
    this.panel.style.display = 'none';
    this.tools.style.display = on ? 'flex' : 'none';
    if (on) this.select(this.items[1]);
    else { this.sel?.classList.remove('sel'); this.sel = null; this.save(); }
  }

  select(el) {
    this.sel?.classList.remove('sel');
    this.sel = el;
    el.classList.add('sel');
    this.selName.textContent = el.id === 'joy' ? 'Джойстик' : (el.dataset.car && el.dataset.foot ? `${el.dataset.foot} / ${el.dataset.car}` : el.textContent.trim());
  }

  scaleSel(d) {
    if (!this.sel) return;
    const p = this.cfg.pos[this.id(this.sel)] || (this.cfg.pos[this.id(this.sel)] = {});
    p.s = Math.min(2, Math.max(0.6, (p.s || 1) + d));
    this.apply(); this.save();
  }
}
