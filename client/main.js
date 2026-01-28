import { clamp, hitCircle } from './game/math.js';

(() => {
  const canvas = document.getElementById('c');
  const statusEl = document.getElementById('status');
  const hudEl = document.getElementById('hud');
  const ctx = canvas.getContext('2d');

  const W = 900;
  const H = 600;
  const PLAYER_R = 16;
  const BULLET_R = 4;

  const PLAYER_SPEED = 280; // px/s
  const BULLET_SPEED = 560; // px/s
  const FIRE_COOLDOWN = 0.22; // seconds

  const ENEMY_SPEED = 180;
  const ENEMY_FIRE_COOLDOWN = 0.55;

  function randBetween(a, b) {
    return a + Math.random() * (b - a);
  }

  function setStatus(s, ok) {
    statusEl.textContent = s;
    statusEl.style.borderColor = ok ? '#2ea043' : '#b42318';
    statusEl.style.color = ok ? '#2ea043' : '#ff7b72';
  }

  setStatus('single-player', true);

  const input = {
    up: false,
    down: false,
    left: false,
    right: false,
    fire: false,
    aimUp: false,
    aimDown: false,
    aimLeft: false,
    aimRight: false,
  };

  const keyMap = {
    KeyW: 'up',
    ArrowUp: 'up',
    KeyS: 'down',
    ArrowDown: 'down',
    KeyA: 'left',
    ArrowLeft: 'left',
    KeyD: 'right',
    ArrowRight: 'right',

    KeyI: 'aimUp',
    KeyK: 'aimDown',
    KeyJ: 'aimLeft',
    KeyL: 'aimRight',

    Space: 'fire',
  };

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') {
      reset();
      return;
    }
    const k = keyMap[e.code];
    if (!k) return;
    if (k === 'fire') e.preventDefault();
    input[k] = true;
  });
  window.addEventListener('keyup', (e) => {
    const k = keyMap[e.code];
    if (!k) return;
    input[k] = false;
  });

  function letterbox() {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const sx = cw / W;
    const sy = ch / H;
    const s = Math.min(sx, sy);
    const ox = (cw - W * s) / 2;
    const oy = (ch - H * s) / 2;
    return { s, ox, oy };
  }

  let player, enemy, bullets, score, best, tFire, tEnemyFire, enemyGoal;

  function reset() {
    player = { x: W * 0.25, y: H * 0.5, hp: 3, alive: true };
    enemy = { x: W * 0.75, y: H * 0.5, hp: 5, alive: true };
    bullets = [];
    score = 0;
    best = Math.max(best || 0, score);
    tFire = 0;
    tEnemyFire = 0;
    enemyGoal = { x: randBetween(W * 0.55, W * 0.95), y: randBetween(H * 0.1, H * 0.9) };
    setStatus('single-player', true);
  }

  reset();

  function aimDirFallback(from, to) {
    let ax = (input.aimRight ? 1 : 0) - (input.aimLeft ? 1 : 0);
    let ay = (input.aimDown ? 1 : 0) - (input.aimUp ? 1 : 0);
    if (ax === 0 && ay === 0) {
      ax = to.x - from.x;
      ay = to.y - from.y;
    }
    const m = Math.hypot(ax, ay) || 1;
    return { ax: ax / m, ay: ay / m };
  }

  function spawnBullet(owner, x, y, ax, ay) {
    bullets.push({ owner, x, y, vx: ax * BULLET_SPEED, vy: ay * BULLET_SPEED, life: 1.6 });
  }

  function step(dt) {
    // Player movement
    const ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const iy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    let nx = ix,
      ny = iy;
    const mag = Math.hypot(nx, ny);
    if (mag > 0) {
      nx /= mag;
      ny /= mag;
    }

    player.x = clamp(player.x + nx * PLAYER_SPEED * dt, PLAYER_R, W - PLAYER_R);
    player.y = clamp(player.y + ny * PLAYER_SPEED * dt, PLAYER_R, H - PLAYER_R);

    // Player fire
    tFire -= dt;
    if (input.fire && tFire <= 0 && player.alive) {
      tFire = FIRE_COOLDOWN;
      const { ax, ay } = aimDirFallback(player, enemy);
      spawnBullet(
        'p',
        player.x + ax * (PLAYER_R + BULLET_R + 2),
        player.y + ay * (PLAYER_R + BULLET_R + 2),
        ax,
        ay,
      );
    }

    // Enemy AI movement
    if (enemy.alive) {
      const gx = enemyGoal.x - enemy.x;
      const gy = enemyGoal.y - enemy.y;
      const gm = Math.hypot(gx, gy);
      if (gm < 18) {
        enemyGoal = { x: randBetween(W * 0.55, W * 0.95), y: randBetween(H * 0.1, H * 0.9) };
      } else {
        enemy.x = clamp(enemy.x + (gx / gm) * ENEMY_SPEED * dt, PLAYER_R, W - PLAYER_R);
        enemy.y = clamp(enemy.y + (gy / gm) * ENEMY_SPEED * dt, PLAYER_R, H - PLAYER_R);
      }

      // Enemy fire at player
      tEnemyFire -= dt;
      if (tEnemyFire <= 0 && player.alive) {
        tEnemyFire = ENEMY_FIRE_COOLDOWN;
        const ax0 = player.x - enemy.x;
        const ay0 = player.y - enemy.y;
        const m = Math.hypot(ax0, ay0) || 1;
        const ax = ax0 / m;
        const ay = ay0 / m;
        spawnBullet('e', enemy.x + ax * (PLAYER_R + BULLET_R + 2), enemy.y + ay * (PLAYER_R + BULLET_R + 2), ax, ay);
      }
    }

    // Bullets
    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      if (b.life <= 0) continue;

      if (b.owner === 'p' && enemy.alive && hitCircle(b.x, b.y, BULLET_R, enemy.x, enemy.y, PLAYER_R)) {
        b.life = -1;
        enemy.hp -= 1;
        score += 10;
        if (enemy.hp <= 0) {
          enemy.alive = false;
          score += 100;
          best = Math.max(best, score);
          // respawn a tougher enemy
          setTimeout(() => {
            enemy.alive = true;
            enemy.hp = 6;
            enemy.x = W * 0.75;
            enemy.y = randBetween(H * 0.2, H * 0.8);
          }, 850);
        }
      }

      if (b.owner === 'e' && player.alive && hitCircle(b.x, b.y, BULLET_R, player.x, player.y, PLAYER_R)) {
        b.life = -1;
        player.hp -= 1;
        if (player.hp <= 0) {
          player.alive = false;
          best = Math.max(best, score);
          setStatus('game over (press R)', false);
        }
      }
    }

    bullets = bullets.filter(
      (b) => b.life > 0 && b.x >= -60 && b.x <= W + 60 && b.y >= -60 && b.y <= H + 60,
    );

    hudEl.textContent = `HP: ${player.hp}${player.alive ? '' : ' (dead)'} · Score: ${score} · Best: ${best || 0}`;
  }

  function draw() {
    resize();
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0b0f16';
    ctx.fillRect(0, 0, cw, ch);

    const { s, ox, oy } = letterbox();

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);

    // Arena
    ctx.strokeStyle = '#243244';
    ctx.lineWidth = 2 / s;
    ctx.strokeRect(0, 0, W, H);

    // Player
    ctx.save();
    ctx.globalAlpha = player.alive ? 1 : 0.25;
    ctx.fillStyle = '#1f6feb';
    ctx.beginPath();
    ctx.arc(player.x, player.y, PLAYER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Enemy
    ctx.save();
    ctx.globalAlpha = enemy.alive ? 1 : 0.2;
    ctx.fillStyle = '#d1242f';
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, PLAYER_R, 0, Math.PI * 2);
    ctx.fill();

    // Enemy HP pips
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i < enemy.hp && enemy.alive ? '#fecaca' : '#111827';
      ctx.fillRect(enemy.x - 24 + i * 8, enemy.y - 28, 7, 6);
    }
    ctx.restore();

    // Bullets
    ctx.fillStyle = '#fbbf24';
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    requestAnimationFrame(draw);
  }

  let last = performance.now();
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (player.alive) step(dt);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
  requestAnimationFrame(draw);
})();
