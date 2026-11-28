import * as THREE from 'three';
import { clamp, pick } from './config.js';
import { buildCarModel } from './carmodel.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);

export const CAR_MATS = {
  glass: new THREE.MeshLambertMaterial({ color: 0x1f2a36 }),
  wheel: new THREE.MeshLambertMaterial({ color: 0x141414 }),
  head: new THREE.MeshLambertMaterial({ color: 0xfff6d0, emissive: 0xfff2c0, emissiveIntensity: 0.2 }),
  tail: new THREE.MeshLambertMaterial({ color: 0x880000, emissive: 0xff1010, emissiveIntensity: 0.3 }),
  red: new THREE.MeshLambertMaterial({ color: 0xaa0000, emissive: 0xff0000, emissiveIntensity: 0.1 }),
  blue: new THREE.MeshLambertMaterial({ color: 0x0000aa, emissive: 0x2255ff, emissiveIntensity: 0.1 }),
  white: new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }),
  black: new THREE.MeshLambertMaterial({ color: 0x111111 }),
  trim: new THREE.MeshLambertMaterial({ color: 0x1b1d20 }),
  fire: new THREE.MeshBasicMaterial({ color: 0xff7a1a }),
  driver: new THREE.MeshLambertMaterial({ color: 0xd9a066 }),
};

// Физические параметры: mass — масса (кг), accel — тяга с места (м/с²), max — максимальная скорость (м/с),
// mu — сцепление шин, cs — жёсткость шины в повороте (на рад, доля нагрузки), hcg — высота центра масс (м),
// fb — доля веса на передней оси.
export const CAR_TYPES = {
  sedan: { name: 'Седан', w: 2.0, l: 4.4, bh: 0.7, cab: [1.7, 0.62, 2.2, -0.2], accel: 6.5, max: 34,
    mass: 1300, mu: 1.0, cs: 9, hcg: 0.55, fb: 0.53,
    colors: [0x9b1b1b, 0x2050a0, 0x2d2d2d, 0xd0d0d0, 0x2e6b3a, 0x7a5a2a, 0x5a2a7a, 0xb0b8c0] },
  sport: { name: 'Спорткар', w: 2.0, l: 4.4, bh: 0.55, cab: [1.6, 0.48, 1.8, -0.35], accel: 9.5, max: 48,
    mass: 1150, mu: 1.15, cs: 11, hcg: 0.42, fb: 0.47,
    colors: [0xe0201a, 0xf0c010, 0x1a1a1a, 0x10a0e0, 0xff6a00] },
  van: { name: 'Фургон', w: 2.2, l: 5.0, bh: 1.1, cab: [2.1, 0.9, 3.4, -0.7], accel: 4.5, max: 27,
    mass: 2100, mu: 0.85, cs: 8, hcg: 0.95, fb: 0.55,
    colors: [0xeeeeee, 0x4a6a8a, 0x8a6a3a, 0x2a4a2a] },
  taxi: { name: 'Такси', w: 2.0, l: 4.4, bh: 0.7, cab: [1.7, 0.62, 2.2, -0.2], accel: 7, max: 35,
    mass: 1300, mu: 1.0, cs: 9, hcg: 0.55, fb: 0.53, colors: [0xf2c200] },
  police: { name: 'Полиция', w: 2.0, l: 4.6, bh: 0.7, cab: [1.7, 0.62, 2.2, -0.2], accel: 8.5, max: 42,
    mass: 1450, mu: 1.1, cs: 10, hcg: 0.5, fb: 0.52, colors: [0x151a24] },
};
// производные величины: оси, момент инерции, сопротивление воздуха
for (const T of Object.values(CAR_TYPES)) {
  const half = T.l / 2 - 0.9;              // колёса стоят на ±half от центра
  T.wb = half * 2;                          // колёсная база
  T.a = T.wb * (1 - T.fb);                  // от центра масс до передней оси
  T.b = T.wb * T.fb;                        // до задней оси
  T.I = T.mass * (T.l * T.l + T.w * T.w) / 12;
  T.power = T.mass * T.accel * T.max * 0.35;   // мощность (Вт): выше 35% Vmax тяга ограничена мощностью
  T.crr = T.mass * 0.012;                      // качение (Н·с/м)
  T.cd = (T.power / T.max - T.crr * T.max) / (T.max * T.max);   // воздух: на Vmax тяга = сопротивление
  T.csR = T.cs * 1.3;                          // задние шины жёстче — машина слегка недоворачивает
  T.muR = 1.06;                                // и держат чуть лучше
}
const G = 9.81;

