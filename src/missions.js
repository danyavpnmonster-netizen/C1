import * as THREE from 'three';
import { N, BLOCK, nodeCoord, rnd, pick, randInt } from './config.js';
import { neighbors } from './traffic.js';
import { makeHuman, randomLook } from './human.js';

function roadSpot() {
  const a = { i: randInt(0, N), j: randInt(0, N) }, b = pick(neighbors(a));
  const ax = nodeCoord(a.i), az = nodeCoord(a.j);
  const dx = (nodeCoord(b.i) - ax) / BLOCK, dz = (nodeCoord(b.j) - az) / BLOCK;
  const t = rnd(0.3, 0.7) * BLOCK;
  return { x: ax + dx * t - dz * 6, z: az + dz * t + dx * 6, h: Math.atan2(dx, dz) };
}
function spotFrom(P, minD, maxD) {
  for (let k = 0; k < 80; k++) {
    const s = roadSpot(), d = Math.hypot(s.x - P.x, s.z - P.z);
    if (d >= minD && d <= maxD) return s;
  }
  return roadSpot();
}
const D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const COLUMN = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
function column(color, r, h, opacity = 0.35) {
  const m = new THREE.Mesh(COLUMN, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  }));
  m.scale.set(r, h, r);
  m.position.y = h / 2;
  return m;
}

