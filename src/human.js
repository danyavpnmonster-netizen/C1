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
  sphere: new THREE.SphereGeometry(1, 14, 10),
  half: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),   // верхняя полусфера
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  taper: new THREE.CylinderGeometry(1, 0.78, 1, 10),     // шире сверху (грудь, бедро)
  cone: new THREE.CylinderGeometry(0.55, 1, 1, 12),      // юбка
  box: new THREE.BoxGeometry(1, 1, 1),
  ring: new THREE.TorusGeometry(1, 0.28, 6, 14).rotateX(Math.PI / 2),
};

// Причёски: набор кусков вокруг головы (центр головы y = 1.68).
function hairPieces(style) {
  const H = 1.68, P = [];
  const cap = (sy = 0.105, y = H + 0.05) => P.push([G.half, 'hair', M(0, y, -0.015, 0.123, sy, 0.13)]);
  switch (style) {
    case 'bald': break;
    case 'buzz': cap(0.1, H + 0.02); break;
    case 'long':
      cap(0.12);
      P.push([G.box, 'hair', M(0, H - 0.1, -0.075, 0.24, 0.34, 0.07)]);
      P.push([G.box, 'hair', M(-0.115, H - 0.05, 0, 0.04, 0.24, 0.16)]);
      P.push([G.box, 'hair', M(0.115, H - 0.05, 0, 0.04, 0.24, 0.16)]);
      break;
    case 'ponytail':
      cap(0.12);
      P.push([G.sphere, 'hair', M(0, H + 0.02, -0.14, 0.05, 0.05, 0.05)]);
      P.push([G.cyl, 'hair', M(0, H - 0.09, -0.16, 0.035, 0.2, 0.035)]);
      break;
    case 'bun':
      cap(0.12);
      P.push([G.sphere, 'hair', M(0, H + 0.13, -0.05, 0.065, 0.06, 0.065)]);
      break;
    case 'curly':
      P.push([G.sphere, 'hair', M(0, H + 0.04, -0.01, 0.15, 0.13, 0.15)]);
      break;
    default:   // short
      cap(0.12);
      P.push([G.box, 'hair', M(0, H + 0.085, 0.085, 0.18, 0.035, 0.05)]);   // чёлка
  }
  return P;
}

/**
 * opts: female, sleeves ('short'|'long'), height, build, shoe, hairStyle,
 *       skirt (цвет юбки), jacket (цвет куртки поверх рубашки), cap (цвет бейсболки), glasses
 */
