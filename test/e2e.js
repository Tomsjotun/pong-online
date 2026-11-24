'use strict';

/**
 * End-to-end test: two WebSocket clients create/join a room,
 * evade the ball so a point is scored, and assert state advances.
 *
 * Usage:
 *   node test/e2e.js                 # mot http://127.0.0.1:3000
 *   node test/e2e.js http://host:port
 */

const { WebSocket } = require('ws');

const BASE = process.argv[2] || process.env.E2E_URL || 'http://127.0.0.1:3000';
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS) || 20000;

function wsUrl(base) {
  const u = new URL(base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws';
  u.search = '';
  u.hash = '';
  return u.toString();
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => reject(new Error('timeout öppna ws')), 8000);
    ws.once('open', () => { clearTimeout(t); resolve(ws); });
    ws.once('error', (err) => { clearTimeout(t); reject(err); });
  });
}

function waitFor(ws, pred, label, ms = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('timeout: ' + label));
    }, ms);
    function onMsg(raw) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      try {
        if (pred(msg)) {
          clearTimeout(t);
          ws.off('message', onMsg);
          resolve(msg);
        }
      } catch (err) {
        clearTimeout(t);
        ws.off('message', onMsg);
        reject(err);
      }
    }
    ws.on('message', onMsg);
  });
}

function evader(ws) {
  // Park paddle on the opposite side of the ball so a point is scored.
  const handler = (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type !== 'state' || !msg.ball) return;
    const w = (msg.field && msg.field.w) || 200;
    const side = msg.ball.x < w / 2 ? 0.92 : 0.08;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', x: side }));
    }
  };
  ws.on('message', handler);
  return () => ws.off('message', handler);
}

async function main() {
  const steps = [];
  const url = wsUrl(BASE);
  console.log('E2E mot', BASE, '→', url);

  const healthUrl = new URL('/health', BASE).toString();
  const healthRes = await fetch(healthUrl);
  const health = await healthRes.json();
  if (!health.ok) throw new Error('health misslyckades');
  steps.push('health ok');

  const a = await connect(url);
  const b = await connect(url);
  steps.push('två ws anslutna');

  const createdP = waitFor(a, (m) => m.type === 'created', 'created');
  a.send(JSON.stringify({ type: 'create' }));
  const created = await createdP;
  if (!created.code || created.player !== 1) throw new Error('dåligt created: ' + JSON.stringify(created));
  const code = created.code;
  steps.push('rum skapat: ' + code);

  const joinedP = waitFor(b, (m) => m.type === 'joined' || m.type === 'ready', 'joined');
  const readyA = waitFor(a, (m) => m.type === 'ready' || (m.type === 'state' && m.phase === 'countdown'), 'host ready');
  b.send(JSON.stringify({ type: 'join', code }));
  const joined = await joinedP;
  if (joined.player !== 2) throw new Error('gäst skulle vara spelare 2');
  await readyA;
  steps.push('gäst gick med, match startar');

  const startA = await waitFor(a, (m) => m.type === 'state' && (m.phase === 'countdown' || m.phase === 'playing'), 'state countdown/playing');
  if (!startA.scores || startA.scores[1] !== 0 || startA.scores[2] !== 0) {
    throw new Error('startscore ska vara 0-0');
  }
  if (!startA.ball) throw new Error('saknar boll i state');
  steps.push('state mottaget, ställning 0–0');

  const stopA = evader(a);
  const stopB = evader(b);

  const firstBall = startA.ball;
  const moved = await waitFor(a, (m) => {
    if (m.type !== 'state' || !m.ball) return false;
    const dx = Math.abs(m.ball.x - firstBall.x);
    const dy = Math.abs(m.ball.y - firstBall.y);
    return m.phase === 'playing' && (dx > 2 || dy > 2);
  }, 'bollen rör sig', TIMEOUT_MS);

  steps.push(`bollen rörde sig till (${moved.ball.x.toFixed(1)}, ${moved.ball.y.toFixed(1)})`);

  const scored = await waitFor(a, (m) => {
    return m.type === 'state' && m.scores && (m.scores[1] > 0 || m.scores[2] > 0);
  }, 'poäng gjord', TIMEOUT_MS);

  const s1 = scored.scores[1];
  const s2 = scored.scores[2];
  if (s1 + s2 < 1) throw new Error('väntade poäng men fick ' + JSON.stringify(scored.scores));
  steps.push(`poäng registrerad: ${s1}–${s2} (fas ${scored.phase})`);

  // Disconnect guest, host should be notified
  const leftP = waitFor(a, (m) => m.type === 'opponentLeft' || (m.type === 'state' && m.phase === 'disconnected'), 'motståndaren lämnade');
  b.close();
  await leftP;
  steps.push('frånkoppling hanterad');

  stopA();
  stopB();
  a.close();

  console.log('E2E OK');
  for (const s of steps) console.log('  ✓', s);
}

main().catch((err) => {
  console.error('E2E MISSLYCKADES:', err && err.stack ? err.stack : err);
  process.exit(1);
});
