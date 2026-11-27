import { clamp, wrapAngle, nearestNode } from './config.js';
import { nodeXZ, neighbors, attachToRoad } from './traffic.js';
import { CAR_MATS } from './vehicle.js';

const WANT_CARS = [0, 1, 2, 3, 4, 6];

export class Police {
  constructor(game) {
    this.game = game;
    this.spawnT = 0; this.bustT = 0; this.lostT = 0; this.shotT = 0;
    this.nearest = Infinity; this.flash = 0;
  }

  get cars() { return this.game.cars.filter((c) => c.role === 'police'); }

  update(dt) {
    const g = this.game, P = g.playerPos();
    const cops = this.cars;
    this.flash += dt;
    const on = Math.floor(this.flash * 6) % 2 === 0;
    const active = g.wanted > 0;
    CAR_MATS.red.emissiveIntensity = active ? (on ? 2.5 : 0.1) : 0.1;
    CAR_MATS.blue.emissiveIntensity = active ? (on ? 0.1 : 2.5) : 0.1;

    if (!active) {
      for (const c of cops) { c.role = 'traffic'; attachToRoad(c); }
      this.bustT = 0; this.lostT = 0; this.nearest = Infinity;
      return;
    }
    this.spawnT -= dt;
    if (cops.length < WANT_CARS[g.wanted] && this.spawnT <= 0) {
      g.traffic.spawn(80, 150, 'police', 'police');
      this.spawnT = 2.5;
    }

    let nd = Infinity, nc = null;
    for (const c of cops) {
      if (c.wrecked) continue;
      const d = Math.hypot(c.pos.x - P.x, c.pos.z - P.z);
      if (d < nd) { nd = d; nc = c; }
    }
    this.nearest = nd;

    // потеря преследования
    if (nd > 75) {
      this.lostT += dt;
      if (this.lostT > 8 + g.wanted * 2) { g.setWanted(g.wanted - 1); this.lostT = 0; }
    } else this.lostT = 0;

    // арест
    const pc = g.player.car;
    const pSpeed = pc ? Math.abs(pc.speed) : 0;
    if (g.state === 'play' && nc && nd < 9 && Math.abs(nc.speed) < 6 && pSpeed < 3) this.bustT += dt;
    else this.bustT = Math.max(0, this.bustT - dt * 1.5);
    if (this.bustT > 2.2) { this.bustT = 0; g.busted(); return; }

    // стрельба с 3 звёзд
    if (g.wanted >= 3 && g.state === 'play') {
      this.shotT -= dt;
      if (this.shotT <= 0) {
        const shooters = Math.min(3, cops.filter((c) => !c.wrecked &&
          Math.hypot(c.pos.x - P.x, c.pos.z - P.z) < 40).length);
        if (shooters) {
          this.shotT = 0.6;
          if (pc) pc.damage(2.5 * shooters); else g.player.hurt(2 * shooters);
          g.sfx.shot();
          g.hud.hitFlash();
        } else this.shotT = 0.3;
      }
    }
  }

  control(car, dt) {
    const g = this.game, P = g.playerPos(), pc = g.player.car;
    const ai = car.ai || (car.ai = {});
    const d = Math.hypot(P.x - car.pos.x, P.z - car.pos.z);
    let ax, az;
    if (d < 45) {
      ax = P.x + (pc ? Math.sin(pc.heading) * pc.speed * 0.4 : 0);
      az = P.z + (pc ? Math.cos(pc.heading) * pc.speed * 0.4 : 0);
    } else {
      // едем по перекрёсткам к игроку
      if (!ai.chase) ai.chase = nearestNode(car.pos);
      let T = nodeXZ(ai.chase);
      if (Math.hypot(T.x - car.pos.x, T.z - car.pos.z) < 10) {
        let best = ai.chase, bd = Infinity;
        for (const n of neighbors(ai.chase)) {
          const q = nodeXZ(n), dd = Math.hypot(q.x - P.x, q.z - P.z);
          if (dd < bd) { bd = dd; best = n; }
        }
        ai.chase = best; T = nodeXZ(best);
      }
      ax = T.x; az = T.z;
    }
    const desired = Math.atan2(ax - car.pos.x, az - car.pos.z);
    const diff = wrapAngle(desired - car.heading);
    let target = d < 45 ? clamp(d * 0.9, 0, 32) + (pc ? Math.max(0, pc.speed) * 0.5 : 0) : 30;
    if (d < 6) target = Math.min(target, pc ? Math.abs(pc.speed) + 1 : 0);
    if (Math.abs(diff) > 0.6 && car.speed > 12) target = 10;

    if (ai.revT > 0) {
      ai.revT -= dt;
      return { throttle: -1, steer: clamp(diff * 2, -1, 1), handbrake: 0 };
    }
    if (Math.abs(car.speed) < 1.2 && target > 3) {
      ai.stuckT = (ai.stuckT || 0) + dt;
      if (ai.stuckT > 1.3) { ai.stuckT = 0; ai.revT = 1.3; }
    } else ai.stuckT = 0;

    let throttle = clamp((target - car.speed) * 0.5, -1, 1);
    if (car.speed < 0.5 && throttle < 0) throttle = 0;
    return {
      throttle,
      steer: clamp(-diff * 2.5, -1, 1),
      handbrake: target < 1 && car.speed < 1 ? 1 : (Math.abs(diff) > 1.2 && car.speed > 8 ? 1 : 0),
    };
  }
}
