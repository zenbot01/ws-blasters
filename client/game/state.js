import { clamp, hitCircle } from './math.js';

export const DEFAULTS = {
  W: 900,
  H: 600,
  PLAYER_R: 16,
  BULLET_R: 4,
  PLAYER_SPEED: 280,
  BULLET_SPEED: 560,
  FIRE_COOLDOWN: 0.22,
  ENEMY_SPEED: 180,
  ENEMY_FIRE_COOLDOWN: 0.55,

  // Progression
  LEVEL_CLEAR_DELAY: 0.85,
  BOSS_EVERY: 5,

  // Lives / checkpoints
  STARTING_LIVES: 3,
  CHECKPOINT_EVERY: 3,

  // Enemy variety
  ENEMY_TYPES: ['scout', 'tank'],
};

export function initState(rng = Math.random, bestScore = 0, cfg = DEFAULTS, startLevel = 1) {
  const lvl = Math.max(1, Math.floor(startLevel || 1));
  const cp = lvl - (lvl % cfg.CHECKPOINT_EVERY);
  const checkpointLevel = Math.max(1, cp);

  const state = {
    cfg,

    level: lvl,
    wave: 1,
    pendingNextLevelAt: null,

    checkpointLevel,
    lives: cfg.STARTING_LIVES,

    player: { x: cfg.W * 0.25, y: cfg.H * 0.5, hp: 3, alive: true,
    type, invuln: 0 },
    enemy: spawnEnemy(cfg, rng, lvl),

    obstacles: spawnObstacles(cfg, rng, lvl),

    bullets: [],

    score: 0,
    best: bestScore,

    tFire: 0,
    tEnemyFire: 0,

    enemyGoal: randomEnemyGoal(cfg, rng),
  };
  return state;
}

