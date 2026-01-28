import { initState, stepState } from './game/state.js';
import { drawFrame } from './game/render.js';

(() => {
  const canvas = document.getElementById('c');
  const statusEl = document.getElementById('status');
  const hudEl = document.getElementById('hud');
  const buildEl = document.getElementById('build');

  if (buildEl) {
    const t = new Date().toISOString();
    buildEl.textContent = `Build: ${t}`;
  }

  const ctx = canvas.getContext('2d');

  const bestKey = 'wsblasters.best';
  const unlockedKey = 'wsblasters.unlockedLevel';
  const continueKey = 'wsblasters.continueCheckpoint';

  let bestScore = 0;
  let unlockedLevel = 1;
  let continueCheckpoint = 1;
  try {
    bestScore = Number(localStorage.getItem(bestKey) || '0') || 0;
    unlockedLevel = Math.max(1, Number(localStorage.getItem(unlockedKey) || '1') || 1);
    continueCheckpoint = Math.max(1, Number(localStorage.getItem(continueKey) || '1') || 1);
  } catch {}

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
    slow: false,
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

    ShiftLeft: 'slow',
    ShiftRight: 'slow',
  };

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  let state;
  let paused = false;

  function startAtLevel(level) {
    const lvl = Math.max(1, Math.min(level, unlockedLevel));
    state = initState(Math.random, Math.max(bestScore, state?.best ?? 0), undefined, lvl);
    setStatus(`single-player (lvl ${lvl})`, true);
  }
  function reset({ continueFromUnlocked = false, continueFromCheckpoint = false } = {}) {
    const startLevel = continueFromCheckpoint ? continueCheckpoint : (continueFromUnlocked ? unlockedLevel : 1);
    state = initState(Math.random, Math.max(bestScore, state?.best ?? 0), undefined, startLevel);
    setStatus('single-player', true);
  }
  reset({ continueFromCheckpoint: continueCheckpoint > 1 || unlockedLevel > 1 });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP') {
      paused = !paused;
      setStatus(paused ? 'paused' : 'single-player', !paused);
      return;
    }
    if (e.code === 'KeyR') {
      reset({ continueFromUnlocked: false });
      return;
    }
    if (e.code === 'KeyC') {
      reset({ continueFromCheckpoint: true });
      return;
    }

    // Jump to any previously-unlocked level.
    // Uses Shift+J so we don't break the IJKL aim cluster (J = aimLeft).
    if (e.code === 'KeyJ' && e.shiftKey) {
      const target = Number(prompt(`Jump to level (1-${unlockedLevel})`, String(Math.min(unlockedLevel, state?.level ?? 1))));
      if (Number.isFinite(target)) startAtLevel(Math.max(1, Math.min(unlockedLevel, Math.floor(target))));
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

    if (!paused) stepState(state, input, dt, Math.random);

    const player = state.player;
    const bossTag = state.enemy?.isBoss ? ' BOSS' : '';
    if (state.best > bestScore) {
      bestScore = state.best;
      try { localStorage.setItem(bestKey, String(bestScore)); } catch {}
    }

    if (state.level > unlockedLevel) {
      unlockedLevel = state.level;
      try { localStorage.setItem(unlockedKey, String(unlockedLevel)); } catch {}
    }

    if (state.checkpointLevel > continueCheckpoint) {
      continueCheckpoint = state.checkpointLevel;
      try { localStorage.setItem(continueKey, String(continueCheckpoint)); } catch {}
    }

    hudEl.textContent = `Lvl: ${state.level}${bossTag} (CP ${state.checkpointLevel}) · Lives: ${state.lives} · HP: ${player.hp}${player.alive ? '' : ' (dead)'} · Score: ${state.score} · Best: ${state.best || 0} · Continue: ${continueCheckpoint} · Unlocked: ${unlockedLevel} · Shift=slow · (R)estart / (C)ontinue / (Shift+J)ump`;
    if (!player.alive) setStatus('game over (R=restart, C=continue)', false);

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
