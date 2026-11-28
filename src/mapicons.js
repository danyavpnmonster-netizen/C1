// Значки мест на карте: пиктограммы на цветной плашке.
// Рисуются в единичных координатах (−1…1), масштаб задаёт размер плашки.

export const ICONS = {
  market: { bg: '#2e9e5b', name: 'Продукты' },
  guns: { bg: '#a3312f', name: 'Оружейная' },
  clothes: { bg: '#7a3fa0', name: 'Одежда' },
  hospital: { bg: '#e23d3d', name: 'Больница' },
  police: { bg: '#2a52be', name: 'Полиция' },
  spray: { bg: '#1f8f5f', name: 'Покраска' },
  courier: { bg: '#c98a2b', name: 'Курьер' },
  taxi: { bg: '#f2c200', name: 'Такси' },
  race: { bg: '#d6335a', name: 'Гонка' },
  steal: { bg: '#8a4fd8', name: 'Угон' },
};

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

// маленькая машина (вид сбоку), ширина ~1.4
function car(c, col, x = 0, y = 0.1, s = 1) {
  c.save(); c.translate(x, y); c.scale(s, s);
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(-0.72, 0.2); c.lineTo(-0.72, -0.05); c.lineTo(-0.45, -0.1); c.lineTo(-0.25, -0.38);
  c.lineTo(0.28, -0.38); c.lineTo(0.48, -0.1); c.lineTo(0.72, -0.05); c.lineTo(0.72, 0.2); c.closePath(); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.fillRect(-0.18, -0.32, 0.18, 0.2); c.fillRect(0.04, -0.32, 0.2, 0.2);
  c.fillStyle = '#1a1a1a';
  c.beginPath(); c.arc(-0.42, 0.22, 0.15, 0, 7); c.arc(0.42, 0.22, 0.15, 0, 7); c.fill();
  c.restore();
}

const DRAW = {
  market(c) {     // тележка
    c.strokeStyle = '#fff'; c.lineWidth = 0.12; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-0.7, -0.5); c.lineTo(-0.48, -0.5); c.lineTo(-0.3, 0.25); c.lineTo(0.5, 0.25); c.stroke();
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(-0.42, -0.3); c.lineTo(0.65, -0.3); c.lineTo(0.52, 0.12); c.lineTo(-0.32, 0.12); c.closePath(); c.fill();
    c.beginPath(); c.arc(-0.2, 0.5, 0.12, 0, 7); c.arc(0.4, 0.5, 0.12, 0, 7); c.fill();
  },
  guns(c) {       // пистолет
    c.fillStyle = '#fff';
    c.fillRect(-0.62, -0.32, 1.2, 0.26);
    c.fillRect(0.46, -0.4, 0.1, 0.1);
    c.beginPath(); c.moveTo(-0.62, -0.06); c.lineTo(-0.2, -0.06); c.lineTo(-0.3, 0.6); c.lineTo(-0.62, 0.6); c.closePath(); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 0.08;
    c.beginPath(); c.arc(-0.05, 0.02, 0.16, 0, Math.PI); c.stroke();
  },
  clothes(c) {    // футболка
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(-0.25, -0.6); c.quadraticCurveTo(0, -0.42, 0.25, -0.6);
    c.lineTo(0.72, -0.35); c.lineTo(0.52, 0.0); c.lineTo(0.38, -0.08); c.lineTo(0.38, 0.62);
    c.lineTo(-0.38, 0.62); c.lineTo(-0.38, -0.08); c.lineTo(-0.52, 0.0); c.lineTo(-0.72, -0.35); c.closePath(); c.fill();
  },
  hospital(c) {   // крест
    c.fillStyle = '#fff';
    c.fillRect(-0.18, -0.6, 0.36, 1.2); c.fillRect(-0.6, -0.18, 1.2, 0.36);
  },
  police(c) {     // щит со звездой
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(0, -0.7); c.lineTo(0.58, -0.48); c.quadraticCurveTo(0.56, 0.35, 0, 0.72);
    c.quadraticCurveTo(-0.56, 0.35, -0.58, -0.48); c.closePath(); c.fill();
    c.fillStyle = ICONS.police.bg;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.14 : 0.33;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r + 0.02);
    }
    c.closePath(); c.fill();
  },
  spray(c) {      // баллончик и брызги
    c.fillStyle = '#fff';
    c.fillRect(-0.45, -0.25, 0.42, 0.85);
    c.fillRect(-0.36, -0.42, 0.24, 0.17);
    c.fillRect(-0.3, -0.55, 0.12, 0.13);
    for (const [x, y, r] of [[0.15, -0.5, 0.07], [0.33, -0.38, 0.08], [0.5, -0.56, 0.06], [0.42, -0.15, 0.07], [0.6, -0.3, 0.05], [0.25, -0.2, 0.05]]) {
      c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
  },
  courier(c) {    // коробка с лентой
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(-0.6, -0.2); c.lineTo(0, -0.5); c.lineTo(0.6, -0.2); c.lineTo(0.6, 0.45); c.lineTo(0, 0.72); c.lineTo(-0.6, 0.45); c.closePath(); c.fill();
    c.strokeStyle = ICONS.courier.bg; c.lineWidth = 0.08;
    c.beginPath(); c.moveTo(-0.6, -0.2); c.lineTo(0, 0.08); c.lineTo(0.6, -0.2); c.moveTo(0, 0.08); c.lineTo(0, 0.72); c.stroke();
    c.beginPath(); c.moveTo(-0.3, -0.35); c.lineTo(0.3, -0.06); c.stroke();
  },
  taxi(c) {       // такси с шашечкой
    car(c, '#1a1a1a', 0, 0.22, 1);
    c.fillStyle = '#1a1a1a'; c.fillRect(-0.22, -0.62, 0.44, 0.2);
    c.fillStyle = '#fff'; c.fillRect(-0.18, -0.58, 0.11, 0.12); c.fillRect(0.07, -0.58, 0.11, 0.12);
  },
  race(c) {       // клетчатый флаг
    c.fillStyle = '#fff'; c.fillRect(-0.55, -0.62, 0.09, 1.3);
    const s = 0.2;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
      c.fillStyle = (i + j) % 2 ? '#1a1a1a' : '#fff';
      c.fillRect(-0.46 + i * s, -0.6 + j * s, s, s);
    }
  },
  steal(c) {      // машина и ключ
    car(c, '#fff', -0.05, 0.3, 0.9);
    c.strokeStyle = '#fff'; c.lineWidth = 0.1; c.lineCap = 'round';
    c.beginPath(); c.arc(0.38, -0.45, 0.15, 0, 7); c.stroke();
    c.beginPath(); c.moveTo(0.27, -0.34); c.lineTo(0.0, -0.07); c.moveTo(0.1, -0.17); c.lineTo(0.18, -0.09); c.stroke();
  },
};

// Плашка со значком: центр (x, y), полуразмер r.
export function drawIcon(c, kind, x, y, r) {
  const I = ICONS[kind];
  if (!I) return;
  c.save();
  c.translate(x, y);
  c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = r * 0.5;
  roundRect(c, -r, -r, r * 2, r * 2, r * 0.35);
  c.fillStyle = I.bg; c.fill();
  c.shadowBlur = 0;
  c.lineWidth = Math.max(1, r * 0.12); c.strokeStyle = 'rgba(255,255,255,0.9)'; c.stroke();
  c.scale(r * 0.78, r * 0.78);
  DRAW[kind](c);
  c.restore();
}
