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

    player: { x: cfg.W * 0.25, y: cfg.H * 0.5, hp: 3, alive: true, aim: { x: 1, y: 0 }, invuln: 0 },

    obstacles: spawnObstacles(cfg, rng, lvl),

    enemies: [],
    enemy: null,

    bullets: [],

    fx: { shake: 0 },

    score: 0,
    best: bestScore,

    // For small skill rewards: if you clear a level without taking damage,
    // you get a bonus. (Makes runs feel a bit more arcade-y.)
    levelStartHp: 3,

    tFire: 0,
    tEnemyFire: 0,

    enemyGoal: null,
    enemyGoalRecalcAt: 0,
  };
  state.enemies = [spawnEnemy(cfg, rng, lvl, state.obstacles)];
  state.enemy = state.enemies[0];
  state.enemyGoal = randomEnemyGoal(cfg, rng, state.obstacles);
  state.enemyGoalRecalcAt = 0;
  state.levelStartHp = state.player.hp;
  return state;
}

export function stepState(state, input, dt, rng = Math.random, now) {
  const cfg = state.cfg;
  const { W, H, PLAYER_R, BULLET_R, PLAYER_SPEED, BULLET_SPEED } = cfg;

  // Default time base (seconds)
  if (now == null)
    now = typeof performance !== 'undefined' && performance.now ? performance.now() / 1000 : Date.now() / 1000;

  // Let some obstacles animate a bit (tiny level variety / routing puzzles).
  // This is purely positional (still circle collision + same render).
  if (state.obstacles?.length) updateObstacles(state.obstacles, cfg, now);

  // Tiny juice: screen shake on hits (handled in render).
  if (!state.fx) state.fx = { shake: 0 };
  state.fx.shake = Math.max(0, (state.fx.shake ?? 0) - dt * 2.8);

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

      // Small QoL: hitting a checkpoint also tops you back up.
      // (Feels good, reduces "limp into death" runs.)
      state.player.hp = 3;
    }

    state.obstacles = spawnObstacles(cfg, rng, state.level);

    state.enemies = [spawnEnemy(cfg, rng, state.level, state.obstacles)];
    state.enemy = state.enemies[0];

    // Clear bullets between levels (prevents cheap hits / lingering shots)
    state.bullets = [];

    state.enemyGoal = randomEnemyGoal(cfg, rng, state.obstacles);
    state.enemyGoalRecalcAt = now + 0.4;

    // Fairness: don't carry bullets across levels (prevents stray shots from instantly
    // tagging the new enemy or sniping the player during the transition).
    state.bullets = [];
    state.tFire = 0;
    // Also prevent a "spawn shot" on the very first frame of the new level.
    state.tEnemyFire = enemyFireCooldown(cfg, state.level);

    // Track whether the player clears this level without taking damage.
    state.levelStartHp = state.player.hp;
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

  const slowMul = input.slow ? 0.55 : 1;
  state.player.x = clamp(state.player.x + nx * PLAYER_SPEED * slowMul * dt, PLAYER_R, W - PLAYER_R);
  state.player.y = clamp(state.player.y + ny * PLAYER_SPEED * slowMul * dt, PLAYER_R, H - PLAYER_R);

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

  // Aim updates (also drives ship facing)
  // Supports keyboard (IJKL) and mouse/touch aim vectors.
  {
    const v = input.aimVec;
    if (v && (v.x !== 0 || v.y !== 0)) {
      const m = Math.hypot(v.x, v.y) || 1;
      state.player.aim = { x: v.x / m, y: v.y / m };
    } else {
      const ax0 = (input.aimRight ? 1 : 0) - (input.aimLeft ? 1 : 0);
      const ay0 = (input.aimDown ? 1 : 0) - (input.aimUp ? 1 : 0);
      if (ax0 !== 0 || ay0 !== 0) {
        const m = Math.hypot(ax0, ay0) || 1;
        state.player.aim = { x: ax0 / m, y: ay0 / m };
      }
    }
  }

  // Fire
  state.tFire -= dt;
  if (input.fire && state.tFire <= 0) {
    state.tFire = cfg.FIRE_COOLDOWN;
    const { ax, ay } = aimDirFallback(state.player, state.enemy, input);
    spawnBullet(state, 'p', state.player.x, state.player.y, ax, ay, BULLET_SPEED, PLAYER_R, BULLET_R);
  }

  // Enemy AI
  if (state.enemy.alive) {
    // For visuals: face the player.
    {
      const dx = state.player.x - state.enemy.x;
      const dy = state.player.y - state.enemy.y;
      const m = Math.hypot(dx, dy) || 1;
      state.enemy.aim = { x: dx / m, y: dy / m };
    }
    const enemyR = state.enemy.r ?? PLAYER_R;
    const speed = enemySpeed(cfg, state.level) * (state.enemy.speedMul ?? 1);

    const gx = state.enemyGoal.x - state.enemy.x;
    const gy = state.enemyGoal.y - state.enemy.y;
    const gm = Math.hypot(gx, gy);
    if (gm < 18) {
      state.enemyGoal = randomEnemyGoal(cfg, rng, state.obstacles);
      state.enemyGoalRecalcAt = now + 0.2;
    } else {
      state.enemy.x = clamp(state.enemy.x + (gx / gm) * speed * dt, enemyR, W - enemyR);
      state.enemy.y = clamp(state.enemy.y + (gy / gm) * speed * dt, enemyR, H - enemyR);

      // Soft obstacle collision for enemy
      if (state.obstacles?.length) {
        let bumped = false;
        for (const o of state.obstacles) {
          const dx = state.enemy.x - o.x;
          const dy = state.enemy.y - o.y;
          const d = Math.hypot(dx, dy) || 1;
          const minD = enemyR + o.r;
          if (d < minD) {
            bumped = true;
            const ux = dx / d;
            const uy = dy / d;
            state.enemy.x = clamp(o.x + ux * minD, enemyR, W - enemyR);
            state.enemy.y = clamp(o.y + uy * minD, enemyR, H - enemyR);
          }
        }

        // Tiny AI QoL: if the enemy keeps bumping rocks, pick a new goal.
        // Prevents "stuck on rocks" and makes obstacle-heavy levels feel more dynamic.
        if (bumped && now >= (state.enemyGoalRecalcAt ?? 0)) {
          state.enemyGoal = randomEnemyGoal(cfg, rng, state.obstacles);
          state.enemyGoalRecalcAt = now + 0.6;
        }
      }
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
      state.fx.shake = Math.max(state.fx.shake ?? 0, 0.14);
      if (state.enemy.hp <= 0) {
        state.enemy.alive = false;
        state.fx.shake = Math.max(state.fx.shake ?? 0, state.enemy.isBoss ? 0.55 : 0.32);

        const clearScore = state.enemy.isBoss ? 500 : 100;
        state.score += clearScore;

        // Small arcade reward: "no-hit clear" bonus.
        // (Boss levels excluded because they can be longer / more chaotic.)
        if (!state.enemy.isBoss && state.player.hp === (state.levelStartHp ?? state.player.hp)) {
          state.score += 60;
        }

        // Tiny sustain reward: heal 1 HP on non-boss clears (up to 3).
        // Makes longer sessions feel a bit fairer without changing enemy tuning.
        if (!state.enemy.isBoss) {
          state.player.hp = Math.min(3, state.player.hp + 1);
        }

        state.best = Math.max(state.best, state.score);

        if (state.pendingNextLevelAt == null) {
          state.pendingNextLevelAt = now + cfg.LEVEL_CLEAR_DELAY;
        }
      }
    }

    if (b.owner === 'e' && state.player.invuln <= 0 && hitCircle(b.x, b.y, BULLET_R, state.player.x, state.player.y, PLAYER_R)) {
      b.life = -1;
      state.player.hp -= 1;
      state.fx.shake = Math.max(state.fx.shake ?? 0, 0.22);
      if (state.player.hp <= 0) {
        onPlayerDeath(state, rng);
      }
    }
  }

  state.bullets = state.bullets.filter(
    (b) => b.life > 0 && b.x >= -60 && b.x <= W + 60 && b.y >= -60 && b.y <= H + 60,
  );

  state.enemy = state.enemies[0];
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
  state.player = {
    x: cfg.W * 0.25,
    y: cfg.H * 0.5,
    hp: 3,
    alive: true,
    aim: { x: 1, y: 0 },
    invuln: 1.1,
  };
  state.levelStartHp = state.player.hp;
  state.obstacles = spawnObstacles(cfg, rng, state.level);
  state.enemies = [spawnEnemy(cfg, rng, state.level, state.obstacles)];
  state.enemy = state.enemies[0];
  state.enemyGoal = randomEnemyGoal(cfg, rng, state.obstacles);
  state.enemyGoalRecalcAt = 0;
  state.bullets = [];
  state.fx = { shake: 0 };
  state.tFire = 0;
  state.tEnemyFire = 0;

  // If you ran out of lives, reset checkpoint and lives
  if (state.lives === 0) {
    state.checkpointLevel = 1;
    state.lives = cfg.STARTING_LIVES;
    state.level = 1;
    state.obstacles = spawnObstacles(cfg, rng, 1);
    state.enemy = spawnEnemy(cfg, rng, 1, state.obstacles);
    state.enemies = [state.enemy];
    state.enemyGoal = randomEnemyGoal(cfg, rng, state.obstacles);
    state.enemyGoalRecalcAt = 0;
  }

  state.enemy = state.enemies[0];
  return state;
}

