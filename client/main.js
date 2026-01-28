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
  const saveHpKey = 'wsblasters.saveHp';

  let bestScore = 0;
  let unlockedLevel = 1;
  let continueCheckpoint = 1;
  let continueLives = 3;
  let continueScore = 0;

  let savedLevel = 1;
  let savedCheckpoint = 1;
  let savedLives = 3;
  let savedScore = 0;
  let savedHp = 3;
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
    savedHp = Math.max(1, Math.min(3, Number(localStorage.getItem(saveHpKey) || '3') || 3));
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

  // QoL: when pausing (manual or auto), clear "sticky" inputs.
  // Prevents accidental resume-shots if the user alt-tabs or pauses mid-click.
  function clearTransientInput() {
    input.up = input.down = input.left = input.right = false;
    input.aimUp = input.aimDown = input.aimLeft = input.aimRight = false;
    input.fire = false;
    input.aimVec = null;
  }

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
        clearTransientInput();
      }

      // Also do a quick save when backgrounding.
      try {
        if (state?.player?.alive) {
          localStorage.setItem(saveLevelKey, String(state.level));
          localStorage.setItem(saveCheckpointKey, String(state.checkpointLevel));
          localStorage.setItem(saveLivesKey, String(state.lives));
          localStorage.setItem(saveScoreKey, String(state.score));
          localStorage.setItem(saveHpKey, String(state.player.hp));
        }
      } catch {}
    } else if (autoPaused) {
      paused = false;
      autoPaused = false;
      setStatus('single-player', true);
    }
  });

  // QoL: also auto-pause when the window loses focus (alt-tab, click elsewhere).
  // Similar to the tab-hidden case, but catches focus changes that don't trigger
  // visibilitychange on some platforms.
  window.addEventListener('blur', () => {
    if (!paused) {
      paused = true;
      autoPaused = true;
      setStatus('paused (focus lost)', false);
      clearTransientInput();
    }

    // Quick save on focus loss.
    try {
      if (state?.player?.alive) {
        localStorage.setItem(saveLevelKey, String(state.level));
        localStorage.setItem(saveCheckpointKey, String(state.checkpointLevel));
        localStorage.setItem(saveLivesKey, String(state.lives));
        localStorage.setItem(saveScoreKey, String(state.score));
        localStorage.setItem(saveHpKey, String(state.player.hp));
      }
    } catch {}
  });
  window.addEventListener('focus', () => {
    if (!document.hidden && autoPaused) {
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
        localStorage.setItem(saveHpKey, String(state.player.hp));
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
    state.player.hp = Math.max(1, Math.min(3, savedHp || state.player.hp));

    // Tiny QoL: give a short grace period when resuming a run.
    // Prevents immediate "resume -> take a hit" moments on obstacle-heavy levels.
    state.player.invuln = Math.max(state.player.invuln || 0, 1.1);

    // Fairness: also prevent an "instant enemy shot" on the first frame after resuming.
    // (initState starts enemy fire timer at 0.)
    state.tEnemyFire = Math.max(state.tEnemyFire || 0, 0.6);

    setStatus(`single-player (resume lvl ${lvl})`, true);
  }

  function clearMidRunSave() {
    savedLevel = 1;
    savedCheckpoint = 1;
    savedLives = 0;
    savedScore = 0;
    savedHp = 3;
    try {
      localStorage.setItem(saveLevelKey, String(savedLevel));
      localStorage.setItem(saveCheckpointKey, String(savedCheckpoint));
      localStorage.setItem(saveLivesKey, String(savedLives));
      localStorage.setItem(saveScoreKey, String(savedScore));
      localStorage.setItem(saveHpKey, String(savedHp));
    } catch {}
  }

  function reset({ continueFromUnlocked = false, continueFromCheckpoint = false, resumeFromSave = false } = {}) {
    // Allow resuming even on level 1 (e.g. you refresh mid-fight).
    // Guard against resurrecting a totally fresh run by requiring either level>1 or some score.
    if (resumeFromSave && savedLives > 0 && (savedLevel > 1 || savedScore > 0)) {
      resumeSavedRun();
      return;
    }

    // If you're intentionally starting a new run (restart / continue / start at lvl 1),
    // wipe the mid-run autosave so "resume" can't resurrect an older, unrelated run.
    clearMidRunSave();

    const startLevel = continueFromCheckpoint ? continueCheckpoint : (continueFromUnlocked ? unlockedLevel : 1);
    state = initState(Math.random, Math.max(bestScore, state?.best ?? 0), undefined, startLevel);

    // Progress saving: when continuing from a checkpoint, keep the lives + score you had
    // when you last reached that checkpoint. (Makes "continue" feel real.)
    // Tiny QoL: also restart the checkpoint attempt at full HP with a brief grace window.
    if (continueFromCheckpoint && continueCheckpoint > 1) {
      state.lives = Math.max(1, continueLives || state.lives);
      state.score = Math.max(0, continueScore || state.score);
      state.player.hp = 3;
      state.player.invuln = Math.max(state.player.invuln || 0, 0.9);

      // Fairness: avoid a cheap "spawn shot" right after continuing.
      state.tEnemyFire = Math.max(state.tEnemyFire || 0, 0.6);
    }

    setStatus('single-player', true);
  }

  // Default boot: if we have a mid-run save (even within the same checkpoint), prefer that.
  // This makes refresh/close feel safe and keeps "resume" useful early-game too.
  reset({ resumeFromSave: savedLives > 0 && (savedLevel > 1 || savedScore > 0) });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      paused = !paused;
      setStatus(paused ? 'paused' : 'single-player', !paused);

      if (paused) {
        // QoL: pause is often a "safe moment" to refresh/close.
        // Force a quick mid-run save so Resume (V) works reliably.
        midRunSaveNow(performance.now(), { force: true });

        // Also clear sticky inputs so unpausing doesn't instantly fire.
        clearTransientInput();
      }
      return;
    }
    if (e.code === 'KeyR') {
      // Intentional restart should also wipe the mid-run autosave so "resume" doesn't
      // resurrect an old run by accident.
      clearMidRunSave();
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

    // Manual quick-save (useful on mobile/itchy refresh fingers).
    if (e.code === 'KeyX') {
      midRunSaveNow(performance.now(), { force: true });
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

  // Tiny UX: show brief HUD toasts so progression feels real (especially on mobile/refresh).
  let saveToastUntil = 0;
  let checkpointToastUntil = 0;
  let unlockToastUntil = 0;

  function midRunSaveNow(t, { force = false } = {}) {
    const player = state.player;
    // Allow a forced save even while paused (e.g. when the user hits P/Esc).
    if (!player?.alive || (paused && !force)) return;

    const now = t / 1000;
    const sig = `${state.level}|${state.checkpointLevel}|${state.lives}|${state.score}|${state.player.hp}`;

    if (!force) {
      if (now - lastSaveAt < 1.6) return;
      if (sig === lastSavedSig) return;
    } else {
      if (sig === lastSavedSig) return;
    }

    savedLevel = state.level;
    savedCheckpoint = state.checkpointLevel;
    savedLives = state.lives;
    savedScore = state.score;
    savedHp = state.player.hp;
    try {
      localStorage.setItem(saveLevelKey, String(savedLevel));
      localStorage.setItem(saveCheckpointKey, String(savedCheckpoint));
      localStorage.setItem(saveLivesKey, String(savedLives));
      localStorage.setItem(saveScoreKey, String(savedScore));
      localStorage.setItem(saveHpKey, String(savedHp));
    } catch {}

    lastSavedSig = sig;
    lastSaveAt = now;

    // Toast: saved.
    saveToastUntil = Math.max(saveToastUntil, now + 0.9);
  }

  let last = performance.now();
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;

    if (!paused) stepState(state, input, dt, Math.random);

    const player = state.player;
    const bossTag = state.enemy?.isBoss ? ' BOSS' : '';

    // If you truly hit 0 lives, treat it as a real game over.
    // Clear the mid-run autosave so "resume" can't undo the defeat.
    if (!player.alive && state.gameOver) {
      clearMidRunSave();
    }

    if (state.best > bestScore) {
      bestScore = state.best;
      try { localStorage.setItem(bestKey, String(bestScore)); } catch {}
    }

    if (state.level > unlockedLevel) {
      unlockedLevel = state.level;
      try { localStorage.setItem(unlockedKey, String(unlockedLevel)); } catch {}

      // Tiny feedback: make unlocks feel tangible.
      unlockToastUntil = Math.max(unlockToastUntil, (t / 1000) + 1.1);

      // Force a save on level-up so a quick refresh doesn't lose the milestone.
      midRunSaveNow(t, { force: true });
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

      // Tiny feedback: checkpoints should feel like a moment.
      checkpointToastUntil = Math.max(checkpointToastUntil, (t / 1000) + 1.3);

      // Force a save at checkpoints so progress persists immediately.
      midRunSaveNow(t, { force: true });
    }

    // Mid-run autosave (resume exactly where you were).
    // Saved at a low frequency to keep it cheap.
    midRunSaveNow(t);

    const nowS = t / 1000;
    const toasts = [];
    if (nowS < saveToastUntil) toasts.push('Saved');
    if (nowS < checkpointToastUntil) toasts.push('Checkpoint!');
    if (nowS < unlockToastUntil) toasts.push('Unlocked!');
    const toast = toasts.length ? ` · ${toasts.join(' · ')}` : '';

    hudEl.textContent = `Lvl: ${state.level}${bossTag} (CP ${state.checkpointLevel}) · Lives: ${state.lives} · HP: ${player.hp}${player.alive ? '' : ' (dead)'} · Score: ${state.score} · Best: ${state.best || 0} · Continue: ${continueCheckpoint} (Lives ${continueLives}, Score ${continueScore}) · Save: ${savedLevel} (Lives ${savedLives}, HP ${savedHp}, Score ${savedScore}) · Unlocked: ${unlockedLevel}${toast} · Shift=slow · (P/Esc)ause · (R)estart / (C)ontinue / (V)resume save / (X)save now / (Shift+J)ump`;
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
