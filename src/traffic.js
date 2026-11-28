import { LANE, clamp, wrapAngle, rnd, pick } from './config.js';
import { NODE_R } from './roads.js';
import { randomCarType } from './vehicle.js';

// Движение машин по дорожной сети. Состояние машины в car.ai:
//   edge — дорога, dir — направление (+1 от узла a к b, −1 обратно), s — позиция вдоль дороги,
//   next — дорога, на которую свернём на следующем перекрёстке.
// Машина держит свою полосу (правее осевой на LANE) и целится в точку впереди.

const endNode = (R, ai) => (ai.dir > 0 ? R.edges[ai.edge].b : R.edges[ai.edge].a);

// Выбор следующей дороги: случайно, чуть чаще прямо; без разворота, если есть выбор.
export function chooseNext(R, edgeId, nodeId) {
  const opts = R.nodes[nodeId].edges.filter((e) => e !== edgeId);
  if (!opts.length) return edgeId;
  const here = R.sample(edgeId, R.edges[edgeId].a === nodeId ? 0 : R.edges[edgeId].L);
  const inDir = R.edges[edgeId].a === nodeId ? [-here.tx, -here.tz] : [here.tx, here.tz];
  let best = null, bd = -2;
  for (const e of opts) {
    const p = R.sample(e, R.edges[e].a === nodeId ? 0 : R.edges[e].L);
    const out = R.edges[e].a === nodeId ? [p.tx, p.tz] : [-p.tx, -p.tz];
    const d = inDir[0] * out[0] + inDir[1] * out[1];
    if (d > bd) { bd = d; best = e; }
  }
  if (Math.random() < 0.4) return best;
  return pick(opts);
}

export function setRoute(car, R, edge, dir, s) {
  car.ai = car.ai || {};
  const ai = car.ai;
  ai.edge = edge; ai.dir = dir; ai.s = s;
  ai.next = chooseNext(R, edge, endNode(R, ai));
  ai.cruise = ai.cruise || rnd(10, 14);
  ai.waitT = ai.waitT || 0; ai.ignoreT = ai.ignoreT || 0;
}

// Ставит машину на ближайшую полосу по направлению её движения.
export function attachToRoad(car, R) {
  const n = R.nearest(car.pos.x, car.pos.z, 120);
  if (!n) return;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const dir = fx * n.tx + fz * n.tz >= 0 ? 1 : -1;
  setRoute(car, R, n.edge, dir, n.s);
}

// Точка полосы на расстоянии ahead впереди (с переходом на следующую дорогу).
function laneAhead(R, ai, ahead) {
  const e = R.edges[ai.edge];
  const along = ai.dir > 0 ? ai.s : e.L - ai.s;
  let rest = along + ahead;
  if (rest <= e.L) {
    const p = R.sample(ai.edge, ai.dir > 0 ? rest : e.L - rest);
    const tx = p.tx * ai.dir, tz = p.tz * ai.dir;
    return { x: p.x - tz * LANE, z: p.z + tx * LANE, tx, tz };
  }
  // за перекрёстком — на следующей дороге
  rest -= e.L;
  const node = endNode(R, ai), ne = R.edges[ai.next];
  const ndir = ne.a === node ? 1 : -1;
  const p = R.sample(ai.next, ndir > 0 ? Math.min(rest, ne.L) : ne.L - Math.min(rest, ne.L));
  const tx = p.tx * ndir, tz = p.tz * ndir;
  return { x: p.x - tz * LANE, z: p.z + tx * LANE, tx, tz };
}

// Продвинуть машину по маршруту: обновить s, переключиться на следующую дорогу.
// chooser(edge, node) выбирает дорогу после перекрёстка (у полиции — к игроку).
export function followRoad(car, R, chooser = null) {
  const ai = car.ai;
  for (let k = 0; k < 2; k++) {
    ai.s = R.project(ai.edge, car.pos.x, car.pos.z, ai.s, 14);
    const e = R.edges[ai.edge];
    const remain = ai.dir > 0 ? e.L - ai.s : ai.s;
    if (remain > NODE_R * 0.6) break;
    const node = endNode(R, ai), ne = R.edges[ai.next];
    ai.edge = ai.next; ai.dir = ne.a === node ? 1 : -1; ai.s = ai.dir > 0 ? 0 : ne.L;
    ai.next = chooser ? chooser(ai.edge, endNode(R, ai)) : chooseNext(R, ai.edge, endNode(R, ai));
  }
}

