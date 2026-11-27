import * as THREE from 'three';
import { rnd } from './config.js';

// Дождь: капли летят вокруг камеры, небо темнеет, слышен шум.
const COUNT = 2600, BOX = 45, TOP = 32;

export class Weather {
  constructor(game) {
    this.game = game;
    this.amount = 0;            // текущая сила дождя 0..1
    this.target = 0;
    this.timer = rnd(90, 180);  // до следующей смены погоды (сек)
    const pos = new Float32Array(COUNT * 6);
    for (let i = 0; i < COUNT; i++) {
      const x = rnd(-BOX, BOX), y = rnd(0, TOP), z = rnd(-BOX, BOX);
      pos.set([x, y, z, x, y + 0.6, z], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xd0dcec, transparent: true, opacity: 0, depthWrite: false });
    this.rain = new THREE.LineSegments(this.geo, this.mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    game.scene.add(this.rain);
  }

  setRain(on) {
    this.target = on ? 1 : 0;
    this.game.hud.message(on ? 'Начался дождь' : 'Дождь закончился', 2);
  }

  update(dt) {
    const g = this.game;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = rnd(120, 240);
      this.setRain(this.target === 0 && Math.random() < 0.45);
    }
    this.amount += Math.sign(this.target - this.amount) * Math.min(Math.abs(this.target - this.amount), dt * 0.15);
    this.mat.opacity = this.amount * 0.75;
    this.rain.visible = this.amount > 0.01;
    g.sfx.rain(this.amount);
    if (!this.rain.visible) return;
    const c = g.camera.position, arr = this.geo.attributes.position.array;
    this.rain.position.set(c.x, 0, c.z);
    const n = Math.floor(COUNT * (g.quality === 0 ? 0.6 : 1) * this.amount);
    this.geo.setDrawRange(0, n * 2);
    const fall = 28 * dt;
    for (let i = 0; i < n; i++) {
      const k = i * 6;
      arr[k + 1] -= fall; arr[k + 4] -= fall;
      if (arr[k + 1] < 0) {
        const x = rnd(-BOX, BOX), z = rnd(-BOX, BOX);
        arr[k] = arr[k + 3] = x; arr[k + 2] = arr[k + 5] = z;
        arr[k + 1] = TOP; arr[k + 4] = TOP + 0.6;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
