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
