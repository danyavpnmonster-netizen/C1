import * as THREE from 'three';

// Модели машин: кузов выдавливается из профиля сбоку (как силуэт на чертеже),
// со скруглёнными кромками, вырезанными арками колёс, стеклянной кабиной и крышей.
// Профиль задан парами [z, y]: z — вдоль машины (зад → перёд), y — высота.

const PROFILES = {
  sedan: {
    top: [[-2.2, 0.45], [-2.23, 0.78], [-2.1, 0.95], [-1.25, 1.0], [1.25, 0.97], [2.0, 0.86], [2.2, 0.72], [2.23, 0.45]],
    glass: [[-1.32, 0.98], [1.22, 0.96], [0.36, 1.43], [-0.76, 1.45]],
    roof: [[-0.82, 1.41], [0.42, 1.4], [0.38, 1.48], [-0.78, 1.49]],
    light: 0.74, belt: 0.98,
  },
  sport: {
    top: [[-2.2, 0.42], [-2.23, 0.72], [-2.05, 0.85], [-1.0, 0.9], [1.0, 0.85], [2.05, 0.64], [2.23, 0.52], [2.23, 0.42]],
    glass: [[-1.45, 0.88], [0.95, 0.84], [0.05, 1.22], [-0.7, 1.24]],
    roof: [[-0.74, 1.2], [0.1, 1.19], [0.07, 1.26], [-0.7, 1.27]],
    light: 0.6, belt: 0.86, spoiler: true,
  },
  van: {
    top: [[-2.5, 0.45], [-2.53, 2.0], [-2.42, 2.15], [1.4, 2.15], [2.1, 1.5], [2.45, 1.12], [2.53, 0.45]],
    side: [[0.55, 1.28], [1.98, 1.28], [1.38, 1.98], [0.55, 1.98]],
    windshield: [[1.44, 2.07], [2.1, 1.5]],
    light: 0.95, belt: 1.25,
  },
};
PROFILES.taxi = PROFILES.sedan;
PROFILES.police = {
  ...PROFILES.sedan,
  top: PROFILES.sedan.top.map(([z, y]) => [z * 4.6 / 4.4, y]),
  glass: PROFILES.sedan.glass.map(([z, y]) => [z * 4.6 / 4.4, y]),
  roof: PROFILES.sedan.roof.map(([z, y]) => [z * 4.6 / 4.4, y]),
};

export const MODEL_MATS = {
  glass: new THREE.MeshPhongMaterial({ color: 0x1a2430, specular: 0x8899aa, shininess: 90, transparent: true, opacity: 0.86 }),
  trim: new THREE.MeshLambertMaterial({ color: 0x1b1d20 }),
  tire: new THREE.MeshLambertMaterial({ color: 0x151515 }),
  rim: new THREE.MeshPhongMaterial({ color: 0xb8bcc2, specular: 0xffffff, shininess: 60 }),
  chrome: new THREE.MeshPhongMaterial({ color: 0xd8dce0, specular: 0xffffff, shininess: 100 }),
  white: new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }),
};

const BOX = new THREE.BoxGeometry(1, 1, 1);
const TIRE = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 18).rotateZ(Math.PI / 2);
const RIM = new THREE.CylinderGeometry(0.22, 0.22, 0.28, 10).rotateZ(Math.PI / 2);
const HUB = new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6).rotateZ(Math.PI / 2);

// Выдавливание профиля поперёк машины. Ширина — по оси x, центр в нуле.
function extrude(points, width, bevel = 0.07, arches = null) {
  const s = new THREE.Shape();
  if (arches) {
    // нижняя кромка с полукруглыми вырезами под колёса
    const [rz, fz, r, y0] = arches;
    const first = points[0];
    s.moveTo(first[0], y0);
    for (const az of [rz, fz]) {
      s.lineTo(az - r, y0);
      s.absarc(az, y0, r, Math.PI, 0, true);
    }
    s.lineTo(points[points.length - 1][0], y0);
    for (let i = points.length - 1; i >= 0; i--) s.lineTo(points[i][0], points[i][1]);
    s.lineTo(first[0], y0);
  } else {
    s.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
    s.closePath();
  }
  const depth = Math.max(0.01, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10,
  });
  // (u, v, e) → (x = w/2 - e - bevel… , y = v, z = u): поворот без отражения
  const m = new THREE.Matrix4().set(0, 0, -1, depth / 2, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
  geo.applyMatrix4(m);
  geo.computeVertexNormals();
  return geo;
}

const cache = new Map();
function geometries(type, T) {
  if (cache.has(type)) return cache.get(type);
  const P = PROFILES[type], wz = T.l / 2 - 0.9;
  const G = {
    body: extrude(P.top, T.w - 0.04, 0.08, [-wz, wz, 0.46, 0.32]),
  };
  if (P.glass) {
    G.glass = extrude(P.glass, T.w - 0.22, 0.06);
    G.roof = extrude(P.roof, T.w - 0.2, 0.05);
  }
  if (P.side) G.side = extrude(P.side, T.w + 0.02, 0);
  if (type === 'police') G.livery = extrude([[-1.05, 0.55], [1.05, 0.55], [1.05, 0.9], [-1.05, 0.9]], T.w + 0.01, 0);
  if (type === 'taxi') G.stripe = extrude([[-1.9, 0.7], [1.9, 0.7], [1.9, 0.77], [-1.9, 0.77]], T.w + 0.01, 0);
  cache.set(type, G);
  return G;
}

