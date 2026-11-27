import * as THREE from 'three';
import { pick } from './config.js';

const box = (w, h, d, py = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (py) g.translate(0, py, 0);
  return g;
};
const GEO = {
  leg: box(0.22, 0.86, 0.24, -0.43),
  torso: box(0.52, 0.62, 0.3),
  arm: box(0.14, 0.62, 0.16, -0.3),
  head: box(0.28, 0.3, 0.28),
  hair: box(0.3, 0.1, 0.3),
};
const cache = new Map();
export function mat(c) {
  if (!cache.has(c)) cache.set(c, new THREE.MeshLambertMaterial({ color: c }));
  return cache.get(c);
}

export function makeHuman(shirt, pants, skin, hair = 0x221a12) {
  const g = new THREE.Group();
  const part = (geo, color, x, y) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(x, y, 0);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const lL = part(GEO.leg, pants, -0.13, 0.88);
  const lR = part(GEO.leg, pants, 0.13, 0.88);
  part(GEO.torso, shirt, 0, 1.19);
  const aL = part(GEO.arm, shirt, -0.34, 1.47);
  const aR = part(GEO.arm, shirt, 0.34, 1.47);
  part(GEO.head, skin, 0, 1.68);
  part(GEO.hair, hair, 0, 1.86);
  g.userData = { lL, lR, aL, aR };
  return g;
}

export function animateHuman(g, phase, amount, punch = 0) {
  const u = g.userData;
  const s = Math.sin(phase) * 0.75 * amount;
  u.lL.rotation.x = s;
  u.lR.rotation.x = -s;
  u.aL.rotation.x = -s * 0.8;
  u.aR.rotation.x = punch > 0 ? -1.6 * punch : s * 0.8;
}

const SHIRTS = [0xc0392b, 0x2980b9, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xecf0f1, 0x34495e, 0xe67e22, 0x16a085, 0xd35400];
const PANTS = [0x2c3e50, 0x1a1a1a, 0x5d4037, 0x34495e, 0x7f8c8d, 0x1f3a5f];
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4226];
const HAIRS = [0x1a1209, 0x3b2716, 0x8a6a3a, 0xd8c07a, 0x555555];

export const randomLook = () => ({
  shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKINS), hair: pick(HAIRS),
});
