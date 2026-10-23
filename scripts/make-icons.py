"""Builds icons/icon.icns (macOS) and icons/icon.ico (Windows) from the shared app icon.
Run with Pillow installed: python3 scripts/make-icons.py  (macOS needs `iconutil`, which ships with Xcode tools)."""
import shutil, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
src = Image.open(root / '..' / 'mobile' / 'assets' / 'icon.png').convert('RGBA')
out = root / 'icons'

# macOS does not mask icons: draw the rounded square (824 px inside a 1024 canvas, Apple's grid) ourselves.
def mac_master() -> Image.Image:
    size = 1024; body = 824; pad = (size - body) // 2
    art = src.resize((body, body), Image.LANCZOS)
    mask = Image.new('L', (body * 4, body * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, body * 4 - 1, body * 4 - 1), radius=int(body * 4 * 0.2237), fill=255)
    mask = mask.resize((body, body), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(art, (pad, pad), mask)
    return canvas

iconset = out / 'icon.iconset'
shutil.rmtree(iconset, ignore_errors=True); iconset.mkdir(parents=True)
master = mac_master()
for base in (16, 32, 128, 256, 512):
    master.resize((base, base), Image.LANCZOS).save(iconset / f'icon_{base}x{base}.png')
    master.resize((base * 2, base * 2), Image.LANCZOS).save(iconset / f'icon_{base}x{base}@2x.png')
master.resize((512, 512), Image.LANCZOS).save(root / 'assets' / 'dock-icon.png')  # shown in the Dock when running unpackaged (development)
subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(out / 'icon.icns')], check=True)
shutil.rmtree(iconset)

# Windows draws .ico art exactly as supplied, so a full-bleed square looks sharper than the macOS icon. Bake in rounded corners with
# transparent edges (about 2% padding) for the shell icons, the window and taskbar icon, and the installer.
def win_master(size: int) -> Image.Image:
    pad = round(size * 0.02); body = size - 2 * pad
    art = src.resize((body, body), Image.LANCZOS)
    mask = Image.new('L', (body * 4, body * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, body * 4 - 1, body * 4 - 1), radius=int(body * 4 * 0.2237), fill=255)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(art, (pad, pad), mask.resize((body, body), Image.LANCZOS))
    return canvas

win_master(256).save(out / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
win_master(512).save(out / 'icon.png')
win_master(512).save(root / 'assets' / 'app-icon.png')   # BrowserWindow icon: title bar and taskbar
print('wrote', *(p.name for p in (out / 'icon.icns', out / 'icon.ico', out / 'icon.png')))

# Windows tray icons: the colourful app icon with a status dot, so they stay visible on both light and dark taskbars
# (the macOS tray icons are white-on-transparent and vanish on a light taskbar).
for status, colour in (('connected', (34, 197, 94, 255)), ('offline', (239, 68, 68, 255)), ('signed-out', (156, 163, 175, 255))):
    size = 64  # drawn large, shown at 16-32 px
    img = src.resize((size, size), Image.LANCZOS).convert('RGBA')
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * 0.22), fill=255)
    base = Image.new('RGBA', (size, size), (0, 0, 0, 0)); base.paste(img, (0, 0), mask.resize((size, size), Image.LANCZOS))
    d = ImageDraw.Draw(base)
    r = 13; cx, cy = size - r - 1, size - r - 1
    d.ellipse((cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3), fill=(255, 255, 255, 255))  # white ring for contrast
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=colour)
    base.save(root / 'assets' / f'tray-win-{status}.png')
print('wrote tray-win-*.png')
