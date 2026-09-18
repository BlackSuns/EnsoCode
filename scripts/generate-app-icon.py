#!/usr/bin/env python3
"""Rasterize the EnsoCode app icon into png / icns / ico. Run from repo root."""

from __future__ import annotations

import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"

BG = (0xFF, 0xFF, 0xFF)
FG = (0x46, 0x49, 0x52)
BG_HEX = "#FFFFFF"
FG_HEX = "#464952"

RADIUS = 261
STROKE = 62
GAP_DEG = 27.5
GAP_CENTER = 47.5
CANVAS = 1024
SQUIRCLE_INSET = 0.098
SQUIRCLE_N = 6.0
WIN_CORNER = 0.26
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
SHADOW_BLUR = 20
SHADOW_OFFSET_Y = 12
SHADOW_OPACITY = 0.32
PHONE_ICONS = ROOT / "packages/phone/public/icons"
MASKABLE_SAFE = 0.8
PWA_BG = BG
PWA_FG = FG


def _params(size: int) -> tuple[float, float, float]:
    scale = size / CANVAS
    return STROKE * scale, RADIUS * scale, GAP_DEG


def render(
    size: int,
    bg: tuple[int, int, int] = BG,
    fg: tuple[int, int, int] = FG,
) -> Image.Image:
    stroke, radius, gap = _params(size)
    ss = 8 if size <= 64 else 4
    S = size * ss
    im = Image.new("RGB", (S, S), bg)
    d = ImageDraw.Draw(im)
    cx = cy = (S - 1) / 2
    r = radius * ss
    stroke_s = max(ss, stroke * ss)
    ro = r + stroke_s / 2
    ri = max(0.0, r - stroke_s / 2)
    start = GAP_CENTER + gap / 2
    end = GAP_CENTER - gap / 2
    d.ellipse((cx - ro, cy - ro, cx + ro, cy + ro), fill=fg)
    d.ellipse((cx - ri, cy - ri, cx + ri, cy + ri), fill=bg)
    pad = stroke_s
    d.pieslice(
        (cx - ro - pad, cy - ro - pad, cx + ro + pad, cy + ro + pad),
        start=end,
        end=start,
        fill=bg,
    )
    cap_r = stroke_s / 2

    def pt(ang: float) -> tuple[float, float]:
        a = math.radians(ang)
        return cx + r * math.cos(a), cy + r * math.sin(a)

    for ang in (start, end):
        x, y = pt(ang)
        d.ellipse((x - cap_r, y - cap_r, x + cap_r, y + cap_r), fill=fg)
    return im.resize((size, size), Image.Resampling.LANCZOS)


def squircle_mask(size: int) -> Image.Image:
    ss = 4
    S = size * ss
    a = (S * (1 - 2 * SQUIRCLE_INSET)) / 2
    cx = cy = S / 2
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    n = SQUIRCLE_N
    for y in range(S):
        yn = abs((y + 0.5 - cy) / a)
        if yn >= 1:
            continue
        span = (1 - yn**n) ** (1 / n)
        d.line((cx - span * a, y, cx + span * a, y), fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def apply_squircle(im: Image.Image) -> Image.Image:
    out = im.convert("RGBA")
    out.putalpha(squircle_mask(im.size[0]))
    return out


def apply_mac_shadow(im: Image.Image) -> Image.Image:
    alpha = im.getchannel("A")
    shade = alpha.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
    shade = shade.point(lambda p: min(255, round(p * SHADOW_OPACITY)))
    shifted = Image.new("L", im.size, 0)
    shifted.paste(shade, (0, SHADOW_OFFSET_Y))
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    layer.putalpha(shifted)
    return Image.alpha_composite(layer, im.convert("RGBA"))


def with_windows_corners(im: Image.Image) -> Image.Image:
    size = im.size[0]
    radius = max(1, round(size * WIN_CORNER))
    ss = 8 if size <= 64 else 4
    S = size * ss
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=radius * ss, fill=255)
    mask = mask.resize((size, size), Image.Resampling.LANCZOS)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def straight_white_alpha(im: Image.Image) -> Image.Image:
    """Keep white RGB under transparent pixels. Windows paints (0,0,0,0) as black."""
    rgba = im.convert("RGBA")
    r, g, b, a = rgba.split()
    white = Image.new("L", rgba.size, 255)
    return Image.merge(
        "RGBA",
        (
            Image.composite(r, white, a),
            Image.composite(g, white, a),
            Image.composite(b, white, a),
            a,
        ),
    )


def write_svg(path: Path) -> None:
    start = GAP_CENTER + GAP_DEG / 2
    end = GAP_CENTER - GAP_DEG / 2
    cx = cy = CANVAS / 2

    def pt(ang: float) -> tuple[float, float]:
        a = math.radians(ang)
        return cx + RADIUS * math.cos(a), cy + RADIUS * math.sin(a)

    x0, y0 = pt(start)
    x1, y1 = pt(end)
    path.write_text(
        (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" viewBox="0 0 {CANVAS} {CANVAS}">\n'
            f'  <rect width="{CANVAS}" height="{CANVAS}" fill="{BG_HEX}"/>\n'
            f'  <path d="M {x0:.2f} {y0:.2f} A {RADIUS} {RADIUS} 0 1 1 {x1:.2f} {y1:.2f}"'
            f' fill="none" stroke="{FG_HEX}" stroke-width="{STROKE}" stroke-linecap="round"/>\n'
            "</svg>\n"
        ),
        encoding="utf-8",
    )


