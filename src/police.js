import * as THREE from 'three';
import { clamp, wrapAngle, nearestNode, rnd, randInt, lerpAngle } from './config.js';
import { nodeXZ, neighbors, attachToRoad } from './traffic.js';
import { CAR_MATS } from './vehicle.js';
import { makeHuman, animateHuman, mat } from './human.js';

const WANT_CARS = [0, 1, 2, 3, 4, 6];
const PARK = { throttle: 0, steer: 0, handbrake: 1 };
const CAP = new THREE.BoxGeometry(0.32, 0.1, 0.32), BRIM = new THREE.BoxGeometry(0.32, 0.04, 0.16);
const GUN = new THREE.BoxGeometry(0.1, 0.16, 0.34);

// Полицейский пешком.
class Officer {
  constructor(scene, car, x, z) {
    this.mesh = makeHuman(0x1d2f5a, 0x12182a, [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69][randInt(0, 3)], 0x1a1209);
    const cap = new THREE.Mesh(CAP, mat(0x111a33)); cap.position.y = 1.86;
    const brim = new THREE.Mesh(BRIM, mat(0x111a33)); brim.position.set(0, 1.82, 0.2);
    const gun = new THREE.Mesh(GUN, mat(0x111111)); gun.position.set(0, -0.62, 0.12);
    this.mesh.add(cap, brim); this.mesh.userData.aR.add(gun);
    scene.add(this.mesh);
    this.car = car;
    this.pos = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.state = 'chase'; this.hp = 2; this.timer = 0;
    this.facing = car.heading; this.phase = rnd(0, 6); this.shotT = rnd(0.8, 1.6);
  }
}

export class Police {
  constructor(game) {
    this.game = game;
    this.spawnT = 0; this.bustT = 0; this.lostT = 0; this.shotT = 0;
    this.nearest = Infinity; this.flash = 0;
    this.officers = [];
  }

  // Высадка двух полицейских из машины рядом с игроком.
  deploy(car) {
    const g = this.game, lx = Math.cos(car.heading), lz = -Math.sin(car.heading);
    for (const side of [1, -1]) {
      const o = new Officer(g.scene, car, car.pos.x + lx * 1.8 * side, car.pos.z + lz * 1.8 * side);
      this.officers.push(o);
    }
    car.copsOut = 2;
    car.driverMesh.visible = false;
  }

  removeOfficer(o) {
    this.game.scene.remove(o.mesh);
    this.officers.splice(this.officers.indexOf(o), 1);
  }

  clearOfficers() {
    for (const o of this.officers.slice()) this.removeOfficer(o);
    for (const c of this.game.cars) c.copsOut = 0;
  }

  hitOfficer(o, dmg, dx = 0, dz = 0) {
    if (o.state === 'flying' || o.state === 'dead') return;
    o.hp -= dmg;
    this.game.crime(o.hp <= 0 ? 4 : 2);
    if (o.hp > 0) return;
    o.state = 'flying';
    o.vel.set(dx * 3, 2.5, dz * 3);
    o.pos.y = 0.3;
    if (Math.random() < 0.7) this.game.addPickup('ammo', o.pos.x + rnd(-1, 1), o.pos.z + rnd(-1, 1), 12, false);
  }

