import * as THREE from 'three';

// Следы шин на асфальте: кольцевой буфер тёмных полосок под задними колёсами.
const MAX = 900, STEP = 0.45;

export class Skids {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(0.28, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.i = 0;
    this.dummy = new THREE.Object3D();
    this.last = new WeakMap();   // машина → позиции последних следов колёс
  }

  mark(x0, z0, x1, z1) {
    const d = this.dummy, len = Math.hypot(x1 - x0, z1 - z0);
    d.position.set((x0 + x1) / 2, 0.05, (z0 + z1) / 2);
    d.rotation.set(0, Math.atan2(x1 - x0, z1 - z0), 0);
    d.scale.set(1, 1, len);
    d.updateMatrix();
    this.mesh.setMatrixAt(this.i, d.matrix);
    this.i = (this.i + 1) % MAX;
    this.mesh.count = Math.min(MAX, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(cars) {
    for (const c of cars) {
      const sliding = c.skid > 0.45 && !c.airborne && Math.hypot(c.vel.x, c.vel.z) > 3 && c.pos.y < 0.1;
      if (!sliding) { this.last.delete(c); continue; }
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading), lx = fz, lz = -fx;
      const rz = -(c.T.l / 2 - 0.9), wx = c.T.w / 2 - 0.15;
      const wheels = [-1, 1].map((s) => ({ x: c.pos.x + fx * rz + lx * wx * s, z: c.pos.z + fz * rz + lz * wx * s }));
      const prev = this.last.get(c);
      if (!prev) { this.last.set(c, wheels); continue; }
      if (Math.hypot(wheels[0].x - prev[0].x, wheels[0].z - prev[0].z) < STEP) continue;
      for (let k = 0; k < 2; k++) this.mark(prev[k].x, prev[k].z, wheels[k].x, wheels[k].z);
      this.last.set(c, wheels);
    }
  }
}
