"""Generates demo-house.pdf: a FICTIONAL two-storey house drawing for the estimator.

The drawing is the visual twin of demo-house.json: ground floor GIA 98.6 m2 + first floor
GIA 87.8 m2 = 186.4 m2, 4 bedrooms, 3 bathrooms, a study, a covered terrace and two balconies.
It lets anyone try the upload path, and with an API key it is an extraction case with a
known answer (fixtures/extract-cases.json).

usage: python make_demo_drawing.py [out.pdf] [preview.png]     (needs PyMuPDF)
"""
import sys

import fitz  # PyMuPDF

OUT = sys.argv[1] if len(sys.argv) > 1 else "demo-house.pdf"
PREVIEW = sys.argv[2] if len(sys.argv) > 2 else None

W, H = 1191, 842  # A3 landscape, points
S = 28.35  # 1:100 -> 1 m = 10 mm = 28.35 pt
INK = (0.12, 0.16, 0.2)
SOFT = (0.45, 0.5, 0.55)
STEEL = (0.17, 0.43, 0.5)
SAND = (0.79, 0.64, 0.15)

doc = fitz.open()
page = doc.new_page(width=W, height=H)


def m(x):
    return x * S


def text(x, y, s, size=7.5, color=INK, font="helv", align=0, width=200):
    if align:
        page.insert_textbox(fitz.Rect(x - width / 2, y - size, x + width / 2, y + size * 1.6), s, fontsize=size, fontname=font, color=color, align=1)
    else:
        page.insert_text((x, y), s, fontsize=size, fontname=font, color=color)


def wall_rect(x0, y0, w, h, t=2.6):
    page.draw_rect(fitz.Rect(x0, y0, x0 + m(w), y0 + m(h)), color=INK, width=t)


def partition(x0, y0, x1, y1):
    page.draw_line((x0, y0), (x1, y1), color=INK, width=1.1)


def door(cx, cy, r=m(0.9), start=0, sweep=90):
    import math

    pts = [(cx + r * math.cos(math.radians(start + a)), cy + r * math.sin(math.radians(start + a))) for a in range(0, sweep + 1, 10)]
    page.draw_polyline(pts, color=SOFT, width=0.5, dashes="[2 2] 0")
    page.draw_line((cx, cy), pts[-1], color=SOFT, width=0.6)


def window(x0, y0, x1, y1):
    page.draw_line((x0, y0), (x1, y1), color=(1, 1, 1), width=2.8)
    page.draw_line((x0, y0), (x1, y1), color=STEEL, width=0.8)


def dim_h(x0, x1, y, label):
    page.draw_line((x0, y), (x1, y), color=SOFT, width=0.5)
    for x in (x0, x1):
        page.draw_line((x - 3, y + 3), (x + 3, y - 3), color=SOFT, width=0.7)
        page.draw_line((x, y - 6), (x, y + 6), color=SOFT, width=0.4)
    text((x0 + x1) / 2, y - 3, label, size=7, color=SOFT, align=1, width=80)


def dim_v(x, y0, y1, label):
    page.draw_line((x, y0), (x, y1), color=SOFT, width=0.5)
    for y in (y0, y1):
        page.draw_line((x - 3, y + 3), (x + 3, y - 3), color=SOFT, width=0.7)
        page.draw_line((x - 6, y), (x + 6, y), color=SOFT, width=0.4)
    page.insert_text((x - 4, (y0 + y1) / 2 + 14), label, fontsize=7, color=SOFT, rotate=90)


def room(x, y, name, area):
    text(x, y, name, size=7.5, color=INK, align=1, width=110)
    text(x, y + 10, f"{area:.1f} m2", size=7, color=SOFT, align=1, width=110)


