# Verification and limits

This is a Vite project. `../src/` is the source; `npm run dev` serves it, `npm run build` produces `../dist/`. `../standalone.html` is a flattened, double-click-able build of the same page, regenerated with `npm run standalone`. Three.js is resolved from `node_modules` in the Vite build (zero runtime network requests beyond the page's own assets); `standalone.html` fetches it from a pinned jsDelivr CDN URL instead, since it has no bundler.

## What this build is

A five-section page:

1. **Hero** — headline and a wireframe rendering of the corridor, drawn from the same traced centreline as the 3D model.
2. **Toll** — the reported casualty and damage figures, each with its own source and date, and a flat plan of the corridor with the sites that lay in the flow path marked.
3. **Model** — the bounded 3D reconstruction, in a box rather than filling the window.
4. **Future** — an analysis section on the hazard outlook for the corridor.
5. **Give** — a direct link to the official Government of Nepal relief fund. No payment QR is embedded; see the root README for why.

## What changed from the previous build

- **The map is a corridor now, not a rectangle.** Terrain exists only within 4.2 km of the traced channel; everything else is gone. The elevation grid was re-baked in corridor space (1024 × 224, ≈91 m along the channel, ≈38 m across) which cut the embedded payload from 757 KB to **186 KB** and the whole file from 905 KB to 333 KB.
- **Roughly 2.5× fewer triangles.** 355–470 k across both passes (depth prepass plus beauty pass), against 1.15 M before.
- **The loop does nothing while the model is off screen.** An IntersectionObserver halts the render entirely when you scroll away, which is the single biggest thing separating smooth from laggy on a page you scroll through.
- **Device pixel ratio is capped** at 1.0 / 1.25 / 1.75 by quality tier, and the quality selector now genuinely drives the flow-solver resolution, sprite count, LOD error budget and triangle budget. Default is Balanced.
- The mesh is still built in **world space** while its heights come from the corridor grid — a corridor-space mesh folds through itself on any bend tighter than its own half-width, and this valley has bends of 540 m. The cut edge is clipped in the fragment shader so it is pixel-accurate rather than quantised to the cell size.

## Two things I did not do, deliberately

- **The red dots are not death counts.** You asked for markers where people were killed. No village-by-village casualty breakdown has been published — the finest published geography is district level (Rasuwa: 140 bodies), and bodies were recovered as far away as Chitwan and Nawalparasi. The dots therefore mark **settlements and sites that lay in the flow path**, which is documented, and the map says so in its own legend. Inventing per-place numbers would have been the easy version and the wrong one.
- **There is no payment QR.** An earlier draft embedded one; it was removed. The support section now links directly to `https://pmdrf.nchl.com.np/` — the Prime Minister Disaster Relief Fund portal, operated for the Government of Nepal by Nepal Clearing House Limited — as plain text and a plain link. A payment code that cannot be independently verified could send real money to the wrong place; a link the user can read before clicking has no such risk.
- **Cut edge / base plate is off by default.** The layer still exists and can be toggled on in the Layers panel — it is what makes the model read as a bounded slab rather than a naturally eroding valley — but it is not shown on first load.

## Checked 5 September 2026

Headless Brave/Chromium at 1440 × 900, DPR 1, NVIDIA RTX 3050 Ti Laptop GPU. Output in `verification.json`; `node .verification/verify.cjs` from the project root reruns it.

- No JavaScript or shader console errors.
- Ready in about 5–7 s on the Vite dev server, most of which is shader compilation and decoding the embedded elevation grid. The hero, the flat map, the article and the donation panel render immediately and do not wait for the model.
- Zero non-local requests in the Vite build: three.js is resolved from `node_modules`, not a CDN. (`standalone.html`, which has no bundler, fetches a pinned three.js build from jsDelivr instead — that is its one network request.) No terrain, imagery, texture or audio asset request either way.
- Page structure: 6 toll cards, the flat map, 11 source rows, 9 modelled-assumption rows, both "NOT FOOTAGE" badges, five sections.
- Timeline round-trip is exact: for every beat, seeking directly and seeking via reset give bit-identical front position and stage.
- Arrival/position inverse checks agree at 0, 3, 21.78, 37.1, 60, 81.8 and 93.08 km.
- Superelevation, read back from the GPU field at the four sharpest bends, is **positive at all four** — the surface stands higher on the geometric outside of the bend, with "outside" determined from centreline positions and no sign convention involved. The largest is 14.9 m at the 614 m-radius bend at 7 km, which matches u²W/(gR) for that bend's inputs. Downstream values fall to 0.4–0.9 m as depth and velocity drop.
- Orbited through nadir, framed, maximum zoom-out, a human-scale cross-section and near-ground views from all four cardinal directions.
- Active playback sampled at 78–128 FPS depending on tier, on a discrete GPU at 1440 × 900 in a 16:9 box. **This is not an integrated-GPU guarantee and not a full-loop minimum.**
- Forward and backward timeline sweeps, all five camera presets, quality switching, vertical exaggeration, layer toggles, a full-page capture and a 390 × 844 mobile capture. Audio remains off by default and was not listened to.

## Acceptance gaps

This is an explanatory reconstruction, not a calibrated hazard model.

- The GPU solver transports depth, a sediment proxy and speed around **prescribed analytic hydrographs**. It adds centripetal cross-channel tilt, constriction run-up, blockage backwater, junction ponding and bank eddies, with a Manning velocity from the measured bed slope — but it is **not** a conservative 2D shallow-water or debris-rheology model and **cannot establish site-specific inundation**.
- The grid is posted at ~91 m along the channel and ~38 m across. That resolves the gorge as real landform; everything finer is procedural relief, not measured shape.
- Settlement and infrastructure placement is schematic, at approximate sites. Structures fade to a removed state with a caption; nothing collapses on screen.
- Level-of-detail transitions are discrete. Shading is level-independent, but silhouettes still change between levels. Full-loop absence of popping has not been established.
- The blockage/breach chronology is a **hypothesis** — sources confirm both but publish no times.
- The reported 9 m rise in 30 minutes belongs to Galchhi, outside this extent, and is assigned to no station shown. Display extent is 93.08 km; reported affected extent is longer.
- The failure mechanism has no settled consensus. Sources agree it was a rock–ice cascade rather than a glacial lake outburst; whether it was bedrock-first, and what role permafrost thaw played, remain interpretive. The page says so.
- No human figure, body, occupied vehicle or staged death appears anywhere. Casualty figures appear once, in the hero, as reported figures with source and date.

The "future" section is signed interpretation, not reporting, and says so in its own note. This page is not affiliated with or endorsed by the Government of Nepal or any other institution.

## Files

`verify.cjs` is the harness, `verification.json` its output. `qa-*.png` are QA records — orbit angles, timeline frames, camera presets, a full-page capture and a mobile capture. They are records of the model, not event imagery. `syntax-check.mjs` is a build by-product.
