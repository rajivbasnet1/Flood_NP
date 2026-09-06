# Langtang–Trishuli · 26 August 2026

A labelled scientific reconstruction of the glacier collapse, debris dam, breach and downstream flood wave that struck the Nepal–Tibet border on 26 August 2026 — the reported toll, a bounded 3D model of the corridor built on a real elevation grid, and an analysis of what comes next for these valleys.

**This is a reconstruction, not a recreation of footage.** It shows no people, no bodies, and no moment of harm. Casualty figures appear once, each with its own source and date, and were still being revised when this was built.

---

## Screenshots

### Hero — the reported toll and the corridor map
![Hero section: headline, reported toll figures, and a wireframe of the corridor](docs/screenshots/01-hero.png)

### Where the flood went
![Flat plan of the 93 km corridor with settlements that lay in the flow path marked](docs/screenshots/02-toll-map.png)

### The 3D reconstruction, mid-corridor
![The bounded relief model, orbitable, with the flood band running through the gorge](docs/screenshots/03-model-flood.png)

### The border reach, close in
![Camera preset at the Rasuwagadhi border confluence, showing the flood at valley scale](docs/screenshots/04-model-border.png)

### Analysis — what comes next
![Two-column article on the hazard outlook for the corridor](docs/screenshots/05-future.png)

### Support — the official channel
![Support section linking directly to the Government of Nepal relief fund](docs/screenshots/06-give.png)

### Mobile
<img src="docs/screenshots/07-mobile.png" alt="The page on a 390px mobile viewport" width="320">

---

## Key features

- **A real elevation grid, not a procedural mountain.** Terrain comes from a public-domain corridor-space grid (AWS Terrain Tiles, SRTM/ALOS-derived) covering 93.08 km of channel and 4.2 km either side, at roughly 91 m along the channel and 38 m across.
- **A traced channel, not a hand-drawn one.** The centreline was found by priority-flood depression filling and steepest-descent flow routing through that grid, starting from the failure scar. Checked independently: the traced Rasuwagadhi confluence lands 29 m from its published coordinate, Syafrubesi 115 m, Betrawati 113 m.
- **A free-orbit 3D model in a box**, not a full-bleed canvas — drag to orbit, scroll to zoom toward the cursor, scrub the timeline in either direction with exact state restoration (nothing is baked forward-only).
- **A GPU flow solver** carrying depth, a sediment proxy and speed around timing anchored to the one sourced figure (the ~7-minute arrival at the border), with cross-channel superelevation on bends, run-up in constrictions, and backwater at the modelled blockage.
- **The reported toll, sourced and dated**, shown once in the hero and nowhere inside the reconstruction.
- **A flat corridor map** marking settlements that lay in the flow path — explicitly *not* a per-place death count, because no village-by-village breakdown has been published.
- **A sources panel** inside the model listing every hard number on the page with where it came from, next to a list of what is modelled rather than measured.
- **A direct link to the official relief fund** — no payment QR, no code that could route money to the wrong place.
- **Runs smoothly while scrolling.** The render loop stops entirely when the model is off screen, so the rest of the page never fights it for frame time.

---

## Running it

This is a [Vite](https://vitejs.dev) project.

```bash
npm install
npm run dev       # dev server with hot reload
npm run build     # production build, output to dist/
npm run preview   # serve the production build locally
```

**Just want to look at it without installing anything?** Open **`standalone.html`** directly — double-click it. It's the same page with the source bundled into one file, using a pinned CDN build of three.js instead of the npm-resolved one. Regenerate it after editing `src/` with:

```bash
npm run standalone
```

Browsers block ES module imports from `file://` pages (CORS, origin `"null"`), so opening `index.html` itself by double-clicking will not work — it detects this and points you at `standalone.html` instead.

---

## Project layout

```
index.html              Vite entry point (markup only)
standalone.html         the same page, flattened — opens by double-clicking
build-standalone.cjs    regenerates standalone.html from src/
vite.config.js          base:'./' for relative deploys, e.g. GitHub Pages
package.json
src/
  util.js               helpers, the deterministic random stream
  state.js              playback + quality state, in one object
  data.js               sources, modelled assumptions, reported toll
  terrain-data.js        the embedded elevation grid (~186 KB base64)
  corridor.js            grid decode, traced channel, event timeline
  scene.js               renderer, the void, the sky probe
  terrain.js              the corridor block, its cut face and base
  flow.js                 collapse, debris dam, GPU flow solver
  water.js                flow surface, debris, spray
  overlays.js             built environment, flood band, peak extent, deposition
  controls.js             orbit camera and presets
  hud.js                  transport, readouts, labels, sources tables, audio
  site.js                 toll cards, flat corridor map, wireframe hero
  main.js                 post chain, wiring, frame loop, boot
  styles.css              all styling
docs/screenshots/        the images above
.verification/           automated test harness, QA captures, known limits
```

Module dependencies run one way: `util` and `state` depend on nothing; `corridor` builds on `terrain-data`; everything else builds on `corridor` and `scene`; `main` wires it together. There are no import cycles.

---

## What the model is, and is not

Timing is anchored to the one sourced figure: the traced chainage to the Rasuwagadhi confluence is 21.78 km, and setting the front to arrive there at the reported ~7 minutes gives 54.5 m/s — which independently reproduces the separately reported "first ~22 km at approximately 193 km/h".

Everything else is modelled and labelled as such, in the page's own sources panel and in `.verification/README.md`. The flow solver is a reduced GPU transport around prescribed hydrographs, **not** a conservative shallow-water model, and it cannot establish site-specific inundation. It should not be used for hazard planning or attribution.

## Two deliberate omissions

- **The map markers are not death counts.** No village-by-village casualty breakdown has been published; the finest published geography is district level. The markers show which settlements lay in the flow path, and the legend on the page says so.
- **There is no payment QR.** The support section links to the Government of Nepal's Prime Minister Disaster Relief Fund portal directly. A payment code that cannot be independently verified could send money to the wrong place.

## Verification

`node .verification/verify.cjs` starts the dev server, drives the page headlessly, and checks: zero console errors, the timeline round-trips exactly in both directions, superelevation reads correctly on the sharpest bends, and every camera preset and quality tier renders without breaking. `.verification/README.md` has the full report and the known limits of the reconstruction.

## Attribution

Terrain: AWS Terrain Tiles (public domain, SRTM/ALOS-derived). Rendering: [three.js](https://threejs.org). Every reported figure carries its own source in the page's Sources & uncertainty panel. This project is not affiliated with, endorsed by, or operated on behalf of the Government of Nepal or any other institution.
