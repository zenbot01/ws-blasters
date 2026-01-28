import http from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;

// --- Game constants ---
const W = 900;
const H = 600;
const PLAYER_R = 16;
const BULLET_R = 4;
const PLAYER_SPEED = 260; // px/s
const BULLET_SPEED = 520; // px/s
const FIRE_COOLDOWN_MS = 250;
const TICK_HZ = 30;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function nowMs() { return Date.now(); }
function randBetween(a, b) { return a + Math.random() * (b - a); }

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('ws-blasters server running\n');
});

const wss = new WebSocketServer({ server });

/**
 * State
 */
const clients = new Map(); // ws -> { id, slot, input, lastFireAt }
let nextId = 1;

const game = {
  t0: nowMs(),
  players: {
    1: null,
    2: null,
  },
  bullets: [],
  scores: { 1: 0, 2: 0 }
};

function spawnPlayer(slot) {
  const x = slot === 1 ? W * 0.25 : W * 0.75;
  const y = randBetween(H * 0.25, H * 0.75);
  return {
    slot,
    x,
    y,
    vx: 0,
    vy: 0,
    hp: 3,
    alive: true
  };
}

function resetPlayer(slot) {
  game.players[slot] = spawnPlayer(slot);
}

resetPlayer(1);
resetPlayer(2);

function assignSlot() {
  const p1Taken = [...clients.values()].some(c => c.slot === 1);
  const p2Taken = [...clients.values()].some(c => c.slot === 2);
  if (!p1Taken) return 1;
  if (!p2Taken) return 2;
  return 0; // spectator
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function rectCircleHit(px, py, pr, bx, by, br) {
  const dx = px - bx;
  const dy = py - by;
  const rr = pr + br;
  return (dx * dx + dy * dy) <= rr * rr;
}

function step(dt) {
  // Update players from inputs
  for (const c of clients.values()) {
    if (c.slot !== 1 && c.slot !== 2) continue;
    const p = game.players[c.slot];
    if (!p?.alive) continue;

    const ix = (c.input.right ? 1 : 0) - (c.input.left ? 1 : 0);
    const iy = (c.input.down ? 1 : 0) - (c.input.up ? 1 : 0);

    // Normalize diagonal
    let nx = ix;
    let ny = iy;
    const mag = Math.hypot(nx, ny);
    if (mag > 0) { nx /= mag; ny /= mag; }

    p.vx = nx * PLAYER_SPEED;
    p.vy = ny * PLAYER_SPEED;

    p.x = clamp(p.x + p.vx * dt, PLAYER_R, W - PLAYER_R);
    p.y = clamp(p.y + p.vy * dt, PLAYER_R, H - PLAYER_R);

    // Fire
    if (c.input.fire) {
      const t = nowMs();
      if (t - c.lastFireAt >= FIRE_COOLDOWN_MS) {
        c.lastFireAt = t;
        // Aim direction from input, fallback toward opponent
        let ax = (c.input.aimRight ? 1 : 0) - (c.input.aimLeft ? 1 : 0);
        let ay = (c.input.aimDown ? 1 : 0) - (c.input.aimUp ? 1 : 0);
        if (ax === 0 && ay === 0) {
          const opp = game.players[c.slot === 1 ? 2 : 1];
          ax = (opp?.x ?? W/2) - p.x;
          ay = (opp?.y ?? H/2) - p.y;
        }
        const amag = Math.hypot(ax, ay) || 1;
        ax /= amag; ay /= amag;

        game.bullets.push({
          id: `${c.slot}-${t}-${Math.random().toString(16).slice(2)}`,
          owner: c.slot,
          x: p.x + ax * (PLAYER_R + BULLET_R + 2),
          y: p.y + ay * (PLAYER_R + BULLET_R + 2),
          vx: ax * BULLET_SPEED,
          vy: ay * BULLET_SPEED,
          life: 1.6
        });
      }
    }
  }

  // Update bullets
  for (const b of game.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
  }

  // Collisions
  for (const b of game.bullets) {
    if (b.life <= 0) continue;
    const targetSlot = b.owner === 1 ? 2 : 1;
    const p = game.players[targetSlot];
    if (!p?.alive) continue;
    if (rectCircleHit(p.x, p.y, PLAYER_R, b.x, b.y, BULLET_R)) {
      b.life = -1;
      p.hp -= 1;
      if (p.hp <= 0) {
        p.alive = false;
        game.scores[b.owner] += 1;
        // respawn after short delay
        setTimeout(() => {
          resetPlayer(targetSlot);
          broadcast({ type: 'respawn', slot: targetSlot });
        }, 900);
      }
    }
  }

  // Cull bullets
  game.bullets = game.bullets.filter(b =>
    b.life > 0 &&
    b.x >= -50 && b.x <= W + 50 &&
    b.y >= -50 && b.y <= H + 50
  );

  // Broadcast snapshot
  broadcast({
    type: 'state',
    world: { w: W, h: H },
    players: game.players,
    bullets: game.bullets,
    scores: game.scores,
    ts: nowMs()
  });
}

wss.on('connection', (ws) => {
  const slot = assignSlot();
  const id = nextId++;
  clients.set(ws, {
    id,
    slot,
    input: {
      up: false, down: false, left: false, right: false,
      fire: false,
      aimUp: false, aimDown: false, aimLeft: false, aimRight: false,
    },
    lastFireAt: 0
  });

  send(ws, {
    type: 'welcome',
    id,
    slot,
    world: { w: W, h: H },
    controls: {
      move: 'WASD / Arrow keys',
      aim: 'IJKL',
      fire: 'Space'
    }
  });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString('utf-8')); } catch { return; }
    const c = clients.get(ws);
    if (!c) return;

    if (msg.type === 'input' && msg.input && typeof msg.input === 'object') {
      // Only accept known keys
      for (const k of Object.keys(c.input)) {
        if (k in msg.input) c.input[k] = !!msg.input[k];
      }
    }
  });

  ws.on('close', () => {
    const wasSlot = clients.get(ws)?.slot;
    clients.delete(ws);

    // If a player left, free the slot. Keep the game players alive; next joiner takes it.
    if (wasSlot === 1 || wasSlot === 2) {
      broadcast({ type: 'left', slot: wasSlot });
    }
  });
});

// Tick loop
let last = Date.now();
setInterval(() => {
  const t = Date.now();
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  step(dt);
}, 1000 / TICK_HZ);

server.listen(PORT, () => {
  console.log(`ws-blasters server listening on http://localhost:${PORT} (ws on same port)`);
});
