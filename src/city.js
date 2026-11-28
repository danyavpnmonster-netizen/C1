import * as THREE from 'three';
import { ROAD, SIDEWALK, HALF, LAND, clamp, mulberry32, blockIndex } from './config.js';
import { Roads, NODE_R, WALK_OFF } from './roads.js';

const rng = mulberry32(20261127);

// Текстуры фасадов. Отдельная карта свечения — горящие окна ночью.
// office — окна в сетке, glass — стеклянные ленты, brick — кирпич, house — сайдинг частного дома.
function windowTextures(style = 'office') {
  const S = 256, cols = style === 'house' ? 2 : 8, rows = style === 'house' ? 1 : 8, cw = S / cols, ch = S / rows;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const a = mk(), e = mk();
  const ga = a.getContext('2d'), ge = e.getContext('2d');
  ga.fillStyle = '#ffffff'; ga.fillRect(0, 0, S, S);
  ge.fillStyle = '#000000'; ge.fillRect(0, 0, S, S);
  if (style === 'brick') {
    for (let y = 0; y < S; y += 8) for (let x = (y / 8) % 2 ? -8 : 0; x < S; x += 16) {
      ga.fillStyle = `hsl(${8 + rng() * 10},${45 + rng() * 15}%,${42 + rng() * 10}%)`;
      ga.fillRect(x + 1, y + 1, 14, 6);
    }
  }
  if (style === 'house') {
    ga.fillStyle = 'rgba(0,0,0,0.07)';
    for (let y = 0; y < S; y += 12) ga.fillRect(0, y, S, 2);
  }
  for (let y = 0; y < rows; y++) {
    if (style === 'office') { ga.fillStyle = 'rgba(0,0,0,0.10)'; ga.fillRect(0, y * ch + ch - 3, S, 3); }
    if (style === 'glass') { ga.fillStyle = '#c9d6df'; ga.fillRect(0, y * ch + ch - 5, S, 5); }
    for (let x = 0; x < cols; x++) {
      let wx = x * cw + cw * 0.18, wy = y * ch + ch * 0.2, ww = cw * 0.64, wh = ch * 0.55;
      if (style === 'glass') { wx = x * cw + 1; wy = y * ch; ww = cw - 2; wh = ch - 5; }
      if (style === 'brick') { wx = x * cw + cw * 0.25; wy = y * ch + ch * 0.15; ww = cw * 0.5; wh = ch * 0.6; }
      if (style === 'house') { wx = x * cw + cw * 0.25; wy = ch * 0.25; ww = cw * 0.5; wh = ch * 0.35; }
      ga.fillStyle = style === 'glass' ? '#4f7393' : '#3d4b5c'; ga.fillRect(wx, wy, ww, wh);
      ga.fillStyle = 'rgba(255,255,255,0.2)'; ga.fillRect(wx, wy, ww * 0.35, wh);
      if (style === 'brick' || style === 'house') {
        ga.fillStyle = '#f2efe6'; ga.fillRect(wx - 3, wy + wh, ww + 6, 4);   // подоконник
      }
      if (rng() < (style === 'glass' ? 0.3 : 0.38)) {
        ge.fillStyle = rng() < 0.8 ? '#ffd27a' : '#bfe3ff';
        ge.fillRect(wx, wy, ww, wh);
      }
    }
  }
  if (style === 'house') {   // дверь
    ga.fillStyle = '#6b4a2f'; ga.fillRect(S * 0.42, S * 0.6, S * 0.16, S * 0.4);
  }
  const ta = new THREE.CanvasTexture(a), te = new THREE.CanvasTexture(e);
  for (const t of [ta, te]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
  }
  return { ta, te };
}

const STYLES = {
  office: { tile: [24, 28], colors: [0xe8d9c0, 0xc9b79c, 0x9fb3c8, 0xd4a58a, 0xb8c4b0, 0xe6e6e6, 0xa89f91, 0xf0c9a0, 0x8fa5b5] },
  glass: { tile: [16, 28], colors: [0x9ec3e0, 0x7fa7c9, 0xa9d1c9, 0xb4bfd6] },
  brick: { tile: [18, 24], colors: [0xffffff, 0xf0e0d0, 0xe0d6cc] },
  house: { tile: [8, 3], colors: [0xf3e3b5, 0xbfe0d0, 0xf0c4b4, 0xd0d8f0, 0xffffff, 0xe8d0f0] },
};
export const SHOP_TYPES = {
  market: { name: 'ПРОДУКТЫ 24/7', color: 0x2e9e5b },
  guns: { name: 'ОРУЖЕЙНАЯ', color: 0x8a2b2b },
  clothes: { name: 'ОДЕЖДА', color: 0x7a3fa0 },
};

// Зоны города по расстоянию от центра: деловой центр, кварталы, частный сектор.
const zoneOf = (x, z) => {
  const d = Math.hypot(x, z) / HALF;
  return d < 0.38 ? 'center' : d < 0.72 ? 'mid' : 'suburb';
};
const FRONT = ROAD / 2 + SIDEWALK;     // от осевой до края участка

