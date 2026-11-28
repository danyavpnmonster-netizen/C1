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

// ---------- игра через интернет (Wi-Fi и мобильный) ----------
// Телефоны знакомятся через бесплатный сервис PeerJS (0.peerjs.com), дальше обмениваются
// данными напрямую (WebRTC). Если оператор мешает прямому соединению, данные идут через
// промежуточный TURN-сервер. «Сервер #1» — это игрок с известным всем идентификатором:
// кто входит первым, становится сервером, остальные подключаются к нему.
const SERVER_PEER_ID = 'sunrise-bay-server-1';
const ICE = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

class PeerTransport {
  constructor(onEvent, serverId = SERVER_PEER_ID) {
    this.onEvent = onEvent; this.sid = serverId; this.gen = 0;
    this.peers = new Map(); this.hosting = false;
  }
  online() { return navigator.onLine !== false; }
  myIp() { return ''; }
  players() { return this.hosting ? this.peers.size + 1 : 0; }

  // Войти на «Сервер #1»: подключиться к нему, а если его нет — стать им.
  join() {
    this.close();
    const gen = ++this.gen;
    this.onEvent('state', 'connecting');
    const p = this.peer = new window.Peer(undefined, { config: ICE, debug: 0 });
    p.on('open', () => {
      if (gen !== this.gen) return;
      const conn = p.connect(this.sid, { serialization: 'json', reliable: true });
      let opened = false;
      // сервер есть в каталоге, но соединение не установилось — сеть не пускает
      const to = setTimeout(() => {
        if (opened || gen !== this.gen) return;
        this.fail('не удалось соединиться с сервером (сеть не пропускает соединение)');
      }, 15000);
      conn.on('open', () => {
        if (gen !== this.gen) return;
        opened = true; clearTimeout(to); this.conn = conn;
        this.onEvent('state', 'connected');
      });
      conn.on('data', (d) => { if (gen === this.gen) this.onEvent('msg', String(d)); });
      conn.on('close', () => { if (opened && gen === this.gen) { this.cleanup(); this.onEvent('state', 'closed'); } });
    });
    p.on('error', (e) => {
      if (gen !== this.gen) return;
      if (e.type === 'peer-unavailable') { this.becomeHost(gen); return; }   // никто не играет
      this.fail(this.describe(e));
    });
  }

  becomeHost(gen) {
    if (this.peer) this.peer.destroy();
    this.hosting = true; this.peers = new Map(); this.next = 1;
    const p = this.peer = new window.Peer(this.sid, { config: ICE, debug: 0 });
    p.on('open', () => {
      if (gen !== this.gen) return;
      this.onEvent('welcome', '0'); this.onEvent('state', 'connected');
    });
    p.on('connection', (conn) => {
      conn.on('open', () => {
        if (gen !== this.gen) return;
        if (this.peers.size + 1 >= MAX_PLAYERS) { conn.send('0|{"t":"full"}'); setTimeout(() => conn.close(), 500); return; }
        const id = this.next++;
        this.peers.set(id, conn);
        conn.send('0|{"t":"welcome","id":' + id + '}');
        const join = id + '|{"t":"join"}';
        this.onEvent('msg', join); this.broadcast(join, id);
        conn.on('data', (d) => { const line = id + '|' + d; this.onEvent('msg', line); this.broadcast(line, id); });
        const gone = () => {
          if (!this.peers.has(id)) return;
          this.peers.delete(id);
          const bye = id + '|{"t":"bye"}';
          this.onEvent('msg', bye); this.broadcast(bye, id);
        };
        conn.on('close', gone); conn.on('error', gone);
      });
    });
    p.on('disconnected', () => { if (gen === this.gen && !p.destroyed) { try { p.reconnect(); } catch (e) { /* позже */ } } });
    p.on('error', (e) => {
      if (gen !== this.gen) return;
      // кто-то стал сервером на долю секунды раньше — подключаемся к нему
      if (e.type === 'unavailable-id') { this.hosting = false; p.destroy(); setTimeout(() => { if (gen === this.gen) this.join(); }, 700); return; }
      if (e.type === 'peer-unavailable') return;
      this.fail(this.describe(e));
    });
  }

  describe(e) {
    const t = e && e.type;
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'нет связи с интернетом или сервисом соединения';
    if (t === 'browser-incompatible') return 'это устройство не поддерживает онлайн-игру (WebRTC)';
    return (e && e.message) || 'ошибка соединения';
  }

  fail(msg) { this.cleanup(); this.onEvent('error', msg); }

  broadcast(line, except) {
    for (const [id, c] of this.peers) if (id !== except && c.open) { try { c.send(line); } catch (e) { /* закрывается */ } }
  }

