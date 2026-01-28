# WS Blasters

A tiny 2‑player blaster game:
- **Client:** plain HTML (Canvas)
- **Server:** Node.js + WebSockets (`ws`)

## Controls
- Move: **WASD** or **Arrow keys**
- Aim: **IJKL**
- Fire: **Space**

## Run locally

### 1) Start the server

```bash
cd server
npm install
npm start
```

Server runs on `http://localhost:8080` and WebSocket is on the same port.

### 2) Open the client

Open `client/index.html` in a browser.

If you open it via `file://`, it will connect to `ws://localhost:8080` automatically.

## About GitHub Pages
GitHub Pages can host the **static client** (HTML/CSS/JS), but it **cannot host the WebSocket server**.

If you want “Pages + working multiplayer”, deploy `server/` to a host like Render/Fly.io/Railway/etc, then change `wsUrl()` in `client/index.html` to point at that server.