export function stepState(state, input, dt, rng = Math.random, now) {
  const cfg = state.cfg;
  const { W, H, PLAYER_R, BULLET_R, PLAYER_SPEED, BULLET_SPEED } = cfg;

  // Default time base (seconds)
  if (now == null)
    now = typeof performance !== 'undefined' && performance.now ? performance.now() / 1000 : Date.now() / 1000;

  // If player is dead, freeze sim (keeps rendering). Respawn handled elsewhere.
  if (!state.player.alive) return state;

  // Respawn grace: brief invulnerability to prevent immediate spawn kills.
  if (state.player.invuln == null) state.player.invuln = 0;
  state.player.invuln = Math.max(0, state.player.invuln - dt);

  // Handle level transitions
  if (state.pendingNextLevelAt != null && now >= state.pendingNextLevelAt) {
    state.level += 1;
    state.wave = 1;
    state.pendingNextLevelAt = null;

    // Checkpoint every N levels
    if (state.level % cfg.CHECKPOINT_EVERY === 0) {
      state.checkpointLevel = state.level;
      state.lives += 2; // reward: keep people playing
    }

    state.enemy = spawnEnemy(cfg, rng, state.level);
    state.obstacles = spawnObstacles(cfg, rng, state.level);
    state.enemyGoal = randomEnemyGoal(cfg, rng);
    state.tEnemyFire = 0;
  }

  // Player movement
  const ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const iy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  let nx = ix;
  let ny = iy;
  const mag = Math.hypot(nx, ny);
  if (mag > 0) {
    nx /= mag;
    ny /= mag;
  }

  state.player.x = clamp(state.player.x + nx * PLAYER_SPEED * dt, PLAYER_R, W - PLAYER_R);
  state.player.y = clamp(state.player.y + ny * PLAYER_SPEED * dt, PLAYER_R, H - PLAYER_R);

  // Soft obstacle collision (push out of circles)
  if (state.obstacles?.length) {
    for (const o of state.obstacles) {
      const dx = state.player.x - o.x;
      const dy = state.player.y - o.y;
      const d = Math.hypot(dx, dy) || 1;
      const minD = PLAYER_R + o.r;
      if (d < minD) {
        const ux = dx / d;
        const uy = dy / d;
        state.player.x = clamp(o.x + ux * minD, PLAYER_R, W - PLAYER_R);
        state.player.y = clamp(o.y + uy * minD, PLAYER_R, H - PLAYER_R);
      }
    }
  }

  // Fire
  state.tFire -= dt;
  if (input.fire && state.tFire <= 0) {
    state.tFire = cfg.FIRE_COOLDOWN;
    const { ax, ay } = aimDirFallback(state.player,
    speedMul: type === 'scout' ? 1.25 : 0.85,
    fireMul: type === 'scout' ? 0.85 : 1.25,
 state.enemy, input);
    spawnBullet(state, 'p', state.player.x, state.player.y, ax, ay, BULLET_SPEED, PLAYER_R, BULLET_R);
  }

  // Enemy AI
  if (state.enemy.alive) {
    const enemyR = state.enemy.r ?? PLAYER_R;
    const speed = enemySpeed(cfg, state.level) * (state.enemy.speedMul ?? 1);

    const gx = state.enemyGoal.x - state.enemy.x;
    const gy = state.enemyGoal.y - state.enemy.y;
    const gm = Math.hypot(gx, gy);
    if (gm < 18) {
      state.enemyGoal = randomEnemyGoal(cfg, rng);
    } else {
      state.enemy.x = clamp(state.enemy.x + (gx / gm) * speed * dt, enemyR, W - enemyR);
      state.enemy.y = clamp(state.enemy.y + (gy / gm) * speed * dt, enemyR, H - enemyR);
    }

    // Enemy fire
    state.tEnemyFire -= dt;
    if (state.tEnemyFire <= 0) {
      state.tEnemyFire = enemyFireCooldown(cfg, state.level) * (state.enemy.fireMul ?? 1);
      const ax0 = state.player.x - state.enemy.x;
      const ay0 = state.player.y - state.enemy.y;
      const m = Math.hypot(ax0, ay0) || 1;
      const ax = ax0 / m;
      const ay = ay0 / m;

      if (state.enemy.isBoss) {
        // Boss fires a 3-shot spread
        const spread = 0.22;
        for (const a of [-spread, 0, spread]) {
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const rx = ax * ca - ay * sa;
          const ry = ax * sa + ay * ca;
          spawnBullet(state, 'e', state.enemy.x, state.enemy.y, rx, ry, BULLET_SPEED, enemyR, BULLET_R);
        }
      } else {
        spawnBullet(state, 'e', state.enemy.x, state.enemy.y, ax, ay, BULLET_SPEED, enemyR, BULLET_R);
      }
    }
  }

  // Bullets update + collisions
  for (const b of state.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;

    if (b.life <= 0) continue;

    // Obstacles block bullets
    if (state.obstacles?.length) {
      for (const o of state.obstacles) {
        if (hitCircle(b.x, b.y, BULLET_R, o.x, o.y, o.r)) {
          b.life = -1;
          break;
        }
      }
      if (b.life <= 0) continue;
    }

    const enemyR = state.enemy.r ?? PLAYER_R;

    if (b.owner === 'p' && state.enemy.alive && hitCircle(b.x, b.y, BULLET_R, state.enemy.x, state.enemy.y, enemyR)) {
      b.life = -1;
      state.enemy.hp -= 1;
      state.score += 10;
      if (state.enemy.hp <= 0) {
        state.enemy.alive = false;
        state.score += state.enemy.isBoss ? 500 : 100;
        state.best = Math.max(state.best, state.score);

        if (state.pendingNextLevelAt == null) {
          state.pendingNextLevelAt = now + cfg.LEVEL_CLEAR_DELAY;
        }
      }
    }

    if (b.owner === 'e' && state.player.invuln <= 0 && hitCircle(b.x, b.y, BULLET_R, state.player.x, state.player.y, PLAYER_R)) {
      b.life = -1;
      state.player.hp -= 1;
      if (state.player.hp <= 0) {
        onPlayerDeath(state, rng);
      }
    }
  }

  state.bullets = state.bullets.filter(
    (b) => b.life > 0 && b.x >= -60 && b.x <= W + 60 && b.y >= -60 && b.y <= H + 60,
  );

  return state;
}

