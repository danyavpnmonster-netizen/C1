import { N, BLOCK, LANE, nodeCoord, clamp, wrapAngle, rnd, pick, randInt, nearestNode } from './config.js';
import { randomCarType } from './vehicle.js';

export const nodeXZ = (n) => ({ x: nodeCoord(n.i), z: nodeCoord(n.j) });
const same = (a, b) => a.i === b.i && a.j === b.j;

export function neighbors(n) {
  const r = [];
  if (n.i > 0) r.push({ i: n.i - 1, j: n.j });
  if (n.i < N) r.push({ i: n.i + 1, j: n.j });
  if (n.j > 0) r.push({ i: n.i, j: n.j - 1 });
  if (n.j < N) r.push({ i: n.i, j: n.j + 1 });
  return r;
}

function chooseNext(from, to) {
  const opts = neighbors(to).filter((n) => !same(n, from));
  if (!opts.length) return from;
  // чуть чаще едем прямо
  const dx = to.i - from.i, dz = to.j - from.j;
  const straight = opts.find((n) => n.i - to.i === dx && n.j - to.j === dz);
  if (straight && Math.random() < 0.45) return straight;
  return pick(opts);
}

export function setRoute(car, from, to) {
  car.ai = car.ai || {};
  car.ai.from = from; car.ai.to = to; car.ai.next = chooseNext(from, to);
  car.ai.cruise = car.ai.cruise || rnd(9, 13);
  car.ai.waitT = 0; car.ai.ignoreT = 0;
}

// Ставит машину на ближайшую полосу по направлению её движения.
export function attachToRoad(car) {
  const a = nearestNode(car.pos);
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  let best = null, bs = -Infinity;
  for (const b of neighbors(a)) {
    const s = (b.i - a.i) * fx + (b.j - a.j) * fz;
    if (s > bs) { bs = s; best = b; }
  }
  setRoute(car, a, best);
}

export function obstacleAhead(car, game, range) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  let best = Infinity;
  const test = (x, z, w) => {
    const rx = x - car.pos.x, rz = z - car.pos.z;
    const al = rx * fx + rz * fz;
    if (al <= 0 || al > range) return;
    if (Math.abs(rx * fz - rz * fx) < w) best = Math.min(best, al);
  };
  for (const c of game.cars) if (c !== car) test(c.pos.x, c.pos.z, 2.3);
  for (const p of game.peds.list) if (p.state === 'walk' || p.state === 'flee') test(p.pos.x, p.pos.z, 1.6);
  if (!game.player.car && game.state === 'play') test(game.player.pos.x, game.player.pos.z, 1.6);
  return best;
}

export function trafficControl(car, dt, game) {
  const ai = car.ai;
  let A, B, dx, dz, L, sx, sz, along, remain;
  for (let k = 0; k < 2; k++) {
    A = nodeXZ(ai.from); B = nodeXZ(ai.to);
    dx = B.x - A.x; dz = B.z - A.z; L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    sx = A.x - dz * LANE; sz = A.z + dx * LANE;
    along = (car.pos.x - sx) * dx + (car.pos.z - sz) * dz;
    remain = L - along;
    if (remain > LANE + 1) break;
    ai.from = ai.to; ai.to = ai.next; ai.next = chooseNext(ai.from, ai.to);
  }
  const look = clamp(along + 9, 0, L + LANE);
  const tx = sx + dx * look, tz = sz + dz * look;
  const desired = Math.atan2(tx - car.pos.x, tz - car.pos.z);
  const diff = wrapAngle(desired - car.heading);

  let target = ai.cruise;
  const nx = nodeXZ(ai.next);
  const straight = ((nx.x - B.x) * dx + (nx.z - B.z) * dz) / BLOCK;
  if (remain < 22 && straight < 0.5) target = Math.min(target, 6.5);
  if (Math.abs(diff) > 0.35) target = Math.min(target, 6);

  let brake = false;
  ai.ignoreT = Math.max(0, ai.ignoreT - dt);
  if (ai.ignoreT <= 0) {
    const block = obstacleAhead(car, game, 16);
    if (block < 6.5) { target = 0; brake = true; }
    else if (block < 16) target = Math.min(target, (block - 6) * 1.1);
  }
  if (brake && Math.abs(car.speed) < 0.5) {
    ai.waitT += dt;
    if (ai.waitT > 4) { ai.waitT = 0; ai.ignoreT = 1.5; }
  } else ai.waitT = 0;

  let throttle = clamp((target - car.speed) * 0.6, -1, 1);
  if (car.speed < 0.5 && throttle < 0) throttle = 0;
  return { throttle, steer: clamp(-diff * 2.2, -1, 1), handbrake: target === 0 && car.speed < 1 ? 1 : 0 };
}

export class Traffic {
  constructor(game) { this.game = game; this.max = 22; this.t = 0; }

  update(dt) {
    const g = this.game, P = g.playerPos();
    for (let k = g.cars.length - 1; k >= 0; k--) {
      const c = g.cars[k];
      if (c === g.player.car || c.keep) continue;
      const d = Math.hypot(c.pos.x - P.x, c.pos.z - P.z);
      const lim = c === g.player.lastCar ? 320 : c.role === 'police' ? 260 : 190;
      if (d > lim) g.removeCar(c);
    }
    const n = g.cars.reduce((s, c) => s + (c.role === 'traffic' ? 1 : 0), 0);
    this.t -= dt;
    if (n < this.max && this.t <= 0) { this.spawn(70, 170); this.t = 0.25; }
  }

  spawn(minD, maxD, role = 'traffic', type = null) {
    const g = this.game, P = g.playerPos();
    const pn = nearestNode(P);
    for (let tries = 0; tries < 14; tries++) {
      const a = { i: clamp(pn.i + randInt(-3, 3), 0, N), j: clamp(pn.j + randInt(-3, 3), 0, N) };
      const b = pick(neighbors(a));
      const A = nodeXZ(a), B = nodeXZ(b);
      const dx = (B.x - A.x) / BLOCK, dz = (B.z - A.z) / BLOCK;
      const t = rnd(0.2, 0.8) * BLOCK;
      const x = A.x + dx * t - dz * LANE, z = A.z + dz * t + dx * LANE;
      const d = Math.hypot(x - P.x, z - P.z);
      if (d < minD || d > maxD) continue;
      if (g.cars.some((c) => Math.hypot(c.pos.x - x, c.pos.z - z) < 9)) continue;
      const car = g.addCar(type || randomCarType(), x, z, Math.atan2(dx, dz));
      car.role = role;
      car.driverMesh.visible = true;
      setRoute(car, a, b);
      return car;
    }
    return null;
  }
}

