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
    stepState(s, { left: true }, 1, rng);
    expect(s.player.x).toBeGreaterThanOrEqual(16);
  });

  it('player bullet damages enemy', () => {
    const rng = makeRng([0.5]);
    const s = initState(rng);
    // Make enemy close so a bullet hits quickly
    s.enemy.x = s.player.x + 40;
    s.enemy.y = s.player.y;

    stepState(s, { fire: true }, 0.01, rng);
    // Advance a bit
    for (let i = 0; i < 20; i++) stepState(s, {}, 0.02, rng);

    expect(s.enemy.hp).toBeLessThan(5);
    expect(s.score).toBeGreaterThanOrEqual(10);
  });
});