export class Missions {
  constructor(game) {
    this.game = game;
    const c = game.city;
    const b1 = c.block(4, 4), b2 = c.block(5, 5), b3 = c.block(3, 5), b4 = c.block(4, 5);
    this.givers = [
      { type: 'courier', name: 'Курьер', color: 0xffcc00, pos: { x: b1.x1 - 2, z: b1.cz + 14 }, car: false },
      { type: 'taxi', name: 'Такси', color: 0x33aaff, pos: { x: b2.x0 + 2, z: b2.cz }, car: true },
      { type: 'race', name: 'Гонка', color: 0xff4466, pos: { x: b3.x1 - 2, z: b3.cz - 10 }, car: true },
      { type: 'steal', name: 'Угон на заказ', color: 0xaa55ff, pos: { x: b4.cx + 12, z: b4.z0 + 2 }, car: false },
    ];
    for (const g of this.givers) {
      g.mesh = new THREE.Group();
      g.mesh.add(column(g.color, 1.3, 2.5, 0.45));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.12, 8, 24), new THREE.MeshBasicMaterial({ color: g.color }));
      ring.position.y = 3.2; g.ring = ring; g.mesh.add(ring);
      g.mesh.position.set(g.pos.x, 0, g.pos.z);
      g.cd = 0;
      game.scene.add(g.mesh);
    }
    this.marker = column(0xffdd33, 4, 60);
    this.marker.visible = false;
    game.scene.add(this.marker);
    this.passenger = null;
    this.active = null;
    this.hintT = 0;
  }

  get target() { return this.active ? this.active.stages[this.active.idx].pos : null; }

  start(giver) {
    const g = this.game, P = g.playerPos();
    let m;
    if (giver.type === 'courier') {
      const A = spotFrom(P, 100, 250), B = spotFrom(A, 200, 400);
      m = { title: 'Курьер', reward: 400, time: (D(P, A) + D(A, B)) / 11 + 25, stages: [
        { pos: A, text: 'Забери посылку', r: 4 },
        { pos: B, text: 'Доставь посылку', r: 5, stop: true },
      ] };
    } else if (giver.type === 'taxi') {
      const A = spotFrom(P, 80, 200), B = spotFrom(A, 200, 450);
      m = { title: 'Такси', reward: 250, bonus: 6, time: (D(P, A) + D(A, B)) / 12 + 25, needCar: true, stages: [
        { pos: A, text: 'Подбери пассажира', r: 6, stop: true, pickup: true },
        { pos: B, text: 'Отвези пассажира', r: 6, stop: true },
      ] };
      const l = randomLook();
      this.passenger = makeHuman(l.shirt, l.pants, l.skin, l.hair);
      this.passenger.position.set(A.x, 0, A.z);
      g.scene.add(this.passenger);
    } else if (giver.type === 'steal') {
      const A = spotFrom(P, 120, 280), B = spotFrom(A, 250, 450);
      const car = g.addCar(pick(['sport', 'van', 'taxi']), A.x, A.z, A.h);
      car.role = 'parked'; car.keep = true;
      car.bodyMat.color.setHex(0xaa55ff);
      m = { title: 'Угон на заказ', reward: 700, bonus: 5, time: (D(P, A) + D(A, B)) / 11 + 40, car, stages: [
        { pos: { x: A.x, z: A.z }, text: `Угони фиолетовую машину (${car.T.name})`, r: 3, car },
        { pos: B, text: 'Пригони машину заказчику', r: 6, stop: true, needThis: car },
      ] };
    } else {
      const pts = []; let prev = P, total = 0;
      for (let k = 0; k < 6; k++) { const s = spotFrom(prev, 90, 170); total += D(prev, s); pts.push(s); prev = s; }
      m = { title: 'Гонка', reward: 600, bonus: 12, time: total / 15 + 12, needCar: true,
        stages: pts.map((pos, k) => ({ pos, text: `Чекпоинт ${k + 1}/6`, r: 7 })) };
    }
    m.idx = 0; m.giver = giver;
    this.active = m;
    this.marker.visible = true;
    this.placeMarker();
    g.hud.big(m.title, 2);
    g.hud.message(m.stages[0].text, 4);
    g.sfx.check();
  }

  placeMarker() {
    const st = this.active.stages[this.active.idx];
    this.marker.position.set(st.pos.x, 30, st.pos.z);
    this.marker.scale.set(st.r * 0.8, 60, st.r * 0.8);
  }

  finish() {
    const g = this.game, m = this.active;
    const pay = Math.round(m.reward + (m.bonus ? m.time * m.bonus : 0));
    g.addMoney(pay);
    g.stats.missions++;
    g.hud.big(`МИССИЯ ВЫПОЛНЕНА\n+$${pay}`, 3.5);
    g.sfx.ok();
    this.end();
  }

  fail(reason = '') {
    if (!this.active) return;
    this.game.hud.big('МИССИЯ ПРОВАЛЕНА' + (reason ? '\n' + reason : ''), 3);
    this.game.sfx.fail();
    this.end();
  }

  end() {
    if (this.active) {
      this.active.giver.cd = 20;
      if (this.active.car) this.active.car.keep = false;
    }
    this.active = null;
    this.marker.visible = false;
    if (this.passenger) { this.game.scene.remove(this.passenger); this.passenger = null; }
  }

  update(dt) {
    const g = this.game, P = g.playerPos(), car = g.player.car;
    const t = g.time;
    this.hintT -= dt;
    for (const gv of this.givers) {
      gv.cd = Math.max(0, gv.cd - dt);
      gv.mesh.visible = !this.active && gv.cd <= 0;
      gv.ring.rotation.y = t * 2;
      gv.ring.position.y = 3.2 + Math.sin(t * 3) * 0.2;
    }
    if (g.state !== 'play') return;
    if (!this.active) {
      for (const gv of this.givers) {
        if (gv.cd > 0 || D(P, gv.pos) > 3.5) continue;
        if (gv.car && !car) {
          if (this.hintT <= 0) { g.hud.message(`«${gv.name}»: нужна машина`, 2); this.hintT = 2.5; }
        } else this.start(gv);
      }
      return;
    }
    const m = this.active;
    m.time -= dt;
    if (m.time <= 0) { m.time = 0; this.fail('Время вышло'); return; }
    if (this.passenger) {
      this.passenger.rotation.y = Math.atan2(P.x - this.passenger.position.x, P.z - this.passenger.position.z);
    }
    const st = m.stages[m.idx];
    if (m.car && (m.car.wrecked || !g.cars.includes(m.car))) { this.fail('Машина уничтожена'); return; }
    if (st.car) {
      st.pos.x = st.car.pos.x; st.pos.z = st.car.pos.z;
      this.marker.position.set(st.pos.x, 30, st.pos.z);
      if (car === st.car) {
        m.idx++; g.sfx.check(); this.placeMarker();
        g.crime(4);
        g.hud.message('Сработала сигнализация! ' + m.stages[m.idx].text, 3.5);
      }
      return;
    }
    if (st.needThis && car !== st.needThis) {
      if (this.hintT <= 0) { g.hud.message('Нужна та самая фиолетовая машина!', 2); this.hintT = 3; }
      return;
    }
    if (m.needCar && !car) {
      if (this.hintT <= 0) { g.hud.message('Вернитесь в машину!', 2); this.hintT = 3; }
      return;
    }
    if (D(P, st.pos) < st.r && (!st.stop || !car || Math.abs(car.speed) < 4)) {
      if (st.pickup && this.passenger) { this.passenger.visible = false; }
      m.idx++;
      g.sfx.check();
      if (m.idx >= m.stages.length) { this.finish(); return; }
      this.placeMarker();
      g.hud.message(m.stages[m.idx].text, 3);
    } else if (st.stop && car && D(P, st.pos) < st.r && this.hintT <= 0) {
      g.hud.message('Остановитесь', 1.2); this.hintT = 1.5;
    }
  }
}
