import * as THREE from 'three';
import { makeHuman, animateHuman, randomLook } from './human.js';
import { rnd, randInt, pick } from './config.js';
import { NODE_R } from './roads.js';

// Пешеходы ходят по тротуарам вдоль дорог. Маршрут: p.w = {edge, side, s, dir}
// (side +1 — тротуар справа от направления a→b, dir — куда идёт вдоль дороги).
// У перекрёстка сворачивают за угол или переходят улицу.

const STEP = 4;
const END = NODE_R + 1;

class Ped {
  constructor(scene) {
    const l = randomLook();
    this.mesh = makeHuman(l.shirt, l.pants, l.skin, l.hair, l.opts);
    scene.add(this.mesh);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.state = 'walk'; this.facing = 0; this.phase = Math.random() * 6;
    this.speed = rnd(1.1, 1.6); this.timer = 0;
    this.w = { edge: 0, side: 1, s: 0, dir: 1 };
    this.target = { x: 0, z: 0 }; this.flee = { x: 0, z: 0 };
  }
}

export class Peds {
  constructor(game, count = 40) {
    this.game = game;
    this.list = [];
    for (let i = 0; i < count; i++) {
      const p = new Ped(game.scene);
      this.respawn(p, true);
      this.list.push(p);
    }
  }

  get R() { return this.game.city.roads; }

  setTarget(p) {
    const pt = this.R.sidewalkPoint(p.w.edge, p.w.s, p.w.side);
    p.target.x = pt.x; p.target.z = pt.z;
  }

  respawn(p, initial = false) {
    const g = this.game, P = g.playerPos(), R = this.R;
    for (let t = 0; t < 30; t++) {
      const a = Math.random() * Math.PI * 2, r = initial ? rnd(8, 120) : rnd(55, 125);
      const n = R.nearest(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r, 50);
      if (!n) continue;
      const e = R.edges[n.edge];
      if (e.L < END * 2 + 4) continue;
      const sPos = Math.min(Math.max(n.s, END), e.L - END);
      p.w = { edge: n.edge, side: Math.random() < 0.5 ? 1 : -1, s: sPos, dir: Math.random() < 0.5 ? 1 : -1 };
      const pt = R.sidewalkPoint(n.edge, sPos, p.w.side);
      const d = Math.hypot(pt.x - P.x, pt.z - P.z);
      if (!initial && d < 45) continue;
      p.pos.set(pt.x, 0, pt.z);
      break;
    }
    this.advance(p);
    p.state = 'walk'; p.timer = 0;
    p.mesh.rotation.set(0, 0, 0);
    p.mesh.visible = true;
  }

  // Следующая точка маршрута; у конца дороги — переход на соседнюю.
  advance(p) {
    const R = this.R, w = p.w, e = R.edges[w.edge];
    const ns = w.s + w.dir * STEP;
    if (ns > END && ns < e.L - END) { w.s = ns; this.setTarget(p); return; }
    // перекрёсток: выбираем дорогу дальше
    const node = w.dir > 0 ? e.b : e.a;
    const opts = R.nodes[node].edges.filter((id) => id !== w.edge && R.edges[id].L > END * 2 + 2);
    const nid = opts.length ? pick(opts) : w.edge;
    const ne = R.edges[nid];
    const atA = ne.a === node;
    const s2 = atA ? END : ne.L - END;
    // сторона: ближайшая (за угол) или, иногда, через дорогу
    const here = { x: p.pos.x, z: p.pos.z };
    const pa = R.sidewalkPoint(nid, s2, 1), pb = R.sidewalkPoint(nid, s2, -1);
    let side = Math.hypot(pa.x - here.x, pa.z - here.z) < Math.hypot(pb.x - here.x, pb.z - here.z) ? 1 : -1;
    if (Math.random() < 0.25) side = -side;
    p.w = { edge: nid, side, s: s2, dir: atA ? 1 : -1 };
    this.setTarget(p);
  }

  resumeWalk(p) {
    const R = this.R, n = R.nearest(p.pos.x, p.pos.z, 120);
    if (n) {
      const e = R.edges[n.edge];
      p.w = { edge: n.edge, side: n.side, s: Math.min(Math.max(n.s, END), e.L - END), dir: Math.random() < 0.5 ? 1 : -1 };
      this.setTarget(p);
    }
    p.state = 'walk';
    p.mesh.rotation.set(0, p.facing, 0);
  }

  arrive(p) { this.advance(p); }