# ── Ground floor: 12.40 x 7.95 m = 98.6 m2 ─────────────────────────────────────
gx, gy = 90, 170
wall_rect(gx, gy, 12.4, 7.95)
partition(gx + m(6.9), gy, gx + m(6.9), gy + m(7.95))
partition(gx + m(6.9), gy + m(3.6), gx + m(12.4), gy + m(3.6))
partition(gx + m(9.6), gy, gx + m(9.6), gy + m(3.6))
partition(gx + m(6.9), gy + m(5.9), gx + m(9.4), gy + m(5.9))
partition(gx + m(9.4), gy + m(3.6), gx + m(9.4), gy + m(7.95))
partition(gx + m(10.9), gy + m(5.6), gx + m(12.4), gy + m(5.6))
partition(gx + m(10.9), gy + m(3.6), gx + m(10.9), gy + m(7.95))
window(gx + m(1.2), gy, gx + m(5.4), gy)
window(gx + m(1.0), gy + m(7.95), gx + m(5.8), gy + m(7.95))
window(gx + m(7.6), gy, gx + m(9.0), gy)
window(gx + m(10.2), gy, gx + m(11.8), gy)
door(gx + m(6.9), gy + m(4.4), start=90)
door(gx + m(9.4), gy + m(6.2), start=0)
room(gx + m(3.45), gy + m(3.7), "KITCHEN / LIVING / DINING", 42.5)
room(gx + m(8.25), gy + m(1.7), "BEDROOM 4", 12.8)
room(gx + m(11.0), gy + m(1.7), "STUDY", 11.2)
room(gx + m(8.15), gy + m(4.6), "HALL / STAIRS", 12.0)
room(gx + m(8.15), gy + m(6.8), "UTILITY", 6.4)
room(gx + m(10.15), gy + m(5.6), "SHOWER", 4.6)
room(gx + m(11.65), gy + m(4.4), "WC", 3.1)
room(gx + m(11.65), gy + m(6.6), "STORE", 3.2)
page.draw_rect(fitz.Rect(gx, gy + m(7.95), gx + m(6.0), gy + m(7.95) + m(4.0)), color=SOFT, width=0.6, dashes="[4 3] 0")
room(gx + m(3.0), gy + m(9.8), "COVERED TERRACE", 24.0)
dim_h(gx, gx + m(12.4), gy - 22, "12.40")
dim_v(gx - 24, gy, gy + m(7.95), "7.95")
text(gx, gy - 46, "GROUND FLOOR PLAN   1:100", size=11, font="hebo")
page.draw_rect(fitz.Rect(gx + m(6.9), gy + m(8.5), gx + m(12.4), gy + m(10.1)), color=STEEL, width=1.2)
text(gx + m(7.1), gy + m(9.2), "GROUND FLOOR  GIA 98.6 m2", size=9, color=STEEL, font="hebo")
text(gx + m(7.1), gy + m(9.75), "12.40 x 7.95 m", size=7, color=SOFT)

# ── First floor: 12.40 x 7.08 m = 87.8 m2 ──────────────────────────────────────
fx, fy = 660, 170
wall_rect(fx, fy, 12.4, 7.08)
partition(fx + m(5.2), fy, fx + m(5.2), fy + m(7.08))
partition(fx + m(5.2), fy + m(3.9), fx + m(8.8), fy + m(3.9))
partition(fx + m(8.8), fy, fx + m(8.8), fy + m(7.08))
partition(fx + m(8.8), fy + m(3.5), fx + m(12.4), fy + m(3.5))
partition(fx, fy + m(4.6), fx + m(5.2), fy + m(4.6))
partition(fx + m(3.2), fy + m(4.6), fx + m(3.2), fy + m(7.08))
partition(fx + m(5.2), fy + m(5.6), fx + m(8.8), fy + m(5.6))
window(fx + m(1.0), fy, fx + m(4.2), fy)
window(fx + m(9.4), fy, fx + m(11.8), fy)
window(fx + m(9.4), fy + m(7.08), fx + m(11.8), fy + m(7.08))
window(fx + m(5.8), fy, fx + m(8.2), fy)
door(fx + m(5.2), fy + m(4.3), start=180)
door(fx + m(8.8), fy + m(4.0), start=0)
room(fx + m(2.6), fy + m(2.2), "MASTER BEDROOM", 18.4)
room(fx + m(1.6), fy + m(5.7), "EN-SUITE", 6.2)
room(fx + m(4.2), fy + m(5.7), "WARDROBE", 5.0)
room(fx + m(7.0), fy + m(1.8), "BEDROOM 2", 13.1)
room(fx + m(7.0), fy + m(4.6), "LANDING / STAIRS", 9.8)
room(fx + m(7.0), fy + m(6.2), "BATHROOM", 5.3)
room(fx + m(10.6), fy + m(1.6), "BEDROOM 3", 12.6)
room(fx + m(10.6), fy + m(5.1), "BALCONY ACCESS", 4.4)
for bx in (fx + m(0.6), fx + m(8.9)):
    page.draw_rect(fitz.Rect(bx, fy + m(7.08), bx + m(3.2), fy + m(7.08) + m(1.4)), color=SOFT, width=0.6, dashes="[4 3] 0")
    text(bx + m(1.6), fy + m(7.08) + m(0.85), "BALCONY", size=6.5, color=SOFT, align=1, width=80)
