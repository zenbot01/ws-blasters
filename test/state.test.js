import { describe, expect, it } from 'vitest';
import { initState, stepState, DEFAULTS } from '../client/game/state.js';

function makeRng(seq) {
  let i = 0;
  return () => {
    const v = seq[i % seq.length];
    i++;
    return v;
  };
}

describe('state', () => {
  it('moves player within bounds', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng);
    s.player.x = 10;
    stepState(s, { left: true }, 1, rng, 0);
    expect(s.player.x).toBeGreaterThanOrEqual(DEFAULTS.PLAYER_R);
  });

  it('can start at an unlocked level (with checkpoint alignment)', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng, 0, DEFAULTS, 4);
    expect(s.level).toBe(4);
    expect(s.checkpointLevel).toBe(3); // CHECKPOINT_EVERY=3
    expect(s.lives).toBe(DEFAULTS.STARTING_LIVES + 2);
    expect(s.enemy.alive).toBe(true);
    expect(s.enemy.isBoss).toBe(false);

    const sBoss = initState(rng, 0, DEFAULTS, 5);
    expect(sBoss.level).toBe(5);
    expect(sBoss.enemy.isBoss).toBe(true);
  });

  it('levels up after killing enemy (after delay)', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng);
    s.enemy.x = s.player.x + 40;
    s.enemy.y = s.player.y;
    s.enemy.hp = 1;

    let t = 0;
    stepState(s, { fire: true }, 0.01, rng, t);

    for (let i = 0; i < 12; i++) {
      t += 0.02;
      stepState(s, {}, 0.02, rng, t);
    }

    expect(s.level).toBe(1);
    expect(s.enemy.alive).toBe(false);

    // Add a lingering bullet to ensure we don't carry shots across levels.
    s.bullets.push({ owner: 'p', x: s.player.x, y: s.player.y, vx: 0, vy: 0, life: 10 });

    t += 2;
    stepState(s, {}, 0.01, rng, t);
    expect(s.level).toBe(2);
    expect(s.enemy.alive).toBe(true);
    expect(s.bullets.length).toBe(0);
  });

  it('spawns a boss on level 5', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng);

    let t = 0;
    while (s.level < 5) {
      s.enemy.x = s.player.x + 40;
      s.enemy.y = s.player.y;
      s.enemy.hp = 1;

      stepState(s, { fire: true }, 0.01, rng, t);
      for (let i = 0; i < 12; i++) {
        t += 0.02;
        stepState(s, {}, 0.02, rng, t);
      }
      t += 1;
      stepState(s, {}, 0.01, rng, t);
      if (t > 60) throw new Error('test timeout');
    }

    expect(s.level).toBe(5);
    expect(s.enemy.isBoss).toBe(true);
    expect(s.enemy.maxHp).toBeGreaterThan(0);
    expect(s.enemy.r).toBeGreaterThan(DEFAULTS.PLAYER_R);
  });

  it('keeps boss levels readable by not stacking extra obstacle patterns', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng, 0, DEFAULTS, 5);
    expect(s.enemy.isBoss).toBe(true);

    // Boss levels should have a small, consistent cover layout.
    expect(s.obstacles.length).toBe(2);
  });

  it('treats boss clears as a checkpoint', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng, 0, DEFAULTS, 5);
    expect(s.enemy.isBoss).toBe(true);

    // Clear the boss.
    s.enemy.x = s.player.x + 40;
    s.enemy.y = s.player.y;
    s.enemy.hp = 1;

    let t = 0;
    stepState(s, { fire: true }, 0.01, rng, t);

    expect(s.enemy.alive).toBe(false);
    expect(s.checkpointLevel).toBe(5);
  });

  it('reduces player hitbox slightly while in slow mode', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng);

    s.player.invuln = 0;
    s.player.hp = 3;

    // Place an enemy bullet barely inside the normal hitbox, but outside the slow-mode hitbox.
    // PLAYER_R=16, BULLET_R=4, slow hitbox = 16*0.85=13.6
    // Distance 19.9 hits normal (<=20) but misses slow ( >17.6)
    const dx = (DEFAULTS.PLAYER_R + DEFAULTS.BULLET_R) - 0.1;
    s.bullets = [{ owner: 'e', x: s.player.x + dx, y: s.player.y, vx: 0, vy: 0, life: 1 }];

    stepState(s, { slow: true }, 0.01, rng, 0);
    expect(s.player.hp).toBe(3);

    // Same setup without slow should hit.
    s.player.invuln = 0;
    s.player.hp = 3;
    s.bullets = [{ owner: 'e', x: s.player.x + dx, y: s.player.y, vx: 0, vy: 0, life: 1 }];

    stepState(s, { slow: false }, 0.01, rng, 0);
    expect(s.player.hp).toBe(2);
  });

  it('uses lives + checkpoint instead of hard reset to level 1', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng);

    // Move to checkpoint level 3
    s.level = 3;
    s.checkpointLevel = 3;

    // Simulate death by forcing enemy bullet hits: just call onPlayerDeath through step
    // Disable the start-of-run grace window so the bullet hit is immediate.
    s.player.invuln = 0;
    s.player.hp = 1;
    // Make an enemy bullet overlap player
    s.bullets.push({ owner: 'e', x: s.player.x, y: s.player.y, vx: 0, vy: 0, life: 1 });
    stepState(s, {}, 0.01, rng, 0);

    // Should respawn and still be at checkpoint (since lives remain)
    expect(s.level).toBe(3);
    expect(s.lives).toBe(DEFAULTS.STARTING_LIVES - 1);
    expect(s.player.alive).toBe(true);
  });
});
