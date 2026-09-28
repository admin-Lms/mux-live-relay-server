const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const oldFfmpeg = `    const ffmpeg = spawn(FFMPEG_PATH, [
      "-loglevel", "info",

      // Input
      "-f", "webm",
      "-i", "pipe:0",

      // Video (Since browser is now sending H264, just copy it to save CPU & avoid crashes!)
      "-c:v", "copy",

      // Audio — convert Opus to AAC for RTMP compatibility
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
      "-ac", "2",

      // Output
      "-f", "flv",
      rtmpUrl,
    ]);`;

const newFfmpeg = `    const ffmpeg = spawn(FFMPEG_PATH, [
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
    ]);`;

code = code.replace(oldFfmpeg, newFfmpeg);
fs.writeFileSync('index.js', code);
console.log("Replaced ffmpeg command!");