dim_h(fx, fx + m(12.4), fy - 22, "12.40")
dim_v(fx - 24, fy, fy + m(7.08), "7.08")
text(fx, fy - 46, "FIRST FLOOR PLAN   1:100", size=11, font="hebo")
page.draw_rect(fitz.Rect(fx + m(6.9), fy + m(8.5), fx + m(12.4), fy + m(10.1)), color=STEEL, width=1.2)
text(fx + m(7.1), fy + m(9.2), "FIRST FLOOR  GIA 87.8 m2", size=9, color=STEEL, font="hebo")
text(fx + m(7.1), fy + m(9.75), "12.40 x 7.08 m", size=7, color=SOFT)

# ── Site note, schedule, title block ─────────────────────────────────────────────
page.draw_oval(fitz.Rect(90, 560, 90 + m(8), 560 + m(3.5)), color=STEEL, width=0.8, dashes="[3 2] 0")
text(90 + m(4), 560 + m(1.9), "SWIMMING POOL (separate contract, not in scope)", size=7, color=STEEL, align=1, width=260)

sx, sy = 440, 575
text(sx, sy, "AREA SCHEDULE", size=9, font="hebo")
rows = [("Ground floor GIA", "98.6 m2"), ("First floor GIA", "87.8 m2"), ("TOTAL GIA", "186.4 m2"), ("Covered terrace (not GIA)", "24.0 m2"), ("Balconies (not GIA)", "2 x 4.5 m2")]
for i, (k, v) in enumerate(rows):
    y = sy + 16 + i * 13
    bold = k.startswith("TOTAL")
    text(sx, y, k, size=8, font="hebo" if bold else "helv")
    text(sx + 170, y, v, size=8, font="hebo" if bold else "helv")
    page.draw_line((sx, y + 4), (sx + 230, y + 4), color=(0.85, 0.83, 0.78), width=0.4)

tb = fitz.Rect(W - 380, H - 150, W - 40, H - 40)
page.draw_rect(tb, color=INK, width=1.4)
page.draw_line((tb.x0, tb.y0 + 40), (tb.x1, tb.y0 + 40), color=INK, width=0.6)
text(tb.x0 + 12, tb.y0 + 18, "OLIVE GROVE HOUSE", size=13, font="hebo")
text(tb.x0 + 12, tb.y0 + 32, "Two-storey family house, 4 bedrooms. FICTIONAL demo drawing.", size=7.5, color=SOFT)
text(tb.x0 + 12, tb.y0 + 58, "Acme Steel Homes estimator: test drawing, not a real project", size=7.5)
text(tb.x0 + 12, tb.y0 + 72, "Sheet A-101  Plans  Scale 1:100 @ A3", size=7.5)
text(tb.x0 + 12, tb.y0 + 86, "Structure: LGSF G550 + foam concrete, mineral facade", size=7.5, color=SOFT)
text(tb.x0 + 12, tb.y0 + 100, "Generated by estimate/fixtures/make_demo_drawing.py", size=6.5, color=SOFT)

nx, ny = W - 80, 90
page.draw_polyline([(nx, ny - 22), (nx - 8, ny + 6), (nx, ny), (nx + 8, ny + 6), (nx, ny - 22)], color=INK, fill=INK, width=0.6)
text(nx - 3, ny - 28, "N", size=10, font="hebo")
for i in range(5):
    page.draw_rect(fitz.Rect(90 + i * m(1), 790, 90 + (i + 1) * m(1), 796), color=INK, fill=INK if i % 2 == 0 else None, width=0.5)
text(90, 806, "0     1     2     3     4     5 m", size=6.5, color=SOFT)

doc.set_metadata({"title": "Olive Grove House (fictional demo drawing)", "author": "sales-voice-agent-vision-estimator", "creator": "make_demo_drawing.py", "producer": "PyMuPDF"})
doc.save(OUT, garbage=4, deflate=True)
if PREVIEW:
    page.get_pixmap(dpi=110).save(PREVIEW)
print(f"wrote {OUT}" + (f" and {PREVIEW}" if PREVIEW else ""))
