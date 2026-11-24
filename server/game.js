'use strict';

const WIDTH = 200;
const HEIGHT = 320;
const PADDLE_W = 48;
const PADDLE_H = 7;
const PADDLE_MARGIN = 22;
const BALL_R = 4.5;
const PADDLE_SPEED = 320;
const BALL_SPEED = 170;
const BALL_SPEED_INC = 1.06;
const MAX_BALL_SPEED = 420;
const WIN_SCORE = 7;
const TICK_DT = 1 / 60;
const SERVE_DELAY = 1.15;
const COUNTDOWN_SEC = 3;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function randomCode(len = 4) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = { 1: null, 2: null };
    this.phase = 'waiting';
    this.countdown = 0;
    this.serveTimer = 0;
    this.serveToward = 1;
    this.scores = { 1: 0, 2: 0 };
    this.winner = null;
    this.events = [];
    this.playAgain = { 1: false, 2: false };
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.p1 = { x: WIDTH / 2, targetX: WIDTH / 2 };
    this.p2 = { x: WIDTH / 2, targetX: WIDTH / 2 };
    this.ball = { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0 };
  }

  get p1Y() {
    return HEIGHT - PADDLE_MARGIN;
  }

  get p2Y() {
    return PADDLE_MARGIN;
  }

  addPlayer(ws) {
    if (!this.players[1]) {
      this.players[1] = ws;
      ws.roomCode = this.code;
      ws.playerId = 1;
      this.lastActivity = Date.now();
      return 1;
    }
    if (!this.players[2]) {
      this.players[2] = ws;
      ws.roomCode = this.code;
      ws.playerId = 2;
      this.lastActivity = Date.now();
      this.beginMatch();
      return 2;
    }
    return 0;
  }

  removePlayer(ws) {
    const id = ws.playerId;
    if (id && this.players[id] === ws) {
      this.players[id] = null;
      this.lastActivity = Date.now();
      if (this.phase !== 'waiting') {
        this.phase = 'disconnected';
        this.events.push('disconnect');
      }
    }
  }

  occupied() {
    return Number(!!this.players[1]) + Number(!!this.players[2]);
  }

  beginMatch() {
    this.scores = { 1: 0, 2: 0 };
    this.winner = null;
    this.playAgain = { 1: false, 2: false };
    this.p1.x = this.p1.targetX = WIDTH / 2;
    this.p2.x = this.p2.targetX = WIDTH / 2;
    this.resetBall(Math.random() < 0.5 ? 1 : -1, true);
    this.phase = 'countdown';
    this.countdown = COUNTDOWN_SEC;
    this.events.push('countdown');
  }

  resetBall(toward, freeze) {
    this.ball.x = WIDTH / 2;
    this.ball.y = HEIGHT / 2;
    const angle = (Math.random() * 0.7 - 0.35);
    const speed = BALL_SPEED;
    this.ball.vx = Math.sin(angle) * speed;
    this.ball.vy = toward * Math.cos(angle) * speed;
    this.serveToward = toward;
    if (freeze) {
      this.ball._svx = this.ball.vx;
      this.ball._svy = this.ball.vy;
      this.ball.vx = 0;
      this.ball.vy = 0;
    }
  }

  releaseServe() {
    if (this.ball._svx != null) {
      this.ball.vx = this.ball._svx;
      this.ball.vy = this.ball._svy;
      delete this.ball._svx;
      delete this.ball._svy;
    }
  }

  setInput(playerId, targetX) {
    if (playerId !== 1 && playerId !== 2) return;
    const paddle = playerId === 1 ? this.p1 : this.p2;
    // targetX is normalized 0..1 (paddle center)
    paddle.targetX = clamp(targetX * WIDTH, PADDLE_W / 2, WIDTH - PADDLE_W / 2);
    this.lastActivity = Date.now();
  }

  requestPlayAgain(playerId) {
    if (this.phase !== 'gameover' && this.phase !== 'disconnected') return;
    if (this.phase === 'disconnected') return;
    this.playAgain[playerId] = true;
    this.lastActivity = Date.now();
    if (this.playAgain[1] && this.playAgain[2] && this.players[1] && this.players[2]) {
      this.beginMatch();
    }
  }

  tick(dt) {
    this.events = [];
    this._movePaddle(this.p1, dt);
    this._movePaddle(this.p2, dt);

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.phase = 'playing';
        this.releaseServe();
        this.events.push('serve');
      }
      return;
    }

    if (this.phase === 'scored') {
      this.serveTimer -= dt;
      if (this.serveTimer <= 0) {
        this.phase = 'playing';
        this.releaseServe();
        this.events.push('serve');
      }
      return;
    }

    if (this.phase !== 'playing') return;

    const b = this.ball;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x - BALL_R <= 0) {
      b.x = BALL_R;
      b.vx = Math.abs(b.vx);
      this.events.push('wall');
    } else if (b.x + BALL_R >= WIDTH) {
      b.x = WIDTH - BALL_R;
      b.vx = -Math.abs(b.vx);
      this.events.push('wall');
    }

    this._paddleCollision(this.p1, this.p1Y, 1);
    this._paddleCollision(this.p2, this.p2Y, -1);

    if (b.y > HEIGHT + BALL_R) {
      this._score(2, -1);
    } else if (b.y < -BALL_R) {
      this._score(1, 1);
    }
  }

  _movePaddle(p, dt) {
    const max = PADDLE_SPEED * dt;
    const dx = clamp(p.targetX - p.x, -max, max);
    p.x = clamp(p.x + dx, PADDLE_W / 2, WIDTH - PADDLE_W / 2);
  }

  _paddleCollision(paddle, paddleY, normal) {
    const b = this.ball;
    // normal: 1 means bounce upward (bottom paddle), -1 downward (top)
    const halfW = PADDLE_W / 2;
    const halfH = PADDLE_H / 2;
    const dx = b.x - paddle.x;
    const dy = b.y - paddleY;
    const px = halfW + BALL_R;
    const py = halfH + BALL_R;
    if (Math.abs(dx) > px || Math.abs(dy) > py) return;

    // Only accept hits from the court side, and when moving into the paddle
    if (normal === 1 && b.vy < 0) return;
    if (normal === -1 && b.vy > 0) return;

    const offset = clamp(dx / halfW, -1, 1);
    const maxAngle = 1.05; // ~60 degrees from vertical
    const angle = offset * maxAngle;
    const current = Math.hypot(b.vx, b.vy) || BALL_SPEED;
    const speed = Math.min(Math.max(current * BALL_SPEED_INC, BALL_SPEED), MAX_BALL_SPEED);
    b.vx = Math.sin(angle) * speed;
    b.vy = -normal * Math.cos(angle) * speed;
    b.y = paddleY - normal * (halfH + BALL_R + 0.4);
    this.events.push('paddle');
  }

  _score(scorer, nextToward) {
    this.scores[scorer] += 1;
    this.events.push('score');
    if (this.scores[scorer] >= WIN_SCORE) {
      this.phase = 'gameover';
      this.winner = scorer;
      this.playAgain = { 1: false, 2: false };
      this.ball.vx = 0;
      this.ball.vy = 0;
      this.events.push('win');
      return;
    }
    this.phase = 'scored';
    this.serveTimer = SERVE_DELAY;
    this.resetBall(nextToward, true);
  }

  snapshot() {
    return {
      type: 'state',
      code: this.code,
      phase: this.phase,
      countdown: Math.ceil(Math.max(0, this.countdown)),
      ball: { x: this.ball.x, y: this.ball.y, vx: this.ball.vx, vy: this.ball.vy },
      p1: { x: this.p1.x },
      p2: { x: this.p2.x },
      scores: { 1: this.scores[1], 2: this.scores[2] },
      winner: this.winner,
      playAgain: { 1: this.playAgain[1], 2: this.playAgain[2] },
      events: this.events.slice(),
      field: { w: WIDTH, h: HEIGHT, paddleW: PADDLE_W, paddleH: PADDLE_H, paddleMargin: PADDLE_MARGIN, ballR: BALL_R, winScore: WIN_SCORE },
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this._timer = setInterval(() => this._tickAll(), 1000 / 60);
    this._cleanup = setInterval(() => this._reap(), 30_000);
  }

  createRoom() {
    let code;
    do {
      code = randomCode(4);
    } while (this.rooms.has(code));
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    if (!code) return null;
    return this.rooms.get(String(code).trim().toUpperCase()) || null;
  }

  send(ws, obj) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(obj));
    }
  }

  broadcast(room) {
    const snap = room.snapshot();
    const msg = JSON.stringify(snap);
    for (const id of [1, 2]) {
      const ws = room.players[id];
      if (ws && ws.readyState === 1) ws.send(msg);
    }
  }

  handleMessage(ws, data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return this.send(ws, { type: 'error', message: 'Ogiltigt meddelande' });
    }
    const type = msg && msg.type;
    if (type === 'create') {
      if (ws.roomCode) this.leave(ws);
      const room = this.createRoom();
      const id = room.addPlayer(ws);
      this.send(ws, { type: 'created', code: room.code, player: id });
      this.send(ws, room.snapshot());
      return;
    }
    if (type === 'join') {
      const room = this.get(msg.code);
      if (!room) {
        return this.send(ws, { type: 'error', message: 'Rummet finns inte. Kontrollera koden.' });
      }
      if (room.occupied() >= 2) {
        return this.send(ws, { type: 'error', message: 'Rummet är fullt.' });
      }
      if (room.phase === 'disconnected') {
        return this.send(ws, { type: 'error', message: 'Spelet är slut. Skapa ett nytt.' });
      }
      if (ws.roomCode) this.leave(ws);
      const id = room.addPlayer(ws);
      this.send(ws, { type: 'joined', code: room.code, player: id });
      // Notify both
      this.broadcast(room);
      for (const pid of [1, 2]) {
        this.send(room.players[pid], { type: 'ready', code: room.code, player: pid });
      }
      return;
    }
    if (type === 'input') {
      const room = this.get(ws.roomCode);
      if (!room || !ws.playerId) return;
      if (typeof msg.x === 'number' && Number.isFinite(msg.x)) {
        room.setInput(ws.playerId, msg.x);
      }
      return;
    }
    if (type === 'playAgain') {
      const room = this.get(ws.roomCode);
      if (!room || !ws.playerId) return;
      room.requestPlayAgain(ws.playerId);
      this.broadcast(room);
      return;
    }
    if (type === 'leave') {
      this.leave(ws);
      return;
    }
  }

  leave(ws) {
    const room = this.get(ws.roomCode);
    if (!room) {
      ws.roomCode = null;
      ws.playerId = null;
      return;
    }
    room.removePlayer(ws);
    ws.roomCode = null;
    ws.playerId = null;
    const other = room.players[1] || room.players[2];
    if (other) {
      this.send(other, { type: 'opponentLeft', code: room.code });
      this.broadcast(room);
    } else {
      this.rooms.delete(room.code);
    }
  }

  _tickAll() {
    for (const room of this.rooms.values()) {
      if (room.phase === 'waiting' || room.phase === 'disconnected' || room.phase === 'gameover') {
        // still move paddles slightly? skip physics, but broadcast rarely not needed
        continue;
      }
      room.tick(TICK_DT);
      this.broadcast(room);
    }
  }

  _reap() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const empty = room.occupied() === 0;
      const stale = now - room.lastActivity > 15 * 60 * 1000;
      const waitingTooLong = room.phase === 'waiting' && now - room.createdAt > 30 * 60 * 1000;
      if (empty || stale || waitingTooLong) {
        for (const id of [1, 2]) {
          const ws = room.players[id];
          if (ws) {
            this.send(ws, { type: 'error', message: 'Rummet stängdes på grund av inaktivitet.' });
            ws.roomCode = null;
            ws.playerId = null;
          }
        }
        this.rooms.delete(code);
      }
    }
  }

  stop() {
    clearInterval(this._timer);
    clearInterval(this._cleanup);
  }
}

module.exports = { RoomManager, Room, WIDTH, HEIGHT, WIN_SCORE, TICK_DT };
