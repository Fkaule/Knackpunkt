// Knackpunkt: liefert das Spiel aus und verteilt den Status aller Geräte (Presence) per WebSocket.
// Alle teilen einen Raum; der Raumcode im Status filtert im Spiel, wer zusammen spielt.
// Rechnen tut der Server nichts: die FEM läuft im Browser der Spielleitung und der Mitspielenden.
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT) || 8080;
const MAX_PEERS = 300;
const MAX_PRESENCE_BYTES = 4096;
const MAX_MSGS_PER_SEC = 60;

// game.html ist ein Seitenfragment (so läuft es auch als claude.ai-Artifact), hier kommt der Dokumentrahmen dazu
const PAGE = '<!doctype html>\n<html lang="de">\n<meta charset="utf-8">\n'
  + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>body{margin:0}</style>\n'
  + fs.readFileSync(new URL("./game.html", import.meta.url), "utf8");

const peers = new Map(); // id -> { ws, presence, alive, tokens, last }

function status(){
  let playing = 0;
  for (const p of peers.values()) if (p.presence.g && p.presence.g.ph === "design") playing++;
  return { peers: peers.size, roundsRunning: playing };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")){
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    return res.end(PAGE);
  }
  if (req.method === "GET" && url.pathname === "/api/status"){
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
    return res.end(JSON.stringify(status()));
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Nicht gefunden");
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 8192 });

function broadcast(msg, exceptId){
  const data = JSON.stringify(msg);
  for (const [id, p] of peers) if (id !== exceptId && p.ws.readyState === 1) p.ws.send(data);
}

wss.on("connection", ws => {
  if (peers.size >= MAX_PEERS){ ws.close(1013, "voll"); return; }
  const id = crypto.randomBytes(6).toString("hex");
  const self = { ws, presence: {}, alive: true, tokens: MAX_MSGS_PER_SEC, last: Date.now() };
  peers.set(id, self);
  ws.send(JSON.stringify({ t: "welcome", you: id, peers: [...peers].filter(([pid]) => pid !== id).map(([pid, p]) => ({ peer: pid, presence: p.presence })) }));

  ws.on("pong", () => { self.alive = true; });
  ws.on("message", raw => {
    // einfache Drosselung: höchstens MAX_MSGS_PER_SEC Nachrichten pro Sekunde
    const now = Date.now();
    self.tokens = Math.min(MAX_MSGS_PER_SEC, self.tokens + (now - self.last) / 1000 * MAX_MSGS_PER_SEC);
    self.last = now;
    if (self.tokens < 1) return;
    self.tokens -= 1;
    if (raw.length > MAX_PRESENCE_BYTES + 64) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || m.t !== "p" || typeof m.presence !== "object" || m.presence === null || Array.isArray(m.presence)) return;
    self.presence = m.presence;
    broadcast({ t: "p", peer: id, presence: m.presence }, id);
  });
  ws.on("close", () => {
    peers.delete(id);
    broadcast({ t: "bye", peer: id });
  });
});

// tote Verbindungen aufräumen
setInterval(() => {
  for (const p of peers.values()){
    if (!p.alive){ p.ws.terminate(); continue; }
    p.alive = false;
    p.ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log(`Knackpunkt läuft auf Port ${PORT}`));