function randomEnemyGoal(cfg, rng, obstacles = []) {
  // Pick a point on the enemy side of the arena, but avoid picking a goal inside/behind an obstacle.
  // This reduces "stuck on rocks" moments and makes movement feel more intentional.
  for (let tries = 0; tries < 18; tries++) {
    const x = randBetween(rng, cfg.W * 0.55, cfg.W * 0.95);
    const y = randBetween(rng, cfg.H * 0.1, cfg.H * 0.9);

    let ok = true;
    for (const o of obstacles) {
      const d = Math.hypot(x - o.x, y - o.y);
      if (d < o.r + 26) {
        ok = false;
        break;
      }
    }
    if (ok) return { x, y };
  }

  // Fallback: even if we failed, return something reasonable.
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

    const yTop = clamp(gapCenter - gapHalf - r, cfg.H * 0.14 + r, cfg.H * 0.86 - r);
    const yBot = clamp(gapCenter + gapHalf + r, cfg.H * 0.14 + r, cfg.H * 0.86 - r);

    // Keep the gate away from the central horizontal-ish lane.
    if (Math.abs(yTop - cfg.H * 0.5) > 78 && Math.abs(yBot - cfg.H * 0.5) > 78) {
      obs.push({ x: gateX, y: yTop, r });
      obs.push({ x: gateX, y: yBot, r });
    }
  }

  // Add a little more variety as you climb.
  // Level 2+: 1 rock, then ramps up to 4 (plus the gate above, if any).
  const count = Math.min(4, 1 + Math.floor((level - 2) / 2));

  // Slalom pattern: three medium rocks alternating high/low, forcing a gentle zig-zag route.
  // Keeps the game feeling less "empty" without adding new mechanics.
  if (level >= 4 && level % 5 === 2) {
    const r = randBetween(rng, 20, 28);
    const x0 = randBetween(rng, cfg.W * 0.48, cfg.W * 0.60);
    const dx = randBetween(rng, 72, 96);
    const yA = randBetween(rng, cfg.H * 0.28, cfg.H * 0.38);
    const yB = randBetween(rng, cfg.H * 0.62, cfg.H * 0.72);

    obs.push({ x: x0 + 0 * dx, y: yA, r });
    obs.push({ x: x0 + 1 * dx, y: yB, r });
    obs.push({ x: x0 + 2 * dx, y: yA, r });
  }

  // "Squeeze" pattern: a short row of rocks that creates a single lane.
  // Small but noticeable variety: you have to route left/right through the gap.
  if (level >= 5 && level % 4 === 1) {
    const r = randBetween(rng, 22, 30);
    const y = randBetween(rng, cfg.H * 0.24, cfg.H * 0.76);
    const gapX = randBetween(rng, cfg.W * 0.50, cfg.W * 0.66);
    const gapHalf = randBetween(rng, 52, 68);

    // Three rocks across the mid-field, leaving a gap at gapX.
    const xs = [cfg.W * 0.44, cfg.W * 0.56, cfg.W * 0.68];
    for (const x0 of xs) {
      if (Math.abs(x0 - gapX) < gapHalf) continue;
      obs.push({ x: x0, y, r });
    }
  }

  // Starting midgame, occasionally introduce a gentle "drifter" rock that moves in a small
  // sinusoid. This creates a soft timing/routing problem without feeling unfair.
  if (level >= 6 && level % 3 === 0) {
    const r = randBetween(rng, 18, 26);
    const x = randBetween(rng, cfg.W * 0.48, cfg.W * 0.68);
    const baseY = randBetween(rng, cfg.H * 0.20, cfg.H * 0.80);
    const amp = randBetween(rng, 18, 34);
    const freq = randBetween(rng, 0.65, 0.95);
    const phase = randBetween(rng, 0, Math.PI * 2);

    // Level variety: sometimes drift sideways instead of vertical.
    // (Keeps the same collision model; just makes routing feel less samey.)
    const axis = rng() < 0.5 ? 'y' : 'x';

    // Keep it out of the central lane.
    if (Math.abs(baseY - cfg.H * 0.5) > 78) {
      obs.push({
        x,
        y: baseY,
        r,
        drift: { kind: 'sin', axis, baseX: x, baseY, amp, freq, phase },
      });
    }
  }

  // Slightly later: an "orbiter" rock that moves in a small loop.
  // This feels like a new obstacle type without changing collision/render.
  if (level >= 7 && level % 5 === 0) {
    const r = randBetween(rng, 18, 26);
    const baseX = randBetween(rng, cfg.W * 0.50, cfg.W * 0.70);
    const baseY = randBetween(rng, cfg.H * 0.22, cfg.H * 0.78);
    const amp = randBetween(rng, 14, 26);
    const freq = randBetween(rng, 0.55, 0.85);
    const phase = randBetween(rng, 0, Math.PI * 2);

    // Keep it out of the central lane so it doesn't feel like a cheap pin.
    if (Math.abs(baseY - cfg.H * 0.5) > 78) {
      obs.push({
        x: baseX,
        y: baseY,
        r,
        drift: { kind: 'orbit', baseX, baseY, amp, freq, phase },
      });
    }
  }

  // Level variety: a paired "double-orbit" obstacle that creates a moving gap.
  // Two small rocks orbit the same center 180° apart; this reads as a new obstacle
  // without needing new rendering or collision.
  if (level >= 8 && level % 6 === 2) {
    const r = randBetween(rng, 18, 24);
    const baseX = randBetween(rng, cfg.W * 0.52, cfg.W * 0.70);
    const baseY = randBetween(rng, cfg.H * 0.22, cfg.H * 0.78);
    const amp = randBetween(rng, 18, 30);
    const freq = randBetween(rng, 0.55, 0.82);
    const phase = randBetween(rng, 0, Math.PI * 2);

    // Keep it out of the central lane so it doesn't feel like a cheap pin.
    if (Math.abs(baseY - cfg.H * 0.5) > 78) {
      obs.push({
        x: baseX,
        y: baseY,
        r,
        drift: { kind: 'orbit', baseX, baseY, amp, freq, phase },
      });
      obs.push({
        x: baseX,
        y: baseY,
        r,
        drift: { kind: 'orbit', baseX, baseY, amp, freq, phase: phase + Math.PI },
      });
    }
  }

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

