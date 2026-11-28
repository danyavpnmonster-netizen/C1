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
      bust: $('bust'), weapon: $('weapon'), armor: $('armorfill'),
    };
    this.bigMap = $('bigmap'); this.bigCtx = this.bigMap.getContext('2d'); this.mapOpen = false;
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
    rect(-LAND + 12, -LAND + 12, LAND - 12, LAND - 12, '#6f8f58');
    const at = (px, pz) => this.toBase(px, pz);
    const circle = (cx, cz, r, col) => { const [u, v] = at(cx, cz); x.fillStyle = col; x.beginPath(); x.arc(u, v, r * S, 0, Math.PI * 2); x.fill(); };
    circle(0, 0, HALF * 0.62, '#7f7f7a');
    const gz = this.g.city.gangZone;
    circle(gz.x, gz.z, gz.r, 'rgba(60,150,70,0.45)');
    for (const pk of this.g.city.parks) circle(pk.x, pk.z, pk.r, '#5c9a46');
    // здания
    x.fillStyle = '#34373d';
    for (const f of this.g.city.footprints) {
      x.beginPath();
      f.forEach(([px, pz], i) => { const [u, v] = at(px, pz); if (i) x.lineTo(u, v); else x.moveTo(u, v); });
      x.closePath(); x.fill();
    }
    // дороги: сначала тротуары (шире), потом асфальт
    const R = this.g.city.roads;
    const stroke = (w, col) => {
      x.strokeStyle = col; x.lineWidth = w * S; x.lineCap = 'round'; x.lineJoin = 'round';
      for (const e of R.edges) {
        x.beginPath();
        e.pts.forEach((pt, i) => { const [u, v] = at(pt.x, pt.z); if (i) x.lineTo(u, v); else x.moveTo(u, v); });
        x.stroke();
      }
    };
    stroke(ROAD + SIDEWALK * 2, '#a5a59f');
    stroke(ROAD, '#4b4f56');
    return c;
  }

  message(text, t = 3) { this.el.msg.textContent = text; this.msgT = t; this.el.msg.style.opacity = 1; }
  big(text, t = 3) { this.el.big.textContent = text; this.bigT = t; this.el.big.style.opacity = 1; }
  hitFlash() { this.hitT = 0.25; }

  toggleMap() {
    this.mapOpen = !this.mapOpen;
    this.bigMap.style.display = this.mapOpen ? 'block' : 'none';
  }

  drawBigMap() {
    const g = this.g, cv = this.bigMap, c = this.bigCtx;
    const size = Math.min(innerWidth, innerHeight) * 0.9;
    const px = Math.round(size * Math.min(devicePixelRatio, 2));
    if (cv.width !== px) { cv.width = cv.height = px; cv.style.width = cv.style.height = size + 'px'; }
    const k = px / this.base.width;
    c.drawImage(this.base, 0, 0, px, px);
    const at = (x, z) => { const [u, v] = this.toBase(x, z); return [u * k, v * k]; };
    const icon = (x, z, col, txt) => {
      const [u, v] = at(x, z), r = px * 0.018;
      c.fillStyle = col; c.fillRect(u - r, v - r, r * 2, r * 2);
      c.fillStyle = '#000'; c.font = `bold ${r * 1.4}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(txt, u, v + 1);
    };
    const sp = g.city.sprayPos; if (sp) icon(sp.x, sp.z, '#3dff8a', '$');
    for (const s of g.city.shops) icon(s.door.x, s.door.z, '#ffe066', s.type === 'guns' ? 'О' : s.type === 'clothes' ? 'Ш' : 'М');
    icon(g.hospital.x, g.hospital.z, '#ff6b6b', 'H');
    icon(g.station.x, g.station.z, '#7aa7ff', 'П');
    if (!g.missions.active) for (const gv of g.missions.givers) if (gv.cd <= 0) icon(gv.pos.x, gv.pos.z, '#' + gv.color.toString(16).padStart(6, '0'), gv.name[0]);
    for (const car of g.cars) if (car.role === 'police' && !car.wrecked) {
      const [u, v] = at(car.pos.x, car.pos.z); c.fillStyle = '#ff3030'; c.beginPath(); c.arc(u, v, px * 0.008, 0, 7); c.fill();
    }
    const T = g.missions.target;
    if (T) { const [u, v] = at(T.x, T.z); c.fillStyle = '#ffdd33'; c.strokeStyle = '#000'; c.lineWidth = 3; c.beginPath(); c.arc(u, v, px * 0.014, 0, 7); c.fill(); c.stroke(); }
    const P = g.playerPos(), [u, v] = at(P.x, P.z), h = g.player.car ? g.player.car.heading : g.player.facing, r = px * 0.02;
    c.save(); c.translate(u, v); c.rotate(-h);
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 0.75, r * 0.75); c.lineTo(0, r * 0.4); c.lineTo(-r * 0.75, r * 0.75); c.closePath(); c.fill(); c.stroke();
    c.restore();
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(0, px - px * 0.06, px, px * 0.06);
    c.fillStyle = '#fff'; c.font = `${px * 0.028}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const st = g.stats;
    c.fillText(`Миссий выполнено: ${st.missions} · Бандитов побеждено: ${st.gang} · M — закрыть`, px / 2, px - px * 0.03);
    const [zu, zv] = at(g.gangs.zone.x, g.gangs.zone.z);
    c.fillStyle = '#7dff9a'; c.font = `bold ${px * 0.026}px sans-serif`;
    c.fillText('Район банды', zu, zv);
  }

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
    el.armor.style.width = p.armor + '%';
    el.armor.parentElement.style.display = p.armor > 0 ? 'block' : 'none';
    const wtxt = p.weapon === 'pistol' ? `🔫 ${p.ammo}` : (p.ammo > 0 ? `👊 <small>(🔫 ${p.ammo})</small>` : '👊');
    if (el.weapon._v !== wtxt) { el.weapon.innerHTML = wtxt; el.weapon._v = wtxt; }
    const h = Math.floor(g.hour) % 24, m = Math.floor((g.hour % 1) * 60);
    el.clock.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    // машина
    if (p.car) {
      el.speed.style.display = 'block';
      el.speed.innerHTML = `${Math.round(Math.abs(p.car.speed) * 3.6)}<small> км/ч</small><div class="carhp"><i style="width:${p.car.health}%"></i></div>`
        + `<div class="carhp nitro"><i style="width:${p.car.nitro * 100}%"></i></div>`;
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
    if (this.mapOpen) this.drawBigMap();
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
    for (const s of g.city.shops) label(s.door.x, s.door.z, '#ffe066', s.type === 'guns' ? 'О' : s.type === 'clothes' ? 'Ш' : 'М');
    for (const o of g.police.officers) if (o.state === 'chase') dot(o.pos.x, o.pos.z, '#7fb0ff', 3);
    label(g.hospital.x, g.hospital.z, '#ff6b6b', 'H');
    label(g.station.x, g.station.z, '#7aa7ff', 'П');
    if (!g.missions.active) for (const gv of g.missions.givers) if (gv.cd <= 0) {
      label(gv.pos.x, gv.pos.z, '#' + gv.color.toString(16).padStart(6, '0'), gv.name[0]);
    }
    const flash = Math.floor(g.time * 6) % 2;
    const rt = g.net && g.net.remoteTarget();
    if (rt) { dot(rt.x, rt.z, '#ff9a2e', 6); dot(rt.x, rt.z, '#fff', 2.5); }
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
