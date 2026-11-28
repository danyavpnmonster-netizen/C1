// Выделенный сервер Sunrise Bay: всегда доступен, игроку не нужен телефон-хозяин.
// Каждый подключившийся получает номер 1…MAX; сервер пересылает строки всем остальным
// в виде "номер|json" (номер 0 — сам сервер). Время суток и погода считаются по часам
// сервера, поэтому мир один и тот же для всех, даже если зайти через сутки.
import { DurableObject } from 'cloudflare:workers';

const MAX = 12;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const room = env.ROOM.get(env.ROOM.idFromName(url.searchParams.get('room') || 'server-1'));
    if (url.pathname === '/ws') return room.fetch(req);
    if (url.pathname === '/status') return room.fetch(new Request(new URL('/status', req.url)));
    return new Response('Sunrise Bay — Сервер #1 работает. Подключение: /ws', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};

export class Room extends DurableObject {
  async fetch(req) {
    const url = new URL(req.url);
    const sockets = this.ctx.getWebSockets();
    if (url.pathname === '/status') {
      return Response.json({ name: 'Сервер #1', players: sockets.length, max: MAX, now: Date.now() },
        { headers: { 'access-control-allow-origin': '*' } });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Нужно WebSocket-подключение', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    if (sockets.length >= MAX) {
      server.accept();
      server.send('0|{"t":"full"}');
      server.close(1000, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    const used = new Set(sockets.map((ws) => (ws.deserializeAttachment() || {}).id));
    let id = 1;
    while (used.has(id)) id++;
    // «спящие» соединения: пока никто не пишет, сервер ничего не тратит
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id });
    server.send('0|' + JSON.stringify({ t: 'welcome', id, now: Date.now(), dedicated: true, max: MAX }));
    this.broadcast(id + '|{"t":"join"}', server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 4000) return;
    if (msg === 'ping') { ws.send('pong'); return; }
    const { id } = ws.deserializeAttachment() || {};
    if (!id) return;
    this.broadcast(id + '|' + msg, ws);
  }

  webSocketClose(ws, code) { this.leave(ws); try { ws.close(code, 'bye'); } catch (e) { /* уже закрыт */ } }
  webSocketError(ws) { this.leave(ws); }

  leave(ws) {
    const a = ws.deserializeAttachment() || {};
    if (a.gone) return;
    ws.serializeAttachment({ ...a, gone: true });
    if (a.id) this.broadcast(a.id + '|{"t":"bye"}', ws);
  }

  broadcast(line, except) {
    for (const s of this.ctx.getWebSockets()) {
      if (s === except) continue;
      try { s.send(line); } catch (e) { /* закрывается */ }
    }
  }
}
