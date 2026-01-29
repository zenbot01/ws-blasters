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

  // Fairness: brief invulnerability after taking a hit (prevents stacked bullet deletes).
  HIT_INVULN: 0.55,

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

  // If we start at an unlocked level, grant the checkpoint life rewards you would
  // have earned by reaching those checkpoints. This makes "jump to level" and
  // "continue" starts feel consistent (and a bit more fun).
  const checkpointCount = Math.floor(checkpointLevel / cfg.CHECKPOINT_EVERY);
  const startingLives = Math.min(99, cfg.STARTING_LIVES + checkpointCount * 2);

  const runSeed = (Math.floor(rng() * 1e9) >>> 0);

  const state = {
    cfg,

    // Used to make per-level obstacle layouts deterministic within a run.
    // (So respawns/continues at the same checkpoint feel learnable and fair.)
    runSeed,

    level: lvl,
    wave: 1,
    pendingNextLevelAt: null,

    // If set to the current level number, the enemy has been defeated and the level is "cleared"
    // (even if we're still in the clear-delay window). Used for resume saves so a refresh doesn't
    // force you to replay a just-cleared fight.
    levelCleared: 0,

    checkpointLevel,
    lives: startingLives,

    player: { x: cfg.W * 0.25, y: cfg.H * 0.5, hp: 3, alive: true, aim: { x: 1, y: 0 }, invuln: 0 },

    obstacles: spawnObstacles(cfg, rng, lvl, runSeed),

    enemies: [],
    enemy: null,

    bullets: [],

    fx: { shake: 0 },

    score: 0,
    best: bestScore,

    // For small skill rewards: if you clear a level without taking damage,
    // you get a bonus. (Makes runs feel a bit more arcade-y.)
    levelStartHp: 3,
    lastNoHitAt: 0,
    lastBossClearAt: 0,

    tFire: 0,

    // Fairness: don't allow an instant enemy shot on the first frame of a fresh run.
    // (Level transitions already seed this, but initState used to start at 0.)
    tEnemyFire: enemyFireCooldown(cfg, lvl),

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
    state.levelCleared = 0;

    // Checkpoint every N levels
    if (state.level % cfg.CHECKPOINT_EVERY === 0) {
      state.checkpointLevel = state.level;
      state.lives += 2; // reward: keep people playing

      // Small QoL: hitting a checkpoint also tops you back up.
      // (Feels good, reduces "limp into death" runs.)
      state.player.hp = 3;

      // Tiny fairness: checkpoints are a moment — give a slightly longer grace window.
      // This prevents a "checkpoint -> instant hit" feel on obstacle-heavy layouts.
      state.player.invuln = Math.max(state.player.invuln || 0, 0.9);
    }

    state.obstacles = spawnObstacles(cfg, rng, state.level, state.runSeed);

    state.enemies = [spawnEnemy(cfg, rng, state.level, state.obstacles)];
    state.enemy = state.enemies[0];

    // Fairness: don't carry bullets across levels (prevents stray shots from instantly
    // tagging the new enemy or sniping the player during the transition).
    state.bullets = [];

    state.enemyGoal = randomEnemyGoal(cfg, rng, state.obstacles);
    state.enemyGoalRecalcAt = now + 0.4;

    // Tiny QoL: give a short grace window at the start of each new level.
    // Prevents cheap hits during the transition and feels more arcade-y.
    state.player.invuln = Math.max(state.player.invuln || 0, 0.55);

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

  const slowMul = input.slow ? 0.65 : 1;
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
      } else if (input.fire && state.enemy?.alive) {
        // Small accessibility/QoL: if you're just moving + firing (no separate aim input),
        // auto-aim toward the enemy while firing. Makes WASD+Space playable.
        const dx = state.enemy.x - state.player.x;
        const dy = state.enemy.y - state.player.y;
        const m = Math.hypot(dx, dy) || 1;
        state.player.aim = { x: dx / m, y: dy / m };
      }
    }
  }

  // Fire
  state.tFire -= dt;
  if (input.fire && state.tFire <= 0) {
    // Tiny QoL: while holding "slow" (Shift / touch), slightly reduce the fire cooldown.
    // Makes slow mode feel like a real tactical stance (precision + a bit more DPS).
    const slowFireMul = input.slow ? 0.85 : 1;
    state.tFire = cfg.FIRE_COOLDOWN * slowFireMul;
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

    // Tiny fun: allow player bullets to bounce once off arena walls (later levels).
    // This adds small "bank shot" moments without changing core tuning.
    if (b.owner === 'p' && (b.wallBounces ?? 0) > 0) {
      const pad = BULLET_R + 1;
      let bounced = false;
      if (b.x < pad) { b.x = pad; b.vx = -b.vx; bounced = true; }
      else if (b.x > W - pad) { b.x = W - pad; b.vx = -b.vx; bounced = true; }
      if (b.y < pad) { b.y = pad; b.vy = -b.vy; bounced = true; }
      else if (b.y > H - pad) { b.y = H - pad; b.vy = -b.vy; bounced = true; }

      if (bounced) {
        b.wallBounces -= 1;
        b.bounced = (b.bounced ?? 0) + 1;
        b.lastBounce = 'wall';
        // Small readability: wall bounces don't last as long.
        b.life = Math.min(b.life, 1.0);
      }
    }

    // Obstacles block bullets (with a tiny twist: player shots can ricochet once).
    if (state.obstacles?.length) {
      for (const o of state.obstacles) {
        if (!hitCircle(b.x, b.y, BULLET_R, o.x, o.y, o.r)) continue;

        if (b.owner === 'p' && (b.bounces ?? 0) > 0) {
          b.bounces -= 1;
          b.bounced = (b.bounced ?? 0) + 1;
          b.lastBounce = 'rock';

          // Reflect velocity around the obstacle normal.
          const nx0 = b.x - o.x;
          const ny0 = b.y - o.y;
          const nm = Math.hypot(nx0, ny0) || 1;
          const nx = nx0 / nm;
          const ny = ny0 / nm;
          const dot = b.vx * nx + b.vy * ny;
          b.vx = (b.vx - 2 * dot * nx) * 0.92;
          b.vy = (b.vy - 2 * dot * ny) * 0.92;

          // Nudge outside the rock so we don't instantly re-collide next frame.
          b.x = o.x + nx * (o.r + BULLET_R + 1);
          b.y = o.y + ny * (o.r + BULLET_R + 1);

          // Small readability: ricochets don't last as long.
          b.life = Math.min(b.life, 1.0);
        } else {
          b.life = -1;
        }

        break;
      }
      if (b.life <= 0) continue;
    }

    // Tiny fun/QoL: allow player shots to cancel out enemy shots.
    // Adds a readable "shoot the bullet" moment on boss/late levels and makes runs feel a bit fairer.
    if (b.owner === 'p') {
      for (const eb of state.bullets) {
        if (eb.owner !== 'e' || eb.life <= 0) continue;
        if (hitCircle(b.x, b.y, BULLET_R, eb.x, eb.y, BULLET_R)) {
          b.life = -1;
          eb.life = -1;
          state.score += 1;
          state.fx.shake = Math.max(state.fx.shake ?? 0, 0.08);
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

      // Tiny fun: bank shots feel good. If the bullet bounced (wall or rock), award a small bonus.
      // Encourages using cover instead of only straight-line kiting.
      const bankBonus = Math.min(6, (b.bounced ?? 0) * 2);
      if (bankBonus) state.score += bankBonus;

      state.fx.shake = Math.max(state.fx.shake ?? 0, 0.14);
      if (state.enemy.hp <= 0) {
        state.enemy.alive = false;
        state.fx.shake = Math.max(state.fx.shake ?? 0, state.enemy.isBoss ? 0.55 : 0.32);

        const clearScore = state.enemy.isBoss ? 500 : 100;
        state.score += clearScore;

        // Tiny reward: clearing a boss grants +1 life (keeps longer runs feeling worth it)
        // and a small heal so the next level doesn't start as a limp.
        // Also treat boss clears as a "soft checkpoint" so progress feels real.
        if (state.enemy.isBoss) {
          state.lives = Math.min(99, (state.lives ?? 0) + 1);
          state.player.hp = Math.min(3, (state.player.hp ?? 3) + 1);
          state.checkpointLevel = Math.max(state.checkpointLevel ?? 1, state.level);

          // Tiny feedback hook for the outer UI (toasts, etc.).
          state.lastBossClearAt = now;
        }

        // Small arcade reward: "no-hit clear" bonus.
        // (Boss levels excluded because they can be longer / more chaotic.)
        if (!state.enemy.isBoss && state.player.hp === (state.levelStartHp ?? state.player.hp)) {
          // Scale the bonus a bit with progression so "no-hit" clears stay exciting.
          // (Capped to keep the economy sane.)
          const noHitBonus = Math.min(220, 40 + state.level * 8);
          state.score += noHitBonus;
          state.lastNoHitAt = now;
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

        // Mark the level as cleared immediately so mid-run resume saves can skip replaying
        // this fight if the player refreshes during the clear-delay window.
        state.levelCleared = state.level;

        // QoL/fairness: once you clear the level, delete any remaining enemy bullets.
        // Prevents cheap hits during the clear-delay window.
        state.bullets = state.bullets.filter((b) => b.owner !== 'e');
      }
    }

    // Tiny QoL: "slow" (precision) mode slightly reduces the player's hitbox.
    // Makes Shift/right-click feel like a real defensive stance (especially on touch).
    const playerHitR = PLAYER_R * (input.slow ? 0.85 : 1);

    if (b.owner === 'e' && state.player.invuln <= 0 && hitCircle(b.x, b.y, BULLET_R, state.player.x, state.player.y, playerHitR)) {
      b.life = -1;
      state.player.hp -= 1;

      // Fairness: brief "iframes" on hit so you don't get insta-gibbed by stacked bullets.
      // (Respawn already has its own invuln; this is just for mid-fight chip damage.)
      state.player.invuln = Math.max(state.player.invuln || 0, cfg.HIT_INVULN ?? 0.55);

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

  if (!state) return state;

  state.best = Math.max(state.best, state.score);

  // If you died, any pending clear-delay should not be treated as a cleared level.
  state.levelCleared = 0;

  // Lose a life.
  state.lives = Math.max(0, (state.lives ?? cfg.STARTING_LIVES) - 1);

  // If you ran out of lives, it's a real game over: freeze sim until the player
  // chooses Restart/Continue/Resume from the outer UI.
  if (state.lives <= 0) {
    state.gameOver = true;
    state.pendingNextLevelAt = null;
    state.bullets = [];
    state.fx = { shake: 0 };
    if (state.player) state.player.alive = false;
    return state;
  }

  // Otherwise respawn at the current checkpoint.
  state.gameOver = false;
  state.level = state.checkpointLevel;
  state.pendingNextLevelAt = null;

  state.player = {
    x: cfg.W * 0.25,
    y: cfg.H * 0.5,
    hp: 3,
    alive: true,
    aim: { x: 1, y: 0 },
    invuln: 1.1,
  };
  state.levelStartHp = state.player.hp;

  state.obstacles = spawnObstacles(cfg, rng, state.level, state.runSeed);
  state.enemies = [spawnEnemy(cfg, rng, state.level, state.obstacles)];
  state.enemy = state.enemies[0];
  state.enemyGoal = randomEnemyGoal(cfg, rng, state.obstacles);
  state.enemyGoalRecalcAt = 0;
  state.bullets = [];
  state.fx = { shake: 0 };
  state.tFire = 0;
  // Fairness/QoL: don't allow an instant enemy shot on the first frame after respawn.
  // (Player has invuln, but preventing the "spawn shot" also keeps the fight readable.)
  state.tEnemyFire = enemyFireCooldown(cfg, state.level);

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

function spawnObstacles(cfg, rng, level, runSeed) {
  // Keep level 1 clean for onboarding.
  if (level <= 1) return [];

  // Fairness/QoL: make obstacle layouts deterministic per level within a run.
  // This means if you die and respawn at a checkpoint, you can actually learn the layout
  // instead of re-rolling a new RNG wall.
  if (runSeed != null) {
    const seed = hash32(runSeed ^ ((level + 0x9e3779b9) >>> 0));
    rng = mulberry32(seed);
  }

  // Still uses circle rocks, so we don't need new collision/render logic.
  const obs = [];

  // Boss level variety: add a bit of cover so the 3-shot spread fight feels more tactical.
  // Two symmetric mid-field rocks create safe-ish lanes without fully blocking movement.
  if (isBossLevel(cfg, level)) {
    const r = randBetween(rng, 24, 32);
    const x = randBetween(rng, cfg.W * 0.46, cfg.W * 0.56);
    const yTop = randBetween(rng, cfg.H * 0.26, cfg.H * 0.36);
    const yBot = cfg.H - yTop;
    obs.push({ x, y: yTop, r });
    obs.push({ x, y: yBot, r });

    // Keep boss levels readable: don't also stack the non-boss obstacle patterns.
    // (Those patterns can create clutter + cheap pinches during longer boss fights.)
    return obs;
  }

  // Onboarding: level 2 introduces your first "real" obstacle.
  // Make it deterministic-ish (always one rock in a clear top/bottom lane) so new players
  // reliably learn dodging/routing without getting a weird RNG layout.
  if (level === 2) {
    const r = randBetween(rng, 18, 24);
    const x = randBetween(rng, cfg.W * 0.52, cfg.W * 0.62);
    const top = rng() < 0.5;
    const y = top ? randBetween(rng, cfg.H * 0.26, cfg.H * 0.34) : randBetween(rng, cfg.H * 0.66, cfg.H * 0.74);
    obs.push({ x, y, r });
    return obs;
  }

  // Early variety: level 3 is the first checkpoint level, so give it a recognizable
  // "two-lane" layout. This adds a tiny tactical choice (top/bottom route) without
  // feeling like a wall.
  if (level === 3) {
    const r = randBetween(rng, 18, 24);
    const x = randBetween(rng, cfg.W * 0.50, cfg.W * 0.60);
    const yTop = randBetween(rng, cfg.H * 0.30, cfg.H * 0.38);
    const yBot = cfg.H - yTop;
    obs.push({ x, y: yTop, r });
    obs.push({ x, y: yBot, r });

    // Keep level 3's layout recognizable (first checkpoint level) instead of piling
    // additional random patterns on top.
    return obs;
  }

  // Level variety: every few levels, create a simple "gate" you must route through.

  // Gate pattern: two bigger rocks leaving a vertical gap.
  // (Avoids the midline lane so it doesn't feel like a cheap trap.)
  if (level >= 3 && level % 4 === 0) {
    const gateX = randBetween(rng, cfg.W * 0.50, cfg.W * 0.66);
    const gapCenter = randBetween(rng, cfg.H * 0.22, cfg.H * 0.78);

    // Early-game fairness: make the first few "gate" levels a bit more forgiving.
    // Narrow gaps at low speed can feel like a cheap wall, especially on touch.
    const gapHalf = level <= 6 ? randBetween(rng, 74, 98) : randBetween(rng, 62, 86);
    const r = randBetween(rng, 28, 38);

    const yTop = clamp(gapCenter - gapHalf - r, cfg.H * 0.14 + r, cfg.H * 0.86 - r);
    const yBot = clamp(gapCenter + gapHalf + r, cfg.H * 0.14 + r, cfg.H * 0.86 - r);

    // Keep the gate away from the central horizontal-ish lane.
    if (Math.abs(yTop - cfg.H * 0.5) > 78 && Math.abs(yBot - cfg.H * 0.5) > 78) {
      obs.push({ x: gateX, y: yTop, r });
      obs.push({ x: gateX, y: yBot, r });
    }
  }

  // Horizontal gate: two bigger rocks leaving a horizontal gap.
  // This reads differently than the usual vertical gate and nudges you to route above/below.
  if (level >= 7 && level % 6 === 5) {
    const gateY = randBetween(rng, cfg.H * 0.34, cfg.H * 0.66);
    const gapCenter = randBetween(rng, cfg.W * 0.52, cfg.W * 0.66);
    const gapHalf = randBetween(rng, 72, 96);
    const r = randBetween(rng, 28, 38);

    const xLeft = clamp(gapCenter - gapHalf - r, cfg.W * 0.40 + r, cfg.W * 0.78 - r);
    const xRight = clamp(gapCenter + gapHalf + r, cfg.W * 0.40 + r, cfg.W * 0.78 - r);

    // Keep it off the player's typical midline so it doesn't feel like an instant pin.
    if (Math.abs(gateY - cfg.H * 0.5) > 64) {
      obs.push({ x: xLeft, y: gateY, r });
      obs.push({ x: xRight, y: gateY, r });
    }
  }

  // Moving gate: two rocks drift up/down out of phase, opening/closing a timing-based lane.
  // Adds a new "reads different" obstacle moment without adding new collision/render code.
  if (level >= 4 && level % 6 === 1) {
    const r = randBetween(rng, 18, 24);
    const x = randBetween(rng, cfg.W * 0.52, cfg.W * 0.66);
    const amp = randBetween(rng, 34, 48);
    const freq = randBetween(rng, 0.55, 0.72);
    const phase = randBetween(rng, 0, Math.PI * 2);

    const topY = randBetween(rng, cfg.H * 0.26, cfg.H * 0.36);
    const botY = randBetween(rng, cfg.H * 0.64, cfg.H * 0.74);

    obs.push({ x, y: topY, r, drift: { axis: 'y', baseX: x, baseY: topY, amp, freq, phase } });
    obs.push({ x, y: botY, r, drift: { axis: 'y', baseX: x, baseY: botY, amp, freq, phase: phase + Math.PI } });
  }

  // New variety: a "breathing" rock that pulses in size.
  // Creates a tiny timing puzzle (when to cross the lane) without new mechanics.
  if (level >= 6 && level % 8 === 3) {
    const r = randBetween(rng, 18, 26);
    const x = randBetween(rng, cfg.W * 0.52, cfg.W * 0.66);
    const top = rng() < 0.5;
    const y = top ? randBetween(rng, cfg.H * 0.26, cfg.H * 0.36) : randBetween(rng, cfg.H * 0.64, cfg.H * 0.74);
    const ampR = randBetween(rng, 6, 10);
    const freq = randBetween(rng, 0.7, 0.95);
    const phase = randBetween(rng, 0, Math.PI * 2);
    obs.push({ x, y, r, drift: { kind: 'pulse', baseX: x, baseY: y, baseR: r, ampR, freq, phase } });
  }

  // New variety: an "orbiter" — a small rock that circles a point.
  // Reads differently than gates (more dynamic), and makes some midgame levels feel less static.
  if (level >= 5 && level % 7 === 0) {
    const r = randBetween(rng, 16, 22);
    const cx = randBetween(rng, cfg.W * 0.56, cfg.W * 0.68);
    const cy = randBetween(rng, cfg.H * 0.34, cfg.H * 0.66);
    const amp = randBetween(rng, 34, 52);
    const freq = randBetween(rng, 0.55, 0.8);
    const phase = randBetween(rng, 0, Math.PI * 2);

    // Two orbiters opposite each other make a clear "gap" that moves.
    // Seed initial positions so they don't start overlapped on the first frame.
    const x1 = clamp(cx + Math.cos(phase) * amp, r, cfg.W - r);
    const y1 = clamp(cy + Math.sin(phase) * amp, r, cfg.H - r);
    const x2 = clamp(cx + Math.cos(phase + Math.PI) * amp, r, cfg.W - r);
    const y2 = clamp(cy + Math.sin(phase + Math.PI) * amp, r, cfg.H - r);
    obs.push({ x: x1, y: y1, r, drift: { kind: 'orbit', baseX: cx, baseY: cy, amp, freq, phase } });
    obs.push({ x: x2, y: y2, r, drift: { kind: 'orbit', baseX: cx, baseY: cy, amp, freq, phase: phase + Math.PI } });
  }

  // Add a little more variety as you climb.

  // New variety: an "asteroid belt" — a short row of small rocks with one clear gap.
  // This reads like a distinct layout and creates an obvious routing choice.
  if (level >= 8 && level % 9 === 4) {
    const r = randBetween(rng, 16, 22);
    const y = rng() < 0.5
      ? randBetween(rng, cfg.H * 0.24, cfg.H * 0.34)
      : randBetween(rng, cfg.H * 0.66, cfg.H * 0.76);
    const x0 = randBetween(rng, cfg.W * 0.44, cfg.W * 0.52);
    const dx = randBetween(rng, 62, 78);

    // Keep the gap away from the extreme edges so it feels like a real routing choice
    // (edge gaps can read as "just go around" and are a bit less interesting).
    const gap = Math.floor(randBetween(rng, 1, 4));

    for (let i = 0; i < 5; i++) {
      if (i === gap) continue;
      obs.push({ x: x0 + i * dx, y, r });
    }
  }

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

  // New variety: a single "cover" rock placed off-center.
  // This gives you a consistent pocket of safety/line-breaking without becoming a wall.
  // (Still just a circle rock; no new collision/render.)
  if (level >= 5 && level % 7 === 2) {
    const r = randBetween(rng, 26, 36);
    const x = randBetween(rng, cfg.W * 0.52, cfg.W * 0.64);
    const top = rng() < 0.5;
    const y = top ? randBetween(rng, cfg.H * 0.28, cfg.H * 0.38) : randBetween(rng, cfg.H * 0.62, cfg.H * 0.72);
    obs.push({ x, y, r });
  }

  // New variety: a simple diagonal "chicane" line that creates a different kind of routing.
  // Still just circles, but it reads like a new obstacle layout and breaks up the feel of
  // purely vertical gates.
  if (level >= 6 && level % 6 === 4) {
    const r = randBetween(rng, 18, 26);
    const x0 = randBetween(rng, cfg.W * 0.48, cfg.W * 0.58);
    const dx = randBetween(rng, 62, 84);

    const topStart = rng() < 0.5;
    const y0 = topStart ? randBetween(rng, cfg.H * 0.22, cfg.H * 0.34) : randBetween(rng, cfg.H * 0.66, cfg.H * 0.78);
    const dy = randBetween(rng, 72, 94) * (topStart ? 1 : -1);

    for (let i = 0; i < 3; i++) {
      const x = x0 + i * dx;
      const y = clamp(y0 + i * dy, cfg.H * 0.14 + r, cfg.H * 0.86 - r);

      // Keep it out of the central lane so it doesn't feel like a cheap pin.
      if (Math.abs(y - cfg.H * 0.5) < 72) continue;
      obs.push({ x, y, r });
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

  // New variety: a "breathing" rock that gently pulses its radius.
  // Still circle collision + same render, but it adds a timing element.
  if (level >= 6 && level % 7 === 1) {
    const baseR = randBetween(rng, 18, 26);
    const ampR = randBetween(rng, 5, 10);
    const freq = randBetween(rng, 0.65, 0.95);
    const phase = randBetween(rng, 0, Math.PI * 2);
    const x = randBetween(rng, cfg.W * 0.50, cfg.W * 0.68);
    const y = randBetween(rng, cfg.H * 0.20, cfg.H * 0.80);

    // Keep it out of the central lane so it doesn't feel like a cheap pin.
    if (Math.abs(y - cfg.H * 0.5) > 86) {
      obs.push({
        x,
        y,
        r: baseR,
        drift: { kind: 'pulse', baseR, ampR, freq, phase },
      });
    }
  }

  // New variety: a "sweeper" rock that drifts side-to-side.
  // It creates a moving pocket of cover and a different kind of routing read.
  if (level >= 10 && level % 8 === 1) {
    const r = randBetween(rng, 18, 26);
    const baseX = randBetween(rng, cfg.W * 0.54, cfg.W * 0.70);
    const top = rng() < 0.5;
    const baseY = top ? randBetween(rng, cfg.H * 0.22, cfg.H * 0.32) : randBetween(rng, cfg.H * 0.68, cfg.H * 0.78);
    const amp = randBetween(rng, 46, 72);
    const freq = randBetween(rng, 0.40, 0.58);
    const phase = randBetween(rng, 0, Math.PI * 2);

    obs.push({
      x: baseX,
      y: baseY,
      r,
      drift: { kind: 'sin', axis: 'x', baseX, baseY, amp, freq, phase },
    });
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
      // Seed initial positions on the orbit so the two rocks don't start overlapped
      // for a frame before updateObstacles() runs.
      const x1 = clamp(baseX + Math.cos(phase) * amp, r, cfg.W - r);
      const y1 = clamp(baseY + Math.sin(phase) * amp, r, cfg.H - r);
      const x2 = clamp(baseX + Math.cos(phase + Math.PI) * amp, r, cfg.W - r);
      const y2 = clamp(baseY + Math.sin(phase + Math.PI) * amp, r, cfg.H - r);

      obs.push({
        x: x1,
        y: y1,
        r,
        drift: { kind: 'orbit', baseX, baseY, amp, freq, phase },
      });
      obs.push({
        x: x2,
        y: y2,
        r,
        drift: { kind: 'orbit', baseX, baseY, amp, freq, phase: phase + Math.PI },
      });
    }
  }

  // New midgame variety: a small 4-rock "ring" around a center point.
  // This creates a recognizable pocket of cover (and routing choice) without needing
  // new mechanics.
  if (level >= 9 && level % 7 === 3) {
    const r = randBetween(rng, 18, 24);
    const cx = randBetween(rng, cfg.W * 0.50, cfg.W * 0.68);
    const cy = randBetween(rng, cfg.H * 0.24, cfg.H * 0.76);
    const d = randBetween(rng, 52, 72);

    // Keep it away from the player's spawn lane and from the central horizontal lane.
    if (Math.abs(cy - cfg.H * 0.5) > 86) {
      obs.push({ x: cx - d, y: cy, r });
      obs.push({ x: cx + d, y: cy, r });
      obs.push({ x: cx, y: cy - d * 0.72, r });
      obs.push({ x: cx, y: cy + d * 0.72, r });
    }
  }

  // New variety: a 4-rock "diamond" pocket.
  // Distinct from the ring: one open side + a clear "duck in / break line" space.
  if (level >= 7 && level % 8 === 7 && !isBossLevel(cfg, level)) {
    const r = randBetween(rng, 16, 22);
    const cx = randBetween(rng, cfg.W * 0.52, cfg.W * 0.68);
    const top = rng() < 0.5;
    const cy = top ? randBetween(rng, cfg.H * 0.26, cfg.H * 0.36) : randBetween(rng, cfg.H * 0.64, cfg.H * 0.74);
    const d = randBetween(rng, 44, 58);

    // Keep it away from the central lane so it doesn't feel like a forced pin.
    if (Math.abs(cy - cfg.H * 0.5) > 90) {
      // Leave one side open (random) so it's a pocket, not a full ring.
      const open = Math.floor(randBetween(rng, 0, 4));
      const pts = [
        { x: cx - d, y: cy },
        { x: cx + d, y: cy },
        { x: cx, y: cy - d },
        { x: cx, y: cy + d },
      ];
      for (let i = 0; i < pts.length; i++) {
        if (i === open) continue;
        obs.push({ x: pts[i].x, y: pts[i].y, r });
      }
    }
  }

  // New variety: a simple "pinwheel" of orbiting rocks.
  // Four small rocks orbit a shared center, creating a moving gap that reads differently
  // than the single-orbit/double-orbit patterns.
  if (level >= 11 && level % 10 === 7 && !isBossLevel(cfg, level)) {
    const r = randBetween(rng, 14, 18);
    const cx = randBetween(rng, cfg.W * 0.54, cfg.W * 0.70);
    const top = rng() < 0.5;
    const cy = top ? randBetween(rng, cfg.H * 0.24, cfg.H * 0.34) : randBetween(rng, cfg.H * 0.66, cfg.H * 0.76);
    const amp = randBetween(rng, 26, 38);
    const freq = randBetween(rng, 0.60, 0.85);
    const phase0 = randBetween(rng, 0, Math.PI * 2);

    // Keep it away from the central lane so it doesn't feel like a forced pin.
    if (Math.abs(cy - cfg.H * 0.5) > 90) {
      for (let i = 0; i < 4; i++) {
        obs.push({
          x: cx,
          y: cy,
          r,
          drift: { kind: 'orbit', baseX: cx, baseY: cy, amp, freq, phase: phase0 + i * (Math.PI / 2) },
        });
      }
    }
  }

  // New variety: a small "hex pocket" ring (with one side open).
  // This creates a recognizable safe-ish pocket / line-break spot that plays differently
  // than the 3/4-rock patterns.
  if (level >= 12 && level % 9 === 7 && !isBossLevel(cfg, level)) {
    const r = randBetween(rng, 14, 18);
    const cx = randBetween(rng, cfg.W * 0.54, cfg.W * 0.70);
    const top = rng() < 0.5;
    const cy = top ? randBetween(rng, cfg.H * 0.24, cfg.H * 0.34) : randBetween(rng, cfg.H * 0.66, cfg.H * 0.76);
    const d = randBetween(rng, 46, 62);
    const open = Math.floor(randBetween(rng, 0, 6));

    // Keep it away from the central lane so it doesn't feel like a forced pin.
    if (Math.abs(cy - cfg.H * 0.5) > 96) {
      for (let i = 0; i < 6; i++) {
        if (i === open) continue;
        const a = (i / 6) * Math.PI * 2;
        obs.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r });
      }
    }
  }

  if (count <= 0) return obs;

  for (let i = 0; i < count; i++) {
    // Try a few times to avoid sitting directly in the player's spawn lane
    // and to avoid overlapping existing obstacles.
    let placed = false;
    for (let tries = 0; tries < 14; tries++) {
      // Early levels: keep rocks a bit smaller so onboarding feels fair.
      const rMin = level <= 3 ? 16 : 18;
      const rMax = level <= 3 ? 26 : 34;
      const r = randBetween(rng, rMin, rMax);
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

  // QoL/fairness: some of the higher-level patterns can occasionally overlap
  // (especially when multiple pattern clauses trigger on the same level).
  // Overlaps read like a single unfair mega-rock and can create unavoidable pinches.
  // Keep the earlier-placed rocks and drop later overlaps.
  const deOverlapped = [];
  for (const o of obs) {
    let ok = true;
    for (const p of deOverlapped) {
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < o.r + p.r + 6) { ok = false; break; }
    }
    if (ok) deOverlapped.push(o);
  }

  // QoL/fairness: keep the immediate player spawn area clear.
  // Some patterns (especially on denser midgame levels) can occasionally put a rock
  // near the left quarter of the arena, which feels like an unavoidable "spawn pinch".
  // Filtering here keeps all the variety above while preventing that cheap moment.
  const spawnX = cfg.W * 0.25;
  const spawnY = cfg.H * 0.5;
  const spawnPad = 92;
  return deOverlapped.filter((o) => Math.hypot(o.x - spawnX, o.y - spawnY) > (o.r + spawnPad));
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

      // Keep drifting obstacles out of the immediate player-side lane.
      const minX = cfg.W * 0.34 + o.r;
      if (o.x < minX) o.x = minX;
      continue;
    }

    if (d.kind === 'pulse') {
      // "Breathing" obstacle: radius oscillates a bit, but position stays fixed.
      // Clamp to keep collision sane and avoid disappearing rocks.
      if (d.baseR == null) d.baseR = o.r;
      const ampR = d.ampR ?? 7;
      o.r = clamp(d.baseR + Math.sin(t) * ampR, 12, 46);

      // Fairness: if the radius grows, keep the rock inside the arena.
      // (Prevents edge-adjacent pulse rocks from "sticking" into the wall.)
      o.x = clamp(o.x, o.r, cfg.W - o.r);
      o.y = clamp(o.y, o.r, cfg.H - o.r);

      // Keep drifting obstacles out of the immediate player-side lane.
      const minX = cfg.W * 0.34 + o.r;
      if (o.x < minX) o.x = minX;
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

    // Fairness/QoL: drifting obstacles should never wander into the immediate
    // player-side spawn lane. Static obstacles already get filtered at spawn-time,
    // but animated ones could drift left and create cheap "spawn pinch" moments.
    const minX = cfg.W * 0.34 + o.r;
    if (o.x < minX) o.x = minX;
  }
}

function isBossLevel(cfg, level) {
  return level % cfg.BOSS_EVERY === 0;
}

function spawnEnemy(cfg, rng, level, obstacles = []) {
  const boss = isBossLevel(cfg, level);

  // Tiny variety: after the first couple levels, pick enemy type with a bit of RNG
  // instead of strict parity. Keeps runs from feeling too patterned.
  let type;
  if (boss) {
    type = 'boss';
  } else if (level <= 2) {
    type = level % 2 === 0 ? 'scout' : 'tank';
  } else {
    const scoutChance = 0.5 + Math.min(0.15, Math.max(0, (level - 3) * 0.02));
    type = (rng() < scoutChance) ? 'scout' : 'tank';
  }
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

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash32(x) {
  // A tiny 32-bit mix/hash (xorshift-ish). Good enough for seeding.
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
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
  const lvl = state.level ?? 1;

  state.bullets.push({
    owner,
    x: x + ax * (sourceR + bulletR + 2),
    y: y + ay * (sourceR + bulletR + 2),
    vx: ax * bulletSpeed,
    vy: ay * bulletSpeed,
    life: 1.6,

    // Tiny fun: player shots can ricochet off rocks.
    // Give +1 extra bounce in later levels so the midgame feels a bit spicier.
    // (Keeps enemies fair: only the player's bullets get this.)
    bounces: owner === 'p' ? (lvl >= 8 ? 2 : 1) : 0,

    // New micro-variety: later levels also grant wall-bounces.
    // +1 at lvl 6, +2 at lvl 10+ for a little extra mid/late-game fun.
    wallBounces: owner === 'p' ? (lvl >= 10 ? 2 : (lvl >= 6 ? 1 : 0)) : 0,

    // For score bonuses / feedback.
    bounced: 0,
  });
}
