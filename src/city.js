import * as THREE from 'three';
import { N, BLOCK, ROAD, SIDEWALK, HALF, LAND, nodeCoord, clamp, mulberry32, blockIndex } from './config.js';

const rng = mulberry32(20261127);

// Текстура фасада: 8×8 окон. Отдельная карта свечения — горящие окна ночью.
function windowTextures() {
  const S = 256, cols = 8, rows = 8, cw = S / cols, ch = S / rows;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const a = mk(), e = mk();
  const ga = a.getContext('2d'), ge = e.getContext('2d');
  ga.fillStyle = '#ffffff'; ga.fillRect(0, 0, S, S);
  ge.fillStyle = '#000000'; ge.fillRect(0, 0, S, S);
  for (let y = 0; y < rows; y++) {
    ga.fillStyle = 'rgba(0,0,0,0.10)';
    ga.fillRect(0, y * ch + ch - 3, S, 3);
    for (let x = 0; x < cols; x++) {
      const wx = x * cw + cw * 0.18, wy = y * ch + ch * 0.2, ww = cw * 0.64, wh = ch * 0.55;
      ga.fillStyle = '#3d4b5c'; ga.fillRect(wx, wy, ww, wh);
      ga.fillStyle = 'rgba(255,255,255,0.2)'; ga.fillRect(wx, wy, ww * 0.35, wh);
      if (rng() < 0.38) {
        ge.fillStyle = rng() < 0.8 ? '#ffd27a' : '#bfe3ff';
        ge.fillRect(wx, wy, ww, wh);
      }
    }
  }
  const ta = new THREE.CanvasTexture(a), te = new THREE.CanvasTexture(e);
  for (const t of [ta, te]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
  }
  return { ta, te };
}

const WALL_COLORS = [0xe8d9c0, 0xc9b79c, 0x9fb3c8, 0xd4a58a, 0xb8c4b0, 0xe6e6e6, 0xa89f91, 0xf0c9a0, 0x8fa5b5];

export class City {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.grid = new Map();
    this.ramps = [];
    this.blocks = [];
    this.wallMats = [];
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

  addBuilding(x0, x1, z0, z1, h) {
    const w = x1 - x0, d = z1 - z0;
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const fw = f < 2 ? d : w;
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, uv.getX(i) * fw / 24, uv.getY(i) * h / 28);
      }
    }
    const wall = this.wallMats[Math.floor(rng() * this.wallMats.length)];
    const m = new THREE.Mesh(geo, [wall, wall, this.roofMat, this.roofMat, wall, wall]);
    m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    this.addCollider(x0, x1, z0, z1, h);
    // антенна / бак на крыше
    if (h > 30 && rng() < 0.5) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 8), this.roofMat);
      ant.position.set((x0 + x1) / 2, h + 4, (z0 + z1) / 2);
      this.scene.add(ant);
    }
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
    const { ta, te } = windowTextures();
    for (const c of WALL_COLORS) {
      this.wallMats.push(new THREE.MeshLambertMaterial({
        color: c, map: ta, emissiveMap: te, emissive: 0xffffff, emissiveIntensity: 0,
      }));
    }
    this.roofMat = new THREE.MeshLambertMaterial({ color: 0x55585e });
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

    const trees = [], lamps = [];
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
      if (bi === 4 && bj === 4) type = 'city';
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
      } else {
        this.plane(lw, ld, lot, cx, 0.06, cz);
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
        }
        // деревья на тротуаре
        if (rng() < 0.5) { addTree(cx, z0 + 0.9, 0.7); addTree(cx, z1 - 0.9, 0.7); }
        if (rng() < 0.5) { addTree(x0 + 0.9, cz, 0.7); addTree(x1 - 0.9, cz, 0.7); }
      }
    }

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
    const dummy = new THREE.Object3D();
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
