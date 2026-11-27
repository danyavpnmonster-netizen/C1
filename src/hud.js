import { HALF, ROAD, LAND, SIDEWALK } from './config.js';

const $ = (id) => document.getElementById(id);
const S = 0.6;                 // пикселей мини-карты на метр
const EXT = LAND + 60;         // половина размера подложки в метрах

export class Hud {
  constructor(game) {
    this.g = game;
    this.el = {
      money: $('money'), stars: $('stars'), hp: $('hpfill'), armor: $('hpbar'), clock: $('clock'),
      mission: $('mission'), timer: $('timer'), msg: $('msg'), big: $('big'), speed: $('speed'),
      arrow: $('arrow'), arrowWrap: $('arrowWrap'), dist: $('dist'), car: $('carname'), hit: $('hitflash'),
      bust: $('bust'),
    };
    this.map = $('minimap');
    this.ctx = this.map.getContext('2d');
    this.base = this.renderBase();
    this.msgT = 0; this.bigT = 0; this.moneyShown = 0; this.hitT = 0;
  }

  toBase(x, z) { return [(EXT - x) * S, (EXT - z) * S]; }

  renderBase() {
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(EXT * 2 * S);
    const x = c.getContext('2d');
    x.fillStyle = '#2a5f86'; x.fillRect(0, 0, c.width, c.height);
    const rect = (x0, z0, x1, z1, col) => {
      const [u0, v0] = this.toBase(x1, z1), [u1, v1] = this.toBase(x0, z0);
      x.fillStyle = col; x.fillRect(u0, v0, u1 - u0, v1 - v0);
    };
    rect(-LAND, -LAND, LAND, LAND, '#d9c58f');
    const ce = HALF + ROAD / 2;
    rect(-ce, -ce, ce, ce, '#5b5f66');
    for (const b of this.g.city.blocks) {
      rect(b.x0, b.z0, b.x1, b.z1, '#9b9b96');
      const col = b.type === 'park' ? '#5c9a46' : b.type === 'garage' ? '#3a9a63' : '#2f3238';
      rect(b.x0 + SIDEWALK, b.z0 + SIDEWALK, b.x1 - SIDEWALK, b.z1 - SIDEWALK, col);
    }
    return c;
  }

  message(text, t = 3) { this.el.msg.textContent = text; this.msgT = t; this.el.msg.style.opacity = 1; }
  big(text, t = 3) { this.el.big.textContent = text; this.bigT = t; this.el.big.style.opacity = 1; }
  hitFlash() { this.hitT = 0.25; }

  update(dt) {
    const g = this.g, p = g.player, el = this.el;
    // деньги
    this.moneyShown += (p.money - this.moneyShown) * Math.min(1, dt * 6);
    if (Math.abs(p.money - this.moneyShown) < 1) this.moneyShown = p.money;
    el.money.textContent = '$' + String(Math.round(this.moneyShown)).padStart(8, '0');
    // звёзды
    const flashing = g.wanted > 0 && g.police.lostT > 0 && Math.floor(g.time * 4) % 2 === 0;
    let s = '';
    for (let i = 1; i <= 5; i++) s += `<span class="${i <= g.wanted ? (flashing ? 'st dim' : 'st on') : 'st'}">★</span>`;
    if (el.stars._v !== s) { el.stars.innerHTML = s; el.stars._v = s; }
    el.hp.style.width = p.health + '%';
    const h = Math.floor(g.hour) % 24, m = Math.floor((g.hour % 1) * 60);
    el.clock.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    // машина
    if (p.car) {
      el.speed.style.display = 'block';
      el.speed.innerHTML = `${Math.round(Math.abs(p.car.speed) * 3.6)}<small> км/ч</small><div class="carhp"><i style="width:${p.car.health}%"></i></div>`;
      el.car.textContent = p.car.T.name;
    } else { el.speed.style.display = 'none'; el.car.textContent = ''; }
    // миссия
    const ms = g.missions.active;
    if (ms) {
      el.mission.style.display = 'block';
      el.mission.textContent = ms.title + ': ' + ms.stages[ms.idx].text;
      const t = Math.ceil(ms.time);
      el.timer.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
      el.timer.style.color = t < 10 ? '#ff5050' : '#fff';
    } else { el.mission.style.display = 'none'; el.timer.textContent = ''; }
    // стрелка к цели
    const T = g.missions.target, P = g.playerPos();
    if (T) {
      const a = Math.atan2(T.x - P.x, T.z - P.z) - g.camYaw;
      el.arrowWrap.style.display = 'flex';
      el.arrow.style.transform = `rotate(${-a}rad)`;
      el.dist.textContent = Math.round(Math.hypot(T.x - P.x, T.z - P.z)) + ' м';
    } else el.arrowWrap.style.display = 'none';
    // сообщения
    this.msgT -= dt; if (this.msgT < 0) el.msg.style.opacity = 0;
    this.bigT -= dt; if (this.bigT < 0) el.big.style.opacity = 0;
    this.hitT -= dt; el.hit.style.opacity = this.hitT > 0 ? 0.35 : 0;
    el.bust.style.width = Math.min(100, g.police.bustT / 2.2 * 100) + '%';
    el.bust.parentElement.style.display = g.police.bustT > 0.05 ? 'block' : 'none';
    this.drawMap();
  }

