import * as THREE from 'three';
import { N, BLOCK, ROAD, SIDEWALK, HALF, LAND, nodeCoord, clamp, mulberry32, blockIndex } from './config.js';

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
const SHOP_BLOCKS = { '3,4': 'market', '6,5': 'guns', '4,6': 'clothes', '6,3': 'market', '2,5': 'guns' };

export class City {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.grid = new Map();
    this.ramps = [];
    this.blocks = [];
    this.wallMats = [];
    this.mats = {};
    this.shops = [];
    this.doors = [];      // входы в дома и подъезды: {x, z, nx, nz, kind, id}
    this.build();
  }

  block(bi, bj) { return this.blocks[bi * N + bj]; }

  addCollider(minX, maxX, minZ, maxZ, h) {
    const c = { minX, maxX, minZ, maxZ, h };
    this.colliders.push(c);
    const key = blockIndex((minX + maxX) / 2) + ',' + blockIndex((minZ + maxZ) / 2);
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key).push(c);
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
        const cx = clamp(p.x, c.minX, c.maxX), cz = clamp(p.z, c.minZ, c.maxZ);
        const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let nx, nz, push;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; push = r - d;
        } else {
          const l = p.x - c.minX, rr = c.maxX - p.x, b = p.z - c.minZ, t = c.maxZ - p.z;
          const m = Math.min(l, rr, b, t);
          if (m === l) { nx = -1; nz = 0; push = l + r; }
          else if (m === rr) { nx = 1; nz = 0; push = rr + r; }
          else if (m === b) { nx = 0; nz = -1; push = b + r; }
          else { nx = 0; nz = 1; push = t + r; }
        }
        p.x += nx * push; p.z += nz * push;
        hit = { nx, nz };
      }
    }
    const B = LAND - 2;
    if (p.x > 3000) return hit;   // интерьеры
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
      if (c.maxX - c.minX < 1) continue;   // деревья и фонари не закрывают обзор
      if (y < c.h && x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true;
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

  // ---------- построение ----------
  plane(w, d, mat, x, y, z) {
    const m = new THREE.Mesh(this.planeGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, d, 1);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  // Коробка с фасадом выбранного стиля (без коллайдера).
  box(x0, x1, z0, z1, y0, h, style, wall = null) {
    const w = x1 - x0, d = z1 - z0, [tw, th] = STYLES[style].tile;
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
    m.position.set((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    return wall;
  }

  roofProps(x0, x1, z0, z1, y) {
    const n = Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {   // блоки кондиционеров
      const ac = new THREE.Mesh(this.unitBox, this.propMat);
      const s = 1.5 + rng() * 2;
      ac.scale.set(s, 1.2, s);
      ac.position.set(x0 + 2 + rng() * (x1 - x0 - 4), y + 0.6, z0 + 2 + rng() * (z1 - z0 - 4));
      this.scene.add(ac);
    }
    if (rng() < 0.35) {             // водонапорный бак
      const t = new THREE.Mesh(this.tankGeo, this.tankMat);
      t.position.set(x0 + (x1 - x0) * 0.7, y + 2.5, z0 + (z1 - z0) * 0.3);
      this.scene.add(t);
    }
  }

  addBuilding(x0, x1, z0, z1, h, style = null) {
    if (!style) style = h > 45 ? (rng() < 0.6 ? 'glass' : 'office') : h < 20 && rng() < 0.5 ? 'brick' : 'office';
    const w = x1 - x0, d = z1 - z0;
    this.addCollider(x0, x1, z0, z1, h);
    if (h > 28 && w > 14 && d > 14 && rng() < 0.6) {
      // ступенчатый небоскрёб: 2–3 уступа
      let y = 0, ax0 = x0, ax1 = x1, az0 = z0, az1 = z1;
      const tiers = h > 60 ? 3 : 2;
      let wall = null;
      for (let t = 0; t < tiers; t++) {
        const th = t === tiers - 1 ? h - y : h * (t === 0 ? 0.5 : 0.3);
        wall = this.box(ax0, ax1, az0, az1, y, th, style, wall);
        y += th;
        const ins = 1.5 + rng() * 2;
        if (t < tiers - 1) { ax0 += ins; ax1 -= ins; az0 += ins; az1 -= ins; }
      }
      if (rng() < 0.6) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 10), this.roofMat);
        ant.position.set((ax0 + ax1) / 2, h + 5, (az0 + az1) / 2);
        this.scene.add(ant);
      }
    } else {
      this.box(x0, x1, z0, z1, 0, h, style);
      if (style === 'brick' || style === 'office') {
        // парапет по краю крыши
        const p = new THREE.Mesh(this.unitBox, this.roofMat);
        p.scale.set(w + 0.4, 0.8, d + 0.4); p.position.set((x0 + x1) / 2, h + 0.2, (z0 + z1) / 2);
        this.scene.add(p);
      }
      this.roofProps(x0, x1, z0, z1, h);
    }
  }

  // Дверь на грани здания, обращённой к ближайшему краю квартала (к улице).
  addDoor(x0, x1, z0, z1, blk, kind) {
    const opts = [
      [z0 - blk.z0, 0, -1], [blk.z1 - z1, 0, 1], [x0 - blk.x0, -1, 0], [blk.x1 - x1, 1, 0],
    ].sort((a, b) => a[0] - b[0]);
    const [, nx, nz] = opts[0];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const fx = nx ? (nx > 0 ? x1 : x0) : cx, fz = nz ? (nz > 0 ? z1 : z0) : cz;
    const door = new THREE.Mesh(this.unitBox, this.doorMat);
    door.scale.set(nx ? 0.12 : 1.1, 2.1, nz ? 0.12 : 1.1);
    door.position.set(fx + nx * 0.05, 1.05, fz + nz * 0.05);
    this.scene.add(door);
    const step = new THREE.Mesh(this.unitBox, this.roofMat);       // крыльцо
    step.scale.set(nx ? 0.8 : 1.8, 0.15, nz ? 0.8 : 1.8);
    step.position.set(fx + nx * 0.4, 0.07, fz + nz * 0.4);
    step.receiveShadow = true;
    this.scene.add(step);
    this.doors.push({ x: fx + nx * 1.0, z: fz + nz * 1.0, nx, nz, kind, id: this.doors.length });
  }

  // Частный дом с двускатной (четырёхскатной) крышей.
  addHouse(x0, x1, z0, z1, blk = null) {
    const h = 3.5 + rng() * 2.5;
    this.box(x0, x1, z0, z1, 0, h, 'house');
    const w = x1 - x0, d = z1 - z0;
    const roof = new THREE.Mesh(this.roofGeo, this.houseRoofMats[Math.floor(rng() * this.houseRoofMats.length)]);
    roof.scale.set(w * 0.75, 2 + rng() * 1.5, d * 0.75);
    roof.position.set((x0 + x1) / 2, h, (z0 + z1) / 2);
    roof.castShadow = true;
    this.scene.add(roof);
    this.addCollider(x0, x1, z0, z1, h + 2);
    if (blk && rng() < 0.45) this.addDoor(x0, x1, z0, z1, blk, 'house');
  }

  // Магазин у тротуара с вывеской, витринами и дверью (вход с юга, сторона z0).
  addShop(blk, type) {
    const T = SHOP_TYPES[type], cx = blk.cx, z = blk.z0 + SIDEWALK;
    const mat = new THREE.MeshLambertMaterial({ color: T.color });
    const x0 = cx - 10, x1 = cx + 10, z1 = z + 12, h = 5.5;
    const m = new THREE.Mesh(this.unitBox, [mat, mat, this.roofMat, this.roofMat, mat, mat]);
    m.scale.set(x1 - x0, h, z1 - z); m.position.set(cx, h / 2, (z + z1) / 2);
    m.castShadow = m.receiveShadow = true;
    this.scene.add(m);
    this.addCollider(x0, x1, z, z1, h);
    // витрины, дверь, козырёк
    for (const sx of [-1, 1]) {
      const win = new THREE.Mesh(this.unitBox, this.shopGlass);
      win.scale.set(5.5, 2.6, 0.12); win.position.set(cx + sx * 5.5, 1.9, z - 0.05);
      this.scene.add(win);
    }
    const door = new THREE.Mesh(this.unitBox, this.doorMat);
    door.scale.set(2.4, 3, 0.14); door.position.set(cx, 1.5, z - 0.06);
    this.scene.add(door);
    const awning = new THREE.Mesh(this.unitBox, new THREE.MeshLambertMaterial({ color: 0xf4f0e6 }));
    awning.scale.set(20, 0.25, 1.8); awning.position.set(cx, 3.6, z - 0.9); awning.rotation.x = -0.25;
    this.scene.add(awning);
    // вывеска
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#' + T.color.toString(16).padStart(6, '0'); g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#fff6d0'; g.font = 'bold 54px Trebuchet MS, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(T.name, 256, 50);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const signMat = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.3 });
    this.signMats.push(signMat);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.2), signMat);
    sign.position.set(cx, 4.8, z - 0.1); sign.rotation.y = Math.PI;
    this.scene.add(sign);
    this.shops.push({ type, name: T.name, color: T.color, door: { x: cx, z: blk.z0 + 1.6 } });
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

  build() {
    const scene = this.scene;
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
    const lot = new THREE.MeshLambertMaterial({ color: 0x8b8b86 });
    const grass = new THREE.MeshLambertMaterial({ color: 0x4f8f3a });
    const sand = new THREE.MeshLambertMaterial({ color: 0xe2cf9a });
    const garageMat = new THREE.MeshLambertMaterial({ color: 0x2f7d4f });

    const cityExt = HALF + ROAD / 2;
    this.plane(cityExt * 2, cityExt * 2, asphalt, 0, 0, 0);
    this.plane(LAND * 2, LAND * 2, sand, 0, -0.03, 0);
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000),
      new THREE.MeshPhongMaterial({ color: 0x2a6f9e, shininess: 80, specular: 0x88aacc }));
    ocean.rotation.x = -Math.PI / 2; ocean.position.y = -0.35;
    scene.add(ocean);
    this.oceanMat = ocean.material;

    const trees = [], lamps = [], bushRows = [];
    const dummy = new THREE.Object3D();
    const addTree = (x, z, s = 1) => { trees.push([x, z, s]); this.addCollider(x - 0.35, x + 0.35, z - 0.35, z + 0.35, 6); };
    const addLamp = (x, z) => { lamps.push([x, z]); this.addCollider(x - 0.15, x + 0.15, z - 0.15, z + 0.15, 6); };

    for (let bi = 0; bi < N; bi++) for (let bj = 0; bj < N; bj++) {
      const x0 = nodeCoord(bi) + ROAD / 2, x1 = nodeCoord(bi + 1) - ROAD / 2;
      const z0 = nodeCoord(bj) + ROAD / 2, z1 = nodeCoord(bj + 1) - ROAD / 2;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const centre = Math.max(0, 1 - Math.hypot(cx, cz) / HALF);
      let type = rng() < 0.14 ? 'park' : 'city';
      if (bi === 5 && bj === 4) type = 'park';      // центральный парк с трамплином
      if (bi === 1 && bj === 7) type = 'garage';    // покрасочная мастерская
      if (type === 'city' && centre < 0.3 && rng() < 0.65) type = 'houses';   // частный сектор на окраинах
      if (bi === 4 && bj === 4) type = 'city';
      const shopType = SHOP_BLOCKS[bi + ',' + bj];
      if (shopType) type = 'shop';
      const blk = { bi, bj, x0, x1, z0, z1, cx, cz, type };
      this.blocks.push(blk);

      this.plane(x1 - x0, z1 - z0, sidewalk, cx, 0.03, cz);
      for (const [lx, lz] of [[x0 + 1, z0 + 1], [x1 - 1, z0 + 1], [x1 - 1, z1 - 1], [x0 + 1, z1 - 1]]) addLamp(lx, lz);

      const lx0 = x0 + SIDEWALK, lx1 = x1 - SIDEWALK, lz0 = z0 + SIDEWALK, lz1 = z1 - SIDEWALK;
      const lw = lx1 - lx0, ld = lz1 - lz0;

      if (type === 'park') {
        this.plane(lw, ld, grass, cx, 0.06, cz);
        const axis = rng() < 0.5 ? 'x' : 'z';
        const hasRamp = rng() < 0.6 || (bi === 5 && bj === 4);
        if (hasRamp) this.addRamp(cx, cz, axis, rng() < 0.5 ? 1 : -1);
        const count = 10 + Math.floor(rng() * 10);
        for (let k = 0; k < count; k++) {
          const x = lx0 + 2 + rng() * (lw - 4), z = lz0 + 2 + rng() * (ld - 4);
          if (hasRamp && (axis === 'x' ? Math.abs(z - cz) < 7 : Math.abs(x - cx) < 7)) continue;
          addTree(x, z, 0.8 + rng() * 0.6);
        }
      } else if (type === 'garage') {
        this.plane(lw, ld, lot, cx, 0.06, cz);
        this.plane(12, 12, garageMat, cx, 0.08, cz);
        // П-образный навес мастерской
        const h = 6;
        this.addBuilding(cx - 8, cx + 8, lz1 - 3, lz1, h);
        this.addBuilding(cx - 8, cx - 7, cz - 6, lz1 - 3, h);
        this.addBuilding(cx + 7, cx + 8, cz - 6, lz1 - 3, h);
        this.sprayPos = { x: cx, z: cz };
      } else if (type === 'houses') {
        this.plane(lw, ld, grass, cx, 0.06, cz);
        // 3×3 участка с домами и деревьями во дворах
        const n = 3, cwid = lw / n, cdep = ld / n;
        for (let ix = 0; ix < n; ix++) for (let iz = 0; iz < n; iz++) {
          if (ix === 1 && iz === 1) { addTree(lx0 + cwid * 1.5, lz0 + cdep * 1.5, 1.2); continue; }
          const px = lx0 + ix * cwid, pz = lz0 + iz * cdep;
          const hw = 4.5 + rng() * 2, hd = 4 + rng() * 2;
          const hx = px + cwid / 2 + (rng() - 0.5) * 2, hz = pz + cdep / 2 + (rng() - 0.5) * 2;
          this.addHouse(hx - hw / 2, hx + hw / 2, hz - hd / 2, hz + hd / 2, blk);
          if (rng() < 0.5) addTree(px + 1.8, pz + 1.8, 0.8);
        }
        bushRows.push(blk);
      } else {
        this.plane(lw, ld, lot, cx, 0.06, cz);
        if (type === 'shop') {
          this.addShop(blk, shopType);
          // за магазином — пара зданий
          this.addBuilding(lx0, cx - 1.5, lz0 + 16, lz1, 10 + rng() * 25);
          this.addBuilding(cx + 1.5, lx1, lz0 + 16, lz1, 10 + rng() * 25);
          bushRows.push(blk);
          continue;
        }
        const s = rng();
        const nx = s < 0.25 ? 1 : 2, nz = s < 0.5 ? 1 : 2;
        const gap = 3;
        for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
          let sx0 = lx0 + ix * lw / nx + (ix > 0 ? gap / 2 : 0);
          let sx1 = lx0 + (ix + 1) * lw / nx - (ix < nx - 1 ? gap / 2 : 0);
          let sz0 = lz0 + iz * ld / nz + (iz > 0 ? gap / 2 : 0);
          let sz1 = lz0 + (iz + 1) * ld / nz - (iz < nz - 1 ? gap / 2 : 0);
          sx0 += rng() * 2; sx1 -= rng() * 2; sz0 += rng() * 2; sz1 -= rng() * 2;
          const h = 8 + rng() * 16 + centre * centre * rng() * 80;
          this.addBuilding(sx0, sx1, sz0, sz1, h);
          if (h < 26 && rng() < 0.35) this.addDoor(sx0, sx1, sz0, sz1, blk, 'flat');
        }
        // деревья на тротуаре
        if (rng() < 0.5) { addTree(cx, z0 + 0.9, 0.7); addTree(cx, z1 - 0.9, 0.7); }
        if (rng() < 0.5) { addTree(x0 + 0.9, cz, 0.7); addTree(x1 - 0.9, cz, 0.7); }
        bushRows.push(blk);
      }
    }

    // кусты вдоль внутреннего края тротуара (без коллизий)
    const bushes = [];
    for (const b of bushRows) {
      const inset = SIDEWALK - 0.7;
      const sides = [
        [b.x0 + 6, b.x1 - 6, (t) => [t, b.z0 + inset], b.cx],
        [b.x0 + 6, b.x1 - 6, (t) => [t, b.z1 - inset], b.cx],
        [b.z0 + 6, b.z1 - 6, (t) => [b.x0 + inset, t], b.cz],
        [b.z0 + 6, b.z1 - 6, (t) => [b.x1 - inset, t], b.cz],
      ];
      sides.forEach(([a0, a1, at, mid], si) => {
        for (let t = a0; t <= a1; t += 3.2) {
          if (Math.abs(t - mid) < 2.5) continue;                         // место дерева / прохода
          if (b.type === 'shop' && si === 0 && Math.abs(t - mid) < 11) continue;   // витрина магазина
          if (rng() < 0.25) continue;
          const [bx, bz] = at(t);
          if (this.doors.some((d) => Math.hypot(d.x - bx, d.z - bz) < 2.6)) continue;   // не загораживаем входы
          bushes.push([bx, bz, 0.8 + rng() * 0.5]);
        }
      });
    }
    const bushMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.8, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), bushes.length);
    const greens = [0x3f8a3a, 0x2f7a35, 0x4f9a40, 0x3a7a4a], flowers = [0xd05a8a, 0xe8c84a, 0xf2f2f2];
    const col = new THREE.Color();
    bushes.forEach(([x, z, s], k) => {
      dummy.position.set(x, 0.45 * s, z); dummy.rotation.set(0, rng() * 6, 0); dummy.scale.set(s * 1.1, s * 0.75, s * 1.1);
      dummy.updateMatrix(); bushMesh.setMatrixAt(k, dummy.matrix);
      bushMesh.setColorAt(k, col.setHex(rng() < 0.15 ? flowers[Math.floor(rng() * 3)] : greens[Math.floor(rng() * 4)]));
    });
    bushMesh.castShadow = true;
    scene.add(bushMesh);

    // пальмы на пляже
    for (let k = 0; k < 90; k++) {
      const side = Math.floor(rng() * 4);
      const t = (rng() * 2 - 1) * (LAND - 6);
      const o = HALF + ROAD / 2 + 4 + rng() * 9;
      const [x, z] = side === 0 ? [t, o] : side === 1 ? [t, -o] : side === 2 ? [o, t] : [-o, t];
      addTree(x, z, 1.1);
    }

    // разметка
    const dashes = [];

    for (let i = 0; i <= N; i++) {
      const c = nodeCoord(i);
      for (let s = -HALF; s < HALF; s += 6) {
        const m = s + 1.5;
        const nearest = Math.round((m + HALF) / BLOCK) * BLOCK - HALF;
        if (Math.abs(m - nearest) < ROAD / 2 + 1.5) continue;
        dashes.push([c, m, 0], [m, c, Math.PI / 2]);
      }
    }
    const dashMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.25, 3),
      new THREE.MeshLambertMaterial({ color: 0xf2d24b }), dashes.length);
    dashes.forEach(([x, z, r], k) => {
      dummy.position.set(x, 0.02, z); dummy.rotation.set(-Math.PI / 2, 0, r); dummy.updateMatrix();
      dashMesh.setMatrixAt(k, dummy.matrix);
    });
    scene.add(dashMesh);

    // деревья (инстансинг)
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 3.2, 6),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 0),
      new THREE.MeshLambertMaterial({ color: 0x3f7f35, flatShading: true }), trees.length);
    trees.forEach(([x, z, s], k) => {
      dummy.rotation.set(0, rng() * 6, 0);
      dummy.scale.set(s, s, s);
      dummy.position.set(x, 1.6 * s, z); dummy.updateMatrix(); trunk.setMatrixAt(k, dummy.matrix);
      dummy.position.set(x, 3.9 * s, z); dummy.updateMatrix(); crown.setMatrixAt(k, dummy.matrix);
    });
    trunk.castShadow = crown.castShadow = true;
    scene.add(trunk, crown);

    // фонари
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
  }

  // Случайная точка на тротуаре.
  randomSidewalk() {
    const b = this.blocks[Math.floor(Math.random() * this.blocks.length)];
    const s = SIDEWALK / 2, side = Math.floor(Math.random() * 4), t = 0.15 + Math.random() * 0.7;
    if (side === 0) return { x: b.x0 + s, z: b.z0 + (b.z1 - b.z0) * t };
    if (side === 1) return { x: b.x1 - s, z: b.z0 + (b.z1 - b.z0) * t };
    if (side === 2) return { x: b.x0 + (b.x1 - b.x0) * t, z: b.z0 + s };
    return { x: b.x0 + (b.x1 - b.x0) * t, z: b.z1 - s };
  }
}