// ограничить вектор силы кругом трения
function friction(fx, fy, max) {
  const f = Math.hypot(fx, fy);
  if (f <= max || f === 0) return [fx, fy, 0];
  const k = max / f;
  return [fx * k, fy * k, 1 - k];
}

export function randomCarType() {
  const r = Math.random();
  return r < 0.55 ? 'sedan' : r < 0.7 ? 'sport' : r < 0.85 ? 'van' : 'taxi';
}

export class Car {
  constructor(scene, type = 'sedan', color = null) {
    const T = CAR_TYPES[type];
    this.type = type; this.T = T; this.scene = scene;
    this.pos = new THREE.Vector3();
    this.vel = { x: 0, z: 0 };   // скорость центра масс в мире (м/с)
    this.yawRate = 0;            // угловая скорость (рад/с, + = влево)
    this.heading = 0; this.steer = 0;
    this.vy = 0; this.airborne = false; this.pitch = 0; this.roll = 0; this.bodyPitch = 0;
    this.axLong = 0; this.ayLat = 0;   // сглаженные ускорения — для переноса веса и крена
    this.skid = 0; this.wheelSpin = 0; this.wheelAngle = 0;
    this.health = 100; this.wrecked = false; this.wreckT = 0; this.exploded = false;
    this.role = 'parked'; this.ai = null; this.lastImpact = 0;
    this.nitro = 1; this.boosting = false; this.keep = false;

    const g = this.mesh = new THREE.Group();
    g.rotation.order = 'YXZ';
    this.bodyMat = new THREE.MeshPhongMaterial({ color: color ?? pick(T.colors), specular: 0x555555, shininess: 70 });
    const add = (mat, sx, sy, sz, x, y, z, parent = g) => {
      const m = new THREE.Mesh(BOX, mat);
      m.scale.set(sx, sy, sz); m.position.set(x, y, z);
      m.castShadow = true; parent.add(m); return m;
    };
    const baseY = 0.42;
    const parts = buildCarModel(g, T, type, this.bodyMat, CAR_MATS);
    this.wheels = parts.wheels; this.frontPivots = parts.frontPivots;
    this.driverMesh = parts.driver;
    // огонь при поломке
    this.fire = add(CAR_MATS.fire, 0.8, 0.5, 0.8, 0, T.bh + 0.55, T.l / 2 - 0.9);
    this.fire.visible = false;
    // пламя нитро из выхлопа
    this.flame = add(CAR_MATS.fire, 0.25, 0.25, 0.9, -(T.w / 2 - 0.45), baseY + 0.15, -T.l / 2 - 0.45);
    this.flame.visible = false;
    scene.add(g);
  }

  get radius() { return this.T.w / 2 + 0.1; }
  forward() { return { x: Math.sin(this.heading), z: Math.cos(this.heading) }; }

