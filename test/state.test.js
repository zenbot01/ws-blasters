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

  it('player bullet damages enemy', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng);
    s.enemy.x = s.player.x + 40;
    s.enemy.y = s.player.y;

    let t = 0;
    stepState(s, { fire: true }, 0.01, rng, t);

    for (let i = 0; i < 20; i++) {
      t += 0.02;
      stepState(s, {}, 0.02, rng, t);
    }

    expect(s.enemy.hp).toBeLessThan(5 + 1);
    expect(s.score).toBeGreaterThanOrEqual(10);
  });

  it('levels up after killing enemy (after delay)', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng);
    s.enemy.x = s.player.x + 40;
    s.enemy.y = s.player.y;
    s.enemy.hp = 1;

    let t = 0;
    stepState(s, { fire: true }, 0.01, rng, t);

    for (let i = 0; i < 10; i++) {
      t += 0.02;
      stepState(s, {}, 0.02, rng, t);
    }

    expect(s.enemy.alive).toBe(false);
    expect(s.pendingNextLevelAt).not.toBeNull();

    // Advance beyond clear delay
    t += 2;
    stepState(s, {}, 0.01, rng, t);

    expect(s.level).toBe(2);
    expect(s.enemy.alive).toBe(true);
  });

  it('spawns a boss on level 5', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng);

    let t = 0;

    // Kill enemies until we reach level 5.
    while (s.level < 5) {
      s.enemy.x = s.player.x + 40;
      s.enemy.y = s.player.y;
      s.enemy.hp = 1;

      stepState(s, { fire: true }, 0.01, rng, t);
      // Let bullet hit
      for (let i = 0; i < 12; i++) {
        t += 0.02;
        stepState(s, {}, 0.02, rng, t);
      }
      // Clear delay + spawn next level
      t += 1;
      stepState(s, {}, 0.01, rng, t);

      // Safety
      if (t > 60) throw new Error('test timeout');
    }

    expect(s.level).toBe(5);
    expect(s.enemy.isBoss).toBe(true);
    expect(s.enemy.r).toBeGreaterThan(DEFAULTS.PLAYER_R);
  });
});
