export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function hitCircle(ax, ay, ar, bx, by, br) {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy <= rr * rr;
}
