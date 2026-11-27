import * as THREE from 'three';
import { clamp, lerp, lerpAngle, rnd, randInt } from './config.js';
import { City } from './city.js';
import { Input } from './input.js';
import { Car, CAR_MATS } from './vehicle.js';
import { Player } from './player.js';
import { Peds } from './peds.js';
import { Traffic, trafficControl } from './traffic.js';
import { Police } from './police.js';
import { Missions } from './missions.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { Gangs } from './gangs.js';
import { Weather } from './weather.js';

const HEAT = [0, 1, 4, 9, 16, 26];
const NO_CTL = { throttle: 0, steer: 0, handbrake: 1 };
const SAVE_KEY = 'sunrise-bay-save';

class Game {
  constructor() {
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1800);
    this.scene.fog = new THREE.Fog(0x87b8e8, 140, 560);
    this.scene.background = new THREE.Color(0x87b8e8);

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a5040, 1);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 400 });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.state = 'menu'; this.time = 0; this.hour = 9;
    this.wanted = 0; this.heat = 0; this.stateT = 0;
    this.camYaw = 0; this.camPitch = 0.3; this.lastLook = -10;
    this.cars = []; this.pickups = []; this.fx = [];
    this.stats = { missions: 0, gang: 0 };

    this.city = new City(this.scene);
    this.input = new Input(canvas);
    this.sfx = new Sfx();
    this.player = new Player(this);

    const b = this.city.block(4, 4);
    this.spawnPoint = { x: b.x1 - 2, z: b.cz };
    const hb = this.city.block(2, 2), sb = this.city.block(7, 6);
    this.hospital = { x: hb.x1 - 2, z: hb.cz };
    this.station = { x: sb.x0 + 2, z: sb.cz };
    this.player.pos.set(this.spawnPoint.x, 0, this.spawnPoint.z);
    this.player.facing = Math.PI / 2;
    this.camYaw = Math.PI;

    const start = this.addCar('sport', b.x1 + 2.5, b.cz - 8, 0);
    start.role = 'parked';

    this.peds = new Peds(this);
    this.gangs = new Gangs(this);
    this.weather = new Weather(this);
    this.traffic = new Traffic(this);
    this.police = new Police(this);
    this.missions = new Missions(this);
    this.hud = new Hud(this);
    for (let k = 0; k < 16; k++) this.traffic.spawn(25, 170);
    this.initPickups();
    this.load();

    this.quality = this.input.isTouch ? 1 : 2;
    this.applyQuality();
    this.fpsT = 0; this.fpsN = 0;
    addEventListener('resize', () => this.resize());
    this.resize();
    document.getElementById('start').addEventListener('click', () => this.begin());
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  begin() {
    document.getElementById('start').style.display = 'none';
    this.sfx.init();
    if (!this.input.isTouch) this.renderer.domElement.requestPointerLock?.();
    if (this.state === 'menu') {
      this.state = 'play';
      this.hud.message('Подойдите к машине и нажмите F', 5);
    }
  }

  // 2 — высокое, 1 — среднее, 0 — низкое (без теней)
  applyQuality() {
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, [0.75, 1, 1.5][q]));
    const size = q === 2 ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    }
    this.scene.fog.far = [320, 450, 560][q];
    this.traffic.max = [14, 18, 22][q];
    this.resize?.();
  }

  checkPerformance(dt) {
    this.fpsT += dt; this.fpsN++;
    if (this.fpsT < 3) return;
    const fps = this.fpsN / this.fpsT;
    this.fpsT = 0; this.fpsN = 0;
    if (fps < 28 && this.quality > 0) {
      this.quality--; this.applyQuality();
      this.hud.message('Графика понижена для плавности', 2);
    }
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  playerPos() { return this.player.car ? this.player.car.pos : this.player.pos; }

  addCar(type, x, z, heading) {
    const c = new Car(this.scene, type);
    c.pos.set(x, 0, z); c.heading = heading;
    c.update(0, NO_CTL, this.city);
    this.cars.push(c);
    return c;
  }

  removeCar(c) {
    const i = this.cars.indexOf(c);
    if (i >= 0) this.cars.splice(i, 1);
    if (this.player.lastCar === c) this.player.lastCar = null;
    c.dispose();
  }

  // ---------- деньги, розыск, жизнь ----------
  addMoney(v) { this.player.money = Math.max(0, this.player.money + v); }

  crime(points) {
    if (points <= 0 || this.state !== 'play') return;
    this.heat += points;
    let w = 0;
    while (w < 5 && this.heat >= HEAT[w + 1]) w++;
    if (w > this.wanted) { this.wanted = w; this.police.lostT = 0; }
  }

  setWanted(w) {
    this.wanted = clamp(w, 0, 5);
    this.heat = HEAT[this.wanted];
    if (this.wanted === 0) this.hud.message('Полиция потеряла след', 2.5);
  }

  died() {
    if (this.state !== 'play') return;
    this.exitCar(true);
    this.state = 'dead'; this.stateT = 4;
    this.hud.big('ВЫ ПОГИБЛИ', 4);
    this.missions.fail();
    this.sfx.fail();
  }

  busted() {
    if (this.state !== 'play') return;
    this.exitCar(true);
    this.state = 'busted'; this.stateT = 4;
    this.hud.big('ВАС АРЕСТОВАЛИ', 4);
    this.missions.fail();
    this.sfx.fail();
  }

  respawn() {
    const dead = this.state === 'dead';
    const p = dead ? this.hospital : this.station;
    const fine = Math.min(this.player.money, dead ? 100 : 250);
    this.addMoney(-fine);
    this.player.pos.set(p.x, 0, p.z);
    this.player.health = 100; this.player.vy = 0; this.player.knock.set(0, 0, 0);
    this.setWanted(0);
    this.gangs.alert = 0;
    for (const c of this.cars.slice()) if (c.role === 'police') this.removeCar(c);
    this.state = 'play';
    this.hud.message(dead ? `Больница: −$${fine}` : `Штраф: −$${fine}`, 3);
  }

  // ---------- машины ----------
  toggleCar() {
    const p = this.player;
    if (p.car) { this.exitCar(p.car.wrecked); return; }
    let best = null, bd = 4.2;
    for (const c of this.cars) {
      if (c.wrecked) continue;
      const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return;
    if (best.role === 'traffic' || best.role === 'police') {
      this.peds.ejectDriver(best.pos.x + Math.cos(best.heading) * 2.2, best.pos.z - Math.sin(best.heading) * 2.2, p.pos);
      this.crime(best.role === 'police' ? 5 : 1);
      this.hud.message(best.role === 'police' ? 'Угон полицейской машины!' : 'Угон!', 1.5);
    }
    best.role = 'player'; best.ai = null;
    best.driverMesh.visible = true;
    p.car = best; p.lastCar = best;
    this.sfx.hit(0.15);
  }

  exitCar(force) {
    const p = this.player, c = p.car;
    if (!c) return;
    if (!force && Math.abs(c.speed) > 8) return;
    c.role = 'parked'; c.driverMesh.visible = false;
    p.car = null;
    const lx = Math.cos(c.heading), lz = -Math.sin(c.heading);
    p.pos.set(c.pos.x + lx * 2.1, 0, c.pos.z + lz * 2.1);
    this.city.collide(p.pos, 0.4);
    p.facing = c.heading;
  }

  // ---------- подбираемые предметы ----------
  initPickups() {
    this.cashGeo = new THREE.BoxGeometry(0.9, 0.45, 0.2);
    this.cashMat = new THREE.MeshLambertMaterial({ color: 0x3fbf3f, emissive: 0x1a7a1a, emissiveIntensity: 0.6 });
    this.hpGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    this.hpMat = new THREE.MeshLambertMaterial({ color: 0xff3030, emissive: 0xaa0000, emissiveIntensity: 0.6 });
    for (let k = 0; k < 30; k++) { const s = this.city.randomSidewalk(); this.spawnCash(s.x, s.z, randInt(20, 120), true); }
    for (let k = 0; k < 8; k++) { const s = this.city.randomSidewalk(); this.addPickup('hp', s.x, s.z, 50, true); }
    this.ammoGeo = new THREE.BoxGeometry(0.6, 0.4, 0.6);
    this.ammoMat = new THREE.MeshLambertMaterial({ color: 0x3a7bff, emissive: 0x1a3a99, emissiveIntensity: 0.7 });
    for (let k = 0; k < 10; k++) { const s = this.city.randomSidewalk(); this.addPickup('ammo', s.x, s.z, 24, true); }
    this.armorGeo = new THREE.BoxGeometry(0.7, 0.8, 0.3);
    this.armorMat = new THREE.MeshLambertMaterial({ color: 0x8fa6c4, emissive: 0x2a4a7a, emissiveIntensity: 0.7 });
    for (let k = 0; k < 5; k++) { const s = this.city.randomSidewalk(); this.addPickup('armor', s.x, s.z, 50, true); }
    const pd = this.station; this.addPickup('armor', pd.x, pd.z + 6, 50, true);
    const sp = this.spawnPoint; this.addPickup('ammo', sp.x, sp.z - 12, 24, true);
  }

  addPickup(kind, x, z, value, respawn) {
    const m = kind === 'hp' ? new THREE.Mesh(this.hpGeo, this.hpMat)
      : kind === 'ammo' ? new THREE.Mesh(this.ammoGeo, this.ammoMat)
      : kind === 'armor' ? new THREE.Mesh(this.armorGeo, this.armorMat) : new THREE.Mesh(this.cashGeo, this.cashMat);
    m.position.set(x, 1, z);
    this.scene.add(m);
    this.pickups.push({ kind, x, z, value, respawn, mesh: m, t: 0, life: respawn ? Infinity : 30 });
  }

  spawnCash(x, z, value, respawn = false) { this.addPickup('cash', x, z, value, respawn); }

  updatePickups(dt) {
    const P = this.playerPos(), r = this.player.car ? 3 : 1.6;
    for (let k = this.pickups.length - 1; k >= 0; k--) {
      const pk = this.pickups[k];
      pk.life -= dt;
      if (pk.t > 0) {
        pk.t -= dt;
        if (pk.t <= 0) {
          const s = this.city.randomSidewalk(); pk.x = s.x; pk.z = s.z;
          pk.mesh.position.set(s.x, 1, s.z); pk.mesh.visible = true;
        }
        continue;
      }
      pk.mesh.rotation.y += dt * 2;
      pk.mesh.position.y = 1 + Math.sin(this.time * 3 + k) * 0.15;
      const near = this.state === 'play' && Math.hypot(pk.x - P.x, pk.z - P.z) < r;
      if (near && pk.kind === 'hp' && this.player.health >= 100) continue;
      if (near && pk.kind === 'armor' && this.player.armor >= 100) continue;
      if (near) {
        if (pk.kind === 'cash') { this.addMoney(pk.value); this.hud.message(`+$${pk.value}`, 1.2); this.sfx.cash(); }
        else if (pk.kind === 'armor') { this.player.armor = Math.min(100, this.player.armor + pk.value); this.hud.message('+бронежилет', 1.2); this.sfx.ok(); }
        else if (pk.kind === 'ammo') { this.player.addAmmo(pk.value); this.hud.message(`Пистолет +${pk.value} патронов (Q — сменить)`, 2); this.sfx.check(); }
        else { this.player.health = Math.min(100, this.player.health + pk.value); this.hud.message('+здоровье', 1.2); this.sfx.ok(); }
      }
      if (near || pk.life <= 0) {
        if (pk.respawn) { pk.t = 45; pk.mesh.visible = false; }
        else { this.scene.remove(pk.mesh); this.pickups.splice(k, 1); }
      }
    }
  }

  // ---------- физика взаимодействий ----------
  carCollisions() {
    const cars = this.cars, p = this.player;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz), rr = a.T.l * 0.45 + b.T.l * 0.45;
        if (d >= rr || d < 1e-4 || Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
        dx /= d; dz /= d;
        const push = (rr - d) / 2;
        a.pos.x -= dx * push; a.pos.z -= dz * push;
        b.pos.x += dx * push; b.pos.z += dz * push;
        const fa = a.forward(), fb = b.forward();
        const va = (fa.x * dx + fa.z * dz) * a.speed, vb = (fb.x * dx + fb.z * dz) * b.speed;
        const closing = va - vb;
        if (closing > 0) {
          a.speed -= (fa.x * dx + fa.z * dz) * closing * 0.6;
          b.speed += (fb.x * dx + fb.z * dz) * closing * 0.6;
          if (closing > 4) {
            const dmg = closing * closing * 0.05;
            a.damage(dmg); b.damage(dmg);
            if (a === p.car || b === p.car) {
              this.sfx.hit(Math.min(1, closing / 15));
              const other = a === p.car ? b : a;
              if (other.role === 'police') this.crime(1.5);
              else if (closing > 8) this.crime(0.4);
            }
          }
        }
      }
    }
    // машины и пешеходы
    for (const c of cars) {
      const s = Math.abs(c.speed);
      if (s < 0.8) continue;
      for (const ped of this.peds.list) {
        if (ped.state === 'dead' || ped.state === 'flying') continue;
        const d = Math.hypot(ped.pos.x - c.pos.x, ped.pos.z - c.pos.z);
        if (d > c.T.l * 0.5 + 0.2) continue;
        if (s > 4) {
          this.peds.hitByCar(ped, c);
          if (c === p.car) { this.crime(2); this.sfx.hit(0.5); }
        } else {
          const dx = ped.pos.x - c.pos.x, dz = ped.pos.z - c.pos.z, l = d || 1;
          ped.pos.x = c.pos.x + dx / l * (c.T.l * 0.5 + 0.2);
          ped.pos.z = c.pos.z + dz / l * (c.T.l * 0.5 + 0.2);
        }
      }
      // машина сбивает игрока
      if (!p.car && c.role !== 'parked' && this.state === 'play' && s > 5) {
        const d = Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z);
        if (d < c.T.l * 0.5 && p.pos.y < 1.2) {
          const f = c.forward(), sg = Math.sign(c.speed);
          p.knock.set(f.x * s * sg * 0.8, 0, f.z * s * sg * 0.8);
          p.vy = 4 + s * 0.15;
          this.sfx.hit(0.6); this.hud.hitFlash();
          p.hurt(s * 1.6);
        }
      }
    }
  }

  // Пуля: ищем первую цель по лучу, стены останавливают выстрел.
  shoot(x, y, z, dx, dz, range = 70) {
    this.sfx.shot();
    let best = null, kind = null, bt = range;
    for (const p of this.peds.list) {
      if (p.state !== 'walk' && p.state !== 'flee' && p.state !== 'down') continue;
      const rx = p.pos.x - x, rz = p.pos.z - z, t = rx * dx + rz * dz;
      if (t < 0.3 || t > bt) continue;
      if (Math.abs(rx * dz - rz * dx) < 0.6) { bt = t; best = p; kind = 'ped'; }
    }
    for (const m of this.gangs.list) {
      if (m.state !== 'idle' && m.state !== 'fight') continue;
      const rx = m.pos.x - x, rz = m.pos.z - z, t = rx * dx + rz * dz;
      if (t < 0.3 || t > bt) continue;
      if (Math.abs(rx * dz - rz * dx) < 0.6) { bt = t; best = m; kind = 'gang'; }
    }
    for (const c of this.cars) {
      if (c === this.player.car) continue;
      const rx = c.pos.x - x, rz = c.pos.z - z, t = rx * dx + rz * dz;
      if (t < 0.3 || t > bt) continue;
      if (Math.abs(rx * dz - rz * dx) < c.T.l * 0.4) { bt = t; best = c; kind = 'car'; }
    }
    for (let s = 1; s < bt; s += 0.8) {
      if (this.city.pointBlocked(x + dx * s, y, z + dz * s)) { bt = s; best = null; kind = null; break; }
    }
    this.tracer(x + dx * 0.8, y, z + dz * 0.8, x + dx * bt, z + dz * bt);
    if (kind === 'ped') { this.peds.shot(best, dx, dz); this.crime(3); }
    else if (kind === 'gang') { this.gangs.hit(best, 1, dx, dz); this.sfx.hit(0.3); }
    else if (kind === 'car') {
      best.damage(14);
      this.sfx.hit(0.2);
      this.crime(best.role === 'police' ? 3 : 0.5);
    }
    this.peds.scare({ x, z }, 30);
    if (this.police.nearest < 60) this.crime(1);
  }

  tracer(x1, y, z1, x2, z2) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x1, y, z1), new THREE.Vector3(x2, y, z2)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffee88, transparent: true }));
    this.scene.add(line);
    this.fx.push({ mesh: line, t: 0, dur: 0.08, line: true });
  }

  explode(car) {
    car.exploded = true;
    this.sfx.boom();
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 }));
    m.position.copy(car.pos); m.position.y += 1;
    this.scene.add(m);
    this.fx.push({ mesh: m, t: 0, dur: 0.7 });
    const P = this.player;
    const d = Math.hypot(P.pos.x - car.pos.x, P.pos.z - car.pos.z);
    if (P.car === car) { this.exitCar(true); P.hurt(60); }
    else if (!P.car && d < 8) { P.hurt(70 * (1 - d / 8)); P.vy = 6; }
    for (const ped of this.peds.list) {
      if (ped.state === 'dead' || ped.state === 'flying') continue;
      if (Math.hypot(ped.pos.x - car.pos.x, ped.pos.z - car.pos.z) < 7) {
        ped.state = 'flying'; ped.vel.set(rnd(-5, 5), 7, rnd(-5, 5)); ped.pos.y = 0.3;
      }
    }
    for (const c of this.cars) if (c !== car && Math.hypot(c.pos.x - car.pos.x, c.pos.z - car.pos.z) < 7) c.damage(40);
  }

  // ---------- игрок в машине ----------
  playerCarControl() {
    const a = this.input.axis();
    const boost = this.input.down('ShiftLeft') || this.input.down('ShiftRight') || this.input.down('KeyN');
    return { throttle: a.y, steer: a.x, handbrake: this.input.down('Space') ? 1 : 0, boost };
  }

  sprayCheck(dt) {
    this.sprayCd = Math.max(0, (this.sprayCd || 0) - dt);
    const c = this.player.car, sp = this.city.sprayPos;
    if (!c || !sp || this.sprayCd > 0) return;
    if (Math.hypot(c.pos.x - sp.x, c.pos.z - sp.z) > 5 || Math.abs(c.speed) > 6) return;
    this.sprayCd = 6;
    if (this.wanted === 0 && c.health >= 100) { this.hud.message('Машина в порядке', 2); return; }
    const cost = this.wanted > 0 ? 250 : 100;
    if (this.player.money < cost) { this.hud.message(`Покраска стоит $${cost}`, 2.5); return; }
    this.addMoney(-cost);
    c.health = 100; c.repaint();
    this.setWanted(0);
    this.hud.big(`ПОКРАСКА −$${cost}`, 2);
    this.sfx.ok();
  }

  // ---------- окружение ----------
  updateDayNight(dt) {
    this.hour = (this.hour + dt / 30) % 24;   // 1 игровой час = 30 сек
    const ang = (this.hour - 6) / 12 * Math.PI;
    const sunY = Math.sin(ang);
    const day = clamp(sunY * 1.6 + 0.25, 0, 1);
    const P = this.playerPos();
    const dir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.max(0.15, sunY), 0.45).normalize();
    this.sun.position.set(P.x + dir.x * 200, dir.y * 200, P.z + dir.z * 200);
    this.sun.target.position.set(P.x, 0, P.z);
    this.sun.intensity = 2.4 * day;
    this.sun.castShadow = day > 0.15 && this.quality > 0;
    this.hemi.intensity = 0.25 + day * 0.85;
    const night = new THREE.Color(0x0a1028), dayC = new THREE.Color(0x87b8e8), dusk = new THREE.Color(0xf09a5a);
    const sky = night.clone().lerp(dayC, day);
    const duskAmt = clamp(1 - Math.abs(sunY) * 4, 0, 1) * 0.55;
    sky.lerp(dusk, duskAmt);
    const rain = this.weather.amount;
    sky.lerp(new THREE.Color(0x5a6470).multiplyScalar(0.3 + day * 0.7), rain * 0.7);
    this.sun.intensity *= 1 - rain * 0.7;
    this.scene.fog.near = 140 - rain * 100;
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    this.sun.color.setHex(0xfff1d6).lerp(dusk, duskAmt);
    const n = 1 - day;
    for (const m of this.city.wallMats) m.emissiveIntensity = n * 0.9;
    this.city.lampMat.emissiveIntensity = n * 2.5;
    CAR_MATS.head.emissiveIntensity = 0.2 + n * 2.5;
    CAR_MATS.tail.emissiveIntensity = 0.3 + n * 1.5;
  }

  updateCamera(dt) {
    const p = this.player, car = p.car, inp = this.input;
    if (inp.mouseDX || inp.mouseDY) this.lastLook = this.time;
    this.camYaw -= inp.mouseDX * 0.0028;
    this.camPitch = clamp(this.camPitch + inp.mouseDY * 0.002, -0.05, 1.2);
    const tgt = new THREE.Vector3().copy(car ? car.pos : p.pos);
    tgt.y += car ? 1.6 : 1.5;
    if (car && this.time - this.lastLook > 1.2 && Math.abs(car.speed) > 1) {
      this.camYaw = lerpAngle(this.camYaw, car.heading, Math.min(1, dt * 2.5));
      this.camPitch = lerp(this.camPitch, 0.25, Math.min(1, dt));
    }
    const dist = car ? 9 + (car.type === 'van' ? 2 : 0) + Math.abs(car.speed) * 0.06 : 5.5;
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const sx = Math.sin(this.camYaw), sz = Math.cos(this.camYaw);
    let d = dist;
    for (let k = 1; k <= 12; k++) {
      const t = k / 12 * dist;
      if (this.city.pointBlocked(tgt.x - sx * cp * t, tgt.y + sp * t, tgt.z - sz * cp * t)) { d = Math.max(1.5, (k - 1) / 12 * dist); break; }
    }
    this.camera.position.set(tgt.x - sx * cp * d, Math.max(0.4, tgt.y + sp * d), tgt.z - sz * cp * d);
    this.camera.lookAt(tgt);
    const fov = car ? 65 + Math.min(15, Math.abs(car.speed) * 0.35) : 65;
    if (Math.abs(this.camera.fov - fov) > 0.1) { this.camera.fov = lerp(this.camera.fov, fov, Math.min(1, dt * 3)); this.camera.updateProjectionMatrix(); }
  }

  // ---------- сохранение ----------
  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s) { this.player.money = s.money | 0; this.hour = s.hour ?? 9; this.player.ammo = s.ammo | 0; this.player.armor = s.armor | 0; Object.assign(this.stats, s.stats || {}); }
    } catch (e) { /* хранилище недоступно */ }
  }
  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ money: this.player.money, hour: this.hour, ammo: this.player.ammo, armor: this.player.armor, stats: this.stats })); } catch (e) { /* нет */ }
  }

  // ---------- главный цикл ----------
  frame() {
    const now = performance.now();
    const raw = (now - this.last) / 1000, dt = Math.min(0.05, raw);
    this.last = now;
    if (this.state !== 'menu') { this.update(dt); this.checkPerformance(raw); }
    else { this.time += dt; this.camYaw += dt * 0.1; this.updateDayNight(0); this.updateCamera(dt); }
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  update(dt) {
    this.time += dt;
    const inp = this.input, p = this.player;
    if (this.state === 'play') {
      if (inp.pressed('KeyF')) this.toggleCar();
      if (inp.pressed('Escape') && document.pointerLockElement) document.exitPointerLock();
      if (inp.pressed('KeyM')) this.hud.toggleMap();
    } else {
      this.stateT -= dt;
      if (this.stateT <= 0) this.respawn();
    }
    p.update(dt);
    const ctlPlayer = this.state === 'play' ? this.playerCarControl() : NO_CTL;
    for (const car of this.cars) {
      let ctl = NO_CTL;
      if (car === p.car) ctl = ctlPlayer;
      else if (car.role === 'traffic' && car.ai) ctl = trafficControl(car, dt, this);
      else if (car.role === 'police') ctl = this.police.control(car, dt);
      car.update(dt, ctl, this.city);
      if (car === p.car && car.lastImpact > 4) { this.sfx.hit(Math.min(1, car.lastImpact / 15)); }
      if (car.wrecked && !car.exploded && car.wreckT > 3) this.explode(car);
    }
    if (p.car && p.car.wrecked && !p.car.exploded && this.state === 'play' && p.car.wreckT < 0.05) {
      this.hud.message('Машина горит! Выходите (F)', 2.5);
    }
    this.carCollisions();
    this.peds.update(dt);
    this.gangs.update(dt);
    this.weather.update(dt);
    this.traffic.update(dt);
    this.police.update(dt);
    this.missions.update(dt);
    this.updatePickups(dt);
    this.sprayCheck(dt);
    for (let k = this.fx.length - 1; k >= 0; k--) {
      const f = this.fx[k]; f.t += dt;
      if (!f.line) f.mesh.scale.setScalar(1 + f.t / f.dur * 7);
      f.mesh.material.opacity = 0.9 * (1 - f.t / f.dur);
      if (f.t >= f.dur) { this.scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); this.fx.splice(k, 1); }
    }
    this.updateDayNight(dt);
    this.updateCamera(dt);
    this.hud.update(dt);
    const c = p.car;
    const sirenLvl = this.wanted > 0 ? clamp(1 - this.police.nearest / 120, 0, 1) : 0;
    this.sfx.update(dt, !!c && !c.wrecked, c ? Math.abs(c.speed) / c.T.max : 0, sirenLvl, !!c && inp.down('KeyH'));
    this.saveT = (this.saveT || 0) + dt;
    if (this.saveT > 10) { this.saveT = 0; this.save(); }
  }
}

window.game = new Game();
