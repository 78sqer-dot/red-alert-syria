import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyArchiveUrl } from '../public/js/archive-copy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = fs.readFileSync(path.join(ROOT, 'public/js/alnaba.js'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'public/css/alnaba.css'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'server/alnaba-page.html'), 'utf8');
const URL = 'https://t.me/ras_fixture_archive_channel_01';

function legacyDocument(copyResult) {
  const fields = [];
  const documentObject = {
    body: { append(field) { fields.push(field); } },
    createElement(tag) {
      assert.equal(tag, 'textarea');
      return {
        style: {},
        value: '',
        setAttribute() {},
        focus() {},
        select() {},
        setSelectionRange() {},
        remove() { fields.splice(fields.indexOf(this), 1); },
      };
    },
    execCommand(command) {
      assert.equal(command, 'copy');
      return copyResult;
    },
  };
  return { documentObject, fields };
}

function selectionEnvironment() {
  const selection = {
    cleared: false,
    range: null,
    removeAllRanges() { this.cleared = true; },
    addRange(range) { this.range = range; },
  };
  const documentObject = {
    body: { append() {} },
    createElement() { return { style: {}, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {}, remove() {} }; },
    execCommand() { return false; },
    createRange() { return { selectNodeContents(target) { this.target = target; } }; },
  };
  return { documentObject, selection, windowObject: { getSelection: () => selection } };
}

test('desktop and Android copy buttons write the exact visible public HTTPS URL', async () => {
  for (const environment of ['desktop', 'Android mobile', 'Android desktop-site']) {
    let copied = '';
    const status = await copyArchiveUrl(URL, {
      navigatorObject: { userAgent: environment, clipboard: { async writeText(text) { copied = text; } } },
      documentObject: {},
    });
    assert.equal(status, 'copied', environment);
    assert.equal(copied, URL, environment);
  }
});

test('legacy copy fallback uses a temporary selectable field and removes it', async () => {
  const { documentObject, fields } = legacyDocument(true);
  const status = await copyArchiveUrl(URL, { navigatorObject: {}, documentObject });
  assert.equal(status, 'copied');
  assert.equal(fields.length, 0);
});

test('when clipboard and legacy copy fail, the visible URL is selected for manual copy', async () => {
  const { documentObject, selection, windowObject } = selectionEnvironment();
  const visibleLink = { textContent: URL };
  const status = await copyArchiveUrl(URL, {
    navigatorObject: { clipboard: { async writeText() { throw new Error('permission denied'); } } },
    documentObject,
    windowObject,
    selectionTarget: visibleLink,
  });
  assert.equal(status, 'select');
  assert.equal(selection.cleared, true);
  assert.equal(selection.range.target, visibleLink);
});

test('archive cards show the unchanged full HTTPS URL, keep it clickable, and provide a labeled copy button', () => {
  assert.match(frontend, /const url = String\(item\.url \|\| ''\)/);
  assert.match(frontend, /class="an-archive-url" href="\$\{safeUrl\}" dir="ltr"/);
  assert.match(frontend, /data-copy-archive-link="\$\{safeUrl\}"/);
  assert.match(frontend, /نسخ الرابط/);
  assert.match(frontend, /href="\$\{safeUrl\}" rel="noopener noreferrer"/);
  assert.doesNotMatch(frontend, /telegramArchiveOpenLink|intent:\/\//);
  assert.match(styles, /-webkit-user-select: text; -webkit-touch-callout: default;/);
  assert.match(frontend, /اضغط مطولاً على الرابط الظاهر واختر «نسخ»/);
  assert.match(page, /\/js\/alnaba\.js\?v=8/);
  assert.match(page, /\/css\/alnaba\.css\?v=6/);
});
