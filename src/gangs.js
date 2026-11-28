import * as THREE from 'three';
import { makeHuman, animateHuman, mat } from './human.js';
import { rnd, randInt, wrapAngle } from './config.js';

// Район банды «Зелёные Змеи» — круг на северо-востоке города (city.gangZone).
const GANG_COLOR = 0x1f9e4a;

class Member {
  constructor(scene, home) {
    this.mesh = makeHuman(GANG_COLOR, 0x151515, [0x8d5524, 0xc68642, 0x6b4226][randInt(0, 2)], 0x111111,
      { build: rnd(1.0, 1.15), height: rnd(0.97, 1.06), shoe: 0xf0f0f0, hairStyle: 'buzz', sleeves: 'short' });
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.055, 0.265), mat(GANG_COLOR));
    band.position.y = 1.735;
    this.mesh.userData.body.add(band);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.12), mat(0x1b1b1b));
    gun.position.set(0, -0.38, 0.03);
    this.mesh.userData.eR.add(gun);
    scene.add(this.mesh);
    this.home = home;
    this.pos = new THREE.Vector3(home.x, 0, home.z);
    this.vel = new THREE.Vector3();
    this.facing = rnd(0, 6); this.phase = rnd(0, 6);
    this.hp = 2; this.state = 'idle'; this.timer = 0; this.shotT = rnd(0.5, 1.5);
  }
}

export class Gangs {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.alert = 0;   // > 0 — вся банда враждебна
    const city = game.city;
    for (const spot of city.places.gang) {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        this.list.push(new Member(game.scene, { x: spot.x + Math.cos(a) * 1.2, z: spot.z + Math.sin(a) * 1.2 }));
      }
    }
    this.zone = city.gangZone;   // {x, z, r}
  }

  inZone(p) { const z = this.zone; return Math.hypot(p.x - z.x, p.z - z.z) < z.r; }

  hit(m, dmg, dx = 0, dz = 0) {
    if (m.state === 'dead' || m.state === 'flying') return;
    m.hp -= dmg;
    this.alert = 30;
    if (m.hp > 0) return;
    const g = this.game;
    m.state = 'flying'; m.timer = 0;
    m.vel.set(dx * 3, 2.5, dz * 3);
    m.pos.y = 0.3;
    g.spawnCash(m.pos.x + rnd(-1, 1), m.pos.z + rnd(-1, 1), randInt(30, 80));
    if (Math.random() < 0.6) g.addPickup('ammo', m.pos.x + rnd(-1, 1), m.pos.z + rnd(-1, 1), 12, false);
    g.stats.gang++;
    g.crime(0.5);
  }

  update(dt) {
    const g = this.game, P = g.playerPos(), city = g.city, pl = g.player;
    this.alert = Math.max(0, this.alert - dt);
    const playing = g.state === 'play';
    for (const m of this.list) {
      const dx = P.x - m.pos.x, dz = P.z - m.pos.z, d = Math.hypot(dx, dz);
      let moving = 0;
      if (m.state === 'idle' || m.state === 'fight') {
        const hostile = playing && (this.alert > 0 || d < 18);
        m.state = hostile && d < 45 ? 'fight' : 'idle';
        if (m.state === 'fight') {
          m.facing = Math.atan2(dx, dz);
          // держим дистанцию 8–14 м
          const want = d > 14 ? 1 : d < 8 ? -1 : 0;
          if (want) {
            m.pos.x += dx / d * want * 3.2 * dt; m.pos.z += dz / d * want * 3.2 * dt;
            city.collide(m.pos, 0.35); moving = 1; m.phase += dt * 10;
          }
          m.shotT -= dt;
          if (m.shotT <= 0 && d < 32) {
            m.shotT = rnd(1, 1.8);
            let blocked = false;
            for (let s = 1; s < d; s += 1) if (city.pointBlocked(m.pos.x + dx / d * s, 1.4, m.pos.z + dz / d * s)) { blocked = true; break; }
            if (!blocked) {
              g.tracer(m.pos.x, 1.4, m.pos.z, P.x, P.z);
              g.sfx.shot();
              const miss = Math.min(0.8, 0.25 + d / 50 + (pl.car ? Math.abs(pl.car.speed) / 40 : 0));
              if (Math.random() > miss) {
                if (pl.car) pl.car.damage(4); else pl.hurt(4);
                g.hud.hitFlash();
              }
            }
          }
        } else {
          // возвращаемся домой
          const hx = m.home.x - m.pos.x, hz = m.home.z - m.pos.z, hd = Math.hypot(hx, hz);
          if (hd > 0.5) { m.pos.x += hx / hd * 1.4 * dt; m.pos.z += hz / hd * 1.4 * dt; m.facing = Math.atan2(hx, hz); moving = 1; m.phase += dt * 6; }
          else m.facing += wrapAngle(Math.atan2(dx, dz) - m.facing) * dt * 0.5;
        }
        // машина сбивает
        if (pl.car && Math.abs(pl.car.speed) > 5 && d < pl.car.T.l * 0.5) {
          const f = pl.car.forward();
          this.hit(m, 99, f.x * Math.sign(pl.car.speed) * 2, f.z * Math.sign(pl.car.speed) * 2);
        }
      } else if (m.state === 'flying') {
        m.vel.y -= 18 * dt;
        m.pos.addScaledVector(m.vel, dt);
        m.mesh.rotation.x += dt * 9;
        if (m.pos.y <= 0.15) { m.pos.y = 0.15; m.state = 'dead'; m.mesh.rotation.set(-Math.PI / 2, m.facing, 0, 'YXZ'); }
      } else if (m.state === 'dead') {
        m.timer += dt;
        if (m.timer > 40 && Math.hypot(P.x - m.home.x, P.z - m.home.z) > 70) {
          m.state = 'idle'; m.hp = 2; m.pos.set(m.home.x, 0, m.home.z); m.mesh.rotation.set(0, 0, 0);
        }
      }
      m.mesh.position.copy(m.pos);
      if (m.state === 'idle' || m.state === 'fight') {
        m.mesh.rotation.y = m.facing;
        animateHuman(m.mesh, m.phase, moving, m.state === 'fight' ? 1 : 0);
      }
    }
  }
}
