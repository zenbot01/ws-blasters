import { initState, stepState } from './game/state.js';
import { drawFrame } from './game/render.js';

(() => {
  const canvas = document.getElementById('c');
  const statusEl = document.getElementById('status');
  const hudEl = document.getElementById('hud');
  const ctx = canvas.getContext('2d');

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

  let last = performance.now();
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;

    stepState(state, input, dt, Math.random);

    const player = state.player;
    hudEl.textContent = `Lvl: ${state.level} · HP: ${player.hp}${player.alive ? '' : ' (dead)'} · Score: ${state.score} · Best: ${state.best || 0}`;
    if (!player.alive) setStatus('game over (press R)', false);

    requestAnimationFrame(loop);
  }

  function render() {
    resize();
    drawFrame(ctx, canvas, state);
    requestAnimationFrame(render);
  }

  requestAnimationFrame(loop);
  requestAnimationFrame(render);
})();
