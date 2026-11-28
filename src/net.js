import * as THREE from 'three';
import { makeHuman, animateHuman } from './human.js';
import { lerpAngle } from './config.js';

// Сетевая игра: «Сервер #1» в локальной сети Wi-Fi, до 8 игроков.
// Сервер работает на телефоне того, кто вошёл первым (window.AndroidNet, NetBridge.java);
// остальные находят его в сети и подключаются. Сообщения приходят как "номер|json",
// номер 0 — хост. Транспорт local (две вкладки браузера, ?net=local) — только для проверки.
// Каждый играет в своём экземпляре одного и того же города: передаются положение игрока,
// его машина и события (попадания, время суток, погода).

const SEND_HZ = 15;
const SERVER_NAME = 'Сервер #1';
const MAX_PLAYERS = 8;
const COLORS = [0xff7a1a, 0x2ec4b6, 0xe71d36, 0x9b5de5, 0xf15bb5, 0x00bbf9, 0xfee440, 0x8ac926];

// Имитация сервера через BroadcastChannel (для автотестов в браузере).
class LocalTransport {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.cid = Math.random().toString(36).slice(2);
    this.ch = new BroadcastChannel('sunrise-bay-server');
    this.ch.onmessage = (e) => this.on(e.data);
  }
  on(m) {
    if (this.hosting) {
      if (m.kind === 'hello') {
        const id = this.next++;
        this.clients.add(id);
        this.ch.postMessage({ kind: 'welcome', cid: m.cid, id });
        this.onEvent('msg', id + '|{"t":"join"}');
        this.ch.postMessage({ kind: 'relay', from: id, line: '{"t":"join"}' });
      } else if (m.kind === 'up') {
        this.onEvent('msg', m.from + '|' + m.line);
        this.ch.postMessage({ kind: 'relay', from: m.from, line: m.line });
      } else if (m.kind === 'leave') {
        this.clients.delete(m.from);
        this.onEvent('msg', m.from + '|{"t":"bye"}');
        this.ch.postMessage({ kind: 'relay', from: m.from, line: '{"t":"bye"}' });
      }
    } else if (this.id != null) {
      if (m.kind === 'relay' && m.from !== this.id) this.onEvent('msg', m.from + '|' + m.line);
      if (m.kind === 'down') { this.id = null; this.onEvent('state', 'closed'); }
    } else {
      if (m.kind === 'beacon' && this.scanning) {
        this.onEvent('found', JSON.stringify([{ name: m.name, address: 'local', players: m.players, max: MAX_PLAYERS }]));
      }
      if (m.kind === 'welcome' && m.cid === this.cid) {
        this.id = m.id;
        this.onEvent('state', 'connected');
        this.onEvent('msg', '0|{"t":"welcome","id":' + m.id + '}');
      }
    }
  }
  online() { return true; }
  myIp() { return '127.0.0.1'; }
  device() { return 'Вкладка'; }
  games() { return '[]'; }
  players() { return this.hosting ? this.clients.size + 1 : 0; }
  scan() { this.scanning = true; }
  host(name) {
    this.hosting = true; this.next = 1; this.clients = new Set();
    this.onEvent('welcome', '0'); this.onEvent('state', 'connected');
    clearInterval(this.beacon);
    this.beacon = setInterval(() => this.hosting && this.ch.postMessage({ kind: 'beacon', name, players: this.clients.size + 1 }), 400);
  }
  connect() { this.onEvent('state', 'connecting'); this.ch.postMessage({ kind: 'hello', cid: this.cid }); }
  send(line) {
    if (this.hosting) this.ch.postMessage({ kind: 'relay', from: 0, line });
    else if (this.id != null) this.ch.postMessage({ kind: 'up', from: this.id, line });
  }
  close() {
    if (this.hosting) this.ch.postMessage({ kind: 'down' });
    else if (this.id != null) this.ch.postMessage({ kind: 'leave', from: this.id });
    this.hosting = false; this.id = null; clearInterval(this.beacon);
  }
}

export class Net {
  constructor(game) {
    this.game = game;
    this.state = 'idle'; this.isHost = false; this.myId = null;
    this.sendT = 0; this.syncT = 0;
    this.remotes = new Map();     // номер игрока → {human, label, car, target, pos, …}
    this.servers = [];
    this.nick = this.loadNick();
    window.__bt = (type, data) => this.onEvent(type, data);
    if (window.AndroidNet) this.t = window.AndroidNet;
    else if (/[?&]net=local/.test(location.search)) this.t = new LocalTransport((a, b) => this.onEvent(a, b));
    else this.t = null;
    this.ui();
  }

  get connected() { return this.state === 'connected'; }

