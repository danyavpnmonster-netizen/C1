import * as THREE from 'three';
import { mat } from './human.js';
import { randInt } from './config.js';

// Квартира с комнатами. Одна на все дома (стоит далеко за картой), у каждого дома —
// свои обои, пол и находки. Комнаты: гостиная, спальня, кухня, ванная.
const IX = 5000, IZ = 0;
const W = 12, D = 10, WALL_H = 2.8, T = 0.2;
const EXIT = { x: IX, z: IZ - D / 2 + 0.55 };
const SPAWN = { x: IX, z: IZ - D / 2 + 1.7 };

const PALETTES = [
  { wall: 0xe9dfc9, floor: 0x9a6b43, rug: 0x7a2e2e, sofa: 0x3b5f8a, bed: 0x6a8fbf },
  { wall: 0xcfe0d5, floor: 0xb08a5a, rug: 0x2e5a4a, sofa: 0x8a5a3b, bed: 0xd8c28a },
  { wall: 0xf0d9d9, floor: 0x7a5a42, rug: 0x5a3b6a, sofa: 0x4a4a4a, bed: 0xc87a7a },
  { wall: 0xdad6ee, floor: 0xa7a39a, rug: 0x2b3f6a, sofa: 0x6a2b2b, bed: 0x8ab0a0 },
];
// места, где могут лежать находки
const LOOT_SPOTS = [[-4.5, -1.2], [4.5, -4.2], [-1.6, 1.4], [-5.3, 1.2], [3, 0.9], [5.2, 2.2], [-4.6, 3.6], [1.2, -3.6]];

