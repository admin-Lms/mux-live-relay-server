  // server run to node index.js      


  require("dotenv").config();

  const http = require("http");
  const { WebSocketServer } = require("ws");
  const { spawn, execSync } = require("child_process");

  const ffmpegStatic = require("ffmpeg-static");
  const FFMPEG_PATH = ffmpegStatic;
  console.log("✅ ffmpeg-static:", FFMPEG_PATH);

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

      // Input
      "-fflags", "+nobuffer+genpts+discardcorrupt",
      "-flags", "low_delay",
      "-analyzeduration", "1000000",
      "-probesize", "1000000",

      "-color_primaries", "bt709",
      "-color_trc", "bt709",
      "-colorspace", "bt709",

      "-i", "pipe:0",

      // Video — high quality H264
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-tune", "zerolatency",
      "-profile:v", "high",
      "-level", "4.2",
      "-b:v", "4000k",
      "-minrate", "4000k",
      "-maxrate", "5000k",
      "-bufsize", "8000k",
      "-pix_fmt", "yuv420p",
      "-g", "60",
      "-keyint_min", "60",
      "-sc_threshold", "0",
      "-bf", "2",
      "-crf", "18",

      "-color_primaries:v", "bt709",
      "-color_trc:v", "bt709",
      "-colorspace:v", "bt709",

      "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p",

      // Audio — high quality AAC
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
      "-ac", "2",

      // Output
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

    ffmpeg.on("close", (code) => {
      console.log(`⏹ ffmpeg exit ${code}`);
      if (!clientClosed) ws.close(1011, "ffmpeg exited");
    });

    ffmpeg.stdin.on("error", (e) => console.warn("stdin:", e.message));

    ws.on("message", (chunk) => {
      if (ffmpeg.stdin.writable) ffmpeg.stdin.write(chunk);
    });

    ws.on("close", () => {
      clientClosed = true;
      ffmpeg.stdin.end();
      setTimeout(() => ffmpeg.kill("SIGTERM"), 1000);
    });

    ws.on("error", (e) => {
      console.error("WS error:", e.message);
      ffmpeg.kill("SIGTERM");
    });
  });