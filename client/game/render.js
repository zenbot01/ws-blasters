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

  // Obstacles
  if (state.obstacles?.length) {
    for (const o of state.obstacles) drawObstacle(ctx, o);
  }

  // Entities
  drawPlayerShip(ctx, state.player, PLAYER_R);

  const enemyR = state.enemy.r ?? PLAYER_R;
  if (state.enemy.isBoss) {
    drawBoss(ctx, state.enemy, enemyR);
  } else {
    drawEnemy(ctx, state.enemy, enemyR);
  }

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
  const g = ctx.createRadialGradient(
    W / 2,
    H / 2,
    Math.min(W, H) * 0.1,
    W / 2,
    H / 2,
    Math.max(W, H) * 0.75,
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawObstacle(ctx, o) {
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.shadowColor = 'rgba(148, 163, 184, 0.25)';
  ctx.shadowBlur = 14;

  const g = ctx.createRadialGradient(o.x - o.r * 0.35, o.y - o.r * 0.35, 2, o.x, o.y, o.r * 1.2);
  g.addColorStop(0, 'rgba(226, 232, 240, 0.35)');
  g.addColorStop(1, 'rgba(51, 65, 85, 0.95)');

  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}

function drawPlayerShip(ctx, p, r) {
  ctx.save();
  ctx.globalAlpha = p.alive ? 1 : 0.28;

  // Flicker while invulnerable (respawn grace).
  if (p.alive && (p.invuln ?? 0) > 0) {
    ctx.globalAlpha *= Math.floor((p.invuln ?? 0) * 14) % 2 === 0 ? 0.35 : 0.9;
  }

  // Glow
  ctx.shadowColor = 'rgba(56, 189, 248, 0.55)';
  ctx.shadowBlur = 18;

  // Determine facing based on aim (fallback forward)
  const ax = p.aim?.x ?? 1;
  const ay = p.aim?.y ?? 0;
  const ang = Math.atan2(ay, ax);

  ctx.translate(p.x, p.y);
  ctx.rotate(ang);

  // Ship body (triangle)
  const bodyGrad = ctx.createLinearGradient(-r, 0, r * 1.4, 0);
  bodyGrad.addColorStop(0, '#0ea5e9');
  bodyGrad.addColorStop(1, '#1f6feb');

  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(r * 1.5, 0);
  ctx.lineTo(-r * 0.9, -r * 0.9);
  ctx.lineTo(-r * 0.6, 0);
  ctx.lineTo(-r * 0.9, r * 0.9);
  ctx.closePath();
  ctx.fill();

  // Cockpit highlight
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(147,197,253,0.65)';
  ctx.beginPath();
  ctx.ellipse(r * 0.35, 0, r * 0.35, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Outline
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Thruster flame
  ctx.globalAlpha *= 0.9;
  ctx.fillStyle = 'rgba(251, 191, 36, 0.7)';
  ctx.beginPath();
  ctx.moveTo(-r * 1.05, 0);
  ctx.lineTo(-r * 1.45, -r * 0.25);
  ctx.lineTo(-r * 1.25, 0);
  ctx.lineTo(-r * 1.45, r * 0.25);
  ctx.closePath();
  ctx.fill();

  ctx.restore();

  // HP pips (world-space)
  ctx.save();
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < p.hp && p.alive ? 'rgba(147,197,253,0.95)' : 'rgba(17,24,39,0.9)';
    ctx.fillRect(p.x - 18 + i * 12, p.y - 30, 10, 6);
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

function drawBoss(ctx, b, r) {
  ctx.save();
  ctx.globalAlpha = b.alive ? 1 : 0.18;

  // Big purple glow
  ctx.shadowColor = 'rgba(168, 85, 247, 0.6)';
  ctx.shadowBlur = 26;

  const g = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.35, 2, b.x, b.y, r * 1.3);
  g.addColorStop(0, '#f5d0fe');
  g.addColorStop(1, '#a855f7');

  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.fill();

  // Crown-ish ring
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r + 5, 0, Math.PI * 2);
  ctx.stroke();

  // Boss HP bar
  const max = Math.max(1, b.maxHp ?? b.hp);
  const barW = 140;
  const barH = 10;
  const x = b.x - barW / 2;
  const y = b.y - r - 22;
  ctx.fillStyle = 'rgba(17,24,39,0.9)';
  ctx.fillRect(x, y, barW, barH);
  ctx.fillStyle = 'rgba(245, 208, 254, 0.9)';
  ctx.fillRect(x, y, Math.max(2, barW * Math.min(1, b.hp / (max || 1))), barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, barW, barH);

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
