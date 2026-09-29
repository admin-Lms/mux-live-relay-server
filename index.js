// server run to node index.js      

require("dotenv").config();

const http = require("http");
const { WebSocketServer } = require("ws");
const { spawn, execSync } = require("child_process");

// ─── Verify ffmpeg on startup ────────────────────────────────────────────────
try {
  const ver = execSync("ffmpeg -version 2>&1 | head -1").toString().trim();
  console.log("✅ ffmpeg found:", ver);
} catch (e) {
  console.error("❌ CRITICAL: ffmpeg NOT found on PATH!", e.message);
}

const FFMPEG_PATH = "ffmpeg";
const LIVE_URL = process.env.LIVE_URL || "http://localhost:8080";
const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Relay server is running ✅");
});

const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log(`🚀 Relay server running on port ${PORT}`);
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const streamKey = url.searchParams.get("key");

  console.log(`\n🔌 [WS] New client connected`);
  console.log(`   Stream key: ${streamKey ? streamKey.substring(0, 10) + "..." : "MISSING"}`);

  if (!streamKey) {
    console.error("❌ [WS] No stream key provided, closing connection");
    ws.close(1008, "Missing stream key");
    return;
  }

  const rtmpUrl = `rtmps://global-live.mux.com:443/app/${streamKey}`;
  console.log(`🔴 [RELAY] Starting ffmpeg → ${rtmpUrl.substring(0, 50)}...`);

  let clientClosed = false;
  let chunksReceived = 0;

  const ffmpeg = spawn(FFMPEG_PATH, [
    "-loglevel", "warning",

    // ── Input: tolerate missing keyframes at stream start ──────────────────
    "-fflags",       "+nobuffer+genpts+discardcorrupt",
    "-err_detect",   "ignore_err",    // ignore decode errors (missing keyframes)
    "-analyzeduration", "0",
    "-probesize",    "32",

    "-f",  "webm",
    "-i",  "pipe:0",

    // ── Video encoding ─────────────────────────────────────────────────────
    "-c:v",         "libx264",
    "-preset",      "veryfast",
    "-tune",        "zerolatency",
    "-b:v",         "2500k",
    "-maxrate",     "2500k",
    "-bufsize",     "5000k",
    "-pix_fmt",     "yuv420p",
    "-g",           "48",           // keyframe every 48 frames (~1.6s at 30fps)
    "-keyint_min",  "48",
    "-sc_threshold","0",
    "-x264-params", "nal-hrd=cbr:force-cfr=1",

    // ── Audio encoding ─────────────────────────────────────────────────────
    "-c:a",  "aac",
    "-b:a",  "128k",
    "-ar",   "44100",
    "-ac",   "2",

    // ── Output ─────────────────────────────────────────────────────────────
    "-f",       "flv",
    "-flvflags","no_duration_filesize",
    rtmpUrl,
  ]);

  console.log(`✅ [FFMPEG] Process spawned (PID: ${ffmpeg.pid})`);

  ffmpeg.on("error", (err) => {
    console.error("❌ [FFMPEG] Error:", err.message);
    ws.close(1011, err.message);
  });

  ffmpeg.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    // Only log important ffmpeg messages, skip repetitive keyframe warnings
    if (msg && !msg.includes("Discarding interframe") && !msg.includes("Invalid data found")) {
      console.log("[ffmpeg]", msg);
    }
  });

  ffmpeg.on("close", (code, signal) => {
    console.log(`⏹ [FFMPEG] Exited | code: ${code} | signal: ${signal} | total chunks: ${chunksReceived}`);
    if (code !== 0 && code !== null && !clientClosed) {
      ws.close(1011, "ffmpeg exited with error");
    }
  });

  ffmpeg.stdin.on("error", (e) => {
    if (e.code !== "EPIPE") console.warn("⚠️ [FFMPEG STDIN]:", e.message);
  });

  ws.on("message", (chunk) => {
    chunksReceived++;
    if (chunksReceived === 1) {
      console.log(`📦 [WS] First chunk (${chunk.length} bytes) → ffmpeg`);
    }
    if (chunksReceived % 200 === 0) {
      console.log(`📦 [WS] ${chunksReceived} chunks sent to ffmpeg`);
    }
    if (ffmpeg.stdin.writable) {
      ffmpeg.stdin.write(chunk);
    }
  });

  ws.on("close", (code, reason) => {
    clientClosed = true;
    console.log(`🔌 [WS] Client disconnected | code: ${code} | total chunks: ${chunksReceived}`);
    ffmpeg.stdin.end();
    setTimeout(() => {
      if (ffmpeg.exitCode === null) ffmpeg.kill("SIGTERM");
    }, 2000);
  });

  ws.on("error", (e) => {
    console.error("❌ [WS] Error:", e.message);
    ffmpeg.kill("SIGTERM");
  });

  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
});

// Heartbeat - detect stale connections
const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(pingInterval));

console.log("🎬 Relay server ready");