export class Homes {
  constructor(game) {
    this.game = game;
    this.doors = game.city.doors;
    this.inside = null; this.cd = 0; this.hintT = 0;
    this.looted = new Set();
    this.build();
    // кольца у входов (одним инстансом на все двери)
    const ring = new THREE.RingGeometry(0.75, 1.0, 24).rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x7fe08a, transparent: true, opacity: 0.7, depthWrite: false });
    this.rings = new THREE.InstancedMesh(ring, this.ringMat, Math.max(1, this.doors.length));
    const dm = new THREE.Object3D();
    this.doors.forEach((d, i) => { dm.position.set(d.x, 0.07, d.z); dm.updateMatrix(); this.rings.setMatrixAt(i, dm.matrix); });
    this.rings.count = this.doors.length;
    game.scene.add(this.rings);
  }

  build() {
    const g = this.game, scene = g.scene, city = g.city, box3 = city.unitBox;
    const grp = this.group = new THREE.Group();
    this.wallMat = new THREE.MeshLambertMaterial({ color: 0xe9dfc9 });
    this.floorMat = new THREE.MeshLambertMaterial({ color: 0x9a6b43 });
    this.rugMat = new THREE.MeshLambertMaterial({ color: 0x7a2e2e });
    this.sofaMat = new THREE.MeshLambertMaterial({ color: 0x3b5f8a });
    this.bedMat = new THREE.MeshLambertMaterial({ color: 0x6a8fbf });
    const box = (m, sx, sy, sz, x, y, z, solid = false) => {
      const b = new THREE.Mesh(box3, m);
      b.scale.set(sx, sy, sz); b.position.set(IX + x, y, IZ + z);
      b.castShadow = b.receiveShadow = true;
      grp.add(b);
      if (solid) city.addCollider(IX + x - sx / 2, IX + x + sx / 2, IZ + z - sz / 2, IZ + z + sz / 2, y + sy / 2);
      return b;
    };
    // стена от (x0,z0) до (x1,z1) — по одной оси
    const wall = (x0, z0, x1, z1) => {
      const w = Math.abs(x1 - x0) || T, d = Math.abs(z1 - z0) || T;
      box(this.wallMat, w + (x1 !== x0 ? T : 0), WALL_H, d + (z1 !== z0 ? T : 0), (x0 + x1) / 2, WALL_H / 2, (z0 + z1) / 2, true);
    };
    const X0 = -W / 2, X1 = W / 2, Z0 = -D / 2, Z1 = D / 2;
    box(this.floorMat, W, 0.1, D, 0, -0.05, 0);
    // наружные стены (вход — проём в южной)
    wall(X0, Z0, -0.75, Z0); wall(0.75, Z0, X1, Z0);
    wall(X0, Z1, X1, Z1); wall(X0, Z0, X0, Z1); wall(X1, Z0, X1, Z1);
    // гостиная | спальня и кухня: стена по z=0 с двумя проёмами
    wall(X0, 0, -3.6, 0); wall(-2.4, 0, 2.4, 0); wall(3.6, 0, X1, 0);
    wall(0, 0, 0, Z1);                                   // спальня | кухня
    wall(X0, 3, -5.1, 3); wall(-4.1, 3, -3.4, 3); wall(-3.4, 3, -3.4, Z1);   // ванная в углу спальни
    // порог-выход
    box(new THREE.MeshBasicMaterial({ color: 0xfff6d8 }), 1.5, 2.3, 0.05, 0, 1.15, Z0 - 0.12);

    const C = (c) => mat(c);
    // --- гостиная ---
    this.rug = box(this.rugMat, 4, 0.02, 2.6, 0, 0.01, -2.6);
    box(this.sofaMat, 2.6, 0.45, 0.9, 0, 0.23, -0.75, true);
    box(this.sofaMat, 2.6, 0.55, 0.25, 0, 0.6, -0.38);
    box(this.sofaMat, 0.25, 0.65, 0.9, -1.3, 0.33, -0.75); box(this.sofaMat, 0.25, 0.65, 0.9, 1.3, 0.33, -0.75);
    box(C(0x5a3b28), 1.1, 0.4, 0.6, 0, 0.2, -2.6, true);                    // журнальный столик
    box(C(0x2a2a2a), 1.9, 0.5, 0.45, 0, 0.25, -4.55, true);                 // тумба
    const tv = box(new THREE.MeshLambertMaterial({ color: 0x111827, emissive: 0x2a5a9a, emissiveIntensity: 0.6 }), 1.5, 0.85, 0.07, 0, 0.95, -4.55);
    this.tv = tv;
    box(this.sofaMat, 0.95, 0.45, 0.9, -4.1, 0.23, -2.6, true);             // кресло
    box(this.sofaMat, 0.95, 0.6, 0.22, -4.55, 0.6, -2.6);
    box(C(0x6b4a2f), 0.4, 2, 1.8, 5.75, 1, -2.4, true);                     // книжный шкаф
    const books = [0xc0392b, 0x2980b9, 0x27ae60, 0xf1c40f, 0x8e44ad];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 5; k++) box(C(books[(r + k) % 5]), 0.3, 0.32, 0.22, 5.6, 0.45 + r * 0.6, -3.1 + k * 0.32);
    box(C(0x8a5a3b), 0.4, 0.4, 0.4, -5.5, 0.2, -4.5);                       // горшок
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), C(0x3f7f35)); leaf.position.set(IX - 5.5, 0.85, IZ - 4.5); grp.add(leaf);
    box(C(0x333333), 0.06, 1.6, 0.06, 5.5, 0.8, -4.6);                      // торшер
    box(new THREE.MeshLambertMaterial({ color: 0xfff1c0, emissive: 0xffd98a, emissiveIntensity: 0.8 }), 0.4, 0.3, 0.4, 5.5, 1.7, -4.6);
    // --- спальня ---
    box(this.bedMat, 1.7, 0.5, 2.2, -1.5, 0.25, 3.7, true);
    box(C(0xf2f0ea), 1.5, 0.15, 0.45, -1.5, 0.55, 4.55);                     // подушка
    box(C(0x5a3b28), 1.8, 0.9, 0.12, -1.5, 0.45, 4.85);                      // спинка
    box(C(0x7a5a3a), 0.5, 0.5, 0.5, -2.75, 0.25, 4.6, true);                // тумбочка
    box(C(0x6b4a2f), 1.5, 2.1, 0.6, -1.8, 1.05, 0.45, true);                // шкаф
    box(C(0x2a2a2a), 0.04, 0.3, 0.04, -1.85, 1.1, 0.14);
    // --- ванная ---
    box(C(0xf4f4f4), 1.5, 0.55, 0.75, -5.15, 0.28, 4.45, true);             // ванна
    box(C(0x7ab8d8), 1.3, 0.05, 0.55, -5.15, 0.54, 4.45);
    box(C(0xf4f4f4), 0.45, 0.45, 0.55, -3.95, 0.23, 4.6, true);             // унитаз
    box(C(0xf4f4f4), 0.55, 0.15, 0.4, -5.6, 0.85, 3.3);                     // раковина
    // --- кухня ---
    box(C(0xd8d4cc), 4.4, 0.9, 0.6, 2.4, 0.45, 4.6, true);                  // столешница
    box(C(0x111111), 0.7, 0.02, 0.5, 1.4, 0.91, 4.6);                        // плита
    box(C(0x9aa6b0), 0.6, 0.03, 0.4, 3.4, 0.91, 4.6);                        // мойка
    box(C(0xeaeaea), 0.8, 1.9, 0.75, 5.4, 0.95, 4.5, true);                 // холодильник
    box(C(0x8a6a4a), 1.3, 0.06, 0.85, 3, 0.75, 2.1, true);                  // стол
    for (const sx of [-1, 1]) {
      box(C(0x6a4a3a), 0.45, 0.45, 0.45, 3 + sx * 0.95, 0.23, 2.1);
      box(C(0x6a4a3a), 0.06, 0.5, 0.45, 3 + sx * 1.15, 0.7, 2.1);
    }
    // окна — светлые панели на наружных стенах
    const win = new THREE.MeshLambertMaterial({ color: 0xbfe3ff, emissive: 0x9fc6e0, emissiveIntensity: 0.5 });
    box(win, 1.6, 1.1, 0.04, -3.5, 1.6, Z0 + 0.12); box(win, 1.6, 1.1, 0.04, 3.5, 1.6, Z0 + 0.12);
    box(win, 0.04, 1.1, 1.6, X1 - 0.12, 1.6, 2.4); box(win, 0.04, 1.1, 1.6, X0 + 0.12, 1.6, 1.4);
    scene.add(grp);
  }

  enter(door) {
    const g = this.game, p = g.player;
    this.inside = door;
    const pal = PALETTES[door.id % PALETTES.length];
    this.wallMat.color.setHex(pal.wall); this.floorMat.color.setHex(pal.floor);
    this.rugMat.color.setHex(pal.rug); this.sofaMat.color.setHex(pal.sofa); this.bedMat.color.setHex(pal.bed);
    p.pos.set(SPAWN.x, 0, SPAWN.z); p.facing = 0; p.vy = 0;
    g.camYaw = 0;
    g.shops.light.position.set(IX, 4, IZ);
    this.cd = 1;
    g.hud.message(door.kind === 'flat' ? 'Квартира' : 'Дом', 1.5);
    g.sfx.check();
    if (!this.looted.has(door.id)) {
      this.looted.add(door.id);
      const spots = LOOT_SPOTS.slice().sort(() => Math.random() - 0.5);
      const n = randInt(1, 3);
      for (let k = 0; k < n; k++) g.addPickup('cash', IX + spots[k][0], IZ + spots[k][1], randInt(20, 150), false, 600);
      if (Math.random() < 0.35) g.addPickup('hp', IX + spots[n][0], IZ + spots[n][1], 50, false, 600);
      if (Math.random() < 0.3) g.addPickup('ammo', IX + spots[n + 1][0], IZ + spots[n + 1][1], 12, false, 600);
    }
  }

  exit() {
    const g = this.game, p = g.player, d = this.inside;
    this.inside = null;
    // находки, которые не подобрали, остаются ждать следующего раза — убираем со сцены
    for (let k = g.pickups.length - 1; k >= 0; k--) {
      const pk = g.pickups[k];
      if (pk.x > IX - 50 && pk.x < IX + 50) { g.scene.remove(pk.mesh); g.pickups.splice(k, 1); }
    }
    p.pos.set(d.x + d.nx * 1.2, 0, d.z + d.nz * 1.2);
    p.facing = Math.atan2(d.nx, d.nz); g.camYaw = p.facing;
    this.cd = 1.5;
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.cd = Math.max(0, this.cd - dt);
    this.hintT -= dt;
    this.ringMat.opacity = 0.45 + Math.sin(g.time * 4) * 0.25;
    if (this.tv) this.tv.material.emissiveIntensity = 0.45 + Math.sin(g.time * 7) * 0.15 + Math.random() * 0.1;
    if (g.state !== 'play') { if (this.inside) this.exit(); return; }
    if (this.inside) {
      if (this.cd <= 0 && Math.hypot(p.pos.x - EXIT.x, p.pos.z - EXIT.z) < 0.9) this.exit();
      return;
    }
    if (p.car || this.cd > 0 || g.shops.inside) return;
    for (const d of this.doors) {
      if (Math.abs(p.pos.x - d.x) > 1.2 || Math.abs(p.pos.z - d.z) > 1.2) continue;
      if (Math.hypot(p.pos.x - d.x, p.pos.z - d.z) > 1.0) continue;
      if (g.wanted > 0) {
        if (this.hintT <= 0) { g.hud.message('Сначала оторвитесь от полиции', 2); this.hintT = 2.5; }
      } else this.enter(d);
      break;
    }
  }
}

export { IX as HOME_X };
