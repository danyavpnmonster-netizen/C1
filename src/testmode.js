// Тест-режим: без полиции, с телеметрией физики и быстрыми действиями
// для проверки управления. Клавиши работают только в этом режиме.
const CARS = [['sedan', 'Седан'], ['sport', 'Спорткар'], ['van', 'Фургон'], ['taxi', 'Такси'], ['police', 'Полиция']];

export class TestMode {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.panel = document.getElementById('testpanel');
    this.tele = document.getElementById('tele');
    this.maxG = 0;
  }

  enable() {
    this.on = true;
    const g = this.game;
    document.body.classList.add('testmode');
    this.panel.style.display = 'block';
    const btn = (label, fn, hint) => {
      const b = document.createElement('button');
      b.innerHTML = label + (hint ? `<small>${hint}</small>` : '');
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      b.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); fn(); }, { passive: false });
      return b;
    };
    const row = document.getElementById('testbtns');
    CARS.forEach(([type, name], i) => row.append(btn(name, () => this.spawn(type), String(i + 1))));
    row.append(
      btn('Сброс', () => this.reset(), 'R'),
      btn('Трамплин', () => this.toRamp(), 'G'),
      btn('Прямая', () => this.toStraight(), 'Y'),
      btn('Препятствия', () => this.obstacles(), 'K'),
      btn('Дождь', () => g.weather.setRain(g.weather.target === 0), 'T'),
      btn('Деньги', () => { g.addMoney(5000); g.player.addAmmo(100); g.player.armor = 100; }, '$'),
    );
    g.player.money = Math.max(g.player.money, 5000);
    this.toStraight();
  }

  // Новая машина выбранного типа; игрок сразу за рулём.
  spawn(type) {
    const g = this.game, p = g.player;
    const base = p.car || p;
    const x = base.pos.x, z = base.pos.z, h = p.car ? p.car.heading : p.facing;
    if (p.car) { const old = p.car; g.exitCar(true); g.removeCar(old); }
    const c = g.addCar(type, x, z, h);
    c.role = 'parked';
    p.pos.set(x, 0, z);
    g.toggleCar();
    if (p.car !== c) { c.role = 'player'; c.driverMesh.visible = true; p.car = c; p.lastCar = c; }
    g.hud.message(c.T.name, 1.2);
  }

  reset() {
    const c = this.game.player.car;
    if (!c) return;
    c.vel.x = c.vel.z = 0; c.yawRate = 0; c.vy = 0; c.airborne = false;
    c.pos.y = 0; c.pitch = 0; c.roll = 0; c.bodyPitch = 0;
    if (c.wrecked) { c.wrecked = false; c.exploded = false; c.fire.visible = false; c.repaint(); }
    c.health = 100; c.nitro = 1;
    this.maxG = 0;
  }

  place(x, z, heading) {
    const g = this.game, p = g.player;
    if (!p.car) this.spawn('sport');
    const c = p.car;
    this.reset();
    c.pos.set(x, 0, z); c.heading = heading;
    g.camYaw = heading;
  }

  // Разгон 45 м до трамплина в центральном парке.
  toRamp() {
    const r = this.game.city.ramps[0];
    if (!r) return;
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    if (r.axis === 'x') this.place(r.dir > 0 ? r.x0 - 45 : r.x1 + 45, cz, r.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    else this.place(cx, r.dir > 0 ? r.z0 - 45 : r.z1 + 45, r.dir > 0 ? 0 : Math.PI);
    this.game.hud.message('Газ до упора — трамплин впереди', 2);
  }

  // Внешнее кольцо: длинная прямая вдоль пляжа.
  toStraight() {
    const R = this.game.city.roads, e = R.edges[this.game.city.places.straight.edge];
    const p = R.sample(e.id, 20);
    this.place(p.x - p.tz * 4, p.z + p.tx * 4, Math.atan2(p.tx, p.tz));
    this.game.hud.message(`Прибрежная дорога ${Math.round(e.L)} м: проверьте разгон и торможение`, 2.5);
  }

  // Ряд припаркованных машин впереди — для проверки столкновений.
  obstacles() {
    const g = this.game, c = g.player.car;
    if (!c) return;
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading), lx = fz, lz = -fx;
    const types = ['sedan', 'van', 'taxi', 'sport'];
    for (let k = 0; k < 4; k++) {
      const d = 30 + k * 7, side = (k % 2 ? 1 : -1) * 1.2;
      const o = g.addCar(types[k], c.pos.x + fx * d + lx * side, c.pos.z + fz * d + lz * side, c.heading + (k % 2 ? 0.6 : -0.4));
      o.role = 'parked';
    }
    g.hud.message('Впереди 4 машины', 1.5);
  }

  update(dt) {
    if (!this.on) return;
    const g = this.game, inp = g.input;
    for (let i = 0; i < CARS.length; i++) if (inp.pressed('Digit' + (i + 1))) this.spawn(CARS[i][0]);
    if (inp.pressed('KeyR')) this.reset();
    if (inp.pressed('KeyG')) this.toRamp();
    if (inp.pressed('KeyY')) this.toStraight();
    if (inp.pressed('KeyK')) this.obstacles();
    if (inp.pressed('KeyT')) g.weather.setRain(g.weather.target === 0);
    if (g.wanted) g.setWanted(0);
    g.player.health = Math.max(g.player.health, 30);

    const c = g.player.car;
    if (!c) { this.tele.textContent = 'Пешком. Выберите машину кнопкой или 1–5.'; return; }
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const vx = c.vel.x * fx + c.vel.z * fz, vy = c.vel.x * fz - c.vel.z * fx;
    const v = Math.hypot(vx, vy);
    const beta = v > 1 ? Math.atan2(vy, Math.abs(vx)) * 57.3 : 0;
    const gl = c.ayLat / 9.81, ga = c.axLong / 9.81;
    this.maxG = Math.max(this.maxG, Math.abs(gl));
    const grip = Math.round((1 - g.weather.amount * 0.25) * 100);
    const fmt = (n, d = 1) => (n >= 0 ? ' ' : '') + n.toFixed(d);
    this.tele.textContent =
      `${c.T.name}  ${Math.round(c.T.mass)} кг\n` +
      `скорость   ${String(Math.round(v * 3.6)).padStart(4)} км/ч\n` +
      `продольн.  ${fmt(ga, 2)} g\n` +
      `боковое    ${fmt(gl, 2)} g  (макс ${this.maxG.toFixed(2)})\n` +
      `угол заноса${fmt(beta, 0).padStart(5)}°\n` +
      `вращение   ${fmt(c.yawRate, 2)} рад/с\n` +
      `скольжение ${String(Math.round(c.skid * 100)).padStart(4)} %${c.wheelSpin ? '  пробуксовка' : ''}\n` +
      `сцепление  ${String(grip).padStart(4)} %${grip < 100 ? '  (дождь)' : ''}\n` +
      `в воздухе  ${c.airborne ? 'да, ' + c.pos.y.toFixed(1) + ' м' : 'нет'}\n` +
      `корпус     ${String(Math.round(c.health)).padStart(4)} %   нитро ${Math.round(c.nitro * 100)} %`;
  }
}
