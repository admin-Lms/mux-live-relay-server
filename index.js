  // server run to node index.js      


  require("dotenv").config();

  const http = require("http");
  const { WebSocketServer } = require("ws");
  const { spawn, execSync } = require("child_process");

  // const ffmpegStatic = require("ffmpeg-static");
  const FFMPEG_PATH = "ffmpeg";
  console.log("✅ Using system ffmpeg:", FFMPEG_PATH);

  const LIVE_URL = process.env.LIVE_URL || "http://localhost:8080";
  const PORT = process.env.PORT || 8080;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Relay server is running");
  });

  const wss = new WebSocketServer({ server });

  server.listen(PORT, () => {
    console.log(`🚀 Relay server running on port ${PORT}`);
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, LIVE_URL);
    const streamKey = url.searchParams.get("key");

    if (!streamKey) { ws.close(1008, "Missing stream key"); return; }

    const rtmpUrl = `rtmps://global-live.mux.com:443/app/${streamKey}`;
    console.log("🔴 Relay →", rtmpUrl);

    let clientClosed = false;

    const ffmpeg = spawn(FFMPEG_PATH, [
      "-loglevel", "info",

      "-fflags", "+nobuffer+genpts",
      "-f", "webm",
      "-i", "pipe:0",

      "-c:v", "libx264",
      "-preset", "veryfast",
      "-tune", "zerolatency",
      "-b:v", "3000k",
      "-maxrate", "3000k",
      "-bufsize", "6000k",
      "-pix_fmt", "yuv420p",
      "-g", "60",
      "-keyint_min", "60",
      "-sc_threshold", "0",

      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "48000",

      "-f", "flv",
      rtmpUrl,
    ]);

    ffmpeg.on("error", (err) => {
      console.error("❌ ffmpeg error:", err.message);
      ws.close(1011, err.message);
    });

    ffmpeg.stderr.on("data", (d) => {
      const msg = d.toString().trim();
      if (msg) console.log("[ffmpeg]", msg);
    });

    ffmpeg.on("close", (code, signal) => { console.log(`[FFMPEG] exit code: ${code}, signal: ${signal}`);
      console.log(`⏹ ffmpeg exit ${code}`);
      if (!clientClosed) ws.close(1011, "ffmpeg exited");
    });

    ffmpeg.stdin.on("error", (e) => console.warn("stdin:", e.message));

    ws.on("message", (chunk) => {
      if (ffmpeg.stdin.writable) ffmpeg.stdin.write(chunk);
    });

    ws.on("close", (code, reason) => { console.log(`[WS] Client closed connection! code: ${code}, reason: ${reason}`);
      clientClosed = true;
      ffmpeg.stdin.end();
      setTimeout(() => ffmpeg.kill("SIGTERM"), 1000);
    });

    ws.on("error", (e) => {
      console.error("WS error:", e.message);
      ffmpeg.kill("SIGTERM");
    });
  });