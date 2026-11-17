import test from 'node:test';
import assert from 'node:assert/strict';

const primaryOwnerId = 8808894711;
const backupOwnerId = 8270709633;
const otherConfiguredOwnerId = 9900000001;
process.env.PRIMARY_OWNER_ID = String(primaryOwnerId);
process.env.OWNER_IDS = `${backupOwnerId},${otherConfiguredOwnerId}`;

const { config, isOwner, applyProject, automaticMonitorRecipientIds } = await import('../server/config.js?owner-allowlist-test');

test('configured primary is first and the saved project owner remains a full backup admin', () => {
  // Other IDs in OWNER_IDS are not promoted when a saved project owner currently takes precedence.
  applyProject({ ownerId: backupOwnerId });
  assert.deepEqual(config.ownerIds, [primaryOwnerId, backupOwnerId]);
  assert.equal(config.ownerIds[0], primaryOwnerId);
  assert.equal(isOwner(primaryOwnerId), true);
  assert.equal(isOwner(backupOwnerId), true);
  assert.equal(isOwner(otherConfiguredOwnerId), false);
  assert.equal(isOwner(1234567890), false);
});

test('when no project owner is saved, all existing environment owners remain available', () => {
  applyProject({});
  assert.deepEqual(config.ownerIds, [primaryOwnerId, backupOwnerId, otherConfiguredOwnerId]);
  assert.equal(isOwner(primaryOwnerId), true);
  assert.equal(isOwner(backupOwnerId), true);
  assert.equal(isOwner(otherConfiguredOwnerId), true);
});

test('the two shared owners remain full admins when a different project owner is saved', () => {
  applyProject({ ownerId: otherConfiguredOwnerId });
  assert.deepEqual(config.ownerIds, [primaryOwnerId, backupOwnerId, otherConfiguredOwnerId]);
  assert.equal(isOwner(primaryOwnerId), true);
  assert.equal(isOwner(backupOwnerId), true);
  assert.equal(isOwner(otherConfiguredOwnerId), true);
  assert.equal(isOwner(1234567890), false);
});

test('automatic-monitor notifications go to both shared IDs while both remain admins', () => {
  applyProject({ ownerId: primaryOwnerId });
  assert.deepEqual(automaticMonitorRecipientIds(), [8270709633, 8808894711]);
  assert.equal(isOwner(8270709633), true);
  assert.equal(isOwner(8808894711), true);
  assert.deepEqual(config.ownerIds, [primaryOwnerId, backupOwnerId]);
});

test('an explicit sole-owner handover can still revoke the previous owner list', () => {
  const nextOwnerId = 1234567890;
  applyProject({ ownerId: nextOwnerId }, { soleOwner: true });
  assert.deepEqual(config.ownerIds, [nextOwnerId]);
  assert.equal(isOwner(primaryOwnerId), false);
  assert.equal(isOwner(backupOwnerId), false);
});
