import * as THREE from 'three';
import { makeHuman, animateHuman, mat } from './human.js';
import { lerpAngle } from './config.js';

export class Player {
  constructor(game) {
    this.game = game;
    this.mesh = makeHuman(0xf5f5f5, 0x2b4a8a, 0x8d5a3b);
    game.scene.add(this.mesh);
    this.pos = new THREE.Vector3();
    this.vy = 0; this.facing = 0; this.phase = 0;
    this.health = 100; this.armor = 0; this.money = 0;
    this.car = null; this.lastCar = null;
    this.punchT = 0; this.punchCd = 0;
    this.knock = new THREE.Vector3();
    this.weapon = 'fists'; this.ammo = 0; this.shotCd = 0;
    // пистолет в правой руке
    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.34), mat(0x1b1b1b));
    this.gun.position.set(0, -0.62, 0.12);
    this.gun.visible = false;
    this.mesh.userData.aR.add(this.gun);
  }

  setWeapon(w) {
    if (w === 'pistol' && this.ammo <= 0) { this.game.hud.message('Нет патронов', 1.2); return; }
    this.weapon = w;
    this.gun.visible = w === 'pistol';
  }

  addAmmo(n) {
    const first = this.ammo <= 0;
    this.ammo += n;
    if (first) this.setWeapon('pistol');
  }

  hurt(v) {
    if (this.game.state !== 'play') return;
    const absorbed = Math.min(this.armor, v * 0.8);
    this.armor -= absorbed; v -= absorbed;
    this.health = Math.max(0, this.health - v);
    if (this.health <= 0) this.game.died();
  }

  update(dt) {
    if (this.car) {
      this.mesh.visible = false;
      this.pos.copy(this.car.pos);
      return;
    }
    this.mesh.visible = true;
    const g = this.game, inp = g.input, city = g.city;
    const playing = g.state === 'play';
    const a = playing ? inp.axis() : { x: 0, y: 0 };
    const yaw = g.camYaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
    let mx = fx * a.y + rx * a.x, mz = fz * a.y + rz * a.x;
    const len = Math.hypot(mx, mz);
    const run = inp.down('ShiftLeft') || inp.down('ShiftRight') || !!a.run;
    const sp = run ? 8 : 4.5;
    let moving = 0;
    if (len > 0.08) {
      const k = 1 / Math.max(1, len);
      mx *= k; mz *= k;
      this.pos.x += mx * sp * dt; this.pos.z += mz * sp * dt;
      this.facing = lerpAngle(this.facing, Math.atan2(mx, mz), Math.min(1, dt * 12));
      moving = run ? 1.3 : 1;
      this.phase += dt * sp * 2.2;
    }
    // отброс от удара машиной
    if (this.knock.lengthSq() > 0.01) {
      this.pos.addScaledVector(this.knock, dt);
      this.knock.multiplyScalar(Math.max(0, 1 - dt * 4));
    }
    // прыжок и гравитация
    const gh = city.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= gh + 0.05) {
      this.pos.y = gh; this.vy = 0;
      if (playing && inp.pressed('Space')) this.vy = 6;
    }
    if (this.vy !== 0 || this.pos.y > gh) {
      this.vy -= 18 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y < gh) { this.pos.y = gh; this.vy = 0; }
    }
    city.collide(this.pos, 0.4);
    // не проходим сквозь машины
    for (const c of g.cars) {
      const f = c.forward(), off = c.T.l / 2 - c.T.w / 2;
      for (const o of [off, 0, -off]) {
        const cx = c.pos.x + f.x * o, cz = c.pos.z + f.z * o;
        const dx = this.pos.x - cx, dz = this.pos.z - cz, d = Math.hypot(dx, dz), r = c.radius + 0.4;
        if (d < r && d > 1e-4 && this.pos.y < c.pos.y + 1.4) {
          this.pos.x = cx + dx / d * r; this.pos.z = cz + dz / d * r;
        }
      }
    }
    // смена оружия
    if (playing) {
      if (inp.pressed('Digit1')) this.setWeapon('fists');
      if (inp.pressed('Digit2')) this.setWeapon('pistol');
      if (inp.pressed('KeyQ')) this.setWeapon(this.weapon === 'fists' ? 'pistol' : 'fists');
    }
    const attack = playing && (inp.clicked || inp.pressed('KeyE'));
    // выстрел
    this.shotCd -= dt;
    if (attack && this.weapon === 'pistol') {
      if (this.shotCd <= 0) {
        this.shotCd = 0.28;
        this.facing = g.camYaw;
        this.ammo--;
        g.shoot(this.pos.x, this.pos.y + 1.45, this.pos.z, Math.sin(g.camYaw), Math.cos(g.camYaw));
        if (this.ammo <= 0) { this.ammo = 0; this.setWeapon('fists'); }
      }
    }
    // удар
    this.punchCd -= dt;
    if (attack && this.weapon === 'fists' && this.punchCd <= 0) {
      this.punchCd = 0.45; this.punchT = 0.3;
      g.sfx.punch();
      const ffx = Math.sin(this.facing), ffz = Math.cos(this.facing);
      for (const m of g.gangs.list) {
        if (m.state !== 'idle' && m.state !== 'fight') continue;
        const dx = m.pos.x - this.pos.x, dz = m.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 1.6 && (dx * ffx + dz * ffz) / (d || 1) > 0.3) { g.gangs.hit(m, 0.5, 0, 0); g.sfx.hit(0.4); break; }
      }
      for (const p of g.peds.list) {
        if (p.state !== 'walk' && p.state !== 'flee') continue;
        const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 1.6 && (dx * ffx + dz * ffz) / (d || 1) > 0.3) {
          g.peds.punch(p, this.pos);
          g.crime(g.police.nearest < 50 ? 2 : 0.6);
          g.sfx.hit(0.4);
          break;
        }
      }
    }
    this.punchT = Math.max(0, this.punchT - dt);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.facing;
    animateHuman(this.mesh, this.phase, moving, this.weapon === 'pistol' ? 1 : this.punchT / 0.3);
  }
}
