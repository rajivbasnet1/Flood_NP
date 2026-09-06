#!/usr/bin/env node
// Bundle the Vite project source into one self-contained standalone.html that
// opens by double-clicking, with no server and no npm install.
//
// The normal dev/build path is Vite (`npm run dev`, `npm run build`), which
// resolves the bare `three` import from node_modules. Opened straight from the
// file system with no bundler, a browser blocks ES module imports outright
// (CORS, origin "null"), so this script flattens src/*.js into one inline
// module — local imports removed, bodies concatenated in dependency order —
// and rewrites the bare `three` imports to a pinned CDN URL, since there is no
// bundler here to resolve them from node_modules.
//
//   node build-standalone.cjs
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');

// Must match the "three" version in package.json — this is the one place that
// version number needs to be kept in sync by hand, since standalone.html has
// no package manager to do it for it.
const THREE_VERSION = require('./package.json').dependencies.three;
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;

// Dependency order. Each module may only use things defined above it.
const ORDER = [
  'util.js', 'state.js', 'terrain-data.js', 'data.js', 'corridor.js',
  'scene.js', 'terrain.js', 'flow.js', 'water.js', 'overlays.js',
  'controls.js', 'hud.js', 'site.js', 'main.js',
];

const bareImports = new Set();
const bodies = [];

for (const name of ORDER) {
  let src = fs.readFileSync(path.join(SRC, name), 'utf8');

  // Pull out every import statement, single- or multi-line.
  src = src.replace(/^import\s+([\s\S]*?)\s+from\s+'([^']+)';[ \t]*$/gm, (whole, clause, spec) => {
    if (!spec.startsWith('.')) {
      // three / three/addons: hoist once, verbatim. The import map added below
      // resolves these bare specifiers — and three's own addon modules (e.g.
      // Sky.js) import bare 'three' internally, so the map is required anyway,
      // which means these hoisted imports need not be rewritten to full URLs.
      bareImports.add(`import ${clause.replace(/\s+/g, ' ').trim()} from '${spec}';`);
      return '';
    }
    // Local import: the binding already exists in the flattened scope. The one
    // thing that must survive is a rename, which has no other declaration.
    const m = clause.match(/^\{([\s\S]*)\}$/);
    if (!m) return '';
    return m[1].split(',')
      .map(s => s.trim()).filter(Boolean)
      .map(s => {
        const as = s.match(/^(\S+)\s+as\s+(\S+)$/);
        return as ? `const ${as[2]} = ${as[1]};` : '';
      })
      .filter(Boolean).join('\n');
  });

  // Drop trailing `export { ... };` manifests; the bindings are already local.
  src = src.replace(/^export\s*\{[\s\S]*?\};[ \t]*$/gm, '');
  // `export const x = …` → `const x = …`
  src = src.replace(/^export\s+(const|let|var|function|async function|class)\b/gm, '$1');

  bodies.push(`/* ══════ ${name} ══════ */\n${src.trim()}`);
}

const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// three's own addon modules (Sky.js etc.) import the bare specifier 'three'
// internally. A bundler resolves that from node_modules; with no bundler here
// the browser needs an import map instead, or it fails at Sky.js's own import.
const importMap = `<script type="importmap">{"imports":{
"three":"${CDN}/build/three.module.js",
"three/addons/":"${CDN}/examples/jsm/"}}</script>`;

html = html
  .replace(/<link rel="stylesheet" href="\/src\/styles\.css">/,
    '<style>\n' + css.trim() + '\n</style>\n' + importMap)
  .replace(/<script type="module" src="\/src\/main\.js"><\/script>/,
    '<script type="module">\n'
    + [...bareImports].join('\n') + '\n\n'
    + bodies.join('\n\n') + '\n</script>')
  // The file:// notice is only for the Vite source page.
  .replace(/<!-- FILE-NOTICE-START -->[\s\S]*?<!-- FILE-NOTICE-END -->/, '')
  .replace(/<title>([^<]*)<\/title>/, '<title>$1</title>');

const out = path.join(ROOT, 'standalone.html');
fs.writeFileSync(out, html);
console.log('wrote standalone.html  ' + (html.length / 1024).toFixed(0) + ' KB');
console.log('Opens directly in a browser — no server, no npm install needed.');
