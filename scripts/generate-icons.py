#!/usr/bin/env python3
"""
アプリアイコン生成スクリプト

依存: Pillow (pip install Pillow)
使い方: python3 scripts/generate-icons.py

生成されるファイル:
  packages/desktop/build/icon.icns         -- macOS アプリアイコン
  packages/desktop/build/icon.ico          -- Windows アプリアイコン
  packages/desktop/build/icon.png          -- Linux / dev 参照用
  packages/desktop/build/icon_tray.png     -- macOS メニューバー (1x)
  packages/desktop/build/icon_tray@2x.png  -- macOS メニューバー (2x Retina)
"""

import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageChops
except ImportError:
    print('Error: Pillow が見つかりません。pip install Pillow を実行してください。', file=sys.stderr)
    sys.exit(1)

# ── 定数 ────────────────────────────────────────────────────────────────────

REPO_ROOT     = Path(__file__).parent.parent
DESKTOP_BUILD = REPO_ROOT / 'packages' / 'desktop' / 'build'

SIZE         = 1024
BG_COLOR     = (18, 22, 20, 255)   # --bg-base
BORDER_DARK  = (45, 64, 53, 255)   # --border-bright #2d4035
GLOW_COLOR   = (61, 255, 143)      # --green #3dff8f
GREEN        = (0, 255, 128, 255)  # シンボル色

MARGIN       = int(SIZE * 0.12)    # Apple HIG 推奨余白 (~12%)
CORNER_R     = 160

# ── ヘルパー ─────────────────────────────────────────────────────────────────

def rounded_rect_mask(margin: int, radius: int, shrink: int = 0) -> 'Image.Image':
    """角丸矩形の内側を白、外側を黒にした L モードのマスクを返す"""
    m = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle(
        [margin + shrink, margin + shrink,
         SIZE - margin - shrink, SIZE - margin - shrink],
        radius=max(radius - shrink, 1), fill=255)
    return m


def draw_terminal_symbol(draw: 'ImageDraw.ImageDraw', size: int,
                         margin: int, inner_padding: int, color: tuple) -> None:
    """SVG viewBox (0 0 24 24) の >_ シンボルを描画する"""
    draw_area   = (size - margin * 2) - inner_padding * 2
    draw_offset = margin + inner_padding
    scale       = draw_area / 24
    lw          = max(int(scale * 1.8), 1)

    def pt(x: float, y: float) -> tuple:
        return int(draw_offset + x * scale), int(draw_offset + y * scale)

    # ">" chevron
    draw.line([pt(4, 17), pt(10, 11), pt(4, 5)], fill=color, width=lw, joint='curve')
    # "_" underscore
    draw.line([pt(12, 19), pt(20, 19)], fill=color, width=lw)


# ── アイコン生成 ──────────────────────────────────────────────────────────────

def generate_app_icon() -> 'Image.Image':
    """1024x1024 の RGBA アプリアイコンを生成して返す"""
    # ベース（背景 + ダーク枠線）
    base = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    d    = ImageDraw.Draw(base)
    d.rounded_rectangle([MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN],
                        radius=CORNER_R, fill=BG_COLOR,
                        outline=BORDER_DARK, width=6)

    # インナーグロー（枠内側にブラー）
    glow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    gd   = ImageDraw.Draw(glow)
    gd.rounded_rectangle([MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN],
                         radius=CORNER_R, outline=(*GLOW_COLOR, 80), width=30)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=14))
    inner_mask = rounded_rect_mask(MARGIN, CORNER_R, shrink=2)
    glow.putalpha(ImageChops.multiply(glow.getchannel('A'), inner_mask))

    result = Image.alpha_composite(base, glow)
    draw_terminal_symbol(ImageDraw.Draw(result), SIZE, MARGIN,
                         inner_padding=60, color=GREEN)
    return result


def generate_tray_icon(size: int) -> 'Image.Image':
    """macOS メニューバー用テンプレートアイコン（白・透明背景）を生成して返す"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw_terminal_symbol(ImageDraw.Draw(img), size,
                         margin=0, inner_padding=0,
                         color=(255, 255, 255, 255))
    return img


# ── 書き出し ─────────────────────────────────────────────────────────────────

def save_icns(png_path: Path, out_path: Path) -> None:
    """PNG (1024x1024) から ICNS を生成する（macOS の iconutil を使用）"""
    sizes = [
        ('icon_16x16.png',       16),
        ('icon_16x16@2x.png',    32),
        ('icon_32x32.png',       32),
        ('icon_32x32@2x.png',    64),
        ('icon_128x128.png',    128),
        ('icon_128x128@2x.png', 256),
        ('icon_256x256.png',    256),
        ('icon_256x256@2x.png', 512),
        ('icon_512x512.png',    512),
        ('icon_512x512@2x.png', 1024),
    ]
    with tempfile.TemporaryDirectory() as tmpdir:
        iconset = Path(tmpdir) / 'icon.iconset'
        iconset.mkdir()
        src = Image.open(png_path)
        for name, sz in sizes:
            src.resize((sz, sz), Image.LANCZOS).save(iconset / name)
        subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(out_path)],
                       check=True)


def save_ico(png_path: Path, out_path: Path) -> None:
    """PNG (1024x1024) から ICO を生成する"""
    src   = Image.open(png_path).convert('RGBA')
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    imgs  = [src.resize(s, Image.LANCZOS) for s in sizes]
    imgs[0].save(out_path, format='ICO',
                 sizes=[(s[0], s[1]) for s in sizes],
                 append_images=imgs[1:])


# ── エントリポイント ──────────────────────────────────────────────────────────

def main() -> None:
    DESKTOP_BUILD.mkdir(parents=True, exist_ok=True)

    # アプリアイコン（PNG）
    png_path = DESKTOP_BUILD / 'icon.png'
    print('Generating app icon...')
    generate_app_icon().save(png_path)
    print(f'  Saved: {png_path}')

    # ICNS (macOS)
    if sys.platform == 'darwin':
        icns_path = DESKTOP_BUILD / 'icon.icns'
        save_icns(png_path, icns_path)
        print(f'  Saved: {icns_path}')
    else:
        print('  Skipped icon.icns (macOS only)')

    # ICO (Windows)
    ico_path = DESKTOP_BUILD / 'icon.ico'
    save_ico(png_path, ico_path)
    print(f'  Saved: {ico_path}')

    # Tray アイコン (macOS メニューバー用)
    print('Generating tray icon...')
    for size, suffix in [(22, ''), (44, '@2x')]:
        path = DESKTOP_BUILD / f'icon_tray{suffix}.png'
        generate_tray_icon(size).save(path)
        print(f'  Saved: {path}')

    print('\nDone.')


if __name__ == '__main__':
    main()
