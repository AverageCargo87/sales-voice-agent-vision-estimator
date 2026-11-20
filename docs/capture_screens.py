"""Captures the README visuals from a running estimate server (demo mode is enough).

    npm run estimate                      # in another terminal; no API key needed
    python docs/capture_screens.py        # needs playwright (chromium) + pillow

Writes docs/estimator-demo.gif (the demo flow) and docs/estimator.png (the result page).
"""
import io
import sys
import time

from PIL import Image
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8099/"
OUT_GIF = "docs/estimator-demo.gif"
OUT_PNG = "docs/estimator.png"
W, H = 760, 940

frames: list[tuple[Image.Image, int]] = []


def grab(page, ms):
    img = Image.open(io.BytesIO(page.screenshot(type="png"))).convert("RGB")
    frames.append((img, ms))


def burst(page, seconds, every=0.12, hold_last=0):
    end = time.time() + seconds
    while time.time() < end:
        grab(page, int(every * 1000))
        time.sleep(every)
    if hold_last:
        grab(page, hold_last)


def smooth_scroll(page, to_y, steps=14):
    start = page.evaluate("window.scrollY")
    for i in range(1, steps + 1):
        page.evaluate(f"window.scrollTo(0, {start + (to_y - start) * i / steps})")
        time.sleep(0.03)
        grab(page, 60)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1, locale="en-US")
    page.goto(URL, wait_until="networkidle")
    grab(page, 1400)

    page.click("#demoBtn")
    burst(page, 2.6)  # progress steps while the replayed model "reads" the drawing
    page.wait_for_selector("#costCard:not(.hidden)")
    burst(page, 0.8, hold_last=1200)

    y = page.evaluate("document.getElementById('costCard').getBoundingClientRect().top + window.scrollY - 16")
    smooth_scroll(page, y)
    burst(page, 0.6, hold_last=1000)

    page.click("#seg button[data-pkg='shell']")
    burst(page, 0.7, hold_last=700)
    page.click("#seg button[data-pkg='turnkey']")
    burst(page, 0.7, hold_last=500)

    page.click("#bdToggle")
    burst(page, 0.6)
    y = page.evaluate("document.getElementById('bdBody').getBoundingClientRect().top + window.scrollY - 60")
    smooth_scroll(page, y)
    burst(page, 0.3, hold_last=1600)

    y = page.evaluate("document.getElementById('narrCard').getBoundingClientRect().top + window.scrollY - 16")
    smooth_scroll(page, y, steps=18)
    burst(page, 0.3, hold_last=2600)

    # Static result page: full height, breakdown open
    page.evaluate("window.scrollTo(0, 0)")
    page.screenshot(path=OUT_PNG, full_page=True)
    browser.close()

# GIF: downscale a little and share one adaptive palette for size
scale = 0.8
small = [(im.resize((int(W * scale), int(H * scale)), Image.LANCZOS), ms) for im, ms in frames]
palette_src = Image.new("RGB", (small[0][0].width, small[0][0].height * 3))
for i, idx in enumerate([0, len(small) // 2, len(small) - 1]):
    palette_src.paste(small[idx][0], (0, small[0][0].height * i))
pal = palette_src.quantize(colors=96, method=Image.Quantize.MEDIANCUT)
q = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im, _ in small]
q[0].save(OUT_GIF, save_all=True, append_images=q[1:], duration=[ms for _, ms in small], loop=0, optimize=False, disposal=0)
print(f"{len(frames)} frames -> {OUT_GIF}; full page -> {OUT_PNG}")