function updateObstacles(obstacles, cfg, now) {
  for (const o of obstacles) {
    const d = o.drift;
    if (!d) continue;

    // Lazily init base positions for older saved objects (if any).
    if (d.baseX == null) d.baseX = o.x;
    if (d.baseY == null) d.baseY = o.y;

    const t = now * (d.freq ?? 0.8) + (d.phase ?? 0);

    if (d.kind === 'orbit') {
      const a = t;
      const amp = d.amp ?? 20;
      o.x = clamp(d.baseX + Math.cos(a) * amp, o.r, cfg.W - o.r);
      o.y = clamp(d.baseY + Math.sin(a) * amp, o.r, cfg.H - o.r);
      continue;
    }

    const off = Math.sin(t) * (d.amp ?? 26);

    if (d.axis === 'x') {
      o.x = clamp(d.baseX + off, o.r, cfg.W - o.r);
      o.y = clamp(d.baseY, o.r, cfg.H - o.r);
    } else {
      o.x = clamp(d.baseX, o.r, cfg.W - o.r);
      o.y = clamp(d.baseY + off, o.r, cfg.H - o.r);
    }
  }
}

function isBossLevel(cfg, level) {
  return level % cfg.BOSS_EVERY === 0;
}

function spawnEnemy(cfg, rng, level, obstacles = []) {
  const boss = isBossLevel(cfg, level);
  const type = boss ? 'boss' : (level % 2 === 0 ? 'scout' : 'tank');
  const baseHp = boss ? 10 : 3;
  const hpBase = baseHp + (boss ? Math.min(24, level) : Math.min(6, Math.floor(level * 0.6)));
  const hp = type === 'tank' ? hpBase + 3 : hpBase;
  const r = boss ? 26 : (type === 'tank' ? 20 : cfg.PLAYER_R);

  // Fairness/QoL: don't spawn the enemy inside an obstacle.
  // (This can happen on some mid levels with denser layouts.)
  const x = cfg.W * 0.75;
  let y = randBetween(rng, cfg.H * 0.2, cfg.H * 0.8);
  for (let tries = 0; tries < 18; tries++) {
    let ok = true;
    for (const o of obstacles) {
      const d = Math.hypot(x - o.x, y - o.y);
      if (d < r + o.r + 10) {
        ok = false;
        break;
      }
    }
    if (ok) break;
    y = randBetween(rng, cfg.H * 0.2, cfg.H * 0.8);
  }

  return {
    maxHp: hp,
    x,
    y,
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
  // Prefer an explicit aim vector (mouse/touch), then keyboard, then last aim, then enemy direction.
  if (input.aimVec && (input.aimVec.x !== 0 || input.aimVec.y !== 0)) {
    const m = Math.hypot(input.aimVec.x, input.aimVec.y) || 1;
    return { ax: input.aimVec.x / m, ay: input.aimVec.y / m };
  }

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

function spawnBullet(state, owner, x, y, ax, ay, bulletSpeed, sourceR, bulletR) {
  state.bullets.push({
    owner,
    x: x + ax * (sourceR + bulletR + 2),
    y: y + ay * (sourceR + bulletR + 2),
    vx: ax * bulletSpeed,
    vy: ay * bulletSpeed,
    life: 1.6,
  });
}
