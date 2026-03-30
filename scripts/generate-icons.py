#!/usr/bin/env python3
"""
アプリアイコン生成スクリプト

依存: Pillow (pip install Pillow)
使い方: python3 scripts/generate-icons.py

生成されるファイル:
  packages/desktop/build/icon.icns          -- macOS アプリアイコン (prod)
  packages/desktop/build/icon.ico           -- Windows アプリアイコン (prod)
  packages/desktop/build/icon.png           -- Linux / dev 参照用 (prod)
  packages/desktop/build/icon-dev.png       -- dev 用アイコン (オレンジ配色)
  packages/desktop/build/icon_tray.png      -- macOS メニューバー (1x)
  packages/desktop/build/icon_tray@2x.png   -- macOS メニューバー (2x Retina)
  packages/mobile/assets/icon.png           -- iOS/Android アイコン (prod, full-bleed)
  packages/mobile/assets/icon-dev.png       -- iOS/Android アイコン (dev, full-bleed)
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
MOBILE_ASSETS = REPO_ROOT / 'packages' / 'mobile' / 'assets'

SIZE        = 1024
BG_COLOR    = (18, 22, 20, 255)   # --bg-base
BORDER_DARK = (45, 64, 53, 255)   # --border-bright #2d4035
GLOW_COLOR  = (61, 255, 143)      # --green #3dff8f
GREEN       = (0, 255, 128, 255)  # シンボル色（prod）

# dev 用オレンジ配色
BORDER_DARK_DEV = (80, 45, 10, 255)
GLOW_COLOR_DEV  = (255, 140, 0)
ORANGE          = (255, 160, 40, 255)

MARGIN   = int(SIZE * 0.12)    # Apple HIG 推奨余白 (~12%)
CORNER_R = 160

# iOS full-bleed アイコン用（余白なし・枠線を iOS 角丸に合わせる）
# iOS の角丸半径は 1024px に対して約 220px（連続曲線の近似値）
IOS_CORNER_R    = 220
IOS_BORDER_W    = 8   # 枠線幅（full-bleed では視認性のため desktop より太く）
IOS_INNER_PAD   = 150 # シンボルの内側余白（余白なし分を補って視覚的バランスを保つ）

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

    draw.line([pt(4, 17), pt(10, 11), pt(4, 5)], fill=color, width=lw, joint='curve')
    draw.line([pt(12, 19), pt(20, 19)], fill=color, width=lw)


# ── アイコン生成 ──────────────────────────────────────────────────────────────

def generate_app_icon(
    border_dark: tuple = BORDER_DARK,
    glow_rgb: tuple = GLOW_COLOR,
    symbol_color: tuple = GREEN,
) -> 'Image.Image':
    """1024x1024 の RGBA アプリアイコンを生成して返す"""
    base = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    d    = ImageDraw.Draw(base)
    d.rounded_rectangle([MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN],
                        radius=CORNER_R, fill=BG_COLOR,
                        outline=border_dark, width=6)

    glow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    gd   = ImageDraw.Draw(glow)
    gd.rounded_rectangle([MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN],
                         radius=CORNER_R, outline=(*glow_rgb, 80), width=30)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=14))
    inner_mask = rounded_rect_mask(MARGIN, CORNER_R, shrink=2)
    glow.putalpha(ImageChops.multiply(glow.getchannel('A'), inner_mask))

    result = Image.alpha_composite(base, glow)
    draw_terminal_symbol(ImageDraw.Draw(result), SIZE, MARGIN,
                         inner_padding=60, color=symbol_color)
    return result


def generate_ios_icon(
    border_dark: tuple = BORDER_DARK,
    glow_rgb: tuple = GLOW_COLOR,
    symbol_color: tuple = GREEN,
) -> 'Image.Image':
    """iOS/Android 用 full-bleed アイコンを生成して返す。
    余白なし・背景色でキャンバス全体を塗りつぶし、枠線を iOS 角丸半径に合わせる。
    """
    # 背景色でキャンバス全体を塗りつぶす（透明ピクセルなし）
    base = Image.new('RGBA', (SIZE, SIZE), BG_COLOR)
    d    = ImageDraw.Draw(base)

    # 枠線の中心が端から border_width/2 の位置になるよう inset する
    inset = IOS_BORDER_W // 2
    d.rounded_rectangle(
        [inset, inset, SIZE - inset, SIZE - inset],
        radius=IOS_CORNER_R,
        outline=border_dark,
        width=IOS_BORDER_W,
    )

    # グロー効果（枠線に沿って発光）
    glow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    gd   = ImageDraw.Draw(glow)
    gd.rounded_rectangle(
        [inset, inset, SIZE - inset, SIZE - inset],
        radius=IOS_CORNER_R,
        outline=(*glow_rgb, 80),
        width=30,
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=14))

    result = Image.alpha_composite(base, glow)
    draw_terminal_symbol(ImageDraw.Draw(result), SIZE, margin=0,
                         inner_padding=IOS_INNER_PAD, color=symbol_color)
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

    # prod アイコン
    print('Generating prod app icon...')
    png_path = DESKTOP_BUILD / 'icon.png'
    generate_app_icon().save(png_path)
    print(f'  Saved: {png_path}')

    if sys.platform == 'darwin':
        icns_path = DESKTOP_BUILD / 'icon.icns'
        save_icns(png_path, icns_path)
        print(f'  Saved: {icns_path}')
    else:
        print('  Skipped icon.icns (macOS only)')

    ico_path = DESKTOP_BUILD / 'icon.ico'
    save_ico(png_path, ico_path)
    print(f'  Saved: {ico_path}')

    # dev アイコン（オレンジ配色）
    print('Generating dev app icon...')
    dev_png_path = DESKTOP_BUILD / 'icon-dev.png'
    generate_app_icon(
        border_dark=BORDER_DARK_DEV,
        glow_rgb=GLOW_COLOR_DEV,
        symbol_color=ORANGE,
    ).save(dev_png_path)
    print(f'  Saved: {dev_png_path}')

    # Tray アイコン
    print('Generating tray icon...')
    for size, suffix in [(22, ''), (44, '@2x')]:
        path = DESKTOP_BUILD / f'icon_tray{suffix}.png'
        generate_tray_icon(size).save(path)
        print(f'  Saved: {path}')

    # モバイル用 full-bleed アイコン（iOS/Android）
    MOBILE_ASSETS.mkdir(parents=True, exist_ok=True)

    print('Generating mobile icons (full-bleed)...')
    mobile_prod = MOBILE_ASSETS / 'icon.png'
    generate_ios_icon().save(mobile_prod)
    print(f'  Saved: {mobile_prod}')

    mobile_dev = MOBILE_ASSETS / 'icon-dev.png'
    generate_ios_icon(
        border_dark=BORDER_DARK_DEV,
        glow_rgb=GLOW_COLOR_DEV,
        symbol_color=ORANGE,
    ).save(mobile_dev)
    print(f'  Saved: {mobile_dev}')

    print('\nDone.')


if __name__ == '__main__':
    main()
