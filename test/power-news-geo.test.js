import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-power-geo-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = process.env.BOT_TOKEN || '123456:LOCAL_TEST';
process.env.OWNER_IDS = process.env.OWNER_IDS || '8270709633';
const { isPowerNews } = await import('../server/services.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

test('international power outages are not inferred to be all-Syria updates', () => {
  const kyiv = 'سلطات كييف: انقطاع الكهرباء في عدة أحياء بعد هجوم روسي';
  assert.equal(isPowerNews(kyiv).ok, false);
  assert.equal(isPowerNews(`${kyiv} وسبق أن أعلنت سوريا تقنيناً`).ok, false, 'a passing Syria mention cannot override an explicit foreign place');
});

test('power news requires a recognized Syrian governorate or explicit Syrian nationwide scope', () => {
  const local = isPowerNews('انقطاع الكهرباء في عدة أحياء في دمشق');
  assert.equal(local.ok, true);
  assert.ok(local.gov, 'a named governorate is retained');

  const nationwide = isPowerNews('انقطاع الكهرباء عن جميع المحافظات السورية');
  assert.deepEqual(nationwide, { ok: true, gov: null });

  assert.equal(isPowerNews('انقطاع الكهرباء في عدة أحياء').ok, false, 'missing location is not interpreted as Syria-wide');
});

test('security attacks on electrical infrastructure do not become service outage cards', () => {
  assert.equal(isPowerNews('قصف محطة الكهرباء في دمشق بعد اشتباكات').ok, false);
});
