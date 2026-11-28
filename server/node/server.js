// Тот же «Сервер #1», но для своего компьютера или VPS: node server.js  (порт 8080 или PORT).
// Протокол как у версии для Cloudflare: "номер|json", номер 0 — сервер.
import http from 'node:http';
import { WebSocketServer } from 'ws';

const MAX = 12;
const PORT = +process.env.PORT || 8080;
const players = new Map();   // ws → id

const send = (ws, line) => { try { ws.send(line); } catch (e) { /* закрывается */ } };
const broadcast = (line, except) => { for (const ws of players.keys()) if (ws !== except) send(ws, line); };

const web = http.createServer((req, res) => {
  if (req.url.startsWith('/status')) {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ name: 'Сервер #1', players: players.size, max: MAX, now: Date.now() }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Sunrise Bay — Сервер #1 работает. Подключение: /ws');
});
const wss = new WebSocketServer({ server: web, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws) => {
  if (players.size >= MAX) { send(ws, '0|{"t":"full"}'); ws.close(1000, 'full'); return; }
  const used = new Set(players.values());
  let id = 1;
  while (used.has(id)) id++;
  players.set(ws, id);
  send(ws, '0|' + JSON.stringify({ t: 'welcome', id, now: Date.now(), dedicated: true, max: MAX }));
  broadcast(id + '|{"t":"join"}', ws);
  ws.on('message', (data) => {
    const msg = data.toString();
    if (msg === 'ping') { send(ws, 'pong'); return; }
    broadcast(id + '|' + msg, ws);
  });
  const gone = () => { if (!players.has(ws)) return; players.delete(ws); broadcast(id + '|{"t":"bye"}', ws); };
  ws.on('close', gone); ws.on('error', gone);
});

web.listen(PORT, () => console.log(`Sunrise Bay: Сервер #1 на порту ${PORT} (ws://адрес:${PORT}/ws)`));
