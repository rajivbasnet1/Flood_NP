// Shared helpers and the one deterministic random stream.
import * as THREE from 'three';
export const $ = id => document.getElementById(id);
export const clamp = THREE.MathUtils.clamp;
export const lerp = THREE.MathUtils.lerp;
export const DEG = THREE.MathUtils.degToRad;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Drives the loading bar by transform rather than width: same result, but a
// progress tick then costs a composite instead of a layout pass.
export const setBar = p => {
  const b = $('bar');
  if (b) b.firstElementChild.style.transform = 'scaleX(' + Math.max(0, Math.min(1, p)).toFixed(3) + ')';
};
// Every placement in the scene comes from this stream, so reloads are identical.
let rng = 26826;
export const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };

// ── Dual units ──────────────────────────────────────────────────────────────
// Every distance on the page carries SI first and US customary second. The
// conversions are exact by definition (1 mi = 1609.344 m, 1 ft = 0.3048 m),
// so these are one number shown twice, never two measurements.
const MI = 1609.344, FT = 0.3048;
const dec = (v, d) => v.toFixed(d).replace(/\.0+$/, '');
// Metres in, "21.5 km · 13.4 mi". `d` controls decimals on both halves.
export const fmtKm = (m, d = 1) => dec(m / 1000, d) + ' km · ' + dec(m / MI, d) + ' mi';
// Metres in, "66 m · 217 ft". Whole units — nothing here is precise to a foot.
export const fmtM = m => Math.round(m).toLocaleString() + ' m · ' + Math.round(m / FT).toLocaleString() + ' ft';
// Metres per second in, "53.8 m/s · 120 mph".
export const fmtSpeed = v => v.toFixed(1) + ' m/s · ' + Math.round(v * 3600 / MI) + ' mph';
