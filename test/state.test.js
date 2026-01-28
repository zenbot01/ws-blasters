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

    t += 2;
    stepState(s, {}, 0.01, rng, t);
    expect(s.level).toBe(2);
    expect(s.enemy.alive).toBe(true);
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

  it('uses lives + checkpoint instead of hard reset to level 1', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng);

    // Move to checkpoint level 3
    s.level = 3;
    s.checkpointLevel = 3;

    // Simulate death by forcing enemy bullet hits: just call onPlayerDeath through step
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
