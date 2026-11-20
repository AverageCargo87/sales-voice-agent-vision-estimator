# The 3D landing page (numbers only)

The fourth piece of the suite is a bilingual (RU / EN) sales page for a reference duplex project: Next.js 16, React 19, Tailwind v4, three.js, GSAP and Lenis, deployed on Vercel. The architect's BIM model was brought into the browser (IFC -> glTF via web-ifc), and the page opens with a **161-frame flyover scrubbed by scroll** on a canvas.

**Why the code is not in this repository:** the page is built around third-party material, the partner architecture bureau's BIM model and drawings and the renders derived from them. Its components import the project's content directly, so a clean copy would be a different page. What is reusable is the method and the measurements below.

## Performance, measured

| | Before | After | Change |
|---|---:|---:|---:|
| HTML document | 6.8 MB | 215 KB | ~32x lighter |
| First visit on mobile (total transfer) | 15.1 MB | 1.9 MB | ~8x lighter |
| First open | 3.0 s | 0.5-1.3 s | 2-6x faster |

## How the numbers were reached

- **Codec chosen by SSIM, not by habit.** The flyover frames were encoded as AVIF and WebP and compared against the source frames: AVIF scored **SSIM 0.9899 at 8.3 MB** for the whole sequence, against **13.5 MB** for WebP, about 38% less for near-identical quality. The page probes AVIF support once and falls back to WebP.
- **Seams checked with PSNR.** The flyover is stitched from five transition clips that meet at six key views; the joins between clips were verified with PSNR rather than by eye.
- **Progressive loading.** The first pass loads every sixth frame, so the first screen comes alive before the full sequence arrives; the rest streams in behind it.
- **Holds on the key views.** The scroll timeline pauses briefly on each key view; captions appear only during those holds, scheduled from the anchor frame indices in the frame manifest instead of hand-tuned scroll fractions.

The landing page and the estimator share one source of facts with the voice agent: the company knowledge base.
