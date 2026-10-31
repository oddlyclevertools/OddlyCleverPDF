# Two made-up "phone photos" of a paper letter on a table, for the scan demo (our own drawing).
#   python tools/make_scan_photos.py  -> showcase/samples/letter_photo_1.jpg, _2.jpg
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

F = "C:/Windows/Fonts/"
def font(name, size): return ImageFont.truetype(F + name, size)

PAGES = [
    ["Whitby Community Library", "", "Mrs Joan Pickering", "8 Abbey Terrace", "Whitby", "", "4 November 2026", "",
     "Dear Mrs Pickering,", "", "Two of your books are now a week overdue:", "", "   The Shell Seekers", "   A History of the Yorkshire Coast", "",
     "Please bring them back when you can, or ring us", "to renew them. There is no fine for the first two weeks."],
    ["We are also running a coffee morning for the", "Friends of the Library on Saturday 14 November,", "10am to midday, in the reading room.", "",
     "Everyone is welcome. Bring a cake if you like!", "", "With best wishes,", "", "Ellen Marsh", "Library volunteer", "", "Page 2"],
]

def paper(lines):
    W, H = 1240, 1754
    im = Image.new("RGB", (W, H), (250, 248, 242))
    d = ImageDraw.Draw(im)
    y = 150
    for i, s in enumerate(lines):
        f = font("georgiab.ttf" if (i == 0 and lines is PAGES[0]) else "georgia.ttf", 52 if (i == 0 and lines is PAGES[0]) else 38)
        d.text((130, y), s, fill=(35, 32, 40), font=f)
        y += 70 if s else 40
    return im

def photo(page, seed):
    random.seed(seed)
    W, H = 2000, 2600
    bg = Image.new("RGB", (W, H), (120, 86, 58))
    d = ImageDraw.Draw(bg)
    for x in range(0, W, 6):  # wood grain
        c = 110 + int(25 * random.random())
        d.line([(x, 0), (x + random.randint(-40, 40), H)], fill=(c, int(c * 0.72), int(c * 0.5)), width=4)
    bg = bg.filter(ImageFilter.GaussianBlur(3))
    # where the paper's corners land: a slight tilt and perspective, like a hand-held phone
    j = lambda a: a + random.randint(-50, 50)
    quad = [(j(330), j(260)), (j(1680), j(330)), (j(1760), j(2330)), (j(250), j(2260))]
    w, h = page.size
    coeffs = find_coeffs(quad, [(0, 0), (w, 0), (w, h), (0, h)])
    warped = page.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new("L", (w, h), 255).transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    shadow = mask.filter(ImageFilter.GaussianBlur(28)).point(lambda v: int(v * 0.55))
    bg.paste((40, 28, 18), (24, 30), shadow)
    bg.paste(warped, (0, 0), mask)
    # warm room light falling off to one corner
    light = Image.radial_gradient("L").resize((W * 2, H * 2)).crop((W // 2, H // 3, W // 2 + W, H // 3 + H)).point(lambda v: int(v * 0.35))
    bg.paste((20, 14, 8), (0, 0), light)
    return bg.resize((1500, 1950), Image.LANCZOS)

def find_coeffs(pa, pb):
    import numpy as np
    m = []
    for (x, y), (u, v) in zip(pa, pb):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    A = np.array(m, dtype=float); B = np.array(pb, dtype=float).reshape(8)
    return np.linalg.solve(A, B).tolist()

for i, lines in enumerate(PAGES, 1):
    photo(paper(lines), i).save(f"showcase/samples/letter_photo_{i}.jpg", quality=88)
print("photos written")
