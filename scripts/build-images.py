"""Builds the site's images from source-images/.

    python scripts/build-images.py

Outputs into site/assets/img/. Needs Pillow and numpy. The social card uses
Palatino from C:/Windows/Fonts (falls back to DejaVu Serif elsewhere); run this
when the source images change, and commit the outputs.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source-images"
OUT = ROOT / "site" / "assets" / "img"

NAVY = (14, 26, 56)
NAVY_2 = (27, 42, 85)
GOLD = (217, 181, 106)
CREAM = (247, 241, 227)


def save_webp(img: Image.Image, name: str, quality: int = 82) -> None:
    img.save(OUT / name, "WEBP", quality=quality, method=6)
    print(f"  {name:28} {img.size[0]}x{img.size[1]}  {(OUT / name).stat().st_size // 1024} KiB")


def inpaint(img: Image.Image, mask: np.ndarray, iterations: int = 400) -> Image.Image:
    """Fills masked pixels by repeatedly averaging their neighbours (smooth skies only)."""
    a = np.asarray(img, dtype=np.float32).copy()
    m = mask.astype(bool)
    # Seed the hole with the mean of the band so diffusion converges quickly.
    a[m] = a[~m].mean(axis=0)
    for _ in range(iterations):
        avg = (
            np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)
        ) / 4.0
        a[m] = avg[m]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def portrait() -> None:
    """Head-and-shoulders crop from the program, with the 'Life' script removed from the sky."""
    program = Image.open(SRC / "celebration-of-life-program.webp").convert("RGB")
    # Square crop centred on his face, stopping just above the printed name.
    left, top, right, bottom = 165, 150, 585, 570
    crop = program.crop((left, top, right, bottom))

    a = np.asarray(crop, dtype=np.int32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    h, w = lum.shape
    yy, xx = np.mgrid[0:h, 0:w]

    # Above his head the background is plain sky: light and blue-leaning. Anything darker,
    # or warmer (the script's gold highlights), is lettering to remove.
    band = yy < 100
    not_sky = (lum < 200) | (((r - b) > 6) & (lum < 242))
    # Never touch his hair: a tight ellipse around the head.
    head = ((xx - 207) / 90.0) ** 2 + ((yy - 175) / 123.0) ** 2 < 1.0
    mask = band & not_sky & ~head
    # Grow the mask a little to catch anti-aliased edges, but never into the hair.
    grown = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7))
    mask = (np.asarray(grown) > 0) & band & ~head

    cleaned = inpaint(crop, mask)
    cleaned = cleaned.filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))
    save_webp(cleaned.resize((640, 640), Image.LANCZOS), "portrait.webp", quality=86)
    save_webp(cleaned.resize((320, 320), Image.LANCZOS), "portrait-320.webp", quality=84)


def mural() -> None:
    img = Image.open(SRC / "rest-in-power-mural.webp").convert("RGB")
    save_webp(img, "mural.webp", quality=84)
    w = 760
    save_webp(img.resize((w, round(img.height * w / img.width)), Image.LANCZOS), "mural-760.webp", quality=82)


def program() -> None:
    img = Image.open(SRC / "celebration-of-life-program.webp").convert("RGB")
    save_webp(img, "program.webp", quality=86)
    w = 420
    save_webp(img.resize((w, round(img.height * w / img.width)), Image.LANCZOS), "program-420.webp", quality=82)


def font(names: list[str], size: int) -> ImageFont.FreeTypeFont:
    dirs = [Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu")]
    for name in names:
        for d in dirs:
            p = d / name
            if p.exists():
                return ImageFont.truetype(str(p), size)
    raise SystemExit(f"None of these fonts found: {names}")


def spaced(draw: ImageDraw.ImageDraw, xy, text, fnt, fill, spacing):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + spacing
    return x


def spaced_width(draw, text, fnt, spacing):
    return sum(draw.textlength(ch, font=fnt) for ch in text) + spacing * (len(text) - 1)


def og_card() -> None:
    W, H = 1200, 630
    card = Image.new("RGB", (W, H), NAVY)
    grad = Image.linear_gradient("L").rotate(90).resize((W, H))
    card = Image.composite(Image.new("RGB", (W, H), NAVY_2), card, grad.point(lambda v: int(v * 0.8)))

    # Warm glow behind the text block.
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse((620, 40, 1240, 620), fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    card = Image.composite(Image.new("RGB", (W, H), (120, 92, 60)), card, glow)

    # Mural portrait on the left, fading into the navy.
    mural = Image.open(SRC / "rest-in-power-mural.webp").convert("RGB")
    face = mural.crop((60, 40, 760, 840))  # 700x800
    face = face.resize((round(face.width * H / face.height), H), Image.LANCZOS)
    fade = Image.new("L", face.size, 255)
    fd = ImageDraw.Draw(fade)
    ramp = 200
    for i in range(ramp):
        x = face.width - ramp + i
        fd.line([(x, 0), (x, H)], fill=int(255 * (1 - (i / ramp) ** 1.4)))
    card.paste(face, (0, 0), fade)

    d = ImageDraw.Draw(card)
    x0 = 610
    small = font(["pala.ttf", "DejaVuSerif.ttf"], 22)
    name = font(["palab.ttf", "DejaVuSerif-Bold.ttf"], 66)
    nick = font(["palai.ttf", "DejaVuSerif-Italic.ttf"], 40)
    quote = font(["palai.ttf", "DejaVuSerif-Italic.ttf"], 31)

    spaced(d, (x0, 128), "IN LOVING MEMORY OF", small, GOLD, 5)
    d.text((x0, 168), "Donnie Edward", font=name, fill=CREAM)
    d.text((x0, 244), "McNeal Jr.", font=name, fill=CREAM)

    nick_text = "\u201cDJ\u201d"
    nw = d.textlength(nick_text, font=nick)
    ny = 338
    d.text((x0, ny), nick_text, font=nick, fill=GOLD)
    d.line([(x0 + nw + 18, ny + 26), (x0 + nw + 210, ny + 26)], fill=GOLD, width=2)
    cx = x0 + nw + 222
    d.polygon([(cx, ny + 20), (cx + 6, ny + 26), (cx, ny + 32), (cx - 6, ny + 26)], fill=GOLD)

    spaced(d, (x0, 410), "JANUARY 17, 1981  \u2013  OCTOBER 13, 2026", small, CREAM, 2)
    d.text((x0, 462), "\u201cGreat Engineer. Better person.\u201d", font=quote, fill=GOLD)
    spaced(d, (x0, 548), "REMEMBERDONNIE.COM", font(["pala.ttf", "DejaVuSerif.ttf"], 18), (170, 182, 210), 4)

    # Thin gold frame, like the program.
    d.rectangle((18, 18, W - 19, H - 19), outline=(*GOLD,), width=2)
    card.save(OUT / "og.jpg", "JPEG", quality=88, optimize=True, progressive=True)
    print(f"  {'og.jpg':28} {W}x{H}  {(OUT / 'og.jpg').stat().st_size // 1024} KiB")


def flame_points(cx, base_y, height, width, steps=120):
    """Teardrop flame with its tip at the top."""
    pts = []
    for i in range(steps + 1):
        t = 2 * math.pi * i / steps
        x = math.sin(t) * (math.sin(t / 2) ** 1.6)
        y = math.cos(t)
        pts.append((cx + x * width / 2, base_y - (y + 1) / 2 * height))
    return pts


def touch_icon() -> None:
    S = 180 * 4
    img = Image.new("RGB", (S, S), NAVY)
    glow = Image.new("L", (S, S), 0)
    ImageDraw.Draw(glow).ellipse((S * 0.18, S * 0.08, S * 0.82, S * 0.72), fill=140)
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.09))
    img = Image.composite(Image.new("RGB", (S, S), (150, 110, 50)), img, glow)
    d = ImageDraw.Draw(img)
    cx = S / 2
    # Candle
    d.rounded_rectangle((cx - S * 0.11, S * 0.60, cx + S * 0.11, S * 0.92), radius=S * 0.03, fill=CREAM)
    d.line([(cx, S * 0.60), (cx, S * 0.56)], fill=(60, 50, 40), width=int(S * 0.012))
    # Flame layers
    d.polygon(flame_points(cx, S * 0.585, S * 0.46, S * 0.30), fill=(232, 145, 58))
    d.polygon(flame_points(cx, S * 0.575, S * 0.34, S * 0.21), fill=(246, 199, 92))
    d.polygon(flame_points(cx, S * 0.565, S * 0.20, S * 0.11), fill=(255, 244, 214))
    img = img.resize((180, 180), Image.LANCZOS)
    img.save(OUT / "apple-touch-icon.png", optimize=True)
    print(f"  {'apple-touch-icon.png':28} 180x180")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Writing images to {OUT.relative_to(ROOT)}")
    portrait()
    mural()
    program()
    og_card()
    touch_icon()


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
