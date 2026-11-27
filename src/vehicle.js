import * as THREE from 'three';
import { clamp, pick } from './config.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const WHEEL = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12).rotateZ(Math.PI / 2);

export const CAR_MATS = {
  glass: new THREE.MeshLambertMaterial({ color: 0x1f2a36 }),
  wheel: new THREE.MeshLambertMaterial({ color: 0x141414 }),
  head: new THREE.MeshLambertMaterial({ color: 0xfff6d0, emissive: 0xfff2c0, emissiveIntensity: 0.2 }),
  tail: new THREE.MeshLambertMaterial({ color: 0x880000, emissive: 0xff1010, emissiveIntensity: 0.3 }),
  red: new THREE.MeshLambertMaterial({ color: 0xaa0000, emissive: 0xff0000, emissiveIntensity: 0.1 }),
  blue: new THREE.MeshLambertMaterial({ color: 0x0000aa, emissive: 0x2255ff, emissiveIntensity: 0.1 }),
  white: new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }),
  black: new THREE.MeshLambertMaterial({ color: 0x111111 }),
  fire: new THREE.MeshBasicMaterial({ color: 0xff7a1a }),
  driver: new THREE.MeshLambertMaterial({ color: 0xd9a066 }),
};

export const CAR_TYPES = {
  sedan: { name: 'Седан', w: 2.0, l: 4.4, bh: 0.7, cab: [1.7, 0.62, 2.2, -0.2], accel: 9, max: 31,
    colors: [0x9b1b1b, 0x2050a0, 0x2d2d2d, 0xd0d0d0, 0x2e6b3a, 0x7a5a2a, 0x5a2a7a, 0xb0b8c0] },
  sport: { name: 'Спорткар', w: 2.0, l: 4.4, bh: 0.55, cab: [1.6, 0.48, 1.8, -0.35], accel: 15, max: 44,
    colors: [0xe0201a, 0xf0c010, 0x1a1a1a, 0x10a0e0, 0xff6a00] },
  van: { name: 'Фургон', w: 2.2, l: 5.0, bh: 1.1, cab: [2.1, 0.9, 3.4, -0.7], accel: 6, max: 25,
    colors: [0xeeeeee, 0x4a6a8a, 0x8a6a3a, 0x2a4a2a] },
  taxi: { name: 'Такси', w: 2.0, l: 4.4, bh: 0.7, cab: [1.7, 0.62, 2.2, -0.2], accel: 10, max: 32, colors: [0xf2c200] },
  police: { name: 'Полиция', w: 2.0, l: 4.6, bh: 0.7, cab: [1.7, 0.62, 2.2, -0.2], accel: 13, max: 39, colors: [0x151a24] },
};

export function randomCarType() {
  const r = Math.random();
  return r < 0.55 ? 'sedan' : r < 0.7 ? 'sport' : r < 0.85 ? 'van' : 'taxi';
}

