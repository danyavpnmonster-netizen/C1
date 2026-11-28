import * as THREE from 'three';
import { makeHuman, animateHuman } from './human.js';
import { lerpAngle } from './config.js';

// Игра вдвоём. Транспорт:
//  • Wi-Fi — в Android-приложении (мост window.AndroidNet: TCP + поиск игр в локальной сети);
//  • local — две вкладки одного браузера (только для проверки, ?net=local).
// Каждый играет в своём экземпляре одного и того же города; передаются
// положение игрока, его машина и события (попадания, время суток, погода).

const SEND_HZ = 15;

class LocalTransport {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.ch = new BroadcastChannel('sunrise-bay-net');
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (m.kind === 'hello' && this.waiting) { this.ch.postMessage({ kind: 'welcome' }); this.up(); }
      else if (m.kind === 'welcome' && this.waiting) this.up();
      else if (m.kind === 'msg' && this.connected) this.onEvent('msg', m.line);
      else if (m.kind === 'bye' && this.connected) { this.connected = false; this.onEvent('state', 'closed'); }
      else if (m.kind === 'beacon' && this.scanning) this.onEvent('found', JSON.stringify([{ name: 'Другая вкладка', address: 'local' }]));
    };
  }
  up() { this.waiting = false; this.connected = true; this.onEvent('peer', 'Вкладка'); this.onEvent('state', 'connected'); }
  online() { return true; }
  myIp() { return '127.0.0.1'; }
  games() { return '[]'; }
  scan() { this.scanning = true; }
  host() {
    this.waiting = true; this.onEvent('state', 'hosting');
    clearInterval(this.beacon);
    this.beacon = setInterval(() => { if (this.waiting) this.ch.postMessage({ kind: 'beacon' }); else clearInterval(this.beacon); }, 500);
  }
  connect() { this.waiting = true; this.onEvent('state', 'connecting'); this.ch.postMessage({ kind: 'hello' }); }
  send(line) { if (this.connected) this.ch.postMessage({ kind: 'msg', line }); }
  close() { if (this.connected) this.ch.postMessage({ kind: 'bye' }); this.connected = false; this.waiting = false; }
}

export class Net {
  constructor(game) {
    this.game = game;
    this.state = 'idle'; this.peer = ''; this.isHost = false;
    this.sendT = 0; this.syncT = 0;
    this.remote = null;       // {target, human, car, label}
    window.__bt = (type, data) => this.onEvent(type, data);
    if (window.AndroidNet) this.t = window.AndroidNet;
    else if (/[?&]net=local/.test(location.search)) this.t = new LocalTransport((a, b) => this.onEvent(a, b));
    else this.t = null;
    this.ui();
  }

  get connected() { return this.state === 'connected'; }