// Ориентированный прямоугольник (OBB) для проверки пересечений участков.
function obb(cx, cz, hw, hd, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { cx, cz, hw, hd, ax: [c, -s], az: [s, c] };
}
function obbOverlap(A, B) {
  const axes = [A.ax, A.az, B.ax, B.az];
  const dx = B.cx - A.cx, dz = B.cz - A.cz;
  for (const [x, z] of axes) {
    const ra = A.hw * Math.abs(A.ax[0] * x + A.ax[1] * z) + A.hd * Math.abs(A.az[0] * x + A.az[1] * z);
    const rb = B.hw * Math.abs(B.ax[0] * x + B.ax[1] * z) + B.hd * Math.abs(B.az[0] * x + B.az[1] * z);
    if (Math.abs(dx * x + dz * z) > ra + rb) return false;
  }
  return true;
}
function obbCorners(o) {
  const res = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    res.push([o.cx + o.ax[0] * o.hw * sx + o.az[0] * o.hd * sz, o.cz + o.ax[1] * o.hw * sx + o.az[1] * o.hd * sz]);
  }
  return res;
}

export class City {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.grid = new Map();
    this.ramps = [];
    this.wallMats = [];
    this.mats = {};
    this.shops = [];
    this.doors = [];      // входы в дома и подъезды: {x, z, nx, nz, kind, id}
    this.lots = [];       // занятые участки (OBB) — чтобы здания не налезали друг на друга
    this.parks = [];      // {x, z, r}
    this.footprints = []; // для мини-карты: углы зданий
    this.places = {};     // особые точки: старт, больница, участок, задания, банда
    this.roads = new Roads(77);
    this.build();
  }

  // ---------- коллизии: ориентированные прямоугольники ----------
  // rot — поворот вокруг вертикали (как у mesh.rotation.y).
  addColliderOBB(cx, cz, hw, hd, rot, h) {
    const c = { cx, cz, hw, hd, cos: Math.cos(rot), sin: Math.sin(rot), h, thin: Math.min(hw, hd) * 2 < 1 };
    this.colliders.push(c);
    const key = blockIndex(cx) + ',' + blockIndex(cz);
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key).push(c);
    return c;
  }
  addCollider(minX, maxX, minZ, maxZ, h) {
    return this.addColliderOBB((minX + maxX) / 2, (minZ + maxZ) / 2, (maxX - minX) / 2, (maxZ - minZ) / 2, 0, h);
  }

  // Выталкивает круг p (x,z[,y]) радиуса r из зданий. Возвращает нормаль удара или null.
  collide(p, r) {
    let hit = null;
    const bi = blockIndex(p.x), bj = blockIndex(p.z);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const list = this.grid.get((bi + di) + ',' + (bj + dj));
      if (!list) continue;
      for (const c of list) {
        if (p.y !== undefined && p.y > c.h) continue;
        const dx = p.x - c.cx, dz = p.z - c.cz;
        // в локальные оси прямоугольника
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) > c.hw + r || Math.abs(lz) > c.hd + r) continue;
        const qx = clamp(lx, -c.hw, c.hw), qz = clamp(lz, -c.hd, c.hd);
        let ex = lx - qx, ez = lz - qz;
        const d2 = ex * ex + ez * ez;
        if (d2 >= r * r) continue;
        let nlx, nlz, push;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2); nlx = ex / d; nlz = ez / d; push = r - d;
        } else {
          const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
          if (px < pz) { nlx = Math.sign(lx) || 1; nlz = 0; push = px + r; }
          else { nlx = 0; nlz = Math.sign(lz) || 1; push = pz + r; }
        }
        // нормаль обратно в мир
        const nx = nlx * c.cos + nlz * c.sin, nz = -nlx * c.sin + nlz * c.cos;
        p.x += nx * push; p.z += nz * push;
        hit = { nx, nz };
      }
    }
    if (p.x > 3000) return hit;   // интерьеры
    const B = LAND - 2;
    if (p.x < -B) { p.x = -B; hit = { nx: 1, nz: 0 }; }
    if (p.x > B) { p.x = B; hit = { nx: -1, nz: 0 }; }
    if (p.z < -B) { p.z = -B; hit = { nx: 0, nz: 1 }; }
    if (p.z > B) { p.z = B; hit = { nx: 0, nz: -1 }; }
    return hit;
  }

  pointBlocked(x, y, z) {
    const list = this.grid.get(blockIndex(x) + ',' + blockIndex(z));
    if (!list) return false;
    for (const c of list) {
      if (c.thin || y >= c.h) continue;   // деревья и фонари не закрывают обзор
      const dx = x - c.cx, dz = z - c.cz;
      if (Math.abs(dx * c.cos - dz * c.sin) < c.hw && Math.abs(dx * c.sin + dz * c.cos) < c.hd) return true;
    }
    return false;
  }

  groundHeight(x, z) {
    for (const r of this.ramps) {
      if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) {
        let t = r.axis === 'x' ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0);
        if (r.dir < 0) t = 1 - t;
        return t * r.h;
      }
    }
    return 0;
  }

  // ---------- участки ----------
  // Свободен ли повёрнутый участок: не на дороге, не в парке, не на другом здании, на суше.
  lotFree(o, margin = 0.5) {
    const B = LAND - 14;
    for (const [x, z] of [...obbCorners(o), [o.cx, o.cz]]) {
      if (Math.abs(x) > B || Math.abs(z) > B) return false;
      if (this.roads.distToRoad(x, z, 40) < FRONT + margin) return false;
      for (const pk of this.parks) if (Math.hypot(x - pk.x, z - pk.z) < pk.r + 2) return false;
    }
    for (const l of this.lots) {
      if (Math.abs(l.cx - o.cx) > 60 || Math.abs(l.cz - o.cz) > 60) continue;
      if (obbOverlap(l, o)) return false;
    }
    return true;
  }
  takeLot(o) { this.lots.push(o); this.footprints.push(obbCorners(o)); }

  // ---------- построение ----------
  // Группа, повёрнутая вдоль улицы: локальная ось +z смотрит от дороги вглубь участка.
  group(cx, cz, rot) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz); g.rotation.y = rot;
    this.scene.add(g);
    return g;
  }

  // Коробка с фасадом выбранного стиля внутри группы (локальные координаты).
  box(parent, x, z, w, d, y0, h, style, wall = null) {
    const [tw, th] = STYLES[style].tile;
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const fw = f < 2 ? d : w;
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(fw / tw)), uv.getY(i) * Math.max(1, Math.round(h / th)));
      }
    }
    const list = this.mats[style];
    wall = wall || list[Math.floor(rng() * list.length)];
    const m = new THREE.Mesh(geo, [wall, wall, this.roofMat, this.roofMat, wall, wall]);
    m.position.set(x, y0 + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return wall;
  }

  part(parent, mat, sx, sy, sz, x, y, z) {
    const m = new THREE.Mesh(this.unitBox, mat);
    m.scale.set(sx, sy, sz); m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  roofProps(g, w, d, y) {
    const n = Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const s = 1.5 + rng() * 2;
      this.part(g, this.propMat, s, 1.2, s, (rng() - 0.5) * (w - 4), y + 0.6, (rng() - 0.5) * (d - 4));
    }
    if (rng() < 0.35) {
      const t = new THREE.Mesh(this.tankGeo, this.tankMat);
      t.position.set(w * 0.2, y + 2.5, -d * 0.2);
      g.add(t);
    }
  }

  // Здание w×d (вдоль улицы × вглубь) с центром (cx, cz), повёрнутое на rot.
  addBuilding(cx, cz, w, d, rot, h, style = null) {
    if (!style) style = h > 45 ? (rng() < 0.6 ? 'glass' : 'office') : h < 20 && rng() < 0.5 ? 'brick' : 'office';
    const g = this.group(cx, cz, rot);
    this.addColliderOBB(cx, cz, w / 2, d / 2, rot, h);
    if (h > 28 && w > 14 && d > 14 && rng() < 0.6) {
      // ступенчатый небоскрёб: 2–3 уступа
      let y = 0, aw = w, ad = d, wall = null;
      const tiers = h > 60 ? 3 : 2;
      for (let t = 0; t < tiers; t++) {
        const th = t === tiers - 1 ? h - y : h * (t === 0 ? 0.5 : 0.3);
        wall = this.box(g, 0, 0, aw, ad, y, th, style, wall);
        y += th;
        const ins = 1.5 + rng() * 2;
        if (t < tiers - 1) { aw -= ins * 2; ad -= ins * 2; }
      }
      if (rng() < 0.6) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 10), this.roofMat);
        ant.position.set(0, h + 5, 0);
        g.add(ant);
      }
    } else {
      this.box(g, 0, 0, w, d, 0, h, style);
      if (style === 'brick' || style === 'office') this.part(g, this.roofMat, w + 0.4, 0.8, d + 0.4, 0, h + 0.2, 0);
      this.roofProps(g, w, d, h);
    }
    return { g, style, h };
  }

  // Частный дом с крышей.
  addHouse(cx, cz, w, d, rot) {
    const h = 3.5 + rng() * 2.5;
    const g = this.group(cx, cz, rot);
    this.box(g, 0, 0, w, d, 0, h, 'house');
    const roof = new THREE.Mesh(this.roofGeo, this.houseRoofMats[Math.floor(rng() * this.houseRoofMats.length)]);
    roof.scale.set(w * 0.75, 2 + rng() * 1.5, d * 0.75);
    roof.position.set(0, h, 0);
    roof.castShadow = true;
    g.add(roof);
    this.addColliderOBB(cx, cz, w / 2, d / 2, rot, h + 2);
    return g;
  }

  // Дверь на передней (обращённой к улице) стене: локально z = -d/2.
  addDoor(g, cx, cz, d, rot, kind) {
    this.part(g, this.doorMat, 1.1, 2.1, 0.12, 0, 1.05, -d / 2 - 0.05);
    this.part(g, this.roofMat, 1.8, 0.15, 0.8, 0, 0.07, -d / 2 - 0.4);
    const nx = -Math.sin(rot), nz = -Math.cos(rot);           // наружу, к улице
    const fx = cx + nx * d / 2, fz = cz + nz * d / 2;
    this.doors.push({ x: fx + nx * 1.0, z: fz + nz * 1.0, nx, nz, kind, id: this.doors.length });
  }

  // Магазин у тротуара: вывеска, витрины, дверь, козырёк.
  addShop(cx, cz, rot, type) {
    const T = SHOP_TYPES[type], w = 20, d = 12, h = 5.5;
    const g = this.group(cx, cz, rot);
    const mat = new THREE.MeshLambertMaterial({ color: T.color });
    const m = new THREE.Mesh(this.unitBox, [mat, mat, this.roofMat, this.roofMat, mat, mat]);
    m.scale.set(w, h, d); m.position.set(0, h / 2, 0); m.castShadow = m.receiveShadow = true;
    g.add(m);
    this.addColliderOBB(cx, cz, w / 2, d / 2, rot, h);
    const fz = -d / 2;
    for (const sx of [-1, 1]) this.part(g, this.shopGlass, 5.5, 2.6, 0.12, sx * 5.5, 1.9, fz - 0.05);
    this.part(g, this.doorMat, 2.4, 3, 0.14, 0, 1.5, fz - 0.06);
    const aw = this.part(g, new THREE.MeshLambertMaterial({ color: 0xf4f0e6 }), 20, 0.25, 1.8, 0, 3.6, fz - 0.9);
    aw.rotation.x = 0.25;
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const x = c.getContext('2d');
    x.fillStyle = '#' + T.color.toString(16).padStart(6, '0'); x.fillRect(0, 0, 512, 96);
    x.fillStyle = '#fff6d0'; x.font = 'bold 54px Trebuchet MS, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(T.name, 256, 50);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const signMat = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.3 });
    this.signMats.push(signMat);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.2), signMat);
    sign.position.set(0, 4.8, fz - 0.1); sign.rotation.y = Math.PI;
    g.add(sign);
    const nx = -Math.sin(rot), nz = -Math.cos(rot);
    const fx = cx + nx * d / 2, fzW = cz + nz * d / 2;
    this.shops.push({ type, name: T.name, color: T.color, door: { x: fx + nx * 1.6, z: fzW + nz * 1.6, nx, nz } });
  }

  addRamp(cx, cz, axis, dir) {
    const L = 14, W = 7, H = 4.5;
    const gx = axis === 'x' ? L : W, gz = axis === 'x' ? W : L;
    const geo = new THREE.BoxGeometry(gx, H, gz);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) {
        const c = axis === 'x' ? pos.getX(i) / gx : pos.getZ(i) / gz;
        let t = c + 0.5; if (dir < 0) t = 1 - t;
        pos.setY(i, -H / 2 + t * H);
      }
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.rampMat);
    m.position.set(cx, H / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    this.ramps.push({ x0: cx - gx / 2, x1: cx + gx / 2, z0: cz - gz / 2, z1: cz + gz / 2, axis, dir, h: H });
  }

  // Лента вдоль дороги со смещением от осевой [o0, o1] на высоте y (для асфальта и тротуаров).
  ribbon(e, o0, o1, y, mat, trim) {
    const R = this.roads, pos = [], idx = [];
    const s0 = trim, s1 = e.L - trim;
    if (s1 <= s0) return;
    const n = Math.max(2, Math.ceil((s1 - s0) / 2));
    for (let k = 0; k <= n; k++) {
      const p = R.sample(e.id, s0 + (s1 - s0) * k / n);
      const rx = -p.tz, rz = p.tx;
      pos.push(p.x + rx * o0, y, p.z + rz * o0, p.x + rx * o1, y, p.z + rz * o1);
      if (k < n) { const i = k * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // нормали вверх (лента может быть «перевёрнута» в зависимости от стороны)
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  // Склеивает статичные объекты города в крупные куски по материалу и области 150×150 м:
  // вместо тысяч отдельных объектов — несколько сотен, а невидимые куски всё так же отсекаются.
  batchStatic(objects) {
    const CH = 150, buckets = new Map();
    const v = new THREE.Vector3(), nrm = new THREE.Vector3(), nm = new THREE.Matrix3();
    const meshes = [];
    for (const o of objects) o.traverse((m) => { if (m.isMesh && !m.isInstancedMesh) meshes.push(m); });
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      nm.getNormalMatrix(m.matrixWorld);
      const g = m.geometry, pos = g.attributes.position, no = g.attributes.normal, uv = g.attributes.uv;
      const idx = g.index ? g.index.array : null;
      const count = idx ? idx.length : pos.count;
      const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
      for (const gr of groups) {
        const mat = Array.isArray(m.material) ? m.material[gr.materialIndex] : m.material;
        if (!mat) continue;
        // кусок по центру объекта
        v.set(0, 0, 0).applyMatrix4(m.matrixWorld);
        const key = Math.floor(v.x / CH) + ',' + Math.floor(v.z / CH) + '|' + mat.uuid + '|' + (m.castShadow ? 1 : 0);
        let b = buckets.get(key);
        if (!b) { b = { mat, cast: m.castShadow, p: [], n: [], u: [] }; buckets.set(key, b); }
        for (let k = gr.start; k < Math.min(gr.start + gr.count, count); k++) {
          const i = idx ? idx[k] : k;
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          b.p.push(v.x, v.y, v.z);
          if (no) { nrm.fromBufferAttribute(no, i).applyMatrix3(nm).normalize(); b.n.push(nrm.x, nrm.y, nrm.z); } else b.n.push(0, 1, 0);
          if (uv) b.u.push(uv.getX(i), uv.getY(i)); else b.u.push(0, 0);
        }
      }
    }
    for (const o of objects) {
      if (o.parent) o.parent.remove(o);
      o.traverse((m) => { if (m.isMesh && m.geometry && !m.geometry.userData.shared) m.geometry.dispose?.(); });
    }
    for (const b of buckets.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, b.mat);
      mesh.castShadow = b.cast; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
    }
    return buckets.size;
  }

  build() {
    const scene = this.scene, R = this.roads;
    const before = new Set(scene.children);
    this.planeGeo = new THREE.PlaneGeometry(1, 1);
    for (const [style, S] of Object.entries(STYLES)) {
      const { ta, te } = windowTextures(style);
      this.mats[style] = S.colors.map((c) => {
        const m = new THREE.MeshLambertMaterial({ color: c, map: ta, emissiveMap: te, emissive: 0xffffff, emissiveIntensity: 0 });
        this.wallMats.push(m);
        return m;
      });
    }
    this.roofMat = new THREE.MeshLambertMaterial({ color: 0x55585e });
    this.unitBox = new THREE.BoxGeometry(1, 1, 1);
    this.propMat = new THREE.MeshLambertMaterial({ color: 0x9a9ea4 });
    this.tankGeo = new THREE.CylinderGeometry(1.6, 1.6, 3, 10);
    this.tankMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
    this.roofGeo = new THREE.ConeGeometry(Math.SQRT2 * 0.75, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    this.houseRoofMats = [0x8a3b2b, 0x4a4f5a, 0x6b4a2f, 0x2f5a4a].map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
    this.shopGlass = new THREE.MeshLambertMaterial({ color: 0x9fc6e0, emissive: 0xfff0c0, emissiveIntensity: 0.25 });
    this.doorMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1e });
    this.signMats = [this.shopGlass];
    this.rampMat = new THREE.MeshLambertMaterial({ color: 0xe0a030 });
    const asphalt = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
    const sidewalk = new THREE.MeshLambertMaterial({ color: 0xa7a7a2 });
    const grass = new THREE.MeshLambertMaterial({ color: 0x5f8f45 });
    const concrete = new THREE.MeshLambertMaterial({ color: 0x8b8b86 });
    const parkMat = new THREE.MeshLambertMaterial({ color: 0x4f8f3a });
    const sand = new THREE.MeshLambertMaterial({ color: 0xe2cf9a });
    const garageMat = new THREE.MeshLambertMaterial({ color: 0x2f7d4f });

    // земля: трава, бетонный центр, пляж, океан
    const plane = (w, d, mat, x, y, z) => {
      const m = new THREE.Mesh(this.planeGeo, mat);
      m.rotation.x = -Math.PI / 2; m.scale.set(w, d, 1); m.position.set(x, y, z); m.receiveShadow = true;
      scene.add(m); return m;
    };
    plane(LAND * 2, LAND * 2, sand, 0, -0.03, 0);
    plane((LAND - 12) * 2, (LAND - 12) * 2, grass, 0, -0.01, 0);
    const centre = new THREE.Mesh(new THREE.CircleGeometry(HALF * 0.62, 48), concrete);
    centre.rotation.x = -Math.PI / 2; centre.position.y = 0.0; centre.receiveShadow = true;
    scene.add(centre);
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000),
      new THREE.MeshPhongMaterial({ color: 0x2a6f9e, shininess: 80, specular: 0x88aacc }));
    ocean.rotation.x = -Math.PI / 2; ocean.position.y = -0.35;
    scene.add(ocean);
    this.oceanMat = ocean.material;

    // дороги: тротуары, асфальт, площадки перекрёстков
    for (const e of R.edges) {
      // слои по высоте разнесены, чтобы не мерцали издалека
      this.ribbon(e, -FRONT, -ROAD / 2 + 0.3, 0.02, sidewalk, NODE_R - 2);
      this.ribbon(e, ROAD / 2 - 0.3, FRONT, 0.02, sidewalk, NODE_R - 2);
      this.ribbon(e, -ROAD / 2, ROAD / 2, 0.05, asphalt, 0);
    }
    const disc = (r, mat, y) => new THREE.InstancedMesh(new THREE.CircleGeometry(r, 28).rotateX(-Math.PI / 2), mat, R.nodes.length);
    const swDisc = disc(FRONT + 1, sidewalk), asDisc = disc(NODE_R, asphalt);
    const dummy = new THREE.Object3D();
    R.nodes.forEach((n, k) => {
      dummy.position.set(n.x, 0.035, n.z); dummy.updateMatrix(); swDisc.setMatrixAt(k, dummy.matrix);
      dummy.position.set(n.x, 0.065, n.z); dummy.updateMatrix(); asDisc.setMatrixAt(k, dummy.matrix);
    });
    swDisc.receiveShadow = asDisc.receiveShadow = true;
    scene.add(swDisc, asDisc);

    // разметка: прерывистая осевая вдоль каждой дороги
    const dashes = [];
    for (const e of R.edges) for (let s = NODE_R + 2; s < e.L - NODE_R - 2; s += 6) {
      const p = R.sample(e.id, s);
      dashes.push([p.x, p.z, Math.atan2(p.tx, p.tz)]);
    }
    const dashMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.25, 3).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xf2d24b }), dashes.length);
    dashes.forEach(([x, z, r], k) => {
      dummy.position.set(x, 0.08, z); dummy.rotation.set(0, r, 0); dummy.updateMatrix();
      dashMesh.setMatrixAt(k, dummy.matrix);
    });
    scene.add(dashMesh);
    dummy.rotation.set(0, 0, 0);

    const trees = [], lamps = [], bushes = [];
    const addTree = (x, z, s = 1) => { trees.push([x, z, s]); this.addCollider(x - 0.35, x + 0.35, z - 0.35, z + 0.35, 6); };
    const addLamp = (x, z) => { lamps.push([x, z]); this.addCollider(x - 0.15, x + 0.15, z - 0.15, z + 0.15, 6); };

    // --- парки в «серединах» ячеек сетки ---
    const G = 8;
    const cells = [];
    for (let i = 0; i < G - 1; i++) for (let j = 0; j < G - 1; j++) {
      const ns = [R.nodes[i * G + j], R.nodes[(i + 1) * G + j], R.nodes[i * G + j + 1], R.nodes[(i + 1) * G + j + 1]];
      const cx = ns.reduce((s, n) => s + n.x, 0) / 4, cz = ns.reduce((s, n) => s + n.z, 0) / 4;
      cells.push({ cx, cz, r: R.distToRoad(cx, cz, 80) - FRONT - 3 });
    }
    cells.sort((a, b) => Math.hypot(a.cx, a.cz) - Math.hypot(b.cx, b.cz));
    const central = cells.find((c) => c.r > 20);
    for (const c of cells) {
      if (c.r < 20) continue;
      if (c !== central && rng() > 0.18) continue;
      const r = Math.min(c.r, 42);
      this.parks.push({ x: c.cx, z: c.cz, r });
      const pm = new THREE.Mesh(new THREE.CircleGeometry(r, 40), parkMat);
      pm.rotation.x = -Math.PI / 2; pm.position.set(c.cx, 0.04, c.cz); pm.receiveShadow = true;
      scene.add(pm);
      const hasRamp = c === central || rng() < 0.6, axis = rng() < 0.5 ? 'x' : 'z';
      if (hasRamp) this.addRamp(c.cx, c.cz, axis, rng() < 0.5 ? 1 : -1);
      for (let k = 0; k < 14; k++) {
        const a = rng() * Math.PI * 2, d = 4 + rng() * (r - 6);
        const x = c.cx + Math.cos(a) * d, z = c.cz + Math.sin(a) * d;
        if (hasRamp && (axis === 'x' ? Math.abs(z - c.cz) < 7 : Math.abs(x - c.cx) < 7)) continue;
        addTree(x, z, 0.8 + rng() * 0.6);
      }
    }

    // --- особые места вдоль дорог ---
    // дороги, отсортированные по удалённости середины от центра
    const mid = (e) => R.sample(e.id, e.L / 2);
    const byDist = R.edges.filter((e) => !e.outer && e.L > 70).map((e) => ({ e, d: Math.hypot(mid(e).x, mid(e).z) }))
      .sort((a, b) => a.d - b.d);
    // участок вдоль дороги e на стороне side (+1 справа от a→b), с центром на s, w × d
    const frontLot = (e, s, side, w, d, setback = 0) => {
      const p = R.sample(e.id, s);
      const nx = -p.tz * side, nz = p.tx * side;                 // от дороги вглубь участка
      const off = FRONT + setback + d / 2;
      const cx = p.x + nx * off, cz = p.z + nz * off;
      const rot = Math.atan2(nx, nz);                            // локальная +z — вглубь участка
      return { o: obb(cx, cz, w / 2, d / 2, rot), cx, cz, rot };
    };
    const usedEdges = new Set();
    const pickEdge = (minD, maxD) => {
      const cand = byDist.filter((c) => c.d >= minD && c.d <= maxD && !usedEdges.has(c.e.id));
      const c = cand[Math.floor(rng() * cand.length)] || byDist.find((x) => !usedEdges.has(x.e.id));
      usedEdges.add(c.e.id);
      return c.e;
    };
    // магазины
    for (const type of ['market', 'guns', 'clothes', 'market', 'guns']) {
      for (let t = 0; t < 20; t++) {
        const e = pickEdge(60, 300), side = rng() < 0.5 ? 1 : -1;
        const L = frontLot(e, e.L / 2, side, 20, 12, 0.5);
        if (!this.lotFree(L.o)) continue;
        this.takeLot(L.o); this.addShop(L.cx, L.cz, L.rot, type);
        break;
      }
    }
    // покрасочная мастерская
    for (let t = 0; t < 30; t++) {
      const e = pickEdge(150, 330), side = rng() < 0.5 ? 1 : -1;
      const L = frontLot(e, e.L / 2, side, 18, 18, 0.5);
      if (!this.lotFree(L.o)) continue;
      this.takeLot(L.o);
      const g = this.group(L.cx, L.cz, L.rot);
      const pad = this.part(g, garageMat, 12, 0.04, 12, 0, 0.06, -1);
      pad.castShadow = false;
      for (const [w, d, x, z] of [[16, 1, 0, 7.5], [1, 9, -7.5, 3.5], [1, 9, 7.5, 3.5]]) {
        this.box(g, x, z, w, d, 0, 6, 'brick');
        const cos = Math.cos(L.rot), sin = Math.sin(L.rot);
        this.addColliderOBB(L.cx + x * cos + z * sin, L.cz - x * sin + z * cos, w / 2, d / 2, L.rot, 6);
      }
      const sinR = Math.sin(L.rot), cosR = Math.cos(L.rot);
      this.sprayPos = { x: L.cx + (-1) * sinR, z: L.cz + (-1) * cosR };
      break;
    }
    // точки на тротуаре для заданий, старта, больницы и участка
    const walkAt = (e, t, side) => R.sidewalkPoint(e.id, e.L * t, side);
    const startEdge = byDist[0].e;
    this.places.spawn = { ...walkAt(startEdge, 0.4, 1), edge: startEdge.id, s: startEdge.L * 0.4 };
    this.places.givers = [walkAt(byDist[1].e, 0.5, 1), walkAt(byDist[2].e, 0.5, -1), walkAt(byDist[3].e, 0.5, 1), walkAt(byDist[4].e, 0.6, -1)];
    const west = byDist.filter((c) => mid(c.e).x < -120).sort((a, b) => a.d - b.d)[0] || byDist[5];
    const east = byDist.filter((c) => mid(c.e).x > 120).sort((a, b) => a.d - b.d)[0] || byDist[6];
    this.places.hospital = walkAt(west.e, 0.5, 1);
    this.places.station = walkAt(east.e, 0.5, -1);
    // длинная прямая вдоль пляжа (для тест-режима): самая длинная прибрежная дорога
    const coast = R.edges.filter((e) => e.outer).sort((a, b) => b.L - a.L)[0];
    this.places.straight = { edge: coast.id };
    // район банды: северо-восток
    this.gangZone = { x: HALF * 0.55, z: -HALF * 0.55, r: 120 };
    this.places.gang = [];
    for (const e of R.edges) {
      if (this.places.gang.length >= 4) break;
      const p = mid(e);
      if (Math.hypot(p.x - this.gangZone.x, p.z - this.gangZone.z) < this.gangZone.r - 20 && e.L > 60) {
        this.places.gang.push(walkAt(e, 0.5, this.places.gang.length % 2 ? 1 : -1));
      }
    }
    // точки старта не должны оказаться под зданиями: резервируем
    for (const p of [this.places.spawn, this.places.hospital, this.places.station, ...this.places.givers]) {
      this.lots.push(obb(p.x, p.z, 3, 3, 0));
    }

    // --- застройка вдоль улиц ---
    const kinds = { center: [16, 30, 14, 26], mid: [12, 22, 12, 20], suburb: [8, 11, 7, 9] };
    for (const e of R.edges) for (const side of [1, -1]) {
      let s = NODE_R + 6 + rng() * 4;
      while (s < e.L - NODE_R - 6) {
        const p = R.sample(e.id, s);
        const zone = zoneOf(p.x, p.z);
        const [w0, w1, d0, d1] = kinds[zone];
        const w = w0 + rng() * (w1 - w0), d = d0 + rng() * (d1 - d0);
        const setback = zone === 'suburb' ? 3 + rng() * 3 : 0.3 + rng() * 1.2;
        if (s + w > e.L - NODE_R - 4) break;
        const L = frontLot(e, s + w / 2, side, w, d, setback);
        if (this.lotFree(L.o)) {
          this.takeLot(L.o);
          const ctr = Math.max(0, 1 - Math.hypot(L.cx, L.cz) / HALF);
          if (zone === 'suburb') {
            const g = this.addHouse(L.cx, L.cz, w, d, L.rot);
            if (rng() < 0.45) this.addDoor(g, L.cx, L.cz, d, L.rot, 'house');
            if (rng() < 0.5) {   // дерево во дворе
              const nx = Math.sin(L.rot), nz = Math.cos(L.rot);
              addTree(L.cx + nx * (d / 2 + 2.5), L.cz + nz * (d / 2 + 2.5), 0.9);
            }
          } else {
            const h = (zone === 'center' ? 18 : 9) + rng() * 16 + ctr * ctr * rng() * 80;
            const b = this.addBuilding(L.cx, L.cz, w, d, L.rot, h);
            if (h < 26 && rng() < 0.35) this.addDoor(b.g, L.cx, L.cz, d, L.rot, 'flat');
          }
          s += w + (zone === 'suburb' ? 5 + rng() * 6 : 2 + rng() * 4);
        } else s += 4;
      }
    }
    // вторая линия: заполняем глубину кварталов
    for (let t = 0; t < 2600; t++) {
      const x = (rng() * 2 - 1) * (LAND - 20), z = (rng() * 2 - 1) * (LAND - 20);
      const n = R.nearest(x, z, 90);
      if (!n || n.dist < FRONT + 20) continue;
      const zone = zoneOf(x, z);
      const [w0, w1, d0, d1] = kinds[zone];
      const w = w0 + rng() * (w1 - w0), d = d0 + rng() * (d1 - d0);
      const rot = Math.atan2(-n.tz, n.tx);   // вдоль ближайшей улицы
      const o = obb(x, z, w / 2, d / 2, rot);
      if (!this.lotFree(o, 2)) continue;
      this.takeLot(o);
      if (zone === 'suburb') this.addHouse(x, z, w, d, rot);
      else this.addBuilding(x, z, w, d, rot, 8 + rng() * 20);
    }

    // --- тротуары: фонари, деревья, кусты ---
    for (const e of R.edges) {
      // у перекрёстков столбов и деревьев нет — там поворачивают машины
      for (let s = NODE_R + 14, k = 0; s < e.L - NODE_R - 12; s += 28, k++) {
        const side = k % 2 ? 1 : -1;
        const p = R.sidewalkPoint(e.id, s, side, ROAD / 2 + 0.8);
        addLamp(p.x, p.z);
      }
      for (const side of [1, -1]) for (let s = NODE_R + 8; s < e.L - NODE_R - 4; s += 3.2) {
        const p = R.sidewalkPoint(e.id, s, side, FRONT - 0.7);
        if (this.doors.some((d) => Math.hypot(d.x - p.x, d.z - p.z) < 2.6)) continue;
        if (this.shops.some((sh) => Math.hypot(sh.door.x - p.x, sh.door.z - p.z) < 11)) continue;
        if (this.sprayPos && Math.hypot(this.sprayPos.x - p.x, this.sprayPos.z - p.z) < 13) continue;
        const z = zoneOf(p.x, p.z);
        if (rng() < (z === 'center' ? 0.35 : 0.5)) bushes.push([p.x, p.z, 0.8 + rng() * 0.5]);
        else if (rng() < 0.05 && s > NODE_R + 14 && s < e.L - NODE_R - 14) addTree(p.x, p.z, 0.75);
      }
    }
    // пальмы на пляже
    for (let k = 0; k < 90; k++) {
      const side = Math.floor(rng() * 4);
      const t = (rng() * 2 - 1) * (LAND - 6);
      const o = LAND - 3 - rng() * 8;
      const [x, z] = side === 0 ? [t, o] : side === 1 ? [t, -o] : side === 2 ? [o, t] : [-o, t];
      if (R.distToRoad(x, z, 30) < FRONT + 2) continue;
      addTree(x, z, 1.1);
    }

    // инстансинг: деревья, кусты, фонари
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 3.2, 6),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 0),
      new THREE.MeshLambertMaterial({ color: 0x3f7f35, flatShading: true }), trees.length);
    trees.forEach(([x, z, s], k) => {
      dummy.rotation.set(0, rng() * 6, 0); dummy.scale.set(s, s, s);
      dummy.position.set(x, 1.6 * s, z); dummy.updateMatrix(); trunk.setMatrixAt(k, dummy.matrix);
      dummy.position.set(x, 3.9 * s, z); dummy.updateMatrix(); crown.setMatrixAt(k, dummy.matrix);
    });
    trunk.castShadow = crown.castShadow = true;
    scene.add(trunk, crown);
    const bushMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.8, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), Math.max(1, bushes.length));
    const greens = [0x3f8a3a, 0x2f7a35, 0x4f9a40, 0x3a7a4a], flowers = [0xd05a8a, 0xe8c84a, 0xf2f2f2];
    const col = new THREE.Color();
    bushes.forEach(([x, z, s], k) => {
      dummy.position.set(x, 0.45 * s, z); dummy.rotation.set(0, rng() * 6, 0); dummy.scale.set(s * 1.1, s * 0.75, s * 1.1);
      dummy.updateMatrix(); bushMesh.setMatrixAt(k, dummy.matrix);
      bushMesh.setColorAt(k, col.setHex(rng() < 0.15 ? flowers[Math.floor(rng() * 3)] : greens[Math.floor(rng() * 4)]));
    });
    bushMesh.count = bushes.length;
    bushMesh.castShadow = true;
    scene.add(bushMesh);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x2c2f33 });
    this.lampMat = new THREE.MeshLambertMaterial({ color: 0xfff1c0, emissive: 0xffd98a, emissiveIntensity: 0 });
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 6), poleMat, lamps.length);
    const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 8, 6), this.lampMat, lamps.length);
    dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0);
    lamps.forEach(([x, z], k) => {
      dummy.position.set(x, 3, z); dummy.updateMatrix(); pole.setMatrixAt(k, dummy.matrix);
      dummy.position.set(x, 6.1, z); dummy.updateMatrix(); bulb.setMatrixAt(k, dummy.matrix);
    });
    scene.add(pole, bulb);
    // склеиваем всё статичное, что построили (кроме инстансов и океана)
    const fresh = scene.children.filter((o) => !before.has(o) && !o.isInstancedMesh && o !== ocean);
    this.batches = this.batchStatic(fresh);
  }

  // Случайная точка на тротуаре.
  randomSidewalk() {
    const R = this.roads, e = R.randomEdge();
    const s = NODE_R + Math.random() * Math.max(1, e.L - NODE_R * 2);
    return R.sidewalkPoint(e.id, s, Math.random() < 0.5 ? 1 : -1);
  }
}

export { WALK_OFF };
