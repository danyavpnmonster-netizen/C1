import * as THREE from 'three';
import { pick, rnd } from './config.js';

// Человек из нескольких объединённых частей с цветами в вершинах:
// туловище с головой — одна сетка, руки и ноги — по два сустава (плечо/локоть, бедро/колено).
// Так получается живая анимация при небольшом числе объектов на сцене.

const MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const cache = new Map();
export function mat(c) {
  if (!cache.has(c)) cache.set(c, new THREE.MeshLambertMaterial({ color: c }));
  return cache.get(c);
}

// Склеивает куски в одну геометрию. Каждый кусок: [геометрия, слот цвета, матрица].
// Слоты: shirt, pants, skin, hair, shoe, eye — их цвета можно потом перекрасить.
function merge(pieces, colors) {
  const pos = [], nor = [], col = [], slots = [];
  const c = new THREE.Color();
  for (const [g0, slot, m] of pieces) {
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    if (m) g.applyMatrix4(m);
    const p = g.attributes.position, n = g.attributes.normal;
    const start = pos.length / 3;
    c.setHex(colors[slot]);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    slots.push({ slot, start, count: p.count });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.userData.slots = slots;
  return geo;
}

const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(sx, sy, sz));

const G = {
  sphere: new THREE.SphereGeometry(1, 10, 8),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  taper: new THREE.CylinderGeometry(1, 0.78, 1, 8),     // шире сверху (грудь, бедро)
  box: new THREE.BoxGeometry(1, 1, 1),
};

// opts: female, sleeves ('short'|'long'), height (0.92..1.08), build (ширина)
export function makeHuman(shirt, pants, skin, hair = 0x221a12, opts = {}) {
  const female = !!opts.female;
  const colors = { shirt, pants, skin, hair, shoe: opts.shoe ?? 0x1c1c1c, eye: 0x1a1a1a };
  const sh = female ? 0.86 : 1, bw = opts.build ?? 1;
  const root = new THREE.Group();
  const body = new THREE.Group();          // всё, что выше пояса (покачивается при ходьбе)
  root.add(body);
  const meshes = [];
  const add = (parent, geo, x, y, z) => {
    const m = new THREE.Mesh(geo, MAT);
    m.position.set(x, y, z); m.castShadow = true;
    parent.add(m); meshes.push(m); return m;
  };

  // туловище, шея, голова, лицо, волосы
  const torso = [
    [G.box, 'pants', M(0, 0.97, 0, 0.34 * bw * (female ? 1.05 : 1), 0.18, 0.2)],
    [G.taper, 'shirt', M(0, 1.26, 0, 0.21 * sh * bw, 0.5, 0.13 * bw)],
    [G.sphere, 'shirt', M(0, 1.5, 0, 0.21 * sh * bw, 0.06, 0.13 * bw)],
    [G.cyl, 'skin', M(0, 1.56, 0, 0.05, 0.1, 0.05)],
    [G.sphere, 'skin', M(0, 1.68, 0.005, 0.115, 0.135, 0.12)],
    [G.box, 'eye', M(-0.042, 1.695, 0.11, 0.028, 0.02, 0.02)],
    [G.box, 'eye', M(0.042, 1.695, 0.11, 0.028, 0.02, 0.02)],
    [G.box, 'skin', M(0, 1.665, 0.122, 0.03, 0.045, 0.03)],
    [G.sphere, 'hair', M(0, 1.72, -0.012, 0.122, 0.11, 0.128)],
  ];
  if (female) torso.push([G.box, 'hair', M(0, 1.6, -0.08, 0.22, 0.3, 0.07)]);
  else if (opts.cap) torso.push([G.cyl, 'shirt', M(0, 1.79, 0, 0.125, 0.06, 0.125)]);
  add(body, merge(torso, colors), 0, 0, 0);

  // нога: бедро → колено → голень и ступня
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(sx * 0.1 * bw, 0.95, 0); root.add(hip);
    add(hip, merge([[G.taper, 'pants', M(0, -0.22, 0, 0.075 * bw, 0.44, 0.08 * bw)]], colors), 0, 0, 0);
    const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
    add(knee, merge([
      [G.taper, 'pants', M(0, -0.21, 0, 0.06, 0.42, 0.065)],
      [G.box, 'shoe', M(0, -0.45, 0.04, 0.1, 0.07, 0.24)],
    ], colors), 0, 0, 0);
    legs.push([hip, knee]);
  }
  // рука: плечо → локоть → предплечье и кисть
  const arms = [];
  const fore = opts.sleeves === 'long' ? 'shirt' : 'skin';
  for (const sx of [-1, 1]) {
    const sho = new THREE.Group(); sho.position.set(sx * 0.23 * sh * bw, 1.46, 0); body.add(sho);
    add(sho, merge([[G.taper, 'shirt', M(0, -0.15, 0, 0.055, 0.3, 0.055)]], colors), 0, 0, 0);
    const elb = new THREE.Group(); elb.position.y = -0.3; sho.add(elb);
    add(elb, merge([
      [G.taper, fore, M(0, -0.13, 0, 0.045, 0.26, 0.045)],
      [G.sphere, 'skin', M(0, -0.29, 0.01, 0.045, 0.055, 0.04)],
    ], colors), 0, 0, 0);
    arms.push([sho, elb]);
  }
  const h = opts.height ?? 1;
  root.scale.setScalar(h);
  root.userData = {
    lL: legs[0][0], lR: legs[1][0], kL: legs[0][1], kR: legs[1][1],
    aL: arms[0][0], aR: arms[1][0], eL: arms[0][1], eR: arms[1][1],
    body, meshes, colors,
  };
  return root;
}

