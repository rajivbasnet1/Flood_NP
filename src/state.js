// Mutable playback and quality state, in one object. Modules read and write
// S.<field> directly: property access is always live, so there is never a
// second copy of the clock anywhere in the app.
export const S = {
  time: -30, playing: false, rate: 20, looping: true, holdEnd: false,
  quality: 'balanced', onScreen: true, spraysOn: true, spriteBudget: 520,
  forceFrame: true, resetFlow: true, fps: 0,
};
export const END = 14400;
export const QUALITY = {
  high:     { lod: 2.6, tri: 340000, flow: [1024, 96], sprites: 820, dpr: 1.75 },
  balanced: { lod: 3.4, tri: 240000, flow: [768, 64],  sprites: 520, dpr: 1.25 },
  low:      { lod: 5.0, tri: 130000, flow: [512, 48],  sprites: 260, dpr: 1.0  },
};
