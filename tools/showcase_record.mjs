// Showcase recorder: Chrome's screencast frames go straight into ffmpeg, encoded with NVENC on
// the RTX (H.264, 30 fps, 1080p). Screencast frames only arrive when the page changes, so each
// frame is repeated until the next one to keep real-time pacing.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const FPS = 30;

export async function startRecorder(page, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
    "-c:v", "h264_nvenc", "-preset", "p6", "-rc", "vbr", "-cq", "19", "-b:v", "0", "-movflags", "+faststart", outPath],
  { stdio: ["pipe", "inherit", "inherit"] });
  const cdp = await page.context().newCDPSession(page);
  let last = null, written = 0;
  const t0 = Date.now();
  const due = () => Math.floor(((Date.now() - t0) / 1000) * FPS);
  const fill = (upTo) => {
    while (last && written < upTo) { ff.stdin.write(last); written++; }
  };
  const tick = setInterval(() => fill(due()), 1000 / FPS);
  cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
    fill(due());
    last = Buffer.from(data, "base64");
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  return {
    async stop() {
      await cdp.send("Page.stopScreencast").catch(() => {});
      clearInterval(tick);
      fill(due());
      ff.stdin.end();
      await new Promise((ok) => ff.on("close", ok));
      return outPath;
    },
  };
}