  loadNick() {
    try { const n = localStorage.getItem('sunrise-bay-nick'); if (n) return n; } catch (e) { /* нет хранилища */ }
    return 'Игрок' + Math.floor(100 + Math.random() * 900);
  }

  // ---------- меню серверов ----------
  ui() {
    const $ = (id) => document.getElementById(id);
    this.panel = $('netpanel'); this.status = $('netstatus'); this.list = $('netlist');
    this.nickInput = $('netnick');
    this.nickInput.value = this.nick;
    this.nickInput.addEventListener('change', () => {
      this.nick = this.nickInput.value.trim().slice(0, 14) || this.nick;
      this.nickInput.value = this.nick;
      try { localStorage.setItem('sunrise-bay-nick', this.nick); } catch (e) { /* нет */ }
    });
    $('netbtn').addEventListener('click', (e) => { e.stopPropagation(); this.open(); });
    $('hudnet').addEventListener('click', (e) => { e.stopPropagation(); this.open(); });
    $('netback').addEventListener('click', () => { this.panel.style.display = 'none'; });
    $('netgo').addEventListener('click', () => {
      const ip = $('netip').value.trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) this.connect(ip);
      else this.say('Введите адрес вида 192.168.1.23 — его видно в меню серверов у того, на чьём телефоне работает сервер.');
    });
  }

  open() {
    this.panel.style.display = 'flex';
    if (document.pointerLockElement) document.exitPointerLock();
    if (!this.t) {
      this.say('Сервер работает в Android-приложении Sunrise Bay (файл APK): браузер не умеет соединять телефоны в сети Wi-Fi.');
      this.renderList();
      return;
    }
    if (this.connected) {
      this.say(this.isHost
        ? `Сервер работает на этом телефоне. Адрес для подключения: ${this.t.myIp() || '—'}.`
        : 'Вы на сервере. Другие игроки видны на карте оранжевыми точками.');
    } else if (!this.t.online()) {
      this.say('Телефон не подключён к Wi-Fi. Подключите все телефоны к одной сети Wi-Fi или к точке доступа одного из них.');
    } else {
      this.say('Ищем «Сервер #1» в вашей сети Wi-Fi…');
      this.searching = true;
      this.t.scan();
      clearTimeout(this.searchT);
      this.searchT = setTimeout(() => {
        this.searching = false;
        if (this.connected || this.servers.length) return;
        // никто не играет: если игрок уже нажал «Войти» — запускаем сервер у него
        if (this.pendingJoin) { this.pendingJoin = false; this.host(); return; }
        this.say('В сети пока никто не играет. Нажмите «Войти» — сервер запустится на этом телефоне, и остальные смогут к нему подключиться.');
        this.renderList();
      }, 4000);
    }
    this.renderList();
  }

  // Строка «Сервер #1» в списке: состояние и кнопка входа/выхода.
  renderList() {
    const found = this.servers[0];
    const players = this.connected ? 1 + this.remotes.size : found ? found.players : 0;
    let where = 'Wi-Fi, не найден';
    if (this.connected) where = this.isHost ? 'Wi-Fi, на этом телефоне' : 'Wi-Fi, вы подключены';
    else if (found) where = `Wi-Fi, ${found.address}`;
    const key = [this.state, players, where].join('|');
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.list.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'server';
    row.innerHTML = `<div class="sv-icon">🌐</div><div class="sv-info"><b>${SERVER_NAME}</b><small>${where}</small></div>`
      + `<div class="sv-count">${players}/${MAX_PLAYERS}</div>`;
    const btn = document.createElement('button');
    btn.className = 'main';
    if (this.connected) { btn.textContent = 'Выйти'; btn.onclick = () => { this.close(); this.open(); }; }
    else if (this.state === 'connecting') { btn.textContent = 'Подключение…'; btn.disabled = true; }
    else {
      btn.textContent = 'Войти';
      btn.disabled = !this.t;
      btn.onclick = () => this.join();
    }
    row.append(btn);
    this.list.append(row);
  }

  say(t) { this.status.textContent = t; }

  // «Войти»: к найденному серверу; если поиск ещё идёт — дождаться его; если никого нет — свой сервер.
  join() {
    if (this.servers[0]) { this.connect(this.servers[0].address); return; }
    if (this.searching) { this.pendingJoin = true; this.say('Ищем сервер в сети… Секунду.'); return; }
    this.host();
  }

  host() { if (!this.t) return; this.isHost = true; this.t.host(SERVER_NAME, MAX_PLAYERS); }
  connect(addr) { if (!this.t) return; this.isHost = false; this.t.connect(addr); this.renderList(); }
  close() {
    if (this.t) this.t.close();
    for (const id of [...this.remotes.keys()]) this.drop(id);
    this.state = 'idle'; this.myId = null; this.isHost = false; this.shownKey = null;
  }

  onEvent(type, data) {
    const g = this.game;
    if (type === 'state') {
      this.state = data;
      if (data === 'connecting') this.say('Подключаемся к серверу…');
      if (data === 'connected') {
        this.panel.style.display = 'none';
        g.begin(false);
        g.hud.big(this.isHost ? 'СЕРВЕР #1 ЗАПУЩЕН' : 'СЕРВЕР #1', 2.5);
        if (this.isHost) g.hud.message(`Другие игроки в этой сети Wi-Fi могут войти. Ваш адрес: ${this.t.myIp() || '—'}`, 5);
        this.send({ t: 'hi', nick: this.nick });
        if (this.isHost) this.sendWorld();
        document.body.classList.add('online');
      }
      if (data === 'closed') {
        g.hud.message(this.isHost ? 'Сервер остановлен' : 'Сервер закрыт — соединение потеряно', 3);
        for (const id of [...this.remotes.keys()]) this.drop(id);
        this.myId = null;
        document.body.classList.remove('online');
      }
      this.renderList();
    } else if (type === 'welcome') {
      this.myId = +data;
    } else if (type === 'error') {
      this.state = 'error';
      this.say('Не удалось: ' + (data || 'ошибка') + '. Проверьте, что телефоны в одной сети Wi-Fi.');
      this.renderList();
    } else if (type === 'found') {
      try { this.servers = JSON.parse(data || '[]'); } catch (e) { this.servers = []; }
      if (!this.connected && this.servers.length) {
        if (this.pendingJoin) { this.pendingJoin = false; this.connect(this.servers[0].address); return; }
        this.say('Найден «Сервер #1». Нажмите «Войти».');
      }
      this.renderList();
    } else if (type === 'msg') {
      const bar = data.indexOf('|');
      if (bar < 0) return;
      const from = +data.slice(0, bar);
      let m; try { m = JSON.parse(data.slice(bar + 1)); } catch (e) { return; }
      this.onMessage(from, m);
    }
  }

  send(obj) { if (this.t && this.connected) this.t.send(JSON.stringify(obj)); }

  sendWorld() {
    const g = this.game;
    this.send({ t: 'w', hour: g.hour, rain: g.weather.target });
  }

  onMessage(from, m) {
    const g = this.game;
    if (m.t === 'welcome') { this.myId = m.id; this.send({ t: 'hi', nick: this.nick }); return; }
    if (m.t === 'full') { this.say('Сервер заполнен (8 игроков).'); this.close(); this.open(); return; }
    if (from === this.myId) return;
    if (m.t === 'join') {
      g.hud.message('К серверу подключился новый игрок', 2.5);
      this.send({ t: 'hi', nick: this.nick });          // представиться новичку
      if (this.isHost) this.sendWorld();
    } else if (m.t === 'bye') {
      const r = this.remotes.get(from);
      if (r) g.hud.message(`${r.nick} вышел с сервера`, 2.5);
      this.drop(from);
    } else if (m.t === 'hi') {
      const r = this.remotes.get(from) || this.spawnRemote(from);
      if (r.nick !== m.nick) { r.nick = m.nick; this.drawLabel(r); g.hud.message(`${m.nick} на сервере`, 2); }
    } else if (m.t === 's') {
      const r = this.remotes.get(from) || this.spawnRemote(from);
      r.target = m; r.lastT = g.time;
    } else if (m.t === 'hit') {
      if (m.to !== this.myId || g.state !== 'play') return;
      const p = g.player;
      if (p.car && m.car) p.car.damage(m.d * 1.5); else p.hurt(m.d);
      if (m.kx) { p.knock.set(m.kx, 0, m.kz); p.vy = 4; }
      g.hud.hitFlash(); g.sfx.hit(0.4);
    } else if (m.t === 'w' && from === 0 && !this.isHost) {
      g.hour = m.hour;
      if ((m.rain ? 1 : 0) !== g.weather.target) g.weather.setRain(!!m.rain);
    }
  }

  // ---------- другие игроки в нашем мире ----------
  spawnRemote(id) {
    const g = this.game, col = COLORS[id % COLORS.length];
    const human = makeHuman(col, 0x1f2a44, 0xc68642, 0x1a1209, { height: 1.0, hairStyle: 'short' });
    g.scene.add(human);
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
    label.scale.set(2.4, 0.6, 1);
    g.scene.add(label);
    const r = { id, col, nick: 'Игрок ' + (id + 1), human, label, canvas, car: null, target: null,
      pos: new THREE.Vector3(), facing: 0, phase: 0, lastT: g.time };
    this.drawLabel(r);
    this.remotes.set(id, r);
    return r;
  }

  drawLabel(r) {
    const x = r.canvas.getContext('2d');
    x.clearRect(0, 0, 256, 64);
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 8, 256, 48);
    x.fillStyle = '#' + r.col.toString(16).padStart(6, '0');
    x.font = 'bold 34px Trebuchet MS, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(r.nick.slice(0, 14), 128, 33);
    r.label.material.map.needsUpdate = true;
  }

  drop(id) {
    const g = this.game, r = this.remotes.get(id);
    if (!r) return;
    g.scene.remove(r.human); g.scene.remove(r.label);
    if (r.car) g.removeCar(r.car);
    this.remotes.delete(id);
  }

  // Попадание по игроку id из нашего мира (выстрел, удар, наезд).
  hitRemote(id, d, kx = 0, kz = 0) {
    const r = this.remotes.get(id);
    this.send({ t: 'hit', to: id, d, car: !!(r && r.car), kx, kz });
  }

  // Где сейчас видны другие игроки (для стрельбы, ударов и карты).
  remoteTargets() {
    const out = [];
    for (const r of this.remotes.values()) if (r.target) out.push({ id: r.id, x: r.pos.x, z: r.pos.z, inCar: !!r.car, col: r.col });
    return out;
  }

  update(dt) {
    const g = this.game;
    if (!this.connected) return;
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / SEND_HZ;
      const p = g.player, c = p.car, P = g.playerPos();
      this.send({
        t: 's', x: +P.x.toFixed(2), y: +(c ? c.pos.y : p.pos.y).toFixed(2), z: +P.z.toFixed(2),
        f: +(c ? c.heading : p.facing).toFixed(3), car: c ? c.type : null,
        col: c ? c.bodyMat.color.getHex() : 0, vx: c ? +c.vel.x.toFixed(2) : 0, vz: c ? +c.vel.z.toFixed(2) : 0,
        st: c ? c.steer : 0, gun: p.weapon === 'pistol' ? 1 : 0, dead: g.state !== 'play' ? 1 : 0, shop: g.indoor ? 1 : 0,
      });
    }
    if (this.isHost) { this.syncT -= dt; if (this.syncT <= 0) { this.syncT = 5; this.sendWorld(); } }
    for (const r of this.remotes.values()) this.updateRemote(r, dt);
  }

  updateRemote(r, dt) {
    const g = this.game;
    if (!r.target) return;
    const m = r.target;
    // плавное движение к последнему положению + предсказание по скорости
    const tx = m.x + m.vx * 0.06, tz = m.z + m.vz * 0.06;
    if (Math.hypot(r.pos.x - tx, r.pos.z - tz) > 25) r.pos.set(tx, m.y, tz);
    const k = Math.min(1, dt * 10);
    const moved = Math.hypot(tx - r.pos.x, tz - r.pos.z);
    r.pos.x += (tx - r.pos.x) * k; r.pos.z += (tz - r.pos.z) * k; r.pos.y += (m.y - r.pos.y) * k;
    r.facing = lerpAngle(r.facing, m.f, k);
    if (m.car) {
      if (!r.car || r.car.type !== m.car) {
        if (r.car) g.removeCar(r.car);
        r.car = g.addCar(m.car, r.pos.x, r.pos.z, r.facing);
        r.car.role = 'remote'; r.car.keep = true; r.car.driverMesh.visible = true; r.car.netId = r.id;
      }
      r.car.bodyMat.color.setHex(m.col);
      r.car.setRemote(r.pos.x, r.pos.y, r.pos.z, r.facing, m.vx, m.vz, m.st, dt);
      r.human.visible = false;
      r.label.position.set(r.pos.x, r.pos.y + 2.9, r.pos.z);
    } else {
      if (r.car) { g.removeCar(r.car); r.car = null; }
      r.human.visible = !m.shop;
      r.human.position.copy(r.pos);
      if (m.dead) r.human.rotation.set(-Math.PI / 2, r.facing, 0, 'YXZ');
      else {
        r.human.rotation.set(0, r.facing, 0);
        const sp = moved / Math.max(dt, 1e-3) / 10;
        r.phase += dt * Math.min(18, sp * 2.2 * 10);
        animateHuman(r.human, r.phase, Math.min(1.3, sp * 2), m.gun ? 1 : 0);
      }
      r.label.position.set(r.pos.x, r.pos.y + 2.3, r.pos.z);
    }
    r.label.visible = !m.shop;
    // давно нет данных — игрок, видимо, отвалился
    if (g.time - r.lastT > 8) this.drop(r.id);
  }
}
