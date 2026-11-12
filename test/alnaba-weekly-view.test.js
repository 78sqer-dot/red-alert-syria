import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = fs.readFileSync(path.join(ROOT, 'public/js/alnaba.js'), 'utf8');
const router = fs.readFileSync(path.join(ROOT, 'server/alnaba.js'), 'utf8');
const reader = fs.readFileSync(path.join(ROOT, 'public/js/alnaba-pdf.js'), 'utf8');

test('weekly newspaper uses an in-page canvas reader and keeps direct open and download options', () => {
  assert.match(script, /const previewId = `weekly-pdf-\$\{item\.id\}`;/);
  assert.match(script, /href="#\$\{previewId\}" aria-controls="\$\{previewId\}" data-pdf-open/);
  assert.match(script, /class="an-pdf-reader" id="\$\{previewId\}" data-pdf-reader data-src="\$\{src\}"/);
  assert.match(script, /data-pdf-canvas-wrap><canvas data-pdf-canvas dir="ltr"><\/canvas>/);
  assert.match(reader, /context\.direction = 'ltr'/);
  assert.match(reader, /context\.textAlign = 'left'/);
  assert.match(script, /data-pdf-open>فتح PDF للقراءة/);
  assert.match(script, /href="\$\{src\}" target="_blank" rel="noopener noreferrer">الملف الأصلي/);
  assert.match(script, /href="\$\{src\}" download>تنزيل PDF/);
  assert.doesNotMatch(script, /<iframe src="\$\{src\}/);
});

test('weekly page initializes the local PDF.js reader only for weekly items with lazy loading', () => {
  assert.match(script, /await import\('\/js\/alnaba-pdf\.js\?v=2'\)/);
  assert.match(script, /initializePdfReaders\(view\.list\)/);
  assert.match(reader, /pdfjs\.getDocument\(\{/);
  assert.match(reader, /rangeChunkSize: 512 \* 1024/);
  assert.match(reader, /new IntersectionObserver/);
  assert.match(reader, /PDFJS_URL = '\/vendor\/pdfjs-legacy-4\.10\.38\.min\.mjs'/);
  assert.match(reader, /PDFJS_WORKER_URL = '\/vendor\/pdfjs-legacy-worker-4\.10\.38\.min\.mjs'/);
  assert.match(reader, /MAX_CANVAS_PIXELS = 6_000_000/);
  assert.match(reader, /MAX_ZOOM = 4/);
  assert.match(script, /data-pdf-retry hidden/);
  assert.match(reader, /retry\.hidden = false/);
  assert.match(reader, /width === state\.lastWidth/);
  assert.match(reader, /state\.needsResize = true/);
  assert.match(script, /اضغط \+ ثم اسحب الصفحة/);
  assert.ok(fs.existsSync(path.join(ROOT, 'public/vendor/pdfjs-legacy-4.10.38.min.mjs')));
  assert.ok(fs.existsSync(path.join(ROOT, 'public/vendor/pdfjs-legacy-worker-4.10.38.min.mjs')));
  assert.ok(fs.existsSync(path.join(ROOT, 'public/vendor/pdfjs-LICENSE.txt')));
  assert.match(reader, /data-pdf-next/);
  assert.match(reader, /data-pdf-zoom-in/);
});

test('PDF media response remains inline and supports byte ranges for reading', () => {
  assert.match(router, /res\.setHeader\('Content-Type', item\.mime_type\);[\s\S]*?res\.setHeader\('Content-Disposition', `inline;/, 'the PDF route serves files inline for the embedded viewer');
  assert.match(router, /res\.setHeader\('Accept-Ranges', 'bytes'\)/);
  assert.match(router, /res\.setHeader\('Content-Range', `bytes \$\{range\.start\}-\$\{range\.end\}\/\$\{buffer\.length\}`\)/);
});