  scare(pos, radius) {
    for (const p of this.list) {
      if (p.state !== 'walk' && p.state !== 'flee') continue;
      if (Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < radius) {
        p.state = 'flee'; p.timer = rnd(4, 7); p.flee.x = pos.x; p.flee.z = pos.z;
      }
    }
  }

  hitByCar(p, car) {
    const f = car.forward(), s = Math.abs(car.speed);
    p.state = 'flying';
    p.vel.set(f.x * s * 0.7 * Math.sign(car.speed) + rnd(-2, 2), 3 + s * 0.25, f.z * s * 0.7 * Math.sign(car.speed) + rnd(-2, 2));
    p.pos.y = 0.3;
    if (Math.random() < 0.5) this.game.spawnCash(p.pos.x, p.pos.z, randInt(10, 40));
    this.scare(p.pos, 25);
  }

  shot(p, dx, dz) {
    if (p.state === 'dead' || p.state === 'flying') return;
    p.state = 'flying';
    p.facing = Math.atan2(-dx, -dz);
    p.vel.set(dx * 3, 2.5, dz * 3);
    p.pos.y = 0.3;
    if (Math.random() < 0.5) this.game.spawnCash(p.pos.x, p.pos.z, randInt(10, 50));
  }

  punch(p, from) {
    if (p.state === 'dead' || p.state === 'flying') return;
    p.state = 'down'; p.timer = 2.5;
    p.facing = Math.atan2(from.x - p.pos.x, from.z - p.pos.z);
    if (Math.random() < 0.35) this.game.spawnCash(p.pos.x + rnd(-1, 1), p.pos.z + rnd(-1, 1), randInt(5, 25));
    this.scare(p.pos, 15);
  }

  // Высадить водителя угнанной машины: он убегает.
  ejectDriver(x, z, from) {
    let best = null, bd = -1;
    for (const p of this.list) {
      const d = Math.hypot(p.pos.x - from.x, p.pos.z - from.z);
      if (d > bd && p.state !== 'flying') { bd = d; best = p; }
    }
    if (!best) return;
    best.pos.set(x, 0, z);
    best.mesh.rotation.set(0, 0, 0);
    best.state = 'flee'; best.timer = 6; best.flee.x = from.x; best.flee.z = from.z;
  }

  update(dt) {
    const g = this.game, P = g.playerPos(), city = g.city;
    for (const p of this.list) {
      const d = Math.hypot(p.pos.x - P.x, p.pos.z - P.z);
      if ((d > 150 && p.state !== 'flying') || (p.state === 'dead' && p.timer > 12)) { this.respawn(p); continue; }
      let moving = 0;
      if (p.state === 'walk') {
        const dx = p.target.x - p.pos.x, dz = p.target.z - p.pos.z, l = Math.hypot(dx, dz);
        if (l < 0.4) this.arrive(p);
        else {
          p.pos.x += dx / l * p.speed * dt; p.pos.z += dz / l * p.speed * dt;
          p.facing = Math.atan2(dx, dz); moving = 1;
          p.phase += dt * p.speed * 5;
        }
      } else if (p.state === 'flee') {
        let dx = p.pos.x - p.flee.x, dz = p.pos.z - p.flee.z;
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        p.pos.x += dx * 5.5 * dt; p.pos.z += dz * 5.5 * dt;
        city.collide(p.pos, 0.35);
        p.facing = Math.atan2(dx, dz); moving = 1.3; p.phase += dt * 14;
        p.timer -= dt;
        if (p.timer <= 0) this.resumeWalk(p);
      } else if (p.state === 'down') {
        p.timer -= dt;
        p.mesh.rotation.set(-Math.PI / 2, p.facing, 0, 'YXZ');
        p.pos.y = 0.15;
        if (p.timer <= 0) {
          p.pos.y = 0; p.mesh.rotation.set(0, 0, 0);
          p.state = 'flee'; p.timer = 5; p.flee.x = P.x; p.flee.z = P.z;
        }
      } else if (p.state === 'flying') {
        p.vel.y -= 18 * dt;
        p.pos.addScaledVector(p.vel, dt);
        city.collide(p.pos, 0.35);
        p.mesh.rotation.x += dt * 9;
        if (p.pos.y <= 0.15) {
          p.pos.y = 0.15; p.state = 'dead'; p.timer = 0;
          p.mesh.rotation.set(-Math.PI / 2, p.facing, 0, 'YXZ');
        }
      } else if (p.state === 'dead') {
        p.timer += dt;
      }
      p.mesh.position.copy(p.pos);
      if (p.state === 'walk' || p.state === 'flee') {
        p.mesh.rotation.y = p.facing;
        animateHuman(p.mesh, p.phase, moving);
      }
    }
  }
}
