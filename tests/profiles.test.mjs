import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inventory, resolveProfile, launchProfile } from '../scripts/profiles.mjs';
test('disk identity, duplicate mail, restricted profile and cross-platform launch preview', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mesh-profiles-'));
  try {
    await writeFile(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: {} } }));
    for (const [directory, child] of [['Default', false], ['Profile 1', false], ['Profile 2', true]]) {
      await mkdir(path.join(root, directory));
      await writeFile(path.join(root, directory, 'Preferences'), JSON.stringify({ profile: { name: directory }, account_info: [{ email: 'same@example.com', is_supervised_child: child }] }));
    }
    const list = await inventory(root);
    assert.equal(list.length, 3);
    assert.equal(new Set(list.map(p => p.profileId)).size, 3);
    assert.throws(() => resolveProfile(list, { email: 'same@example.com' }), /ambiguous_email/);
    assert.throws(() => resolveProfile(list, { profileId: list[2].profileId }), /profile_restricted/);
    const p = resolveProfile(list, { profileId: list[0].profileId });
    const result = await launchProfile({ chromePath: path.join(root, 'chrome'), extensionId: 'a'.repeat(32), profile: p });
    assert.equal(result.state, 'preview');
    assert.equal(result.profileIdentityVerified, false);
    await assert.rejects(launchProfile({ chromePath: path.join(root, 'chrome'), extensionId: 'a'.repeat(32), profile: p, url: 'file:///etc/passwd' }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
