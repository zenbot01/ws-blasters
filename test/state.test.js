import { describe, expect, it } from 'vitest';
import { initState, stepState } from '../client/game/state.js';

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
    expect(s.player.x).toBeGreaterThanOrEqual(16);
  });

  it('player bullet damages enemy', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng);
    // Make enemy close so a bullet hits quickly
    s.enemy.x = s.player.x + 40;
    s.enemy.y = s.player.y;

    stepState(s, { fire: true }, 0.01, rng, 0);
    // Advance a bit
    for (let i = 0; i < 20; i++) stepState(s, {}, 0.02, rng, 0.02 * (i + 1));

    expect(s.enemy.hp).toBeLessThan(5 + 1); // enemy hp varies by init level
    expect(s.score).toBeGreaterThanOrEqual(10);
  });

  it('levels up after killing enemy (after delay)', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng);
    s.enemy.x = s.player.x + 40;
    s.enemy.y = s.player.y;
    s.enemy.hp = 1;

    stepState(s, { fire: true }, 0.01, rng, 0);
    // Bullet should hit quickly
    for (let i = 0; i < 10; i++) stepState(s, {}, 0.02, rng, 0.02 * (i + 1));
    expect(s.enemy.alive).toBe(false);
    expect(s.pendingNextLevelAt).not.toBeNull();

    // Fast-forward beyond delay
    stepState(s, {}, 0.01, rng, 2);
    expect(s.level).toBe(2);
    expect(s.enemy.alive).toBe(true);
  });
});