  send(line) {
    if (this.hosting) this.broadcast('0|' + line, -1);
    else if (this.conn && this.conn.open) { try { this.conn.send(line); } catch (e) { /* закрывается */ } }
  }

  cleanup() {
    for (const c of this.peers.values()) { try { c.close(); } catch (e) { /* уже */ } }
    this.peers.clear();
    if (this.conn) { try { this.conn.close(); } catch (e) { /* уже */ } }
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
    this.conn = null; this.peer = null; this.hosting = false;
  }

  close() { this.gen++; this.cleanup(); }
}

// ---------- выделенный сервер (всегда открыт) ----------
// Cloudflare Workers или свой компьютер (server/). Подключение по WebSocket.
// Адрес по умолчанию задаётся здесь после развёртывания; в меню его можно поменять.
export const DEFAULT_SERVER_URL = '';

// «sunrise-bay-server.имя.workers.dev» → wss://…/ws, «192.168.1.5:8080» → ws://…/ws
export function toWsUrl(s) {
  s = (s || '').trim();
  if (!s) return '';
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+/.test(s)) s = 'ws://' + s;
  else if (!/^[a-z]+:\/\//i.test(s)) s = 'wss://' + s;
  s = s.replace(/^http/i, 'ws');
  try {
    const u = new URL(s);
    if (u.pathname === '/' || u.pathname === '') u.pathname = '/ws';
    return u.toString();
  } catch (e) { return ''; }
}
const statusUrl = (ws) => ws.replace(/^ws/i, 'http').replace(/\/ws(\?.*)?$/, '/status');

class WsTransport {
  constructor(onEvent, url) { this.onEvent = onEvent; this.url = url; this.gen = 0; }
  online() { return navigator.onLine !== false; }
  myIp() { return ''; }
  players() { return 0; }
  join() {
    this.close();
    const gen = ++this.gen;
    this.onEvent('state', 'connecting');
    let ws;
    try { ws = this.ws = new WebSocket(this.url); } catch (e) { this.onEvent('error', 'неверный адрес сервера'); return; }
    let opened = false;
    const to = setTimeout(() => { if (!opened && gen === this.gen) { try { ws.close(); } catch (e) { /* */ } this.onEvent('error', 'сервер не отвечает'); } }, 10000);
    ws.onopen = () => {
      if (gen !== this.gen) return;
      opened = true; clearTimeout(to);
      this.onEvent('state', 'connected');
      clearInterval(this.ping);
      this.ping = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 25000);
    };
    ws.onmessage = (e) => { if (gen === this.gen && e.data !== 'pong') this.onEvent('msg', String(e.data)); };
    ws.onclose = () => {
      clearInterval(this.ping);
      if (gen !== this.gen) return;
      if (opened) this.onEvent('state', 'closed');
      else { clearTimeout(to); this.onEvent('error', 'не удалось подключиться к серверу'); }
    };
  }
  send(line) { if (this.ws && this.ws.readyState === 1) this.ws.send(line); }
  close() { this.gen++; clearInterval(this.ping); if (this.ws) { try { this.ws.close(); } catch (e) { /* */ } } this.ws = null; }
}

