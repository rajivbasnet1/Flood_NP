import { defineConfig } from 'vite';

// Relative base so the built site works from a subpath (GitHub Pages project
// sites are served from /<repo>/, not the domain root).
export default defineConfig({
  base: './',
  build: {
    // The embedded elevation grid is a single ~250 KB base64 string in one
    // module; that is expected and not a real bundle-size problem, so the
    // default 500 KB warning is raised rather than chasing a false alarm.
    chunkSizeWarningLimit: 1200,
  },
});
