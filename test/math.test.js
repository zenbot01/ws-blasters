import { describe, expect, it } from 'vitest';
import { clamp, hitCircle } from '../client/game/math.js';

describe('math', () => {
  it('clamp clamps values to range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(999, 0, 10)).toBe(10);
  });

  it('hitCircle detects circle overlaps', () => {
    expect(hitCircle(0, 0, 1, 1.5, 0, 1)).toBe(true);
    expect(hitCircle(0, 0, 1, 3, 0, 1)).toBe(false);
  });
});