  // ---------- меню ----------
  ui() {
    this.panel = document.getElementById('netpanel');
    this.status = document.getElementById('netstatus');
    this.list = document.getElementById('netlist');
    document.getElementById('netbtn').addEventListener('click', (e) => { e.stopPropagation(); this.open(); });
    document.getElementById('nethost').addEventListener('click', () => this.host());
    document.getElementById('netback').addEventListener('click', () => { this.close(); this.panel.style.display = 'none'; });
    document.getElementById('netgo').addEventListener('click', () => {
      const ip = document.getElementById('netip').value.trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) this.connect(ip);
      else this.say('Введите адрес вида 192.168.1.23 — его видно на экране того, кто создал игру.');
    });
  }

  open() {
    this.panel.style.display = 'flex';
    if (!this.t) {
      this.say('Игра вдвоём по Wi-Fi работает в Android-приложении Sunrise Bay (файл APK). Браузер не умеет напрямую соединять телефоны.');
      document.getElementById('nethost').disabled = true;
      document.getElementById('netmanual').style.display = 'none';
      return;
    }
    if (!this.t.online()) {
      this.say('Телефон не подключён к Wi-Fi. Подключите оба телефона к одной сети Wi-Fi (или включите точку доступа на одном и подключите к ней второй).');
    } else {
      this.say('Оба телефона должны быть в одной сети Wi-Fi. Один нажимает «Создать игру», второй — выбирает игру в списке.');
    }
    this.t.scan();
    this.shownGames = null;
    this.showGames([]);
  }

  showGames(games) {
    const key = JSON.stringify(games);
    if (key === this.shownGames) return;        // не перерисовываем — кнопка не «уедет» из-под пальца
    this.shownGames = key;
    this.list.innerHTML = '';
    if (!games.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Ищем игры в сети…';
      this.list.append(p);
    }
    for (const gm of games) {
      const b = document.createElement('button');
      b.textContent = 'Подключиться: ' + (gm.name || gm.address) + '  (' + gm.address + ')';
      b.onclick = () => this.connect(gm.address);
      this.list.append(b);
    }
  }

  say(t) { this.status.textContent = t; }

  host() { if (!this.t) return; this.isHost = true; this.t.host(); }
  connect(addr) { if (!this.t) return; this.isHost = false; this.t.connect(addr); }
  close() { if (this.t) this.t.close(); this.drop(); this.state = 'idle'; }

  onEvent(type, data) {
    const g = this.game;
    if (type === 'state') {
      this.state = data;
      if (data === 'hosting') {
        const ip = this.t.myIp ? this.t.myIp() : '';
        this.say('Игра создана, ждём второго игрока… Ваш адрес: ' + (ip || 'нет сети') + '. Второй игрок увидит игру в списке или введёт этот адрес.');
      }
      if (data === 'connecting') this.say('Подключаемся…');
      if (data === 'connected') {
        this.say('Соединено!');
        this.panel.style.display = 'none';
        g.begin(false);
        g.hud.big('ИГРА ВДВОЁМ', 2.5);
        this.send({ t: 'hi', host: this.isHost });
        if (this.isHost) this.sendWorld();
      }
      if (data === 'closed') {
        if (this.remote) g.hud.message('Второй игрок отключился', 3);
        this.drop();
      }
    } else if (type === 'peer') {
      this.peer = data || 'Игрок 2';
    } else if (type === 'error') {
      this.state = 'error';
      this.say('Не удалось соединиться: ' + (data || 'ошибка') + '. Проверьте, что оба телефона в одной сети Wi-Fi.');
    } else if (type === 'found') {
      let games = [];
      try { games = JSON.parse(data || '[]'); } catch (e) { games = []; }
      if (this.state !== 'connected') this.showGames(games);
    } else if (type === 'msg') {
      let m; try { m = JSON.parse(data); } catch (e) { return; }
      this.onMessage(m);
    }
  }

  send(obj) { if (this.t && this.connected) this.t.send(JSON.stringify(obj)); }

  sendWorld() {
    const g = this.game;
    this.send({ t: 'w', hour: g.hour, rain: g.weather.target });
  }

  onMessage(m) {
    const g = this.game;
    if (m.t === 's') {
      if (!this.remote) this.spawnRemote();
      this.remote.target = m;
      this.remote.lastT = g.time;
    } else if (m.t === 'hit') {
      if (g.state !== 'play') return;
      const p = g.player;
      if (p.car && m.car) p.car.damage(m.d * 1.5); else p.hurt(m.d);
      if (m.kx) { p.knock.set(m.kx, 0, m.kz); p.vy = 4; }
      g.hud.hitFlash(); g.sfx.hit(0.4);
    } else if (m.t === 'w' && !this.isHost) {
      g.hour = m.hour;
      if ((m.rain ? 1 : 0) !== g.weather.target) g.weather.setRain(!!m.rain);
    }
  }

  // ---------- второй игрок в нашем мире ----------
  spawnRemote() {
    const g = this.game;
    const human = makeHuman(0xff7a1a, 0x1f2a44, 0xc68642, 0x1a1209, { height: 1.0 });
    g.scene.add(human);
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 8, 256, 48);
    x.fillStyle = '#ffb347'; x.font = 'bold 34px Trebuchet MS, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText((this.peer || 'Игрок 2').slice(0, 14), 128, 33);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    label.scale.set(2.4, 0.6, 1);
    g.scene.add(label);
    this.remote = { human, label, car: null, target: null, pos: new THREE.Vector3(), facing: 0, phase: 0, lastT: g.time };
  }

  drop() {
    const g = this.game, r = this.remote;
    if (!r) return;
    g.scene.remove(r.human); g.scene.remove(r.label);
    if (r.car) g.removeCar(r.car);
    this.remote = null;
  }

  // Попадание по второму игроку из нашего мира (выстрел, удар, наезд).
  hitRemote(d, kx = 0, kz = 0) {
    const r = this.remote;
    this.send({ t: 'hit', d, car: !!(r && r.car), kx, kz });
  }

  // Точка, в которой сейчас виден второй игрок (для стрельбы и ударов).
  remoteTarget() {
    const r = this.remote;
    if (!r || !r.target) return null;
    return { x: r.pos.x, z: r.pos.z, inCar: !!r.car };
  }

  update(dt) {
    const g = this.game;
    if (!this.connected) return;
    // отправка своего состояния
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

    const r = this.remote;
    if (!r || !r.target) return;
    const m = r.target;
    // плавное движение к последнему положению + предсказание по скорости
    const tx = m.x + m.vx * 0.06, tz = m.z + m.vz * 0.06;
    if (r.pos.distanceTo(new THREE.Vector3(tx, m.y, tz)) > 25) r.pos.set(tx, m.y, tz);
    const k = Math.min(1, dt * 10);
    const moved = Math.hypot(tx - r.pos.x, tz - r.pos.z);
    r.pos.x += (tx - r.pos.x) * k; r.pos.z += (tz - r.pos.z) * k; r.pos.y += (m.y - r.pos.y) * k;
    r.facing = lerpAngle(r.facing, m.f, k);

    if (m.car) {
      if (!r.car || r.car.type !== m.car) {
        if (r.car) g.removeCar(r.car);
        r.car = g.addCar(m.car, r.pos.x, r.pos.z, r.facing);
        r.car.role = 'remote'; r.car.keep = true; r.car.driverMesh.visible = true;
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
    // долго нет данных — связь, похоже, оборвалась
    if (g.time - r.lastT > 6) { g.hud.message('Нет связи со вторым игроком', 2); r.lastT = g.time; }
  }
}
