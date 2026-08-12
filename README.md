# LighterSim

A Zippo-style flip-lighter you can play with on your phone. No dependencies, no
build step — plain HTML/CSS/JS, sounds synthesized live with WebAudio, flame and
sparks drawn on a canvas.

## How to play

- **Flick up** (or tap the lid) — flips it open with the classic *cling*.
- **Spin the wheel down** — the knurled strip right of the chimney. A fast flick
  throws sparks and lights the wick; a lazy one just scratches the flint.
- **Tilt your phone** — the flame leans the other way (grants motion access on iOS).
- **Swipe fast across the flame** — blows it out.
- **Swipe down / tap the lid** — snaps it shut and snuffs the flame. *Clunk.*

While lit, the app holds a screen wake lock, so it keeps burning at the concert.

## Borderless on your phone

Open the deployed page, then add it to your home screen — it launches fullscreen
with no browser chrome:

- **iPhone (Safari):** Share → **Add to Home Screen**, then launch from the icon.
- **Android (Chrome):** ⋮ menu → **Add to Home screen** (or the install prompt).

It's a PWA with a service worker, so after the first load it works offline.

## Deploying

Pushing to `main` runs `.github/workflows/deploy.yml`, which publishes the repo
root to GitHub Pages: `https://oowner717.github.io/LighterSim/`. (First run may
need Pages enabled: repo **Settings → Pages → Source: GitHub Actions**.)

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
