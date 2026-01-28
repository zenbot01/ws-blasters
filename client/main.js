import { DEFAULTS, initState, stepState } from './game/state.js';

(() => {
  const canvas = document.getElementById('c');
  const statusEl = document.getElementById('status');
  const hudEl = document.getElementById('hud');
  const ctx = canvas.getContext('2d');

  const { W, H, PLAYER_R, BULLET_R } = DEFAULTS;

  function setStatus(s, ok) {
    statusEl.textContent = s;
    statusEl.style.borderColor = ok ? '#2ea043' : '#b42318';
    statusEl.style.color = ok ? '#2ea043' : '#ff7b72';
  }

  setStatus('single-player', true);

  const input = {
    up: false,
    down: false,
    left: false,
    right: false,
    fire: false,
    aimUp: false,
    aimDown: false,
    aimLeft: false,
    aimRight: false,
  };

  const keyMap = {
    KeyW: 'up',
    ArrowUp: 'up',
    KeyS: 'down',
    ArrowDown: 'down',
    KeyA: 'left',
    ArrowLeft: 'left',
    KeyD: 'right',
    ArrowRight: 'right',

    KeyI: 'aimUp',
    KeyK: 'aimDown',
    KeyJ: 'aimLeft',
    KeyL: 'aimRight',

    Space: 'fire',
  };

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  let state;
  function reset() {
    state = initState(Math.random, state?.best ?? 0);
    setStatus('single-player', true);
  }
  reset();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') {
      reset();
      return;
    }
    const k = keyMap[e.code];
    if (!k) return;
    if (k === 'fire') e.preventDefault();
    input[k] = true;
  });
  window.addEventListener('keyup', (e) => {
    const k = keyMap[e.code];
    if (!k) return;
    input[k] = false;
  });

  function letterbox() {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const sx = cw / W;
    const sy = ch / H;
    const s = Math.min(sx, sy);
    const ox = (cw - W * s) / 2;
    const oy = (ch - H * s) / 2;
    return { s, ox, oy };
  }

  function draw() {
    resize();
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0b0f16';
    ctx.fillRect(0, 0, cw, ch);

    const { s, ox, oy } = letterbox();

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);

    // Arena
    ctx.strokeStyle = '#243244';
    ctx.lineWidth = 2 / s;
    ctx.strokeRect(0, 0, W, H);

    const player = state.player;
    const enemy = state.enemy;

    // Player
    ctx.save();
    ctx.globalAlpha = player.alive ? 1 : 0.25;
    ctx.fillStyle = '#1f6feb';
    ctx.beginPath();
    ctx.arc(player.x, player.y, PLAYER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Enemy
    ctx.save();
    ctx.globalAlpha = enemy.alive ? 1 : 0.2;
    ctx.fillStyle = '#d1242f';
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, PLAYER_R, 0, Math.PI * 2);
    ctx.fill();

    // Enemy HP pips
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i < enemy.hp && enemy.alive ? '#fecaca' : '#111827';
      ctx.fillRect(enemy.x - 24 + i * 8, enemy.y - 28, 7, 6);
    }
    ctx.restore();

    // Bullets
    ctx.fillStyle = '#fbbf24';
    for (const b of state.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    requestAnimationFrame(draw);
  }

  let last = performance.now();
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;

    stepState(state, input, dt, Math.random);

    const player = state.player;
    hudEl.textContent = `HP: ${player.hp}${player.alive ? '' : ' (dead)'} · Score: ${state.score} · Best: ${state.best || 0}`;
    if (!player.alive) setStatus('game over (press R)', false);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
  requestAnimationFrame(draw);
})();
