'use strict';

(() => {
  const canvas = document.getElementById('court');
  const lobbyEl = document.getElementById('lobby');
  const waitingEl = document.getElementById('waiting');
  const hudEl = document.getElementById('hud');
  const endcardEl = document.getElementById('endcard');
  const disconnectEl = document.getElementById('disconnect');
  const endTitleEl = document.getElementById('end-title');
  const endScoreEl = document.getElementById('end-score');
  const endWaitEl = document.getElementById('end-wait');
  const lobbyErrorEl = document.getElementById('lobby-error');
  const roomCodeEl = document.getElementById('room-code');
  const copyStatusEl = document.getElementById('copy-status');
  const toastEl = document.getElementById('toast');
  const codeInput = document.getElementById('code-input');
  const installHint = document.getElementById('install-hint');

  const FIELD = { w: 200, h: 320, paddleW: 48, paddleH: 7, paddleMargin: 22, ballR: 4.5, winScore: 7 };

  let ws = null;
  let reconnectTimer = null;
  let playerId = null;
  let roomCode = null;
  let state = null;
  let lastEventsAt = 0;
  let audioCtx = null;
  let audioReady = false;
  let wantReconnect = false;
  let connectedOnce = false;

  if (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches) {
    installHint.hidden = true;
  }

  const params = new URLSearchParams(location.search);
  const rumParam = (params.get('rum') || params.get('room') || '').trim().toUpperCase();
  if (rumParam) codeInput.value = rumParam;

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

  function setLobbyError(msg) {
    if (!msg) {
      lobbyErrorEl.hidden = true;
      lobbyErrorEl.textContent = '';
      return;
    }
    lobbyErrorEl.textContent = msg;
    lobbyErrorEl.hidden = false;
  }

  function toast(msg, ms = 1800) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  function shareUrl() {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('rum', roomCode || '');
    return url.toString();
  }

  function goHome() {
    wantReconnect = false;
    playerId = null;
    roomCode = null;
    state = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'leave' }));
    }
    hide(waitingEl);
    hide(hudEl);
    hide(endcardEl);
    hide(disconnectEl);
    show(lobbyEl);
    setLobbyError('');
    const url = new URL(location.href);
    url.search = '';
    history.replaceState({}, '', url);
  }

  function unlockAudio() {
    if (audioReady) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      // silent buffer to unlock on iOS
      const buf = audioCtx.createBuffer(1, 1, 22050);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(audioCtx.destination);
      src.start(0);
      audioReady = true;
    } catch {
      /* ignore */
    }
  }

  function beep(freq, dur, type = 'square', gain = 0.07, delay = 0) {
    if (!audioReady || !audioCtx) return;
    try {
      const t0 = audioCtx.currentTime + delay;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    } catch {
      /* ignore */
    }
  }

  function playEvents(events) {
    if (!events || !events.length) return;
    for (const ev of events) {
      if (ev === 'paddle') beep(520, 0.07, 'square', 0.08);
      else if (ev === 'wall') beep(280, 0.06, 'square', 0.05);
      else if (ev === 'serve') beep(660, 0.09, 'square', 0.05);
      else if (ev === 'countdown') { beep(440, 0.1, 'square', 0.06); }
      else if (ev === 'score') {
        beep(220, 0.16, 'square', 0.08);
        beep(160, 0.22, 'square', 0.06, 0.12);
      } else if (ev === 'win') {
        beep(392, 0.14, 'square', 0.07, 0);
        beep(494, 0.14, 'square', 0.07, 0.14);
        beep(587, 0.28, 'square', 0.08, 0.28);
      }
    }
  }

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(wsUrl());
    ws.addEventListener('open', () => {
      connectedOnce = true;
      if (wantReconnect && roomCode && !playerId) {
        // mid-game drop without identity — go home rather than steal a seat
      }
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      onMessage(msg);
    });
    ws.addEventListener('close', () => {
      if (!wantReconnect) return;
      if (lobbyEl.hidden === false) return;
      toast('Anslutningen bröts…');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 900);
    });
    ws.addEventListener('error', () => { /* close handler deals with it */ });
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function onMessage(msg) {
    if (msg.type === 'error') {
      if (!lobbyEl.hidden) setLobbyError(msg.message);
      else toast(msg.message, 2500);
      return;
    }
    if (msg.type === 'created') {
      playerId = msg.player;
      roomCode = msg.code;
      wantReconnect = true;
      roomCodeEl.textContent = roomCode;
      hide(lobbyEl);
      hide(hudEl);
      show(waitingEl);
      copyStatusEl.hidden = true;
      const url = new URL(location.href);
      url.searchParams.set('rum', roomCode);
      history.replaceState({}, '', url);
      return;
    }
    if (msg.type === 'joined' || msg.type === 'ready') {
      playerId = msg.player;
      roomCode = msg.code;
      wantReconnect = true;
      hide(lobbyEl);
      hide(waitingEl);
      show(hudEl);
      hide(endcardEl);
      hide(disconnectEl);
      const url = new URL(location.href);
      url.searchParams.set('rum', roomCode);
      history.replaceState({}, '', url);
      return;
    }
    if (msg.type === 'opponentLeft') {
      show(hudEl);
      hide(endcardEl);
      show(disconnectEl);
      return;
    }
    if (msg.type === 'state') {
      if (msg.field) Object.assign(FIELD, msg.field);
      const isNewEvents = msg.events && msg.events.length && msg !== state;
      state = msg;
      if (isNewEvents) playEvents(msg.events);
      if (msg.phase === 'countdown' || msg.phase === 'playing' || msg.phase === 'scored' || msg.phase === 'gameover') {
        hide(lobbyEl);
        hide(waitingEl);
        show(hudEl);
      }
      if (msg.phase === 'gameover') {
        const meWon = msg.winner === playerId;
        endTitleEl.textContent = meWon ? 'Du vann!' : 'Du förlorade!';
        const mine = playerId === 1 ? msg.scores[1] : msg.scores[2];
        const theirs = playerId === 1 ? msg.scores[2] : msg.scores[1];
        endScoreEl.textContent = `${mine} – ${theirs}`;
        const iReady = !!(msg.playAgain && msg.playAgain[playerId]);
        const theyReady = !!(msg.playAgain && msg.playAgain[playerId === 1 ? 2 : 1]);
        endWaitEl.hidden = !(iReady && !theyReady);
        document.getElementById('btn-again').disabled = iReady;
        hide(disconnectEl);
        show(endcardEl);
      } else if (msg.phase === 'disconnected') {
        show(hudEl);
        hide(endcardEl);
        show(disconnectEl);
      } else {
        hide(endcardEl);
        hide(disconnectEl);
      }
      return;
    }
  }

  // --- rendering ---
  const ctx = canvas.getContext('2d');

  function resize() {
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  function fieldToScreen() {
    const W = canvas.width;
    const H = canvas.height;
    const scale = Math.min(W / FIELD.w, H / FIELD.h);
    const ox = (W - FIELD.w * scale) / 2;
    const oy = (H - FIELD.h * scale) / 2;
    return { scale, ox, oy };
  }

  function flipY(y) {
    // Player 2 has the top paddle in server coords; show self at the bottom.
    return playerId === 2 ? FIELD.h - y : y;
  }

  function draw() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;

    const { scale, ox, oy } = fieldToScreen();
    ctx.setTransform(scale, 0, 0, scale, ox, oy);

    // dashed mid line (horizontal net)
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(8, FIELD.h / 2);
    ctx.lineTo(FIELD.w - 8, FIELD.h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // scores
    const s = state && state.scores ? state.scores : { 1: 0, 2: 0 };
    const myScore = playerId === 2 ? s[2] : s[1];
    const theirScore = playerId === 2 ? s[1] : s[2];
    ctx.fillStyle = '#fff';
    ctx.font = '32px "Courier New", Courier, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(theirScore), FIELD.w / 2, FIELD.h * 0.28);
    ctx.fillText(String(myScore), FIELD.w / 2, FIELD.h * 0.72);

    if (state && (state.phase === 'countdown' || state.phase === 'scored' || state.phase === 'waiting')) {
      ctx.font = '20px "Courier New", Courier, monospace';
      ctx.fillStyle = '#fff';
      let label = '';
      if (state.phase === 'countdown' && state.countdown > 0) label = String(state.countdown);
      else if (state.phase === 'waiting') label = '';
      if (label) ctx.fillText(label, FIELD.w / 2, FIELD.h / 2);
    }

    function drawPaddle(px, py) {
      const y = flipY(py);
      ctx.fillStyle = '#fff';
      ctx.fillRect(px - FIELD.paddleW / 2, y - FIELD.paddleH / 2, FIELD.paddleW, FIELD.paddleH);
    }

    const p1y = FIELD.h - FIELD.paddleMargin;
    const p2y = FIELD.paddleMargin;
    if (state) {
      drawPaddle(state.p1.x, p1y);
      drawPaddle(state.p2.x, p2y);
      const by = flipY(state.ball.y);
      ctx.fillRect(state.ball.x - FIELD.ballR, by - FIELD.ballR, FIELD.ballR * 2, FIELD.ballR * 2);
    } else {
      // decorative idle paddles
      drawPaddle(FIELD.w / 2, p1y);
      drawPaddle(FIELD.w / 2, p2y);
      ctx.fillRect(FIELD.w / 2 - FIELD.ballR, FIELD.h / 2 - FIELD.ballR, FIELD.ballR * 2, FIELD.ballR * 2);
    }

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  // --- input ---
  let sending = false;
  let lastSent = 0;

  function pointerToNormX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const { scale, ox } = fieldToScreen();
    const dpr = canvas.width / rect.width;
    const xCss = clientX - rect.left;
    const fieldX = (xCss * dpr - ox) / scale;
    return Math.max(0, Math.min(1, fieldX / FIELD.w));
  }

  function onPointer(clientX) {
    if (!playerId) return;
    if (!state || state.phase === 'waiting' || state.phase === 'disconnected') return;
    const x = pointerToNormX(clientX);
    const now = performance.now();
    if (now - lastSent < 16 && sending) return;
    lastSent = now;
    sending = true;
    send({ type: 'input', x });
    sending = false;
  }

  canvas.addEventListener('pointerdown', (e) => {
    unlockAudio();
    canvas.setPointerCapture(e.pointerId);
    onPointer(e.clientX);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons || e.pointerType === 'touch') onPointer(e.clientX);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchstart', (e) => {
    unlockAudio();
    if (e.touches[0]) onPointer(e.touches[0].clientX);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches[0]) onPointer(e.touches[0].clientX);
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (e.target.closest && e.target.closest('#code-input')) return;
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  // --- UI ---
  document.getElementById('btn-create').addEventListener('click', () => {
    unlockAudio();
    setLobbyError('');
    connect();
    const tryCreate = () => send({ type: 'create' });
    if (ws.readyState === WebSocket.OPEN) tryCreate();
    else ws.addEventListener('open', tryCreate, { once: true });
  });

  document.getElementById('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    unlockAudio();
    const code = (codeInput.value || '').trim().toUpperCase();
    if (!code || code.length < 4) {
      setLobbyError('Ange en giltig kod (4 tecken).');
      return;
    }
    setLobbyError('');
    connect();
    const tryJoin = () => send({ type: 'join', code });
    if (ws.readyState === WebSocket.OPEN) tryJoin();
    else ws.addEventListener('open', tryJoin, { once: true });
  });

  document.getElementById('btn-cancel').addEventListener('click', goHome);
  document.getElementById('btn-home').addEventListener('click', goHome);
  document.getElementById('btn-disc-home').addEventListener('click', goHome);

  document.getElementById('btn-again').addEventListener('click', () => {
    unlockAudio();
    send({ type: 'playAgain' });
    endWaitEl.hidden = false;
    document.getElementById('btn-again').disabled = true;
  });

  document.getElementById('btn-copy').addEventListener('click', async () => {
    const url = shareUrl();
    try {
      await navigator.clipboard.writeText(url);
      copyStatusEl.textContent = 'Länken är kopierad.';
    } catch {
      copyStatusEl.textContent = url;
    }
    copyStatusEl.hidden = false;
  });

  document.getElementById('btn-share').addEventListener('click', async () => {
    const url = shareUrl();
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Pong Online',
          text: `Spela Pong med mig! Kod: ${roomCode}`,
          url,
        });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      copyStatusEl.textContent = 'Länken är kopierad.';
    } catch {
      copyStatusEl.textContent = url;
    }
    copyStatusEl.hidden = false;
  });

  document.addEventListener('pointerdown', unlockAudio, { once: false });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  connect();

  // Auto-join from shared link after socket is up — user still taps Gå med,
  // but the code is prefilled. If they arrived via a link, join automatically
  // once they interact, and also try immediately (works when not needing a gesture).
  if (rumParam) {
    const auto = () => {
      if (playerId) return;
      send({ type: 'join', code: rumParam });
    };
    if (ws.readyState === WebSocket.OPEN) auto();
    else ws.addEventListener('open', auto, { once: true });
  }
})();