// Собирает модель в группу g. Возвращает подвижные части.
export function buildCarModel(g, T, type, bodyMat, mats) {
  const P = PROFILES[type], G = geometries(type, T);
  const mesh = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; g.add(m); return m; };
  const box = (mat, sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(BOX, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); g.add(m); return m;
  };
  mesh(G.body, bodyMat);
  if (G.glass) { mesh(G.glass, MODEL_MATS.glass, false); mesh(G.roof, bodyMat); }
  if (G.side) mesh(G.side, MODEL_MATS.glass, false);
  if (G.livery) mesh(G.livery, MODEL_MATS.white, false);
  if (G.stripe) mesh(G.stripe, mats.black, false);
  if (P.windshield) {
    const [[z0, y0], [z1, y1]] = P.windshield, len = Math.hypot(z1 - z0, y1 - y0);
    const ws = box(MODEL_MATS.glass, T.w - 0.3, len, 0.04, 0, (y0 + y1) / 2 + 0.03, (z0 + z1) / 2 + 0.03);
    ws.rotation.x = Math.atan2(z1 - z0, y0 - y1);
  }
  const hl = T.l / 2, belt = P.belt, ly = P.light;
  // бамперы, решётка, фары, фонари, зеркала, номер
  box(mats.trim, T.w + 0.04, 0.2, 0.18, 0, 0.42, hl + 0.02);
  box(mats.trim, T.w + 0.04, 0.2, 0.18, 0, 0.42, -hl - 0.02);
  box(mats.trim, T.w * 0.42, 0.16, 0.06, 0, ly - 0.06, hl + 0.06);
  for (const sx of [-1, 1]) {
    box(mats.head, 0.42, 0.14, 0.08, sx * (T.w / 2 - 0.32), ly, hl + 0.04);
    box(mats.tail, 0.42, 0.14, 0.08, sx * (T.w / 2 - 0.32), ly, -hl - 0.04);
    const mz = P.glass ? P.glass[1][0] - 0.1 : 1.9;
    box(mats.trim, 0.16, 0.12, 0.2, sx * (T.w / 2 + 0.06), belt + 0.08, mz);
  }
  box(MODEL_MATS.white, 0.5, 0.12, 0.02, 0, 0.5, -hl - 0.12);
  if (P.spoiler) {
    box(mats.trim, T.w - 0.3, 0.05, 0.35, 0, 1.06, -hl + 0.25);
    for (const sx of [-0.6, 0.6]) box(mats.trim, 0.06, 0.18, 0.1, sx, 0.95, -hl + 0.25);
  }
  if (type === 'police') {
    const roofY = P.roof[3][1] + 0.08, rz = (P.roof[0][0] + P.roof[1][0]) / 2;
    box(mats.trim, 1.3, 0.06, 0.32, 0, roofY - 0.02, rz);
    box(mats.red, 0.55, 0.16, 0.3, 0.34, roofY + 0.08, rz);
    box(mats.blue, 0.55, 0.16, 0.3, -0.34, roofY + 0.08, rz);
  }
  if (type === 'taxi') {
    const roofY = P.roof[3][1] + 0.12, rz = (P.roof[0][0] + P.roof[1][0]) / 2;
    box(MODEL_MATS.white, 0.75, 0.22, 0.28, 0, roofY, rz);
  }
  // водитель: голова и плечи за стеклом
  const driver = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mats.driver); head.position.y = 0.32;
  const torso = new THREE.Mesh(BOX, mats.trim); torso.scale.set(0.42, 0.4, 0.26); torso.position.y = 0.02;
  driver.add(head, torso);
  driver.position.set(0.42, belt + 0.02, P.glass ? (P.glass[0][0] + P.glass[1][0]) / 2 + 0.15 : 1.0);
  driver.visible = false;
  g.add(driver);
  // колёса: шина, диск, ступица
  const wheels = [], frontPivots = [];
  const wx = T.w / 2 - 0.16, wz = T.l / 2 - 0.9;
  for (const [x, z, front] of [[wx, wz, 1], [-wx, wz, 1], [wx, -wz, 0], [-wx, -wz, 0]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.36, z); g.add(pivot);
    const w = new THREE.Group();
    const tire = new THREE.Mesh(TIRE, MODEL_MATS.tire); tire.castShadow = true;
    w.add(tire, new THREE.Mesh(RIM, MODEL_MATS.rim), new THREE.Mesh(HUB, MODEL_MATS.chrome));
    // спицы, чтобы было видно вращение
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.Mesh(BOX, MODEL_MATS.trim); sp.scale.set(0.29, 0.05, 0.36); sp.rotation.x = k * Math.PI / 3;
      w.add(sp);
    }
    pivot.add(w);
    wheels.push(w); if (front) frontPivots.push(pivot);
  }
  return { wheels, frontPivots, driver, roofY: P.roof ? P.roof[3][1] : 2.15 };
}