export function makeHuman(shirt, pants, skin, hair = 0x221a12, opts = {}) {
  const female = !!opts.female;
  const colors = {
    shirt, pants, skin, hair, shoe: opts.shoe ?? 0x1c1c1c, eye: 0x1a1410, white: 0xf2f0ea,
    sole: 0xe8e8e8, belt: 0x2a2018, lips: female ? 0xb5525a : 0x9a5a4a,
    skirt: opts.skirt ?? pants, jacket: opts.jacket ?? shirt, cap: opts.cap ?? 0x1e3a8a, glass: 0x111111,
  };
  const sh = female ? 0.86 : 1, bw = opts.build ?? 1;
  const top = opts.jacket != null ? 'jacket' : 'shirt';
  const root = new THREE.Group();
  const body = new THREE.Group();          // всё, что выше пояса (покачивается при ходьбе)
  root.add(body);
  const meshes = [];
  const add = (parent, geo, x, y, z) => {
    const m = new THREE.Mesh(geo, MAT);
    m.position.set(x, y, z); m.castShadow = true;
    parent.add(m); meshes.push(m); return m;
  };

  // туловище: таз, ремень, грудь, плечи, воротник, шея
  const torso = [
    [G.sphere, opts.skirt != null ? 'skirt' : 'pants', M(0, 0.98, 0, 0.18 * bw * (female ? 1.08 : 1), 0.11, 0.115 * bw)],
    [G.cyl, 'belt', M(0, 1.04, 0, 0.17 * bw * (female ? 1.02 : 1), 0.035, 0.11 * bw)],
    [G.taper, top, M(0, 1.28, 0, 0.2 * sh * bw, 0.46, 0.125 * bw)],
    [G.sphere, top, M(0, 1.5, 0, 0.215 * sh * bw, 0.065, 0.13 * bw)],
    [G.ring, top, M(0, 1.535, 0.005, 0.06, 0.05, 0.055)],
    [G.cyl, 'skin', M(0, 1.565, 0, 0.048, 0.1, 0.048)],
  ];
  if (opts.jacket != null) {
    // рубашка видна в расстёгнутой куртке
    torso.push([G.box, 'shirt', M(0, 1.3, 0.118 * bw, 0.09 * sh, 0.4, 0.02)]);
  }
  if (opts.skirt != null) torso.push([G.cone, 'skirt', M(0, 0.82, 0, 0.21 * bw, 0.32, 0.17 * bw)]);

  // голова: лицо, глаза, брови, нос, губы, уши
  const H = 1.68;
  torso.push(
    [G.sphere, 'skin', M(0, H, 0.005, 0.112, 0.135, 0.118)],
    [G.sphere, 'skin', M(0, H - 0.055, 0.02, 0.08, 0.07, 0.085)],                  // подбородок (внутри овала лица)
    [G.sphere, 'skin', M(-0.113, H, -0.005, 0.02, 0.035, 0.025)],                   // уши
    [G.sphere, 'skin', M(0.113, H, -0.005, 0.02, 0.035, 0.025)],
    [G.box, 'white', M(-0.04, H + 0.013, 0.106, 0.034, 0.02, 0.01)],                // белки
    [G.box, 'white', M(0.04, H + 0.013, 0.106, 0.034, 0.02, 0.01)],
    [G.box, 'eye', M(-0.04, H + 0.013, 0.112, 0.016, 0.018, 0.008)],                // зрачки
    [G.box, 'eye', M(0.04, H + 0.013, 0.112, 0.016, 0.018, 0.008)],
    [G.box, 'hair', M(-0.042, H + 0.042, 0.108, 0.04, 0.01, 0.012)],                // брови
    [G.box, 'hair', M(0.042, H + 0.042, 0.108, 0.04, 0.01, 0.012)],
    [G.box, 'skin', M(0, H - 0.01, 0.122, 0.026, 0.045, 0.03)],                     // нос
    [G.box, 'lips', M(0, H - 0.058, 0.108, 0.045, 0.012, 0.012)],                   // губы
  );
  if (opts.glasses) torso.push(
    [G.box, 'glass', M(-0.04, H + 0.013, 0.12, 0.05, 0.03, 0.01)],
    [G.box, 'glass', M(0.04, H + 0.013, 0.12, 0.05, 0.03, 0.01)],
    [G.box, 'glass', M(0, H + 0.02, 0.12, 0.03, 0.008, 0.008)],
  );
  if (opts.cap != null) {
    torso.push([G.half, 'cap', M(0, H + 0.04, -0.005, 0.127, 0.1, 0.132)]);
    torso.push([G.box, 'cap', M(0, H + 0.045, 0.14, 0.17, 0.014, 0.12)]);
  } else torso.push(...hairPieces(opts.hairStyle ?? (female ? 'long' : 'short')));
  add(body, merge(torso, colors), 0, 0, 0);

  // нога: бедро → колено → голень и кроссовок
  const legs = [];
  const legTop = opts.skirt != null ? 'skin' : 'pants';
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(sx * 0.095 * bw, 0.95, 0); root.add(hip);
    add(hip, merge([[G.taper, legTop, M(0, -0.22, 0, 0.078 * bw, 0.46, 0.082 * bw)]], colors), 0, 0, 0);
    const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
    add(knee, merge([
      [G.sphere, legTop, M(0, 0, 0.005, 0.06, 0.05, 0.065)],
      [G.taper, legTop, M(0, -0.21, 0, 0.062, 0.42, 0.066)],
      [G.sphere, 'shoe', M(0, -0.44, 0.045, 0.058, 0.045, 0.13)],
      [G.box, 'sole', M(0, -0.475, 0.045, 0.11, 0.025, 0.25)],
    ], colors), 0, 0, 0);
    legs.push([hip, knee]);
  }
  // рука: плечо → локоть → предплечье, кисть с большим пальцем
  const arms = [];
  const longSleeve = opts.sleeves === 'long' || opts.jacket != null;
  for (const sx of [-1, 1]) {
    const sho = new THREE.Group(); sho.position.set(sx * 0.225 * sh * bw, 1.47, 0); body.add(sho);
    const upper = longSleeve
      ? [[G.taper, top, M(0, -0.15, 0, 0.058, 0.31, 0.058)]]
      : [[G.taper, 'shirt', M(0, -0.07, 0, 0.065, 0.15, 0.065)], [G.cyl, 'skin', M(0, -0.2, 0, 0.045, 0.2, 0.045)]];
    add(sho, merge([[G.sphere, top, M(0, 0, 0, 0.065, 0.06, 0.065)], ...upper], colors), 0, 0, 0);
    const elb = new THREE.Group(); elb.position.y = -0.3; sho.add(elb);
    add(elb, merge([
      [G.taper, longSleeve ? top : 'skin', M(0, -0.12, 0, 0.044, 0.24, 0.044)],
      [G.box, 'skin', M(0, -0.29, 0.005, 0.07, 0.09, 0.035)],
      [G.box, 'skin', M(-sx * 0.035, -0.27, 0.03, 0.02, 0.05, 0.02)],
    ], colors), 0, 0, 0);
    arms.push([sho, elb]);
  }
  const h = opts.height ?? 1;
  root.scale.setScalar(h);
  root.userData = {
    lL: legs[0][0], lR: legs[1][0], kL: legs[0][1], kR: legs[1][1],
    aL: arms[0][0], aR: arms[1][0], eL: arms[0][1], eR: arms[1][1],
    body, meshes, colors, breath: Math.random() * 6,
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
  if (a < 0.05) {
    // стоит: дышит и чуть переминается
    u.breath += 0.016;
    const b = Math.sin(u.breath * 1.6);
    u.body.position.y = b * 0.006;
    u.body.rotation.z = Math.sin(u.breath * 0.5) * 0.015;
    if (punch <= 0) { u.aR.rotation.x = b * 0.03; }
    u.aL.rotation.x = -b * 0.03;
  } else u.body.rotation.z = 0;
}

