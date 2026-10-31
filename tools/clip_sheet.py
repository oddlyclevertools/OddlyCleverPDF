# Contact sheet of a showcase clip: 12 frames, 4x3, each 480 wide, with the time stamped on.
#   python tools/clip_sheet.py showcase/clips/sc_x.mp4 [out.png]
import subprocess, sys, json
from PIL import Image, ImageDraw
clip = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else "tools/_review/sheet.png"
dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clip]))
N, W = 12, 480
tiles = []
for i in range(N):
    t = dur * (i + 0.5) / N
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-hwaccel", "cuda", "-ss", f"{t:.2f}", "-i", clip, "-frames:v", "1", "-vf", f"scale={W}:-2", "-f", "image2pipe", "-vcodec", "png", "-"])
    import io
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    ImageDraw.Draw(im).text((6, 4), f"{t:.1f}s", fill=(255, 0, 90))
    tiles.append(im)
h = tiles[0].height
sheet = Image.new("RGB", (W * 4, h * 3), "white")
for i, im in enumerate(tiles): sheet.paste(im, ((i % 4) * W, (i // 4) * h))
sheet.save(out); print(out, f"{dur:.1f}s")
