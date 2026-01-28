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
};

export function initState(rng = Math.random, bestScore = 0, cfg = DEFAULTS) {
  const state = {
    cfg,

    level: 1,
    wave: 1,
    pendingNextLevelAt: null,

    player: { x: cfg.W * 0.25, y: cfg.H * 0.5, hp: 3, alive: true },
    enemy: spawnEnemy(cfg, rng, 1),

    bullets: [],

    score: 0,
    best: bestScore,

    tFire: 0,
    tEnemyFire: 0,

    enemyGoal: randomEnemyGoal(cfg, rng),
  };
  return state;
}

export function stepState(state, input, dt, rng = Math.random, now = performanceNow()) {
  const cfg = state.cfg;
  const { W, H, PLAYER_R, BULLET_R, PLAYER_SPEED, BULLET_SPEED } = cfg;

  // If player is dead, freeze sim (keeps rendering).
  if (!state.player.alive) return state;

  // Handle level transitions
  if (state.pendingNextLevelAt != null && now >= state.pendingNextLevelAt) {
    state.level += 1;
    state.wave = 1;
    state.pendingNextLevelAt = null;
    state.enemy = spawnEnemy(cfg, rng, state.level);
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

  // Fire
  state.tFire -= dt;
  if (input.fire && state.tFire <= 0) {
    state.tFire = cfg.FIRE_COOLDOWN;
    const { ax, ay } = aimDirFallback(state.player, state.enemy, input);
    spawnBullet(state, 'p', state.player.x, state.player.y, ax, ay, BULLET_SPEED, PLAYER_R, BULLET_R);
  }

  // Enemy AI
  if (state.enemy.alive) {
    const speed = enemySpeed(cfg, state.level);

    const gx = state.enemyGoal.x - state.enemy.x;
    const gy = state.enemyGoal.y - state.enemy.y;
    const gm = Math.hypot(gx, gy);
    if (gm < 18) {
      state.enemyGoal = randomEnemyGoal(cfg, rng);
    } else {
      state.enemy.x = clamp(state.enemy.x + (gx / gm) * speed * dt, PLAYER_R, W - PLAYER_R);
      state.enemy.y = clamp(state.enemy.y + (gy / gm) * speed * dt, PLAYER_R, H - PLAYER_R);
    }

    // Enemy fire
    state.tEnemyFire -= dt;
    if (state.tEnemyFire <= 0) {
      state.tEnemyFire = enemyFireCooldown(cfg, state.level);
      const ax0 = state.player.x - state.enemy.x;
      const ay0 = state.player.y - state.enemy.y;
      const m = Math.hypot(ax0, ay0) || 1;
      spawnBullet(state, 'e', state.enemy.x, state.enemy.y, ax0 / m, ay0 / m, BULLET_SPEED, PLAYER_R, BULLET_R);
    }
  }

  // Bullets update + collisions
  for (const b of state.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;

    if (b.life <= 0) continue;

    if (b.owner === 'p' && state.enemy.alive && hitCircle(b.x, b.y, BULLET_R, state.enemy.x, state.enemy.y, PLAYER_R)) {
      b.life = -1;
      state.enemy.hp -= 1;
      state.score += 10;
      if (state.enemy.hp <= 0) {
        state.enemy.alive = false;
        state.score += 100;
        state.best = Math.max(state.best, state.score);

        // Start next level timer (small breather / visual beat)
        if (state.pendingNextLevelAt == null) {
          state.pendingNextLevelAt = now + cfg.LEVEL_CLEAR_DELAY;
        }
      }
    }

    if (b.owner === 'e' && hitCircle(b.x, b.y, BULLET_R, state.player.x, state.player.y, PLAYER_R)) {
      b.life = -1;
      state.player.hp -= 1;
      if (state.player.hp <= 0) {
        state.player.alive = false;
        state.best = Math.max(state.best, state.score);
      }
    }
  }

  state.bullets = state.bullets.filter(
    (b) => b.life > 0 && b.x >= -60 && b.x <= W + 60 && b.y >= -60 && b.y <= H + 60,
  );

  return state;
}

function performanceNow() {
  // In browser, performance.now exists; in tests, we pass explicit `now`.
  return () => (typeof performance !== 'undefined' && performance.now ? performance.now() / 1000 : Date.now() / 1000);
}

function randomEnemyGoal(cfg, rng) {
  return {
    x: randBetween(rng, cfg.W * 0.55, cfg.W * 0.95),
    y: randBetween(rng, cfg.H * 0.1, cfg.H * 0.9),
  };
}

function spawnEnemy(cfg, rng, level) {
  const baseHp = 4;
  const hp = baseHp + Math.min(10, level); // cap growth
  return {
    x: cfg.W * 0.75,
    y: randBetween(rng, cfg.H * 0.2, cfg.H * 0.8),
    hp,
    alive: true,
  };
}

function enemySpeed(cfg, level) {
  return cfg.ENEMY_SPEED + Math.min(160, (level - 1) * 10);
}

function enemyFireCooldown(cfg, level) {
  // Faster as levels increase, with floor
  return Math.max(0.24, cfg.ENEMY_FIRE_COOLDOWN - (level - 1) * 0.02);
}

function randBetween(rng, a, b) {
  return a + rng() * (b - a);
}

function aimDirFallback(from, to, input) {
  let ax = (input.aimRight ? 1 : 0) - (input.aimLeft ? 1 : 0);
  let ay = (input.aimDown ? 1 : 0) - (input.aimUp ? 1 : 0);
  if (ax === 0 && ay === 0) {
    ax = to.x - from.x;
    ay = to.y - from.y;
  }
  const m = Math.hypot(ax, ay) || 1;
  return { ax: ax / m, ay: ay / m };
}

function spawnBullet(state, owner, x, y, ax, ay, bulletSpeed, playerR, bulletR) {
  state.bullets.push({
    owner,
    x: x + ax * (playerR + bulletR + 2),
    y: y + ay * (playerR + bulletR + 2),
    vx: ax * bulletSpeed,
    vy: ay * bulletSpeed,
    life: 1.6,
  });
}