export function onPlayerDeath(state, rng = Math.random) {
  const cfg = state.cfg;

  state.player.alive = false;
  state.best = Math.max(state.best, state.score);

  // Lose a life and respawn at checkpoint
  state.lives = Math.max(0, state.lives - 1);

  const targetLevel = state.lives > 0 ? state.checkpointLevel : 1;
  state.level = targetLevel;
  state.pendingNextLevelAt = null;

  // Reset entities
  state.player = { x: cfg.W * 0.25, y: cfg.H * 0.5, hp: 3, alive: true,
    type, invuln: 1.1 };
  state.enemy = spawnEnemy(cfg, rng, state.level);
  state.obstacles = spawnObstacles(cfg, rng, state.level);
  state.enemyGoal = randomEnemyGoal(cfg, rng);
  state.bullets = [];
  state.tFire = 0;
  state.tEnemyFire = 0;

  // If you ran out of lives, reset checkpoint and lives
  if (state.lives === 0) {
    state.checkpointLevel = 1;
    state.lives = cfg.STARTING_LIVES;
    state.level = 1;
    state.enemy = spawnEnemy(cfg, rng, 1);
    state.obstacles = spawnObstacles(cfg, rng, 1);
  }

  return state;
}

function randomEnemyGoal(cfg, rng) {
  return {
    x: randBetween(rng, cfg.W * 0.55, cfg.W * 0.95),
    y: randBetween(rng, cfg.H * 0.1, cfg.H * 0.9),
  };
}

