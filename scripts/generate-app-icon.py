#!/usr/bin/env python3
"""Rasterize the EnsoCode app icon into png / icns / ico. Run from repo root."""

from __future__ import annotations

import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"

BG = (0x1A, 0x1A, 0x21)
FG = (0xFA, 0xFA, 0xFA)
BG_HEX = "#1A1A21"
FG_HEX = "#FAFAFA"

RADIUS = 318
STROKE = 118
GAP_DEG = 34.0
GAP_CENTER = 47.5
CANVAS = 1024
WIN_CORNER = 0.22


def _params(size: int) -> tuple[float, float, float]:
    stroke, radius, gap = STROKE, RADIUS, GAP_DEG
    if size <= 16:
        stroke, gap = 152, 44.0
    elif size <= 32:
        stroke, gap = 132, 38.0
    scale = size / CANVAS
    return stroke * scale, radius * scale, gap


def render(size: int) -> Image.Image:
    stroke, radius, gap = _params(size)
    ss = 8 if size <= 64 else 4
    S = size * ss
    im = Image.new("RGB", (S, S), BG)
    d = ImageDraw.Draw(im)
    cx = cy = (S - 1) / 2
    r = radius * ss
    stroke_s = max(ss, stroke * ss)
    ro = r + stroke_s / 2
    ri = max(0.0, r - stroke_s / 2)
    start = GAP_CENTER + gap / 2
    end = GAP_CENTER - gap / 2
    d.ellipse((cx - ro, cy - ro, cx + ro, cy + ro), fill=FG)
    d.ellipse((cx - ri, cy - ri, cx + ri, cy + ri), fill=BG)
    pad = stroke_s
    d.pieslice(
        (cx - ro - pad, cy - ro - pad, cx + ro + pad, cy + ro + pad),
        start=end,
        end=start,
        fill=BG,
    )
    cap_r = stroke_s / 2

    def pt(ang: float) -> tuple[float, float]:
        a = math.radians(ang)
        return cx + r * math.cos(a), cy + r * math.sin(a)

    for ang in (start, end):
        x, y = pt(ang)
        d.ellipse((x - cap_r, y - cap_r, x + cap_r, y + cap_r), fill=FG)
    return im.resize((size, size), Image.Resampling.LANCZOS)


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
    ico_sizes = (16, 24, 32, 48, 64, 128, 256)
    with tempfile.TemporaryDirectory() as raw:
        files: list[str] = []
        for size in ico_sizes:
            file = Path(raw) / f"{size}.png"
            with_windows_corners(master_sizes[size]).save(file, format="PNG")
            files.append(str(file))
        subprocess.run([magick, *files, str(dest)], check=True)


def main() -> None:
    sizes = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
    images = {size: render(size) for size in sizes}
    BUILD.mkdir(parents=True, exist_ok=True)
    write_svg(BUILD / "icon.svg")
    images[1024].save(BUILD / "icon.png", format="PNG")
    icons_dir = BUILD / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 64, 128, 256, 512):
        images[size].save(icons_dir / f"{size}x{size}.png", format="PNG")
    write_icns(images, BUILD / "icon.icns")
    write_ico(images, BUILD / "icon.ico")
    png = images[1024]
    if png.mode != "RGB":
        raise SystemExit("master icon must be opaque RGB")
    print("wrote", BUILD / "icon.png")


if __name__ == "__main__":
    main()