def write_icns(master_sizes: dict[int, Image.Image], dest: Path) -> None:
    iconutil = shutil.which("iconutil")
    if not iconutil:
        raise SystemExit("iconutil not found")
    entries = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    with tempfile.TemporaryDirectory() as raw:
        iconset = Path(raw) / "icon.iconset"
        iconset.mkdir()
        for name, size in entries.items():
            master_sizes[size].save(iconset / name, format="PNG")
        subprocess.run([iconutil, "-c", "icns", "-o", str(dest), str(iconset)], check=True)


def write_ico(master_sizes: dict[int, Image.Image], dest: Path) -> None:
    magick = shutil.which("magick")
    if not magick:
        raise SystemExit("magick not found")
    # 256 PNG first, remaining BMP — same layout EnsoAI uses. Pillow-all-PNG
    # ICO is read as 16px-first, so Explorer upscales a square and paints alpha black.
    with tempfile.TemporaryDirectory() as raw:
        paths: list[str] = []
        for size in sorted(ICO_SIZES, reverse=True):
            path = Path(raw) / f"{size}.png"
            straight_white_alpha(master_sizes[size]).save(path, format="PNG")
            paths.append(str(path))
        subprocess.run(
            [magick, *paths, str(dest)],
            check=True,
        )


def write_pwa_icons() -> None:
    rgb = render(1024, PWA_BG, PWA_FG)
    PHONE_ICONS.mkdir(parents=True, exist_ok=True)
    rgb.resize((180, 180), Image.Resampling.LANCZOS).save(PHONE_ICONS / "apple-touch-icon.png")
    rgb.resize((192, 192), Image.Resampling.LANCZOS).save(PHONE_ICONS / "icon-192.png")
    rgb.resize((512, 512), Image.Resampling.LANCZOS).save(PHONE_ICONS / "icon-512.png")
    inner = round(512 * MASKABLE_SAFE)
    canvas = Image.new("RGB", (512, 512), PWA_BG)
    glyph = rgb.resize((inner, inner), Image.Resampling.LANCZOS)
    canvas.paste(glyph, ((512 - inner) // 2, (512 - inner) // 2))
    canvas.save(PHONE_ICONS / "icon-maskable-512.png")


def main() -> None:
    square = render(1024)
    master = apply_mac_shadow(apply_squircle(square))
    sizes = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
    images = {
        size: master if size == 1024 else master.resize((size, size), Image.Resampling.LANCZOS)
        for size in sizes
    }
    ico_images = {
        size: with_windows_corners(square.resize((size, size), Image.Resampling.LANCZOS))
        for size in ICO_SIZES
    }
    BUILD.mkdir(parents=True, exist_ok=True)
    write_svg(BUILD / "icon.svg")
    master.save(BUILD / "icon.png", format="PNG")
    icons_dir = BUILD / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 64, 128, 256, 512):
        images[size].save(icons_dir / f"{size}x{size}.png", format="PNG")
    write_icns(images, BUILD / "icon.icns")
    write_ico(ico_images, BUILD / "icon.ico")
    write_pwa_icons()
    if master.mode != "RGBA" or master.getpixel((0, 0))[3] != 0:
        raise SystemExit("master icon must be a transparent-corner squircle")
    if ico_images[32].getpixel((0, 0))[3] != 0:
        raise SystemExit("windows ico must keep transparent corners")
    ident = subprocess.check_output(["magick", "identify", str(BUILD / "icon.ico")], text=True)
    if "PNG 256x256" not in ident.splitlines()[0]:
        raise SystemExit("ico must start with 256 png frame")
    with Image.open(BUILD / "icon.ico") as ico:
        small = ico.ico.getimage((16, 16)).convert("RGBA").getpixel((0, 0))
        large = ico.ico.getimage((256, 256)).convert("RGBA")
    if small[3] != 0 or small[:3] == (0, 0, 0):
        raise SystemExit(f"16px transparent pixel must be white, got {small}")
    if large.getpixel((0, 0))[3] != 0 or large.getpixel((128, 0))[3] < 200:
        raise SystemExit("256px ico must be rounded, not a full square")
    apple = Image.open(PHONE_ICONS / "apple-touch-icon.png")
    any512 = Image.open(PHONE_ICONS / "icon-512.png")
    if apple.mode != "RGB" or any512.mode != "RGB" or any512.getpixel((0, 0)) != PWA_BG:
        raise SystemExit("pwa icons must be opaque full-bleed RGB")
    print("wrote", BUILD / "icon.png")


if __name__ == "__main__":
    main()
