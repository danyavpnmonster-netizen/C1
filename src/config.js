// Общие константы и утилиты города Sunrise Bay.

export const N = 10;          // кварталов по каждой оси
export const BLOCK = 80;      // шаг сетки дорог (м)
export const ROAD = 16;       // ширина дороги
export const LANE = 4;        // смещение полосы от осевой
export const SIDEWALK = 4;    // ширина тротуара
export const SIZE = N * BLOCK;
export const HALF = 395;          // полуразмер города (дорожная сеть roads.js укладывается в ±395)
export const LAND = HALF + ROAD / 2 + 16;   // край суши (дальше — пляж и океан)
export const BOUND = LAND - 2;              // граница, за которую нельзя уехать

export const nodeCoord = (i) => i * BLOCK - HALF;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rnd = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

// Детерминированный генератор, чтобы город был одинаковым при каждом запуске.
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const blockIndex = (v) => Math.floor((v + HALF) / BLOCK);
export const nearestNode = (p) => ({
  i: clamp(Math.round((p.x + HALF) / BLOCK), 0, N),
  j: clamp(Math.round((p.z + HALF) / BLOCK), 0, N),
});
