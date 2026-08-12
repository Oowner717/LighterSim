# LighterSim

A Zippo-style flip-lighter you can play with on your phone. No dependencies, no
build step — plain HTML/CSS/JS, sounds synthesized live with WebAudio, flame and
sparks drawn on a canvas.

## How to play

The lid is a real physical object: it has inertia, and a spring cam that snaps
it to whichever end it's nearest — it never rests half-open, just like the
real thing.

- **Flick up** (or tap the lid) — throws it open with the classic *cling*. How
  hard you flick sets how hard it lands; sound and haptics scale with impact.
- **Drag the lid** — it follows your finger around the hinge in real time
  (listen for the hinge). Let go and the cam takes over; release it with speed
  and it carries your momentum.
- **Spin the wheel down** — the knurled strip right of the chimney. A fast
  flick throws sparks and lights the wick (a still-warm wick relights easier);
  a lazy one just scratches the flint. Flick it hard and it keeps spinning —
  it can even catch from the free spin.
- **Tilt your phone** — the flame leans the other way (grants motion access on iOS).
- **Swipe across the flame** — it's windproof, so it gutters, bends, and
  fights back; only a violent gust (or a couple in a row) blows it out.
- **Swipe down / tap the lid** — snaps it shut and snuffs the flame, and a
  little smoke seeps out of the seam. The wick keeps a dying glow for a
  second after the flame goes.

While lit, the app holds a screen wake lock, so it keeps burning at the concert.

## Borderless on your phone

Open the deployed page, then add it to your home screen — it launches fullscreen
with no browser chrome:

- **iPhone (Safari):** Share → **Add to Home Screen**, then launch from the icon.
- **Android (Chrome):** ⋮ menu → **Add to Home screen** (or the install prompt).

It's a PWA with a service worker, so after the first load it works offline.

## Deploying

GitHub Pages is configured to **deploy from a branch** (repo Settings → Pages),
publishing the repo root of `claude/zippo-lighter-simulation-24ei5h` to
`https://oowner717.github.io/LighterSim/`. Every push to that branch redeploys.
The `.nojekyll` file keeps Pages from running the files through Jekyll.

## Running locally

Any static server works:

```
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Repo layout

- `index.html` / `style.css` — the lighter itself: chrome case, lid, chimney,
  wick, and flint wheel are pure CSS.
- `app.js` — gestures, flame/spark/smoke simulation, WebAudio sound synthesis,
  haptics, tilt, wake lock.
- `sw.js`, `manifest.webmanifest` — PWA install + offline.
- `scripts/make-icons.mjs` — regenerates `icons/` (hand-rolled PNG encoder,
  zero dependencies): `node scripts/make-icons.mjs`.
