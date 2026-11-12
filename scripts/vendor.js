// Copies browser dependencies from node_modules into public/ (run at build time).
import fs from 'node:fs';
import path from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const nm = (p) => path.join(root, 'node_modules', p);
const out = (p) => path.join(root, 'public', p);
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const copyDir = (from, to) => fs.cpSync(from, to, { recursive: true, filter: (source) => !source.endsWith('.map') });
const normalizeLicenseWhitespace = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) normalizeLicenseWhitespace(file);
    else if (/^LICENSE/i.test(entry.name)) {
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/[ \t]+$/gm, '').replace(/\n*$/, '\n'));
    }
  }
};

copy(nm('maplibre-gl/dist/maplibre-gl.mjs'), out('vendor/maplibre-gl.mjs'));
copy(nm('maplibre-gl/dist/maplibre-gl-worker.mjs'), out('vendor/maplibre-gl-worker.mjs'));
copy(nm('maplibre-gl/dist/maplibre-gl.css'), out('vendor/maplibre-gl.css'));
try { fs.unlinkSync(out('vendor/maplibre-gl.js')); } catch { /* removed in the ES-module release */ }
copy(nm('@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js'), out('vendor/mapbox-gl-rtl-text.js'));
const pdfjsVersion = JSON.parse(fs.readFileSync(nm('pdfjs-dist/package.json'), 'utf8')).version;
copy(nm('pdfjs-dist/build/pdf.min.mjs'), out(`vendor/pdfjs-${pdfjsVersion}.min.mjs`));
copy(nm('pdfjs-dist/build/pdf.worker.min.mjs'), out(`vendor/pdfjs-worker-${pdfjsVersion}.min.mjs`));
copy(nm('pdfjs-dist/LICENSE'), out('vendor/pdfjs-LICENSE.txt'));
for (const directory of ['cmaps', 'standard_fonts']) {
  const destination = out(`vendor/pdfjs/${directory}`);
  copyDir(nm(`pdfjs-dist/${directory}`), destination);
  normalizeLicenseWhitespace(destination);
}
const fonts = [
  ['@fontsource/noto-kufi-arabic/files', /noto-kufi-arabic-(arabic|latin)-(300|400|500|600|700|800|900)-normal\.woff2$/],
  ['@fontsource/jetbrains-mono/files', /jetbrains-mono-latin-(400|500|600|700)-normal\.woff2$/],
];
for (const [dir, re] of fonts) for (const f of fs.readdirSync(nm(dir))) if (re.test(f)) copy(path.join(nm(dir), f), out('fonts/' + f));
console.log('vendor files copied');