// Перекраска одежды (магазин одежды).
export function recolorHuman(g, shirt, pants) {
  const u = g.userData, c = new THREE.Color();
  u.colors.shirt = shirt; u.colors.pants = pants;
  for (const m of u.meshes) {
    const col = m.geometry.attributes.color;
    for (const s of m.geometry.userData.slots) {
      if (s.slot !== 'shirt' && s.slot !== 'pants') continue;
      c.setHex(u.colors[s.slot]);
      for (let i = s.start; i < s.start + s.count; i++) col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }
}

// Ходьба/бег: amount 0 — стоит, 1 — идёт, 1.3 — бежит. punch 0..1 — правая рука вперёд (удар/прицел).
export function animateHuman(g, phase, amount, punch = 0) {
  const u = g.userData;
  const a = Math.min(1.4, amount);
  const s = Math.sin(phase), c = Math.cos(phase);
  // бёдра и колени: колено сгибается, когда нога идёт вперёд
  u.lL.rotation.x = s * 0.6 * a;
  u.lR.rotation.x = -s * 0.6 * a;
  u.kL.rotation.x = (0.05 + Math.max(0, c) * 1.0) * a;
  u.kR.rotation.x = (0.05 + Math.max(0, -c) * 1.0) * a;
  // руки в противофазе, локти слегка согнуты
  u.aL.rotation.x = -s * 0.5 * a;
  u.eL.rotation.x = -0.15 - (0.25 + Math.max(0, -s) * 0.3) * a;
  if (punch > 0) { u.aR.rotation.x = -1.55 * punch; u.eR.rotation.x = -0.05; }
  else { u.aR.rotation.x = s * 0.5 * a; u.eR.rotation.x = -0.15 - (0.25 + Math.max(0, s) * 0.3) * a; }
  u.aL.rotation.z = -0.06; u.aR.rotation.z = punch > 0 ? 0 : 0.06;
  // корпус: покачивание вверх-вниз и наклон вперёд на бегу
  u.body.position.y = Math.abs(c) * 0.035 * a;
  u.body.rotation.x = Math.max(0, a - 1) * 0.35;
}

const SHIRTS = [0xc0392b, 0x2980b9, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xecf0f1, 0x34495e, 0xe67e22, 0x16a085, 0xd35400, 0xf4a6c0, 0x9fd3e0];
const PANTS = [0x2c3e50, 0x1a1a1a, 0x5d4037, 0x34495e, 0x7f8c8d, 0x1f3a5f, 0xc8b89a, 0x3b5f8a];
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4226];
const HAIRS = [0x1a1209, 0x3b2716, 0x8a6a3a, 0xd8c07a, 0x555555, 0xa0522d];
const SHOES = [0x1c1c1c, 0xf0f0f0, 0x6b4a2f, 0x2a3a5a];

export const randomLook = () => ({
  shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKINS), hair: pick(HAIRS),
  opts: {
    female: Math.random() < 0.45, sleeves: Math.random() < 0.4 ? 'long' : 'short',
    height: rnd(0.93, 1.07), build: rnd(0.92, 1.12), shoe: pick(SHOES),
  },
});
