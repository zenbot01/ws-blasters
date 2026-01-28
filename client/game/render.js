import { DEFAULTS } from './state.js';

export function drawFrame(ctx, canvas, state) {
  const { W, H, PLAYER_R, BULLET_R } = DEFAULTS;

  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;

  // Letterbox scale
  const sx = cw / W;
  const sy = ch / H;
  const s = Math.min(sx, sy);
  const ox = (cw - W * s) / 2;
  const oy = (ch - H * s) / 2;

  // Background
  drawBackground(ctx, cw, ch);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, s);

  // Arena border
  ctx.strokeStyle = 'rgba(90, 130, 180, 0.35)';
  ctx.lineWidth = 2 / s;
  ctx.strokeRect(0, 0, W, H);

  // Soft vignette inside arena
  drawArenaVignette(ctx, W, H);

  // Entities
  drawPlayer(ctx, state.player, PLAYER_R);
  drawEnemy(ctx, state.enemy, PLAYER_R);

  // Bullets with glow
  for (const b of state.bullets) {
    drawBullet(ctx, b.x, b.y, BULLET_R);
  }

  ctx.restore();
}

function drawBackground(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#070a10');
  g.addColorStop(1, '#0b1220');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Subtle stars
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#e6edf3';
  for (let i = 0; i < 60; i++) {
    const x = (Math.sin(i * 999) * 0.5 + 0.5) * w;
    const y = (Math.sin(i * 1337) * 0.5 + 0.5) * h;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function drawArenaVignette(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.1, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawPlayer(ctx, p, r) {
  ctx.save();
  ctx.globalAlpha = p.alive ? 1 : 0.28;

  // Glow
  ctx.shadowColor = 'rgba(56, 189, 248, 0.55)';
  ctx.shadowBlur = 16;

  const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, 2, p.x, p.y, r * 1.2);
  g.addColorStop(0, '#93c5fd');
  g.addColorStop(1, '#1f6feb');

  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();

  // Rim
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // HP pips
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < p.hp && p.alive ? 'rgba(147,197,253,0.95)' : 'rgba(17,24,39,0.9)';
    ctx.fillRect(p.x - 18 + i * 12, p.y - 28, 10, 6);
  }

  ctx.restore();
}

function drawEnemy(ctx, e, r) {
  ctx.save();
  ctx.globalAlpha = e.alive ? 1 : 0.22;

  // Glow
  ctx.shadowColor = 'rgba(244, 63, 94, 0.45)';
  ctx.shadowBlur = 18;

  const g = ctx.createRadialGradient(e.x - r * 0.35, e.y - r * 0.35, 2, e.x, e.y, r * 1.2);
  g.addColorStop(0, '#fecaca');
  g.addColorStop(1, '#d1242f');

  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // HP pips (up to 6)
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i < e.hp && e.alive ? 'rgba(254,202,202,0.95)' : 'rgba(17,24,39,0.9)';
    ctx.fillRect(e.x - 24 + i * 8, e.y - 28, 7, 6);
  }

  ctx.restore();
}

function drawBullet(ctx, x, y, r) {
  ctx.save();
  ctx.shadowColor = 'rgba(251, 191, 36, 0.75)';
  ctx.shadowBlur = 12;

  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r * 1.8);
  g.addColorStop(0, '#fff7ed');
  g.addColorStop(0.35, '#fbbf24');
  g.addColorStop(1, 'rgba(251,191,36,0.0)');

  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
