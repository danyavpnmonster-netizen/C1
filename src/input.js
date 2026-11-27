// Клавиатура, мышь (pointer lock) и сенсорное управление.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.justPressed = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.clicked = false;
    this.joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
    this.lookId = null; this.lookX = 0; this.lookY = 0;
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (this.isTouch) return;
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
      if (e.button === 0) this.clicked = true;
    });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    if (this.isTouch) this.setupTouch();
  }

  setupTouch() {
    document.body.classList.add('touch');
    const joy = document.getElementById('joy'), knob = document.getElementById('knob');
    const R = 55;
    joy.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]; const r = joy.getBoundingClientRect();
      this.joy.id = t.identifier; this.joy.ox = r.left + r.width / 2; this.joy.oy = r.top + r.height / 2;
      this.moveJoy(t, knob, R); e.preventDefault();
    }, { passive: false });
    joy.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (t.identifier === this.joy.id) this.moveJoy(t, knob, R);
      e.preventDefault();
    }, { passive: false });
    const endJoy = (e) => {
      for (const t of e.changedTouches) if (t.identifier === this.joy.id) {
        this.joy.id = null; this.joy.x = this.joy.y = 0; knob.style.transform = 'translate(0px,0px)';
      }
    };
    joy.addEventListener('touchend', endJoy); joy.addEventListener('touchcancel', endJoy);

    for (const b of document.querySelectorAll('[data-code]')) {
      const code = b.dataset.code;
      b.addEventListener('touchstart', (e) => {
        if (!this.keys.has(code)) this.justPressed.add(code);
        this.keys.add(code); b.classList.add('on'); e.preventDefault();
      }, { passive: false });
      const up = () => { this.keys.delete(code); b.classList.remove('on'); };
      b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
    }
    // обзор — свайп по экрану
    const c = this.canvas;
    c.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      if (this.lookId === null) { this.lookId = t.identifier; this.lookX = t.clientX; this.lookY = t.clientY; }
      e.preventDefault();
    }, { passive: false });
    c.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (t.identifier === this.lookId) {
        this.mouseDX += (t.clientX - this.lookX) * 2; this.mouseDY += (t.clientY - this.lookY) * 2;
        this.lookX = t.clientX; this.lookY = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    const endLook = (e) => { for (const t of e.changedTouches) if (t.identifier === this.lookId) this.lookId = null; };
    c.addEventListener('touchend', endLook); c.addEventListener('touchcancel', endLook);
  }

  moveJoy(t, knob, R) {
    let dx = t.clientX - this.joy.ox, dy = t.clientY - this.joy.oy;
    const l = Math.hypot(dx, dy);
    if (l > R) { dx = dx / l * R; dy = dy / l * R; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    this.joy.x = dx / R; this.joy.y = -dy / R;
  }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this.justPressed.has(code); }

  axis() {
    const k = (c) => (this.keys.has(c) ? 1 : 0);
    const x = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + this.joy.x;
    const y = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') + this.joy.y;
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), run: Math.hypot(this.joy.x, this.joy.y) > 0.92 };
  }

  endFrame() {
    this.justPressed.clear();
    this.mouseDX = 0; this.mouseDY = 0; this.clicked = false;
  }
}