// Время суток и погода по часам выделенного сервера: у всех одинаковые.
export function worldAt(ms) {
  const hour = (9 + ms / 1000 / 30) % 24;            // игровой час = 30 секунд
  const block = Math.floor(ms / 240000);              // погода меняется раз в 4 минуты
  const rain = ((Math.imul(block, 2654435761) >>> 0) % 100) < 30;
  return { hour, rain };
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
    const ev = (a, b) => this.onEvent(a, b);
    // локальная сеть: мост Android-приложения (или имитация во вкладках для проверки)
    this.lan = window.AndroidNet || (/[?&]net=local/.test(location.search) ? new LocalTransport(ev) : null);
    // интернет: WebRTC через PeerJS (в приложении и в браузере с WebRTC)
    this.inet = window.Peer && window.RTCPeerConnection ? new PeerTransport(ev) : null;
    this.serverUrl = this.loadServerUrl();
    this.ded = this.serverUrl ? new WsTransport(ev, this.serverUrl) : null;
    this.t = null;          // активный транспорт
    this.mode = null;       // 'inet' | 'lan'
    this.ui();
  }

  get connected() { return this.state === 'connected'; }

  loadServerUrl() {
    try { const u = localStorage.getItem('sunrise-bay-server-url'); if (u !== null) return u; } catch (e) { /* нет */ }
    return toWsUrl(DEFAULT_SERVER_URL);
  }

  setServerUrl(u) {
    this.serverUrl = u;
    try { localStorage.setItem('sunrise-bay-server-url', u); } catch (e) { /* нет */ }
    this.ded = u ? new WsTransport((a, b) => this.onEvent(a, b), u) : null;
  }

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
    $('netip').value = this.serverUrl || '';
    $('netgo').addEventListener('click', () => {
      const v = $('netip').value.trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) { this.connect(v); return; }      // телефон в этой сети Wi-Fi
      const u = toWsUrl(v);
      if (!u) { this.say('Введите адрес сервера, например sunrise-bay-server.имя.workers.dev или 192.168.1.23.'); return; }
      this.setServerUrl(u);
      $('netip').value = u;
      this.shownKey = null; this.renderList();
      this.joinInet();
    });
  }

  open() {
    this.panel.style.display = 'flex';
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.connected) {
      this.say(this.mode === 'lan'
        ? (this.isHost ? `Сервер работает на этом телефоне. Адрес для подключения: ${this.t.myIp() || '—'}.` : 'Вы на сервере в этой сети Wi-Fi.')
        : (this.isHost ? 'Сервер #1 работает на этом телефоне. Друзья могут войти с Wi-Fi или мобильного интернета.' : 'Вы на «Сервере #1» через интернет.'));
    } else if (!this.inet && !this.lan && !this.ded) {
      this.say('Сетевая игра работает в Android-приложении Sunrise Bay (файл APK).');
    } else {
      this.say('«Сервер #1» — игра через интернет: подходит и Wi-Fi, и мобильный интернет. «Локальная игра» — только для телефонов в одной сети Wi-Fi.');
      this.pollStatus();
      if (this.lan && this.lan.online()) {
        this.searching = true;
        this.lan.scan();
        clearTimeout(this.searchT);
        this.searchT = setTimeout(() => {
          this.searching = false;
          if (this.connected || this.servers.length) return;
          if (this.pendingJoin) { this.pendingJoin = false; this.hostLan(); return; }
          this.renderList();
        }, 4000);
      }
    }
    this.renderList();
  }

  // Список: «Сервер #1» (интернет) и «Локальная игра» (Wi-Fi).
  renderList() {
    const found = this.servers[0];
    const players = this.connected ? 1 + this.remotes.size : 0;
    const key = [this.state, this.mode, players, found ? found.address + found.players : '-'].join('|');
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.list.innerHTML = '';
    const row = (icon, title, sub, count, mode, onJoin, available) => {
      const r = document.createElement('div');
      r.className = 'server';
      r.innerHTML = `<div class="sv-icon">${icon}</div><div class="sv-info"><b>${title}</b><small>${sub}</small></div>`
        + (count ? `<div class="sv-count">${count}</div>` : '');
      const btn = document.createElement('button');
      btn.className = 'main';
      if (this.connected && this.mode === mode) { btn.textContent = 'Выйти'; btn.onclick = () => { this.close(); this.open(); }; }
      else if (this.state === 'connecting' && this.mode === mode) { btn.textContent = 'Подключение…'; btn.disabled = true; }
      else { btn.textContent = 'Войти'; btn.disabled = !available || this.connected || this.state === 'connecting'; btn.onclick = onJoin; }
      r.append(btn);
      this.list.append(r);
    };
    let sub1 = 'Интернет: Wi-Fi и мобильный · через телефоны игроков';
    let cnt1 = this.mode === 'inet' && this.connected ? `${players}/${this.maxPlayers || MAX_PLAYERS}` : '';
    if (this.ded) {
      const st = this.dedStatus;
      sub1 = 'Всегда открыт · Wi-Fi и мобильный' + (st && st.offline ? ' · не отвечает' : '');
      if (!cnt1 && st && !st.offline) cnt1 = `${st.players}/${st.max}`;
    }
    if (this.connected && this.mode === 'inet') sub1 = this.dedicated ? 'Вы на сервере (всегда открыт)' : this.isHost ? 'Сервер на этом телефоне' : 'Вы подключены';
    if (!this.inet && !this.ded) sub1 = 'Недоступно на этом устройстве';
    row('🌐', SERVER_NAME, sub1, cnt1, 'inet', () => this.joinInet(), !!(this.inet || this.ded));
    let sub2 = 'Только эта сеть Wi-Fi';
    if (this.connected && this.mode === 'lan') sub2 = this.isHost ? 'Wi-Fi, на этом телефоне' : 'Wi-Fi, вы подключены';
    else if (found) sub2 = `Wi-Fi, ${found.address}`;
    if (!this.lan) sub2 = 'Только в Android-приложении';
    const cnt2 = this.mode === 'lan' && this.connected ? `${players}/${MAX_PLAYERS}` : found ? `${found.players}/${MAX_PLAYERS}` : '';
    row('📶', 'Локальная игра', sub2, cnt2, 'lan', () => this.joinLan(), !!this.lan);
  }

  say(t) { this.status.textContent = t; }

  // Интернет: подключиться к «Серверу #1» или запустить его у себя.
  joinInet() {
    const tr = this.ded || this.inet;                // выделенный сервер, иначе — через телефоны игроков
    if (!tr) return;
    if (this.t && this.t !== tr) this.t.close();
    this.t = tr; this.mode = 'inet'; this.isHost = false; this.dedicated = tr === this.ded;
    this.say(this.dedicated ? 'Подключаемся к серверу…' : 'Подключаемся к «Серверу #1» через интернет…');
    tr.join();
  }

  // Сколько игроков на выделенном сервере (для меню).
  async pollStatus() {
    if (!this.ded || this.connected) return;
    try {
      const r = await fetch(statusUrl(this.serverUrl), { cache: 'no-store' });
      const j = await r.json();
      this.dedStatus = j; this.shownKey = null; this.renderList();
    } catch (e) { this.dedStatus = { offline: true }; this.shownKey = null; this.renderList(); }
  }

  // Wi-Fi: к найденному серверу; если поиск ещё идёт — дождаться; если никого нет — свой сервер.
  joinLan() {
    if (!this.lan) return;
    if (this.servers[0]) { this.connect(this.servers[0].address); return; }
    if (this.searching) { this.pendingJoin = true; this.say('Ищем сервер в сети… Секунду.'); return; }
    this.hostLan();
  }

  hostLan() { this.t = this.lan; this.mode = 'lan'; this.isHost = true; this.lan.host(SERVER_NAME, MAX_PLAYERS); }
  connect(addr) { if (!this.lan) return; this.t = this.lan; this.mode = 'lan'; this.isHost = false; this.lan.connect(addr); this.renderList(); }
  close() {
    this.leaving = true;
    clearTimeout(this.rejoinT);
    if (this.t) this.t.close();
    this.leaving = false;
    for (const id of [...this.remotes.keys()]) this.drop(id);
    this.state = 'idle'; this.myId = null; this.isHost = false; this.shownKey = null; this.mode = null; this.t = null;
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
        if (!this.isHost && this.dedicated) g.hud.message('Вы на «Сервере #1». Он открыт всегда — заходите когда угодно', 4);
        if (this.isHost && this.mode === 'lan') g.hud.message(`Другие игроки в этой сети Wi-Fi могут войти. Ваш адрес: ${this.t.myIp() || '—'}`, 5);
        if (this.isHost && this.mode === 'inet') g.hud.message('Друзья могут войти на «Сервер #1» с Wi-Fi или мобильного интернета', 5);
        this.send({ t: 'hi', nick: this.nick });
        if (this.isHost) this.sendWorld();
        document.body.classList.add('online');
      }
      if (data === 'closed') {
        for (const id of [...this.remotes.keys()]) this.drop(id);
        this.myId = null;
        document.body.classList.remove('online');
        if (this.mode === 'inet' && this.dedicated && !this.leaving) {
          // сервер всегда открыт — просто переподключаемся
          g.hud.message('Связь с сервером прервалась — переподключаемся…', 3);
          clearTimeout(this.rejoinT);
          this.rejoinT = setTimeout(() => { if (!this.connected) this.joinInet(); }, 2000);
        } else if (this.mode === 'inet' && !this.leaving) {
          // хозяин сервера вышел — переподключаемся: первый станет новым сервером, остальные войдут к нему
          g.hud.message('Сервер переезжает на другой телефон…', 3);
          clearTimeout(this.rejoinT);
          this.rejoinT = setTimeout(() => { if (!this.connected) this.joinInet(); }, 500 + Math.random() * 2000);
        } else g.hud.message(this.isHost ? 'Сервер остановлен' : 'Сервер закрыт — соединение потеряно', 3);
      }
      this.renderList();
    } else if (type === 'welcome') {
      this.myId = +data;
      this.isHost = this.myId === 0;
    } else if (type === 'error') {
      this.state = 'error';
      this.say('Не удалось: ' + (data || 'ошибка') + (this.mode === 'lan' ? '. Проверьте, что телефоны в одной сети Wi-Fi.' : '. Проверьте интернет и попробуйте ещё раз.'));
      this.t = null; this.mode = null;
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
    if (m.t === 'welcome') {
      this.myId = m.id;
      if (m.dedicated) {
        this.serverOffset = m.now - Date.now();       // мир идёт по часам сервера
        this.maxPlayers = m.max;
        this.worldT = 0;
      }
      this.send({ t: 'hi', nick: this.nick });
      return;
    }
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
    if (this.dedicated && this.serverOffset != null) {
      this.worldT -= dt;
      if (this.worldT <= 0) {
        this.worldT = 2;
        const w = worldAt(Date.now() + this.serverOffset);
        g.hour = w.hour;
        if ((w.rain ? 1 : 0) !== g.weather.target) g.weather.setRain(w.rain);
      }
    }
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
