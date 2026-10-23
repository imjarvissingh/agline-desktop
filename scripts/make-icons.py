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
subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(out / 'icon.icns')], check=True)
shutil.rmtree(iconset)

# Windows: full square art, every size Windows asks for.
src.resize((256, 256), Image.LANCZOS).save(out / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
src.resize((512, 512), Image.LANCZOS).save(out / 'icon.png')
print('wrote', *(p.name for p in (out / 'icon.icns', out / 'icon.ico', out / 'icon.png')))