  drawMap() {
    const g = this.g, c = this.ctx, W = this.map.width, R = W / 2, P = g.playerPos();
    c.clearRect(0, 0, W, W);
    c.save();
    c.beginPath(); c.arc(R, R, R - 2, 0, Math.PI * 2); c.clip();
    c.translate(R, R);
    c.rotate(g.camYaw);
    const [pu, pv] = this.toBase(P.x, P.z);
    c.translate(-pu, -pv);
    c.drawImage(this.base, 0, 0);
    const dot = (x, z, col, r = 4) => {
      const [u, v] = this.toBase(x, z);
      c.fillStyle = col; c.beginPath(); c.arc(u, v, r, 0, Math.PI * 2); c.fill();
    };
    const label = (x, z, col, txt) => {
      const [u, v] = this.toBase(x, z);
      c.save(); c.translate(u, v); c.rotate(-g.camYaw);
      c.fillStyle = col; c.fillRect(-7, -7, 14, 14);
      c.fillStyle = '#000'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(txt, 0, 1); c.restore();
    };
    const sp = g.city.sprayPos; if (sp) label(sp.x, sp.z, '#3dff8a', '$');
    label(g.hospital.x, g.hospital.z, '#ff6b6b', 'H');
    label(g.station.x, g.station.z, '#7aa7ff', 'П');
    if (!g.missions.active) for (const gv of g.missions.givers) if (gv.cd <= 0) {
      label(gv.pos.x, gv.pos.z, '#' + gv.color.toString(16).padStart(6, '0'), gv.name[0]);
    }
    const flash = Math.floor(g.time * 6) % 2;
    for (const car of g.cars) if (car.role === 'police' && !car.wrecked) dot(car.pos.x, car.pos.z, flash ? '#ff3030' : '#3060ff', 4);
    c.restore();
    // цель миссии (прижимается к краю)
    const T = g.missions.target;
    if (T) {
      let dx = -(T.x - P.x) * S, dz = -(T.z - P.z) * S;
      const cs = Math.cos(g.camYaw), sn = Math.sin(g.camYaw);
      let u = dx * cs - dz * sn, v = dx * sn + dz * cs;
      const l = Math.hypot(u, v), max = R - 9;
      if (l > max) { u = u / l * max; v = v / l * max; }
      c.fillStyle = '#ffdd33'; c.strokeStyle = '#000'; c.lineWidth = 2;
      c.beginPath(); c.arc(R + u, R + v, 6, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    // игрок
    const heading = g.player.car ? g.player.car.heading : g.player.facing;
    c.save(); c.translate(R, R); c.rotate(-(heading - g.camYaw));
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 6); c.lineTo(0, 3); c.lineTo(-6, 6); c.closePath(); c.fill(); c.stroke();
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,0.8)'; c.lineWidth = 4;
    c.beginPath(); c.arc(R, R, R - 2, 0, Math.PI * 2); c.stroke();
  }
}