export class Car {
  constructor(scene, type = 'sedan', color = null) {
    const T = CAR_TYPES[type];
    this.type = type; this.T = T; this.scene = scene;
    this.pos = new THREE.Vector3();
    this.heading = 0; this.speed = 0; this.steer = 0;
    this.vy = 0; this.airborne = false; this.pitch = 0;
    this.health = 100; this.wrecked = false; this.wreckT = 0; this.exploded = false;
    this.role = 'parked'; this.ai = null; this.lastImpact = 0;

    const g = this.mesh = new THREE.Group();
    g.rotation.order = 'YXZ';
    this.bodyMat = new THREE.MeshLambertMaterial({ color: color ?? pick(T.colors) });
    const add = (mat, sx, sy, sz, x, y, z, parent = g) => {
      const m = new THREE.Mesh(BOX, mat);
      m.scale.set(sx, sy, sz); m.position.set(x, y, z);
      m.castShadow = true; parent.add(m); return m;
    };
    const baseY = 0.42;
    add(this.bodyMat, T.w, T.bh, T.l, 0, baseY + T.bh / 2, 0);
    const [cw, ch, cl, cz] = T.cab;
    const cabMat = type === 'van' ? this.bodyMat : CAR_MATS.glass;
    add(cabMat, cw, ch, cl, 0, baseY + T.bh + ch / 2, cz);
    if (type === 'van') add(CAR_MATS.glass, cw + 0.02, ch * 0.5, 0.6, 0, baseY + T.bh + ch * 0.55, cz + cl / 2 - 0.2);
    if (type === 'police') {
      add(CAR_MATS.white, T.w + 0.02, T.bh * 0.5, 1.6, 0, baseY + T.bh * 0.55, 0.1);
      add(CAR_MATS.red, 0.6, 0.18, 0.3, 0.35, baseY + T.bh + ch + 0.09, cz);
      add(CAR_MATS.blue, 0.6, 0.18, 0.3, -0.35, baseY + T.bh + ch + 0.09, cz);
    }
    if (type === 'taxi') add(CAR_MATS.white, 0.8, 0.25, 0.3, 0, baseY + T.bh + ch + 0.12, cz);
    // фары
    for (const sx of [-1, 1]) {
      add(CAR_MATS.head, 0.42, 0.18, 0.06, sx * (T.w / 2 - 0.35), baseY + T.bh * 0.6, T.l / 2 + 0.01);
      add(CAR_MATS.tail, 0.42, 0.16, 0.06, sx * (T.w / 2 - 0.35), baseY + T.bh * 0.6, -T.l / 2 - 0.01);
    }
    // водитель (левый руль: левая сторона — +x локально)
    this.driverMesh = add(CAR_MATS.driver, 0.32, 0.36, 0.32, 0.42, baseY + T.bh + 0.25, cz + 0.2);
    this.driverMesh.visible = false;
    // колёса
    this.wheels = []; this.frontPivots = [];
    const wx = T.w / 2 - 0.08, wz = T.l / 2 - 0.9;
    for (const [x, z, front] of [[wx, wz, 1], [-wx, wz, 1], [wx, -wz, 0], [-wx, -wz, 0]]) {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.38, z); g.add(pivot);
      const w = new THREE.Mesh(WHEEL, CAR_MATS.wheel); w.castShadow = true; pivot.add(w);
      this.wheels.push(w); if (front) this.frontPivots.push(pivot);
    }
    // огонь при поломке
    this.fire = add(CAR_MATS.fire, 0.8, 0.5, 0.8, 0, baseY + T.bh + 0.3, T.l / 2 - 0.7);
    this.fire.visible = false;
    scene.add(g);
  }

  get radius() { return this.T.w / 2 + 0.1; }
  forward() { return { x: Math.sin(this.heading), z: Math.cos(this.heading) }; }

  damage(v) {
    if (this.wrecked || v <= 0) return;
    this.health -= v;
    if (this.health <= 0) {
      this.health = 0; this.wrecked = true; this.wreckT = 0;
      this.bodyMat.color.multiplyScalar(0.25);
      this.fire.visible = true;
    }
  }

  repaint() {
    this.bodyMat.color.setHex(pick(this.T.colors.length > 1 ? this.T.colors : [0x2e8b57, 0x8b2e2e, 0x2e4f8b]));
  }

  update(dt, c, city) {
    const T = this.T;
    if (this.wrecked) { c = { throttle: 0, steer: 0, handbrake: 1 }; this.wreckT += dt; }
    this.steer += (c.steer - this.steer) * Math.min(1, dt * 8);
    let s = this.speed;
    if (!this.airborne) {
      if (c.throttle > 0) {
        if (s < -0.5) s += 24 * dt * c.throttle;
        else s += T.accel * c.throttle * dt * Math.max(0.05, 1 - s / T.max);
      } else if (c.throttle < 0) {
        if (s > 0.5) s -= 24 * dt * -c.throttle;
        else s -= T.accel * 0.6 * -c.throttle * dt * Math.max(0, 1 + s / 11);
      } else {
        s -= Math.sign(s) * Math.min(Math.abs(s), 2.5 * dt);
      }
      if (c.handbrake) s -= Math.sign(s) * Math.min(Math.abs(s), 12 * dt);
      const steerMax = 0.62 * (1 - Math.min(0.55, Math.abs(s) / T.max * 0.55));
      const yawRate = -this.steer * steerMax * s / 2.6 * (c.handbrake ? 1.6 : 1);
      this.heading += clamp(yawRate, -2.8, 2.8) * dt;
    }
    this.speed = s;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.pos.x += fx * s * dt;
    this.pos.z += fz * s * dt;

    // столкновения со зданиями
    this.lastImpact = 0;
    const off = T.l / 2 - T.w / 2;
    for (const o of [off, -off]) {
      const p = { x: this.pos.x + fx * o, z: this.pos.z + fz * o };
      if (this.airborne) p.y = this.pos.y;
      const ox = p.x, oz = p.z;
      const hit = city.collide(p, this.radius);
      if (!hit) continue;
      this.pos.x += p.x - ox; this.pos.z += p.z - oz;
      const vn = (fx * hit.nx + fz * hit.nz) * this.speed;
      if (vn < 0) {
        const imp = -vn;
        const sign = Math.sign(this.speed);
        this.speed -= sign * imp * 0.85;
        if (imp > 7) this.speed = -sign * imp * 0.22;
        if (imp > 4) this.damage(imp * imp * 0.07);
        this.lastImpact = Math.max(this.lastImpact, imp);
      }
    }

    // вертикаль: трамплины и полёт
    const g = city.groundHeight(this.pos.x, this.pos.z);
    if (this.airborne) {
      this.vy -= 20 * dt;
      this.pos.y += this.vy * dt;
      this.pitch *= 1 - dt * 0.4;
      if (this.pos.y <= g) {
        if (this.vy < -13) { this.damage((-this.vy - 13) * 3); this.lastImpact = Math.max(this.lastImpact, -this.vy * 0.6); }
        this.pos.y = g; this.vy = 0; this.airborne = false;
      }
    } else if (g < this.pos.y - 0.3) {
      this.airborne = true;
      this.vy *= 1.25;   // трамплин подбрасывает чуть сильнее, чем физика

    } else {
      this.vy = dt > 0 ? (g - this.pos.y) / dt : 0;
      this.pos.y = g;
      const hf = city.groundHeight(this.pos.x + fx * 1.4, this.pos.z + fz * 1.4);
      const hb = city.groundHeight(this.pos.x - fx * 1.4, this.pos.z - fz * 1.4);
      this.pitch += (Math.atan2(hf - hb, 2.8) - this.pitch) * Math.min(1, dt * 10);
    }

    // меш
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
    this.mesh.rotation.x = -this.pitch;
    for (const w of this.wheels) w.rotation.x += s * dt / 0.38;
    for (const p of this.frontPivots) p.rotation.y = -this.steer * 0.5;
    if (this.fire.visible) {
      const f = 0.8 + Math.random() * 0.6;
      this.fire.scale.set(f, 0.5 * f * 1.4, f);
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.bodyMat.dispose();
  }
}
