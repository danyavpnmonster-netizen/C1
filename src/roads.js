import { ROAD, SIDEWALK, clamp, mulberry32 } from './config.js';

// Дорожная сеть города: перекрёстки (nodes) и дороги между ними (edges).
// Сетка перекрёстков сдвинута случайно, часть дорог убрана, часть изогнута
// плавными кривыми Безье, остальные прямые. Каждая дорога хранится ломаной
// с шагом ~2 м и накопленной длиной — по ней едут машины и идут пешеходы.

export const GRID = 8;            // перекрёстков по стороне
export const SPACING = 110;       // средний шаг между ними
export const NODE_R = ROAD / 2 + 2;  // радиус площадки перекрёстка
export const WALK_OFF = ROAD / 2 + SIDEWALK / 2;   // смещение тротуара от осевой
const CELL = 40;

export class Roads {
  constructor(seed = 77) {
    this.rng = mulberry32(seed);
    this.nodes = [];
    this.edges = [];
    this.generate();
    this.index();
  }

  // ---------- генерация ----------
  generate() {
    const r = this.rng, G = GRID, half = (G - 1) * SPACING / 2;
    const id = (i, j) => i * G + j;
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const outer = i === 0 || j === 0 || i === G - 1 || j === G - 1;
      const jx = outer ? (i === 0 || i === G - 1 ? 0 : 1) : 1, jz = outer ? (j === 0 || j === G - 1 ? 0 : 1) : 1;
      const amp = outer ? 10 : 24;
      this.nodes.push({
        id: id(i, j), i, j, edges: [],
        x: i * SPACING - half + (r() * 2 - 1) * amp * jx,
        z: j * SPACING - half + (r() * 2 - 1) * amp * jz,
      });
    }
    const pairs = [];
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      if (i < G - 1) pairs.push([id(i, j), id(i + 1, j), j === 0 || j === G - 1]);
      if (j < G - 1) pairs.push([id(i, j), id(i, j + 1), i === 0 || i === G - 1]);
    }
    // убираем часть внутренних дорог, не разрывая сеть и не оставляя тупиков
    const alive = pairs.map(() => true);
    const degree = (n) => pairs.reduce((s, p, k) => s + (alive[k] && (p[0] === n || p[1] === n) ? 1 : 0), 0);
    const connected = () => {
      const seen = new Set([0]), st = [0];
      while (st.length) {
        const n = st.pop();
        pairs.forEach((p, k) => {
          if (!alive[k]) return;
          const o = p[0] === n ? p[1] : p[1] === n ? p[0] : -1;
          if (o >= 0 && !seen.has(o)) { seen.add(o); st.push(o); }
        });
      }
      return seen.size === this.nodes.length;
    };
    const order = pairs.map((_, k) => k).sort(() => r() - 0.5);
    for (const k of order) {
      const [a, b, outer] = pairs[k];
      if (outer || r() > 0.2) continue;
      if (degree(a) <= 2 || degree(b) <= 2) continue;
      alive[k] = false;
      if (!connected()) alive[k] = true;
    }
    pairs.forEach(([a, b, outer], k) => {
      if (!alive[k]) return;
      // изгиб: у прибрежного кольца мягкий, внутри — у половины дорог
      let bend = 0;
      if (outer) bend = (r() * 2 - 1) * 14;
      else if (r() < 0.5) bend = (r() < 0.5 ? -1 : 1) * (14 + r() * 22);
      this.addEdge(a, b, bend, outer);
    });
  }

  addEdge(a, b, bend, outer = false) {
    const A = this.nodes[a], B = this.nodes[b];
    const dx = B.x - A.x, dz = B.z - A.z, L0 = Math.hypot(dx, dz);
    const mx = (A.x + B.x) / 2 - dz / L0 * bend, mz = (A.z + B.z) / 2 + dx / L0 * bend;
    const n = Math.max(2, Math.ceil(L0 / 2));
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n, u = 1 - t;   // квадратичная кривая Безье
      pts.push({ x: u * u * A.x + 2 * u * t * mx + t * t * B.x, z: u * u * A.z + 2 * u * t * mz + t * t * B.z });
    }
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
    const e = { id: this.edges.length, a, b, pts, cum, L: cum[cum.length - 1], bend, outer };
    this.edges.push(e);
    A.edges.push(e.id); B.edges.push(e.id);
    return e;
  }

  // пространственный индекс отрезков для быстрых запросов «ближайшая дорога»
  index() {
    this.cells = new Map();
    for (const e of this.edges) for (let k = 0; k < e.pts.length - 1; k++) {
      const p = e.pts[k], q = e.pts[k + 1];
      const x0 = Math.floor(Math.min(p.x, q.x) / CELL), x1 = Math.floor(Math.max(p.x, q.x) / CELL);
      const z0 = Math.floor(Math.min(p.z, q.z) / CELL), z1 = Math.floor(Math.max(p.z, q.z) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const key = cx + ',' + cz;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push([e.id, k]);
      }
    }
  }

  // ---------- запросы ----------
  // Точка на дороге e на расстоянии s от начала (узла a): позиция и единичная касательная.
  sample(eid, s) {
    const e = this.edges[eid];
    s = clamp(s, 0, e.L);
    let lo = 0, hi = e.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.cum[m] <= s) lo = m; else hi = m; }
    const p = e.pts[lo], q = e.pts[hi], seg = e.cum[hi] - e.cum[lo] || 1, t = (s - e.cum[lo]) / seg;
    const tx = (q.x - p.x) / seg, tz = (q.z - p.z) / seg;
    return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, tx, tz };
  }

  // Ближайшая точка дорожной сети: дорога, позиция s, расстояние, сторона (+1 справа от a→b).
  nearest(x, z, maxR = 80) {
    let best = null, bd = maxR * maxR;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), rr = Math.ceil(maxR / CELL);
    for (let i = -rr; i <= rr; i++) for (let j = -rr; j <= rr; j++) {
      const list = this.cells.get((cx + i) + ',' + (cz + j));
      if (!list) continue;
      for (const [eid, k] of list) {
        const e = this.edges[eid], p = e.pts[k], q = e.pts[k + 1];
        const vx = q.x - p.x, vz = q.z - p.z, l2 = vx * vx + vz * vz || 1;
        const t = clamp(((x - p.x) * vx + (z - p.z) * vz) / l2, 0, 1);
        const px = p.x + vx * t, pz = p.z + vz * t, d2 = (x - px) ** 2 + (z - pz) ** 2;
        if (d2 < bd) {
          bd = d2;
          const l = Math.sqrt(l2);
          // справа от направления a→b: (-tz, tx)
          const side = ((x - px) * (-vz / l) + (z - pz) * (vx / l)) >= 0 ? 1 : -1;
          best = { edge: eid, s: e.cum[k] + t * l, dist: Math.sqrt(d2), side, x: px, z: pz, tx: vx / l, tz: vz / l };
        }
      }
    }
    return best;
  }

  distToRoad(x, z, maxR = 60) {
    const n = this.nearest(x, z, maxR);
    return n ? n.dist : Infinity;
  }

  // Проекция точки на дорогу eid рядом с s0 (для движения машин и пешеходов).
  project(eid, x, z, s0, win = 12) {
    const e = this.edges[eid];
    let best = s0, bd = Infinity;
    let k0 = 0;
    while (k0 < e.cum.length - 1 && e.cum[k0 + 1] < s0 - win) k0++;
    for (let k = k0; k < e.pts.length - 1 && e.cum[k] <= s0 + win; k++) {
      const p = e.pts[k], q = e.pts[k + 1];
      const vx = q.x - p.x, vz = q.z - p.z, l2 = vx * vx + vz * vz || 1;
      const t = clamp(((x - p.x) * vx + (z - p.z) * vz) / l2, 0, 1);
      const d2 = (x - p.x - vx * t) ** 2 + (z - p.z - vz * t) ** 2;
      if (d2 < bd) { bd = d2; best = e.cum[k] + t * Math.sqrt(l2); }
    }
    return best;
  }

  nearestNode(x, z) {
    let best = this.nodes[0], bd = Infinity;
    for (const n of this.nodes) {
      if (!n.edges.length) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  other(eid, nid) { const e = this.edges[eid]; return e.a === nid ? e.b : e.a; }

  // Кратчайшие расстояния по дорогам от всех перекрёстков до узла target (Дейкстра).
  distancesTo(target) {
    const dist = new Array(this.nodes.length).fill(Infinity), done = new Array(this.nodes.length).fill(false);
    dist[target] = 0;
    for (;;) {
      let u = -1, bd = Infinity;
      for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = true;
      for (const eid of this.nodes[u].edges) {
        const v = this.other(eid, u), nd = dist[u] + this.edges[eid].L;
        if (nd < dist[v]) dist[v] = nd;
      }
    }
    return dist;
  }

  // Точка на тротуаре: дорога, позиция, сторона (+1 справа от a→b).
  sidewalkPoint(eid, s, side, off = WALK_OFF) {
    const p = this.sample(eid, s);
    return { x: p.x - p.tz * off * side, z: p.z + p.tx * off * side, tx: p.tx, tz: p.tz };
  }

  randomEdge(rng = Math.random) { return this.edges[Math.floor(rng() * this.edges.length)]; }
}