function spawnObstacles(cfg, rng, level) {
  // Keep level 1 clean for onboarding.
  if (level <= 1) return [];

  // Level variety: every few levels, create a simple "gate" you must route through.
  // Still uses circle rocks, so we don't need new collision/render logic.
  const obs = [];

  // Gate pattern: two bigger rocks leaving a vertical gap.
  // (Avoids the midline lane so it doesn't feel like a cheap trap.)
  if (level >= 3 && level % 4 === 0) {
    const gateX = randBetween(rng, cfg.W * 0.50, cfg.W * 0.66);
    const gapCenter = randBetween(rng, cfg.H * 0.22, cfg.H * 0.78);
    const gapHalf = randBetween(rng, 62, 86);
    const r = randBetween(rng, 28, 38);

    const yTop = clamp(gapCenter - gapHalf - r,
    speedMul: type === 'scout' ? 1.25 : 0.85,
    fireMul: type === 'scout' ? 0.85 : 1.25,
 cfg.H * 0.14 + r,
    speedMul: type === 'scout' ? 1.25 : 0.85,
    fireMul: type === 'scout' ? 0.85 : 1.25,
 cfg.H * 0.86 - r);
    const yBot = clamp(gapCenter + gapHalf + r,
    speedMul: type === 'scout' ? 1.25 : 0.85,
    fireMul: type === 'scout' ? 0.85 : 1.25,
 cfg.H * 0.14 + r,
    speedMul: type === 'scout' ? 1.25 : 0.85,
    fireMul: type === 'scout' ? 0.85 : 1.25,
 cfg.H * 0.86 - r);

    // Keep the gate away from the central horizontal-ish lane.
    if (Math.abs(yTop - cfg.H * 0.5) > 78 && Math.abs(yBot - cfg.H * 0.5) > 78) {
      obs.push({ x: gateX, y: yTop, r });
      obs.push({ x: gateX, y: yBot, r });
    }
  }

  // Add a little more variety as you climb.
  // Level 2+: 1 rock, then ramps up to 4 (plus the gate above, if any).
  const count = Math.min(4, 1 + Math.floor((level - 2) / 2));
  if (count <= 0) return obs;

  for (let i = 0; i < count; i++) {
    // Try a few times to avoid sitting directly in the player's spawn lane
    // and to avoid overlapping existing obstacles.
    let placed = false;
    for (let tries = 0; tries < 14; tries++) {
      const r = randBetween(rng, 18, 34);
      const x = randBetween(rng, cfg.W * 0.42, cfg.W * 0.72);
      const y = randBetween(rng, cfg.H * 0.14, cfg.H * 0.86);

      // Keep a clear horizontal-ish lane around center to reduce unfair pinning.
      const avoidY = cfg.H * 0.5;
      if (Math.abs(y - avoidY) < 78) continue;

      // Avoid the enemy's initial spawn band.
      if (Math.abs(y - cfg.H * 0.5) < 50 && x > cfg.W * 0.62) continue;

      // Avoid overlapping previously placed rocks.
      let ok = true;
      for (const o of obs) {
        const d = Math.hypot(x - o.x, y - o.y);
        if (d < r + o.r + 10) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      obs.push({ x, y, r });
      placed = true;
      break;
    }

    // If we failed to place this obstacle, just stop (better than piling into spawn lanes).
    if (!placed) break;
  }

  return obs;
}

function isBossLevel(cfg, level) {
  return level % cfg.BOSS_EVERY === 0;
}

function spawnEnemy(cfg, rng, level) {
  const boss = isBossLevel(cfg, level);
  const type = boss ? 'boss' : (level % 2 === 0 ? 'scout' : 'tank');
  const baseHp = boss ? 10 : 3;
  const hpBase = baseHp + (boss ? Math.min(24, level) : Math.min(6, Math.floor(level * 0.6)));
  const hp = type === 'tank' ? hpBase + 3 : hpBase;
  const r = boss ? 26 : (type === 'tank' ? 20 : cfg.PLAYER_R);
  return {
    maxHp: hp,
    x: cfg.W * 0.75,
    y: randBetween(rng, cfg.H * 0.2, cfg.H * 0.8),
    hp,
    alive: true,
    type,
    isBoss: boss,
    r,
    speedMul: type === 'scout' ? 1.25 : 0.85,
    fireMul: type === 'scout' ? 0.85 : 1.25,

  };
}

function enemySpeed(cfg, level) {
  const bossPenalty = isBossLevel(cfg, level) ? 30 : 0;
  return cfg.ENEMY_SPEED + Math.min(90, (level - 1) * 6) - bossPenalty;
}

function enemyFireCooldown(cfg, level) {
  const base = Math.max(0.42, cfg.ENEMY_FIRE_COOLDOWN - (level - 1) * 0.008);
  return isBossLevel(cfg, level) ? base + 0.18 : base;
}

function randBetween(rng, a, b) {
  return a + rng() * (b - a);
}

function aimDirFallback(from, to, input) {
  let ax = (input.aimRight ? 1 : 0) - (input.aimLeft ? 1 : 0);
  let ay = (input.aimDown ? 1 : 0) - (input.aimUp ? 1 : 0);
  if (ax === 0 && ay === 0) {
    if (from.aim) {
      ax = from.aim.x;
      ay = from.aim.y;
    } else {
      ax = to.x - from.x;
      ay = to.y - from.y;
    }
  }
  const m = Math.hypot(ax, ay) || 1;
  return { ax: ax / m, ay: ay / m };
}

function spawnBullet(state, owner,
    speedMul: type === 'scout' ? 1.25 : 0.85,
    fireMul: type === 'scout' ? 0.85 : 1.25,
 x, y, ax, ay, bulletSpeed, sourceR, bulletR) {
  state.bullets.push({
    owner,
    speedMul: type === 'scout' ? 1.25 : 0.85,
    fireMul: type === 'scout' ? 0.85 : 1.25,

    x: x + ax * (sourceR + bulletR + 2),
    y: y + ay * (sourceR + bulletR + 2),
    vx: ax * bulletSpeed,
    vy: ay * bulletSpeed,
    life: 1.6,
  });
}