// Насколько резко поворачивает дорога впереди (рад) — чтобы заранее сбросить скорость.
function turnAhead(R, ai, from, to) {
  const a = laneAhead(R, ai, from), b = laneAhead(R, ai, to);
  return Math.abs(wrapAngle(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz)));
}

export function obstacleAhead(car, game, range, carsToo = true) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  let best = Infinity;
  const test = (x, z, w) => {
    const rx = x - car.pos.x, rz = z - car.pos.z;
    const al = rx * fx + rz * fz;
    if (al <= 0 || al > range) return;
    if (Math.abs(rx * fz - rz * fx) < w) best = Math.min(best, al);
  };
  if (carsToo) for (const c of game.cars) if (c !== car) test(c.pos.x, c.pos.z, 2.3);
  for (const p of game.peds.list) if (p.state === 'walk' || p.state === 'flee') test(p.pos.x, p.pos.z, 1.6);
  if (!game.player.car && game.state === 'play') test(game.player.pos.x, game.player.pos.z, 1.6);
  return best;
}

// Управление: держать полосу, тормозить перед поворотами и препятствиями.
export function steerTo(car, tx, tz, target) {
  const desired = Math.atan2(tx - car.pos.x, tz - car.pos.z);
  const diff = wrapAngle(desired - car.heading);
  let throttle = clamp((target - car.speed) * 0.6, -1, 1);
  if (car.speed < 0.5 && throttle < 0) throttle = 0;
  return { throttle, steer: clamp(-diff * 2.4, -1, 1), handbrake: target < 0.5 && car.speed < 1 ? 1 : 0, diff };
}

export function trafficControl(car, dt, game) {
  const R = game.city.roads, ai = car.ai;
  // застрял (упёрся в столб, бордюр, машину): немного назад и снова в путь
  if (ai.revT > 0) {
    ai.revT -= dt;
    const T0 = laneAhead(R, ai, 10);
    const d0 = wrapAngle(Math.atan2(T0.x - car.pos.x, T0.z - car.pos.z) - car.heading);
    return { throttle: -0.8, steer: clamp(d0 * 2, -1, 1), handbrake: 0 };
  }
  followRoad(car, R);
  const look = 7 + Math.abs(car.speed) * 0.35;
  const T = laneAhead(R, ai, look);
  let target = ai.cruise;
  const bend = turnAhead(R, ai, 4, 24);
  if (bend > 0.25) target = Math.min(target, Math.max(5.5, 13 - bend * 7));

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
  const c = steerTo(car, T.x, T.z, target);
  if (Math.abs(c.diff) > 0.5) c.throttle = Math.min(c.throttle, 0.45);
  if (!brake && target > 3 && Math.abs(car.speed) < 0.6) {
    ai.stuckT = (ai.stuckT || 0) + dt;
    if (ai.stuckT > 1.5) { ai.stuckT = 0; ai.revT = 1.0; }
  } else ai.stuckT = 0;
  return c;
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

  // Новая машина на полосе случайной дороги на расстоянии minD..maxD от игрока.
  spawn(minD, maxD, role = 'traffic', type = null) {
    const g = this.game, P = g.playerPos(), R = g.city.roads;
    for (let tries = 0; tries < 16; tries++) {
      const a = Math.random() * Math.PI * 2, r = rnd(minD, maxD);
      const n = R.nearest(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r, 60);
      if (!n) continue;
      const e = R.edges[n.edge];
      if (n.s < NODE_R + 4 || n.s > e.L - NODE_R - 4) continue;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const p = R.sample(n.edge, n.s);
      const tx = p.tx * dir, tz = p.tz * dir;
      const x = p.x - tz * LANE, z = p.z + tx * LANE;
      const d = Math.hypot(x - P.x, z - P.z);
      if (d < minD || d > maxD) continue;
      if (g.cars.some((c) => Math.hypot(c.pos.x - x, c.pos.z - z) < 9)) continue;
      const car = g.addCar(type || randomCarType(), x, z, Math.atan2(tx, tz));
      car.role = role;
      car.driverMesh.visible = true;
      setRoute(car, R, n.edge, dir, n.s);
      car.speed = 6;
      return car;
    }
    return null;
  }
}

export { endNode, laneAhead, turnAhead };
