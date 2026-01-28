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
  const continueLivesKey = 'wsblasters.continueLives';
  const continueScoreKey = 'wsblasters.continueScore';

  // Mid-run save (resume where you left off)
  const saveLevelKey = 'wsblasters.saveLevel';
  const saveCheckpointKey = 'wsblasters.saveCheckpoint';
  const saveLivesKey = 'wsblasters.saveLives';
  const saveScoreKey = 'wsblasters.saveScore';

  let bestScore = 0;
  let unlockedLevel = 1;
  let continueCheckpoint = 1;
  let continueLives = 3;
  let continueScore = 0;

  let savedLevel = 1;
  let savedCheckpoint = 1;
  let savedLives = 3;
  let savedScore = 0;
  try {
    bestScore = Number(localStorage.getItem(bestKey) || '0') || 0;
    unlockedLevel = Math.max(1, Number(localStorage.getItem(unlockedKey) || '1') || 1);
    continueCheckpoint = Math.max(1, Number(localStorage.getItem(continueKey) || '1') || 1);
    continueLives = Math.max(1, Number(localStorage.getItem(continueLivesKey) || '3') || 3);
    continueScore = Math.max(0, Number(localStorage.getItem(continueScoreKey) || '0') || 0);

    savedLevel = Math.max(1, Number(localStorage.getItem(saveLevelKey) || '1') || 1);
    savedCheckpoint = Math.max(1, Number(localStorage.getItem(saveCheckpointKey) || '1') || 1);
    savedLives = Math.max(0, Number(localStorage.getItem(saveLivesKey) || '3') || 3);
    savedScore = Math.max(0, Number(localStorage.getItem(saveScoreKey) || '0') || 0);
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

    // Pointer-based aim (mouse/touch). When present, it overrides IJKL aim.
    aimVec: null,
  };

  /* touch-controls */
  const touch = {
    enabled: false,
    left: { id: null, x0: 0, y0: 0, x: 0, y: 0 },
    right: { id: null, x0: 0, y0: 0, x: 0, y: 0 },
  };

  function setTouchEnabled() {
    try {
      touch.enabled = (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        ('ontouchstart' in window);
    } catch {
      touch.enabled = false;
    }
    const el = document.getElementById('touch');
    if (el) {
      el.style.display = touch.enabled ? 'block' : 'none';
      el.style.pointerEvents = touch.enabled ? 'auto' : 'none';
    }

    // touch guides
    const padL = document.getElementById('padL');
    const padR = document.getElementById('padR');
    if (padL) { padL.style.display = touch.enabled ? 'block' : 'none'; padL.style.transform = 'translate(22px, calc(100vh - 142px))'; }
    if (padR) { padR.style.display = touch.enabled ? 'block' : 'none'; padR.style.transform = 'translate(calc(100vw - 142px), calc(100vh - 142px))'; }
  }

  function applyTouchToInput() {
    const maxR = 48;

    if (touch.left.id != null) {
      const dx = touch.left.x - touch.left.x0;
      const dy = touch.left.y - touch.left.y0;
      const nx = Math.max(-1, Math.min(1, dx / maxR));
      const ny = Math.max(-1, Math.min(1, dy / maxR));
      input.left = nx < -0.25;
      input.right = nx > 0.25;
      input.up = ny < -0.25;
      input.down = ny > 0.25;
    }

    if (touch.right.id != null) {
      const dx = touch.right.x - touch.right.x0;
      const dy = touch.right.y - touch.right.y0;
      const m = Math.hypot(dx, dy);
      const nx = m < 10 ? 0 : dx / m;
      const ny = m < 10 ? 0 : dy / m;
      input.aimLeft = nx < -0.35;
      input.aimRight = nx > 0.35;
      input.aimUp = ny < -0.35;
      input.aimDown = ny > 0.35;
      input.fire = m >= 14;
    }
  }

  function setupTouch() {
    setTouchEnabled();
    const root = document.getElementById('touch');
    const stickL = document.getElementById('stickL');
    const stickR = document.getElementById('stickR');
    if (!touch.enabled || !root || !stickL || !stickR) return;

    function start(side, t) {
      side.id = t.identifier;
      side.x0 = t.clientX;
      side.y0 = t.clientY;
      side.x = t.clientX;
      side.y = t.clientY;
    }
    function move(side, t) {
      side.x = t.clientX;
      side.y = t.clientY;
    }
    function end(side) {
      side.id = null;
    }
    function find(ev, id) {
      for (const t of ev.touches) if (t.identifier === id) return t;
      return null;
    }

    function onStart(ev, which) {
      ev.preventDefault();
      const t = ev.changedTouches[0];
      if (!t) return;
      if (which === 'L' && touch.left.id == null) start(touch.left, t);
      if (which === 'R' && touch.right.id == null) start(touch.right, t);
      applyTouchToInput();
    }
    function onMove(ev) {
      ev.preventDefault();
      if (touch.left.id != null) {
        const t = find(ev, touch.left.id);
        if (t) move(touch.left, t);
      }
      if (touch.right.id != null) {
        const t = find(ev, touch.right.id);
        if (t) move(touch.right, t);
      }
      applyTouchToInput();
    }
    function onEnd(ev) {
      ev.preventDefault();
      for (const t of ev.changedTouches) {
        if (touch.left.id === t.identifier) end(touch.left);
        if (touch.right.id === t.identifier) end(touch.right);
      }
      // release
      if (touch.left.id == null) input.left = input.right = input.up = input.down = false;
      if (touch.right.id == null) {
        input.aimLeft = input.aimRight = input.aimUp = input.aimDown = false;
        input.fire = false;
      }
    }

    stickL.addEventListener('touchstart', (e) => onStart(e, 'L'), { passive: false });
    stickR.addEventListener('touchstart', (e) => onStart(e, 'R'), { passive: false });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd, { passive: false });
    root.addEventListener('touchcancel', onEnd, { passive: false });
  }

  setupTouch();

  // Mouse aim + click-to-fire (makes the game much easier to pick up on desktop).
  function pointerToAimVec(ev) {
    if (!state?.player) return null;

    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;

    const { W, H } = state.cfg;
    const cw = rect.width;
    const ch = rect.height;

    // Same letterbox math as render.js
    const s = Math.min(cw / W, ch / H);
    const ox = (cw - W * s) / 2;
    const oy = (ch - H * s) / 2;

    const wx = (px - ox) / s;
    const wy = (py - oy) / s;

    const dx = wx - state.player.x;
    const dy = wy - state.player.y;
    const m = Math.hypot(dx, dy);
    if (!Number.isFinite(m) || m < 1) return null;
    return { x: dx / m, y: dy / m };
  }

  canvas.addEventListener('pointermove', (ev) => {
    input.aimVec = pointerToAimVec(ev);
  });
  canvas.addEventListener('pointerleave', () => {
    input.aimVec = null;
  });
  canvas.addEventListener('pointerdown', (ev) => {
    // Prevent accidental scroll/drag selection while playing.
    ev.preventDefault();
    input.aimVec = pointerToAimVec(ev);
    input.fire = true;
  });
  window.addEventListener('pointerup', () => {
    input.fire = false;
  });

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
  let autoPaused = false;

  // QoL: auto-pause when the tab is hidden (prevents cheap deaths while alt-tabbed).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (!paused) {
        paused = true;
        autoPaused = true;
        setStatus('paused (tab hidden)', false);
      }

      // Also do a quick save when backgrounding.
      try {
        if (state?.player?.alive) {
          localStorage.setItem(saveLevelKey, String(state.level));
          localStorage.setItem(saveCheckpointKey, String(state.checkpointLevel));
          localStorage.setItem(saveLivesKey, String(state.lives));
          localStorage.setItem(saveScoreKey, String(state.score));
        }
      } catch {}
    } else if (autoPaused) {
      paused = false;
      autoPaused = false;
      setStatus('single-player', true);
    }
  });

  window.addEventListener('beforeunload', () => {
    try {
      if (state?.player?.alive) {
        localStorage.setItem(saveLevelKey, String(state.level));
        localStorage.setItem(saveCheckpointKey, String(state.checkpointLevel));
        localStorage.setItem(saveLivesKey, String(state.lives));
        localStorage.setItem(saveScoreKey, String(state.score));
      }
    } catch {}
  });

  function startAtLevel(level) {
    const lvl = Math.max(1, Math.min(level, unlockedLevel));
    state = initState(Math.random, Math.max(bestScore, state?.best ?? 0), undefined, lvl);
    setStatus(`single-player (lvl ${lvl})`, true);
  }

  function resumeSavedRun() {
    const lvl = Math.max(1, Math.min(savedLevel || 1, unlockedLevel || 1));
    state = initState(Math.random, Math.max(bestScore, state?.best ?? 0), undefined, lvl);
    state.checkpointLevel = Math.max(1, savedCheckpoint || 1);
    state.lives = Math.max(1, savedLives || state.lives);
    state.score = Math.max(0, savedScore || state.score);
    setStatus(`single-player (resume lvl ${lvl})`, true);
  }

  function reset({ continueFromUnlocked = false, continueFromCheckpoint = false, resumeFromSave = false } = {}) {
    if (resumeFromSave && savedLives > 0 && savedLevel > 1) {
      resumeSavedRun();
      return;
    }

    const startLevel = continueFromCheckpoint ? continueCheckpoint : (continueFromUnlocked ? unlockedLevel : 1);
    state = initState(Math.random, Math.max(bestScore, state?.best ?? 0), undefined, startLevel);

    // Progress saving: when continuing from a checkpoint, keep the lives + score you had
    // when you last reached that checkpoint. (Makes "continue" feel real.)
    if (continueFromCheckpoint && continueCheckpoint > 1) {
      state.lives = Math.max(1, continueLives || state.lives);
      state.score = Math.max(0, continueScore || state.score);
    }

    setStatus('single-player', true);
  }

  // Default boot: if we have a mid-run save that's ahead of our checkpoint, prefer that.
  reset({ resumeFromSave: savedLevel > continueCheckpoint && savedLives > 0 });

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
    if (e.code === 'KeyV') {
      reset({ resumeFromSave: true });
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

  // Throttled mid-run autosave (so refresh/close doesn't nuke progress).
  let lastSaveAt = 0;
  let lastSavedSig = '';

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
      continueLives = state.lives;
      continueScore = state.score;
      try {
        localStorage.setItem(continueKey, String(continueCheckpoint));
        localStorage.setItem(continueLivesKey, String(continueLives));
        localStorage.setItem(continueScoreKey, String(continueScore));
      } catch {}
    }

    // Mid-run autosave (resume exactly where you were).
    // Saved at a low frequency to keep it cheap.
    if (player.alive && !paused) {
      const now = t / 1000;
      if (now - lastSaveAt >= 1.6) {
        const sig = `${state.level}|${state.checkpointLevel}|${state.lives}|${state.score}`;
        if (sig !== lastSavedSig) {
          savedLevel = state.level;
          savedCheckpoint = state.checkpointLevel;
          savedLives = state.lives;
          savedScore = state.score;
          try {
            localStorage.setItem(saveLevelKey, String(savedLevel));
            localStorage.setItem(saveCheckpointKey, String(savedCheckpoint));
            localStorage.setItem(saveLivesKey, String(savedLives));
            localStorage.setItem(saveScoreKey, String(savedScore));
          } catch {}
          lastSavedSig = sig;
        }
        lastSaveAt = now;
      }
    }

    hudEl.textContent = `Lvl: ${state.level}${bossTag} (CP ${state.checkpointLevel}) · Lives: ${state.lives} · HP: ${player.hp}${player.alive ? '' : ' (dead)'} · Score: ${state.score} · Best: ${state.best || 0} · Continue: ${continueCheckpoint} (Lives ${continueLives}, Score ${continueScore}) · Save: ${savedLevel} (Lives ${savedLives}, Score ${savedScore}) · Unlocked: ${unlockedLevel} · Shift=slow · (R)estart / (C)ontinue / (V)resume save / (Shift+J)ump`;
    if (!player.alive) setStatus('game over (R=restart, C=continue, V=resume)', false);

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
