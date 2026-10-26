"""Erzeugt die Druckvorlage (A4-PDF) und die App-Icons.

Geometrie muss zu js/vision.js passen: Markenmitten bei ±85 mm, Kantenlänge 20 mm,
Marke oben links mit weißem 8-mm-Kern.

Aufruf: python tools/make_assets.py
"""
from pathlib import Path

from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

MARKER_OFFSET = 85
MARKER_SIZE = 20
CORE = 8


TEXT = {
    "de": {
        "title": "Nullpunkt Einschießscheibe",
        "sub": "Einschießscheibe · Druck in tatsächlicher Größe (100 %)",
        "top": "OBEN",
        "check": "Kontrollmaß 100 mm – nachmessen, sonst stimmt der Druckmaßstab nicht",
        "fields": [("Datum", "Distanz (m)"), ("Waffe", "Gruppe Nr."), ("Munition / Los", "Klicks gedreht")],
        "foot": "Foto: ganze Scheibe mit allen vier Eckmarken, möglichst gerade von vorn, ohne Schatten.",
    },
    "en": {
        "title": "Nullpunkt zeroing target",
        "sub": "Zeroing target · print at actual size (100 %)",
        "top": "TOP",
        "check": "Check length 100 mm – measure it, otherwise the print scale is wrong",
        "fields": [("Date", "Distance (m)"), ("Rifle", "Group no."), ("Ammo / lot", "Clicks turned")],
        "foot": "Photo: whole target with all four corner markers, as straight-on as possible, no shadows.",
    },
}


def target_pdf(path, lang="de"):
    t = TEXT[lang]
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle(t["title"])
    pw, ph = A4
    cx, cy = pw / 2, ph - 140 * mm  # Haltepunkt

    def P(x, y):
        return cx + x * mm, cy + y * mm

    c.setFont("Helvetica-Bold", 16)
    c.drawString(20 * mm, ph - 22 * mm, "NULLPUNKT")
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, ph - 28 * mm, t["sub"])
    c.drawRightString(pw - 20 * mm, ph - 22 * mm, "nullpunkt.pro")

    # Raster ±70 mm
    for v in range(-70, 71, 10):
        strong = v % 50 == 0
        c.setStrokeGray(0.55 if strong else 0.78)
        c.setLineWidth(0.5 if strong else 0.25)
        c.line(*P(v, -70), *P(v, 70))
        c.line(*P(-70, v), *P(70, v))
    c.setFillGray(0.45)
    c.setFont("Helvetica", 6)
    for v in (-50, 50):
        c.drawCentredString(*P(v, -75), f"{v:+d}")
        c.drawRightString(*P(-72, v - 1), f"{v:+d}")

    # Ring und Fadenkreuzbalken mit freier Mitte
    c.setStrokeGray(0)
    c.setFillGray(0)
    c.setLineWidth(1)
    c.circle(*P(0, 0), 40 * mm, stroke=1, fill=0)
    for x, y, w, h in [(-1, 8, 2, 22), (-1, -30, 2, 22), (8, -1, 22, 2), (-30, -1, 22, 2)]:
        c.rect(*P(x, y), w * mm, h * mm, stroke=0, fill=1)
    c.setLineWidth(0.3)
    c.line(*P(-3, 0), *P(3, 0))
    c.line(*P(0, -3), *P(0, 3))

    # Eckmarken
    half = MARKER_SIZE / 2
    for i, (mx, my) in enumerate([(-1, 1), (1, 1), (1, -1), (-1, -1)]):
        x, y = mx * MARKER_OFFSET, my * MARKER_OFFSET
        c.setFillGray(0)
        c.rect(*P(x - half, y - half), MARKER_SIZE * mm, MARKER_SIZE * mm, stroke=0, fill=1)
        if i == 0:
            c.setFillGray(1)
            c.rect(*P(x - CORE / 2, y - CORE / 2), CORE * mm, CORE * mm, stroke=0, fill=1)
    c.setFillGray(0)
    c.setFont("Helvetica", 7)
    c.drawString(*P(-MARKER_OFFSET + half + 3, MARKER_OFFSET - 2), t["top"])

    # Kontrollmaß 100 mm
    y = -105
    c.setLineWidth(0.8)
    c.line(*P(-50, y), *P(50, y))
    c.line(*P(-50, y - 3), *P(-50, y + 3))
    c.line(*P(50, y - 3), *P(50, y + 3))
    c.setFont("Helvetica", 8)
    c.drawCentredString(*P(0, y - 7), t["check"])

    # Protokollfelder
    c.setFont("Helvetica", 9)
    c.setLineWidth(0.4)
    fields = t["fields"]
    top = cy - 125 * mm
    for row, (left, right) in enumerate(fields):
        yy = top - row * 9 * mm
        c.drawString(20 * mm, yy, left)
        c.line(48 * mm, yy - 1 * mm, 125 * mm, yy - 1 * mm)
        c.drawString(130 * mm, yy, right)
        c.line(158 * mm, yy - 1 * mm, pw - 20 * mm, yy - 1 * mm)

    c.setFont("Helvetica", 7)
    c.setFillGray(0.35)
    c.drawString(20 * mm, 10 * mm, t["foot"])
    c.showPage()
    c.save()


def icon(size):
    s = size
    img = Image.new("RGB", (s, s), (18, 22, 20))
    d = ImageDraw.Draw(img)
    brass = (217, 165, 76)
    w = max(2, s // 28)
    r = s * 0.30
    c = s / 2
    d.ellipse([c - r, c - r, c + r, c + r], outline=brass, width=w)
    gap, arm = s * 0.07, s * 0.40
    for a, b in [((c - arm, c), (c - gap, c)), ((c + gap, c), (c + arm, c)), ((c, c - arm), (c, c - gap)), ((c, c + gap), (c, c + arm))]:
        d.line([a, b], fill=brass, width=w)
    dot = s * 0.035
    d.ellipse([c - dot, c - dot, c + dot, c + dot], fill=(240, 240, 235))
    return img


ICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#121614"/><circle cx="32" cy="32" r="19" fill="none" stroke="#d9a54c" stroke-width="3"/><path d="M6.4 32h22M35.6 32h22M32 6.4v22M32 35.6v22" stroke="#d9a54c" stroke-width="3"/><circle cx="32" cy="32" r="2.4" fill="#f0f0eb"/></svg>
"""

if __name__ == "__main__":
    ASSETS.mkdir(exist_ok=True)
    target_pdf(ASSETS / "zielscheibe-a4.pdf")
    target_pdf(ASSETS / "target-a4-en.pdf", "en")
    for n in (180, 192, 512):
        icon(n).save(ASSETS / f"icon-{n}.png")
    (ASSETS / "icon.svg").write_text(ICON_SVG, encoding="utf-8")
    print("ok")