  updateOfficers(dt) {
    const g = this.game, P = g.playerPos(), pl = g.player, pc = pl.car, city = g.city;
    let arresting = false;
    for (const o of this.officers.slice()) {
      const dx = P.x - o.pos.x, dz = P.z - o.pos.z, d = Math.hypot(dx, dz) || 0.001;
      const carOk = o.car && g.cars.includes(o.car) && o.car.role === 'police' && !o.car.wrecked;
      let moving = 0, aiming = false;
      if (o.state === 'chase' || o.state === 'return') {
        // уходим к машине: розыск снят или игрок уехал
        const fleeing = pc && (Math.abs(pc.speed) > 8 || d > 45);
        if (carOk && (g.wanted === 0 || fleeing)) o.state = 'return';
        else if (g.wanted > 0) o.state = 'chase';
        if (o.state === 'return' && carOk) {
          const cx = o.car.pos.x - o.pos.x, cz = o.car.pos.z - o.pos.z, cd = Math.hypot(cx, cz);
          if (cd < 2.6) {
            o.car.copsOut = Math.max(0, (o.car.copsOut || 1) - 1);
            if (!o.car.copsOut) { o.car.driverMesh.visible = true; o.car.deployCd = 8; }
            this.removeOfficer(o); continue;
          }
          o.pos.x += cx / cd * 5 * dt; o.pos.z += cz / cd * 5 * dt;
          o.facing = Math.atan2(cx, cz); moving = 1.2; o.phase += dt * 12;
        } else if (o.state === 'return' || g.wanted === 0) {
          // машины нет — уходим пешком и исчезаем вдали
          o.pos.x -= dx / d * 1.5 * dt; o.pos.z -= dz / d * 1.5 * dt;
          o.facing = Math.atan2(-dx, -dz); moving = 1; o.phase += dt * 6;
          if (d > 70) { this.removeOfficer(o); continue; }
        } else {
          // погоня: при 1–2 звёздах бегут арестовать, с 3 — держат дистанцию и стреляют
          const hold = g.wanted >= 3 ? 9 : 1.1;
          const canShoot = g.wanted >= 2 && g.state === 'play' && !g.shops.inside;
          if (d > hold && !(canShoot && d < 12 && g.wanted >= 3)) {
            const sp = pc ? 6.5 : 5.8;
            o.pos.x += dx / d * sp * dt; o.pos.z += dz / d * sp * dt;
            moving = 1.3; o.phase += dt * 13;
          }
          o.facing = lerpAngle(o.facing, Math.atan2(dx, dz), Math.min(1, dt * 10));
          if (!pc && d < 1.7 && g.state === 'play') arresting = true;
          o.shotT -= dt;
          if (canShoot && d > 3 && d < 24) {
            aiming = true;
            if (o.shotT <= 0) {
              o.shotT = rnd(0.9, 1.5);
              let blocked = false;
              for (let s = 1; s < d; s += 1) if (city.pointBlocked(o.pos.x + dx / d * s, 1.4, o.pos.z + dz / d * s)) { blocked = true; break; }
              if (!blocked) {
                g.tracer(o.pos.x, 1.4, o.pos.z, P.x, P.z);
                g.sfx.shot();
                if (Math.random() < 0.6 - d / 60) {
                  if (pc) pc.damage(4); else pl.hurt(6);
                  g.hud.hitFlash();
                }
              }
            }
          }
        }
        city.collide(o.pos, 0.35);
        // игрок сбивает полицейского
        if (pc && Math.abs(pc.speed) > 5 && d < pc.T.l * 0.5) {
          const f = pc.forward(), sg = Math.sign(pc.speed);
          this.hitOfficer(o, 99, f.x * sg * 2, f.z * sg * 2);
          g.sfx.hit(0.5);
        }
      } else if (o.state === 'flying') {
        o.vel.y -= 18 * dt;
        o.pos.addScaledVector(o.vel, dt);
        o.mesh.rotation.x += dt * 9;
        if (o.pos.y <= 0.15) { o.pos.y = 0.15; o.state = 'dead'; o.mesh.rotation.set(-Math.PI / 2, o.facing, 0, 'YXZ'); }
      } else if (o.state === 'dead') {
        o.timer += dt;
        if (o.timer > 20 || d > 150) { this.removeOfficer(o); continue; }
      }
      o.mesh.position.copy(o.pos);
      if (o.state === 'chase' || o.state === 'return') {
        o.mesh.rotation.y = o.facing;
        animateHuman(o.mesh, o.phase, moving, aiming ? 1 : 0);
      }
    }
    // машины, чьи полицейские погибли, остаются пустыми
    for (const c of g.cars) {
      if (c.copsOut && !this.officers.some((o) => o.car === c && o.state !== 'dead' && o.state !== 'flying')) c.copsOut = 0;
    }
    return arresting;
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

    const arresting = this.updateOfficers(dt);
    if (!active) {
      for (const c of cops) if (!c.copsOut) { c.role = 'traffic'; attachToRoad(c); }
      this.bustT = 0; this.lostT = 0; this.nearest = Infinity;
      return;
    }
    // высадка: машина остановилась рядом с игроком
    const pc0 = g.player.car;
    if (g.state === 'play' && !g.shops.inside && (!pc0 || Math.abs(pc0.speed) < 4)) {
      for (const c of cops) {
        if (c.wrecked || c.copsOut || c.deployCd > 0) continue;
        if (Math.abs(c.speed) < 2.5 && Math.hypot(c.pos.x - P.x, c.pos.z - P.z) < 22) this.deploy(c);
      }
    }
    for (const c of cops) c.deployCd = Math.max(0, (c.deployCd || 0) - dt);
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
    for (const o of this.officers) {
      if (o.state === 'chase') nd = Math.min(nd, Math.hypot(o.pos.x - P.x, o.pos.z - P.z));
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
    const carBust = pc && nc && !nc.copsOut && Math.hypot(nc.pos.x - P.x, nc.pos.z - P.z) < 9 && Math.abs(nc.speed) < 6 && pSpeed < 3;
    if (g.state === 'play' && !g.shops.inside && (carBust || arresting)) this.bustT += dt;
    else this.bustT = Math.max(0, this.bustT - dt * 1.5);
    if (this.bustT > 2.2) { this.bustT = 0; g.busted(); return; }

    // стрельба с 3 звёзд
    if (g.wanted >= 3 && g.state === 'play') {
      this.shotT -= dt;
      if (this.shotT <= 0) {
        const shooters = pc ? Math.min(3, cops.filter((c) => !c.wrecked && !c.copsOut &&
          Math.hypot(c.pos.x - P.x, c.pos.z - P.z) < 40).length) : 0;
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
    if (car.copsOut) return PARK;
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