const SHIRTS = [0xc0392b, 0x2980b9, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xecf0f1, 0x34495e, 0xe67e22, 0x16a085, 0xd35400, 0xf4a6c0, 0x9fd3e0];
const PANTS = [0x2c3e50, 0x1a1a1a, 0x5d4037, 0x34495e, 0x7f8c8d, 0x1f3a5f, 0xc8b89a, 0x3b5f8a];
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4226];
const HAIRS = [0x1a1209, 0x3b2716, 0x8a6a3a, 0xd8c07a, 0x555555, 0xa0522d];
const SHOES = [0x1c1c1c, 0xf0f0f0, 0x6b4a2f, 0x2a3a5a];

const HAIR_M = ['short', 'short', 'buzz', 'bald', 'curly'];
const HAIR_F = ['long', 'long', 'ponytail', 'bun', 'curly'];
const JACKETS = [0x2b2b2b, 0x5a3b28, 0x3b4a6a, 0x6a6a6a, 0x7a2a2a];

export const randomLook = () => {
  const female = Math.random() < 0.45;
  const opts = {
    female, sleeves: Math.random() < 0.35 ? 'long' : 'short',
    height: female ? rnd(0.9, 1.0) : rnd(0.95, 1.08), build: rnd(0.92, 1.12), shoe: pick(SHOES),
    hairStyle: pick(female ? HAIR_F : HAIR_M),
  };
  if (female && Math.random() < 0.4) opts.skirt = pick([0x2c3e50, 0x8e2b4a, 0x1a1a1a, 0xc8b89a, 0x3b5f8a]);
  if (Math.random() < 0.22) opts.jacket = pick(JACKETS);
  if (!female && Math.random() < 0.12) opts.cap = pick([0x1e3a8a, 0xb91c1c, 0x111111, 0xf5f5f5]);
  if (Math.random() < 0.1) opts.glasses = true;
  return { shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKINS), hair: pick(HAIRS), opts };
};
