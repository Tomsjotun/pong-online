'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { RoomManager } = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));
app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.rooms.size, uptime: process.uptime() });
});
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new RoomManager();

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.roomCode = null;
  ws.playerId = null;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    try {
      rooms.handleMessage(ws, data.toString());
    } catch (err) {
      console.error('handleMessage', err);
      rooms.send(ws, { type: 'error', message: 'Ett fel uppstod.' });
    }
  });
  ws.on('close', () => {
    rooms.leave(ws);
  });
  ws.on('error', () => {
    rooms.leave(ws);
  });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log('anslutning', ip);
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      rooms.leave(ws);
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 15000);

function shutdown() {
  clearInterval(heartbeat);
  rooms.stop();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`Pong lyssnar på http://${HOST}:${PORT}`);
});

module.exports = { server, rooms };
