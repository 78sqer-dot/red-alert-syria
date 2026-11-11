import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = fs.readFileSync(path.join(ROOT, 'public/js/alnaba.js'), 'utf8');
const router = fs.readFileSync(path.join(ROOT, 'server/alnaba.js'), 'utf8');

test('weekly newspaper primary action opens its in-page PDF preview and download remains separate', () => {
  assert.match(script, /const previewId = `weekly-pdf-\$\{item\.id\}`;/);
  assert.match(script, /href="#\$\{previewId\}" aria-controls="\$\{previewId\}"/);
  assert.match(script, /class="an-pdf-frame" id="\$\{previewId\}" tabindex="-1"><iframe src="\$\{src\}#toolbar=1&navpanes=0"[^>]*loading="lazy"/);
  assert.match(script, /href="\$\{src\}" download>تنزيل PDF/);
  assert.doesNotMatch(script, /href="\$\{src\}" target="_blank" rel="noopener noreferrer">فتح الصحيفة/);
  assert.match(router, /res\.setHeader\('Content-Type', item\.mime_type\);[\s\S]*?res\.setHeader\('Content-Disposition', `inline;/, 'the PDF route serves files inline for the embedded viewer');
});