  // Продольная скорость (вдоль кузова). Запись сохраняет боковую составляющую.
  get speed() { return this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading); }
  set speed(v) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), lx = fz, lz = -fx;
    const lat = this.vel.x * lx + this.vel.z * lz;
    this.vel.x = fx * v + lx * lat; this.vel.z = fz * v + lz * lat;
  }
  get mass() { return this.T.mass; }

  // Форма для столкновений: три круга вдоль кузова.
  circles() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), off = this.T.l / 2 - this.T.w / 2;
    return [off, 0, -off].map((o) => ({ x: this.pos.x + fx * o, z: this.pos.z + fz * o, o }));
  }
  get inertia() { return this.T.I; }

  // Скорость точки кузова со смещением (rx, rz) от центра масс.
  pointVel(rx, rz) { return { x: this.vel.x + this.yawRate * rz, z: this.vel.z - this.yawRate * rx }; }

  // Импульс J (Н·с) в точке со смещением (rx, rz).
  applyImpulse(jx, jz, rx, rz) {
    this.vel.x += jx / this.T.mass; this.vel.z += jz / this.T.mass;
    this.yawRate += (rz * jx - rx * jz) / this.T.I;
    if (Math.hypot(jx, jz) / this.T.mass > 3) this.escOff = 1.2;   // после сильного удара стабилизация бессильна
  }

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

  // Шаг физики шин (модель «велосипеда»): силы на передней и задней оси,
  // круг трения, перенос веса, сопротивление воздуха и качения.
  tireStep(h, c, grip) {
    const T = this.T, m = T.mass;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), lx = fz, lz = -fx;
    const vx = this.vel.x * fx + this.vel.z * fz;      // вперёд
    const vy = this.vel.x * lx + this.vel.z * lz;      // влево
    const speed = Math.hypot(vx, vy);
    const delta = -this.steer * 0.6 / (1 + speed / 9);    // угол колёс: на скорости меньше
    this.wheelAngle = delta;

    // нагрузка на оси с учётом переноса веса при разгоне/торможении
    const tr = T.hcg / T.wb * m * this.axLong;
    const Nf = Math.max(0.15 * m * G, m * G * T.fb - tr);
    const Nr = Math.max(0.15 * m * G, m * G * (1 - T.fb) + tr);
    const mu = T.mu * grip;

    // продольные силы: задний привод, тормоза 60/40
    const boost = this.boosting;
    const maxF = m * T.accel * (boost ? 2.2 : 1), P = T.power * (boost ? 1.8 : 1);
    let drive = 0, brake = 0;
    if (c.throttle > 0) {
      if (vx < -0.5) brake = m * 9 * c.throttle;
      else drive = c.throttle * Math.min(maxF, P / Math.max(1, vx));
    } else if (c.throttle < 0) {
      if (vx > 0.5) brake = m * 9 * -c.throttle;
      else if (vx > -11) drive = c.throttle * maxF * 0.6;
    }
    const sv = vx > 0.05 ? 1 : vx < -0.05 ? -1 : 0;
    let Fxf = -sv * brake * 0.6;
    let Fxr = drive - sv * brake * 0.4;
    if (c.handbrake) Fxr -= sv * m * 6;

    // поперечные силы шин из углов увода
    const vxa = Math.max(Math.abs(vx), 1.5);
    const dirSign = vx < -0.5 ? -1 : 1;
    const alphaF = Math.atan2(vy + T.a * this.yawRate, vxa) - delta * dirSign;
    const alphaR = Math.atan2(vy - T.b * this.yawRate, vxa);
    let Fyf = -T.cs * Nf * alphaF;
    let Fyr = -T.csR * Nr * alphaR;
    let sf, sr;
    [Fxf, Fyf, sf] = friction(Fxf, Fyf, mu * Nf);
    [Fxr, Fyr, sr] = friction(Fxr, Fyr, mu * T.muR * Nr * (c.handbrake ? 0.55 : 1));
    // пробуксовка: двигатель «перекрутил» колёса
    this.wheelSpin = drive > 0 && Math.abs(drive) > mu * Nr * 0.95 ? 1 : 0;
    this.skid = Math.max(sf, sr, this.wheelSpin * 0.6, Math.min(1, Math.abs(vy) / 6));

    // сопротивление
    const Fdrag = -T.cd * vx * Math.abs(vx) - T.crr * vx;
    const FdragY = -T.cd * vy * Math.abs(vy) * 3;

    const cd = Math.cos(delta), sd = Math.sin(delta);
    const FX = Fxf * cd - Fyf * sd + Fxr + Fdrag;
    const FY = Fxf * sd + Fyf * cd + Fyr + FdragY;
    const torque = T.a * (Fyf * cd + Fxf * sd) - T.b * Fyr;
    const ax = FX / m, ay = FY / m;
    this.vel.x += (fx * ax + lx * ay) * h;
    this.vel.z += (fz * ax + lz * ay) * h;
    this.yawRate += torque / T.I * h;
    // система стабилизации: вращение не быстрее, чем шины способны удержать
    // (на ручнике отключается — можно дрифтовать)
    if (!c.handbrake && speed > 4 && !(this.escOff > 0)) {
      const rMax = mu * G * 1.1 / speed + 0.15;
      const ex = Math.abs(this.yawRate) - rMax;
      if (ex > 0) this.yawRate -= Math.sign(this.yawRate) * ex * Math.min(1, h * 10);
      // гасим занос: разворачиваем кузов к направлению движения
      const beta = Math.atan2(vy, Math.abs(vx));
      if (Math.abs(beta) > 0.2 && vx > 3) this.yawRate += Math.sign(beta) * (Math.abs(beta) - 0.2) * h * 6;
    }
    this.axLong += (ax - this.axLong) * Math.min(1, h * 8);
    this.ayLat += (ay - this.ayLat) * Math.min(1, h * 8);

    // на малой скорости — кинематика (шинная модель там неустойчива)
    const k = Math.min(1, Math.max(0, (speed - 1) / 4));
    if (k < 1) {
      const nvx = this.vel.x * fx + this.vel.z * fz;
      let nvy = this.vel.x * lx + this.vel.z * lz;
      const rKin = nvx * Math.tan(delta) / T.wb;
      this.yawRate = this.yawRate * k + rKin * (1 - k);
      nvy *= 1 - (1 - k) * Math.min(1, h * 15);
      let nvx2 = nvx;
      if (c.throttle === 0 && Math.abs(nvx) < 0.4) nvx2 = 0;        // не катимся сами
      if (c.handbrake && Math.abs(nvx) < 1) nvx2 *= 1 - Math.min(1, h * 10);
      this.vel.x = fx * nvx2 + lx * nvy; this.vel.z = fz * nvx2 + lz * nvy;
    }
    this.heading += this.yawRate * h;
  }

  // Удар о здание: импульс в точке контакта (с закручиванием) и трение о стену.
  wallImpulse(nx, nz, rx, rz) {
    const T = this.T, pv = this.pointVel(rx, rz);
    const vn = pv.x * nx + pv.z * nz;
    if (vn >= 0) return 0;
    const rn = rz * nx - rx * nz;
    const e = 0.15;
    const J = -(1 + e) * vn / (1 / T.mass + rn * rn / T.I);
    this.applyImpulse(nx * J, nz * J, rx, rz);
    // трение вдоль стены
    const tx = -nz, tz = nx, pv2 = this.pointVel(rx, rz);
    const vt = pv2.x * tx + pv2.z * tz, rt = rz * tx - rx * tz;
    let Jt = -vt / (1 / T.mass + rt * rt / T.I);
    Jt = Math.max(-0.35 * J, Math.min(0.35 * J, Jt));
    this.applyImpulse(tx * Jt, tz * Jt, rx, rz);
    return -vn;
  }

  update(dt, c, city, grip = 1) {
    const T = this.T;
    if (this.wrecked) { c = { throttle: 0, steer: 0, handbrake: 1 }; this.wreckT += dt; }
    this.steer += (c.steer - this.steer) * Math.min(1, dt * 7);
    const boost = !!c.boost && this.nitro > 0.02 && c.throttle > 0 && !this.wrecked;
    this.boosting = boost;
    if (boost) this.nitro = Math.max(0, this.nitro - dt * 0.35);
    else this.nitro = Math.min(1, this.nitro + dt * 0.06);

    // интегрируем мелкими шагами — шинная модель жёсткая
    this.escOff = Math.max(0, (this.escOff || 0) - dt);
    const n = Math.max(1, Math.ceil(dt / 0.006)), h = dt / n;
    for (let i = 0; i < n; i++) {
      if (!this.airborne) this.tireStep(h, c, grip);
      else this.heading += this.yawRate * h;
      this.pos.x += this.vel.x * h;
      this.pos.z += this.vel.z * h;
    }
    if (this.airborne) this.skid = 0;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);

    // столкновения со зданиями: два круга (перед и зад)
    this.lastImpact = 0;
    const off = T.l / 2 - T.w / 2, r = this.radius;
    for (const o of [off, 0, -off]) {
      const p = { x: this.pos.x + fx * o, z: this.pos.z + fz * o };
      if (this.airborne) p.y = this.pos.y;
      const ox = p.x, oz = p.z;
      const hit = city.collide(p, r);
      if (!hit) continue;
      this.pos.x += p.x - ox; this.pos.z += p.z - oz;
      // точка контакта относительно центра масс
      const imp = this.wallImpulse(hit.nx, hit.nz, fx * o - hit.nx * r, fz * o - hit.nz * r);
      if (imp > 4) this.damage(imp * imp * 0.06);
      this.lastImpact = Math.max(this.lastImpact, imp);
    }

    // вертикаль: трамплины и полёт
    const g = city.groundHeight(this.pos.x, this.pos.z);
    if (this.airborne) {
      this.vy -= G * 2 * dt;
      this.pos.y += this.vy * dt;
      this.pitch *= 1 - dt * 0.4;
      if (this.pos.y <= g) {
        if (this.vy < -13) { this.damage((-this.vy - 13) * 3); this.lastImpact = Math.max(this.lastImpact, -this.vy * 0.6); }
        this.bodyPitch += this.vy * 0.012;   // кузов «приседает» при приземлении
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

    // подвеска: крен в повороте, клевок при торможении (затухающая пружина)
    const tRoll = clamp(this.ayLat * 0.012, -0.09, 0.09);
    const tPitch = clamp(-this.axLong * 0.008, -0.07, 0.07);
    this.roll += (tRoll - this.roll) * Math.min(1, dt * 6);
    this.bodyPitch += (tPitch - this.bodyPitch) * Math.min(1, dt * 6);

    // меш
    const s = this.speed;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
    this.mesh.rotation.x = -this.pitch + this.bodyPitch;
    this.mesh.rotation.z = this.roll;
    const spin = this.wheelSpin && Math.abs(s) < 15 ? 25 : s;
    for (const w of this.wheels) w.rotation.x += spin * dt / 0.38;
    for (const p of this.frontPivots) p.rotation.y = this.wheelAngle;
    this.flame.visible = boost;
    if (boost) this.flame.scale.z = 0.7 + Math.random() * 0.6;
    if (this.fire.visible) {
      const f = 0.8 + Math.random() * 0.6;
      this.fire.scale.set(f, 0.5 * f * 1.4, f);
    }
  }

  // Машина второго игрока: положение приходит по сети, своей физики нет.
  setRemote(x, y, z, heading, vx, vz, steer, dt) {
    this.pos.set(x, y, z); this.heading = heading;
    this.vel.x = vx; this.vel.z = vz; this.yawRate = 0; this.steer = steer;
    this.health = 100; this.wrecked = false;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, heading, 0);
    const s = this.speed;
    for (const w of this.wheels) w.rotation.x += s * dt / 0.36;
    for (const p of this.frontPivots) p.rotation.y = -steer * 0.6 / (1 + Math.abs(s) / 9);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.bodyMat.dispose();
  }
}
