import * as THREE from 'three';
import { makeHuman, animateHuman, randomLook } from './human.js';
import { N, SIDEWALK, clamp, rnd, randInt, pick, blockIndex } from './config.js';

function corners(b) {
  const s = SIDEWALK / 2;
  return [[b.x0 + s, b.z0 + s], [b.x1 - s, b.z0 + s], [b.x1 - s, b.z1 - s], [b.x0 + s, b.z1 - s]];
}
// переход улицы на соседний квартал: [di, dj, новый индекс угла]
const CROSS = {
  0: [[-1, 0, 1], [0, -1, 3]],
  1: [[1, 0, 0], [0, -1, 2]],
  2: [[1, 0, 3], [0, 1, 1]],
  3: [[-1, 0, 2], [0, 1, 0]],
};

class Ped {
  constructor(scene) {
    const l = randomLook();
    this.mesh = makeHuman(l.shirt, l.pants, l.skin, l.hair);
    scene.add(this.mesh);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.state = 'walk'; this.facing = 0; this.phase = Math.random() * 6;
    this.speed = rnd(1.1, 1.6); this.timer = 0;
    this.bi = 0; this.bj = 0; this.ci = 0; this.dir = 1;
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

  respawn(p, initial = false) {
    const g = this.game, P = g.playerPos(), city = g.city;
    const pbi = clamp(blockIndex(P.x), 0, N - 1), pbj = clamp(blockIndex(P.z), 0, N - 1);
    let x = 0, z = 0;
    for (let t = 0; t < 25; t++) {
      p.bi = clamp(pbi + randInt(-2, 2), 0, N - 1);
      p.bj = clamp(pbj + randInt(-2, 2), 0, N - 1);
      const cs = corners(city.block(p.bi, p.bj));
      const ci = randInt(0, 3), a = cs[ci], b = cs[(ci + 1) % 4], k = Math.random();
      x = a[0] + (b[0] - a[0]) * k; z = a[1] + (b[1] - a[1]) * k;
      p.dir = Math.random() < 0.5 ? 1 : -1;
      p.ci = p.dir > 0 ? (ci + 1) % 4 : ci;
      const d = Math.hypot(x - P.x, z - P.z);
      if ((initial ? d > 6 : d > 50) && d < 130) break;
    }
    p.pos.set(x, 0, z);
    const c = corners(city.block(p.bi, p.bj))[p.ci];
    p.target.x = c[0]; p.target.z = c[1];
    p.state = 'walk'; p.timer = 0;
    p.mesh.rotation.set(0, 0, 0);
    p.mesh.visible = true;
  }

  resumeWalk(p) {
    p.bi = clamp(blockIndex(p.pos.x), 0, N - 1);
    p.bj = clamp(blockIndex(p.pos.z), 0, N - 1);
    const cs = corners(this.game.city.block(p.bi, p.bj));
    let bd = Infinity;
    cs.forEach((c, i) => { const d = Math.hypot(c[0] - p.pos.x, c[1] - p.pos.z); if (d < bd) { bd = d; p.ci = i; } });
    p.target.x = cs[p.ci][0]; p.target.z = cs[p.ci][1];
    p.state = 'walk';
    p.mesh.rotation.set(0, p.facing, 0);
  }

  arrive(p) {
    const city = this.game.city;
    if (Math.random() < 0.3) {
      const opts = CROSS[p.ci].filter(([di, dj]) => {
        const bi = p.bi + di, bj = p.bj + dj;
        return bi >= 0 && bi < N && bj >= 0 && bj < N;
      });
      if (opts.length) {
        const [di, dj, nci] = pick(opts);
        p.bi += di; p.bj += dj; p.ci = nci;
        const c = corners(city.block(p.bi, p.bj))[p.ci];
        p.target.x = c[0]; p.target.z = c[1];
        return;
      }
    }
    p.ci = (p.ci + p.dir + 4) % 4;
    const c = corners(city.block(p.bi, p.bj))[p.ci];
    p.target.x = c[0]; p.target.z = c[1];
  }

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
