"""Extract only reusable firm artwork; permanently erase example billing data.

Run locally with the two user-provided reference files. Runtime PDF generation
uses the prepared assets and never reads files from the user's Desktop.
"""
from pathlib import Path
import argparse
import pymupdf
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument("classic")
parser.add_argument("modern")
args = parser.parse_args()
target = Path(__file__).resolve().parent.parent / "assets" / "invoices"
target.mkdir(parents=True, exist_ok=True)
scale = 3

def raster(path):
    document = pymupdf.open(path)
    page = document[0]
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
    return document, Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)

def box(rect):
    return tuple(round(v * scale) for v in rect)

classic, image = raster(args.classic)
# Keep this static section independently so a discount row can move it down.
image.crop(box((60, 579, 520, 728))).save(target / "classic-bank.png", optimize=True)
draw = ImageDraw.Draw(image)
for rect in [(130, 169, 365, 216), (450, 144, 516, 170), (60, 234.5, 519, 538), (60, 538, 520, 731)]:
    draw.rectangle(box(rect), fill="white")
draw.rectangle(box((62, 108, 517, 128)), fill=(226, 239, 217))
image.save(target / "classic-background.png", optimize=True)
for xref, name in [(21, "classic-regular.ttf"), (29, "classic-bold.ttf"), (37, "classic-heading.ttf")]:
    (target / name).write_bytes(classic.extract_font(xref)[3])

modern, image = raster(args.modern)
draw = ImageDraw.Draw(image)
for rect in [(500, 52, 573, 65), (23, 111, 380, 157), (505, 108, 573, 121), (505, 136, 573, 148), (23, 185, 573, 423), (524, 434, 574, 484)]:
    draw.rectangle(box(rect), fill="white")
image.save(target / "modern-background.png", optimize=True)
print("Prepared clean invoice artwork and embedded reference font subsets.")
