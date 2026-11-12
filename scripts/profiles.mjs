import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
export const profileId = (root, directory) => createHash('sha256').update(`${process.platform === 'win32' ? root.toLowerCase() : root}\0${directory}`).digest('hex').slice(0, 24);
const parse = async file => JSON.parse(await readFile(file, 'utf8'));
export async function inventory(userDataPath) {
  if (!path.isAbsolute(userDataPath)) throw new Error('userDataPath mutlak olmalı.');
  const root = await realpath(userDataPath);
  const state = await parse(path.join(root, 'Local State'));
  const dirs = await readdir(root, { withFileTypes: true });
  const profiles = [];
  for (const dir of dirs.filter(d => d.isDirectory() && /^(Default|Profile \d+)$/.test(d.name))) {
    const profilePath = await realpath(path.join(root, dir.name));
    if (path.dirname(profilePath) !== root) continue;
    try {
      const prefs = await parse(path.join(profilePath, 'Preferences'));
      const cache = state.profile?.info_cache?.[dir.name] || {};
      const accounts = (prefs.account_info || []).map(a => ({ email: a.email || null, name: a.full_name || null }));
      const cachedEmail = String(cache.user_name || '').trim().toLowerCase();
      const emails = [...new Set(accounts.map(a => String(a.email || '').trim().toLowerCase()).filter(Boolean))];
      const child = [prefs.profile?.managed_user_id, cache.managed_user_id].includes('ChildAccountSUID') ||
        [...(prefs.account_info || []), cache].some(a => [true, 1].includes(a.is_supervised_child) || [true, 1].includes(a.is_child_account));
      const conflict = !!cachedEmail && emails.length > 0 && !emails.includes(cachedEmail);
      const email = conflict ? null : cachedEmail || (emails.length === 1 ? emails[0] : null);
      profiles.push({ profileId: profileId(root, dir.name), userDataPath: root, directory: dir.name, profilePath,
        name: prefs.profile?.name || cache.name || dir.name, email, accounts, restricted: child,
        identityStatus: conflict ? 'conflict' : email ? 'available' : emails.length > 1 ? 'ambiguous_account' : 'missing' });
    } catch { profiles.push({ profileId: profileId(root, dir.name), directory: dir.name, userDataPath: root, restricted: true, identityStatus: 'unreadable' }); }
  }
  return profiles;
}
export function resolveProfile(profiles, { profileId: id, email }) {
  if (!id && !email) throw new Error('profileId veya email gerekli.');
  const found = profiles.filter(p => (!id || p.profileId === id) && (!email || p.email === email.trim().toLowerCase()));
  if (found.length !== 1) throw new Error(found.length ? `ambiguous_email: ${found.map(p => p.profileId).join(', ')}` : 'profile_not_found');
  if (found[0].restricted) throw new Error('profile_restricted');
  return found[0];
}
export async function launchProfile({ chromePath, extensionId, profile, url = 'about:blank', apply = false, sessionId = crypto.randomUUID() }) {
  if (!path.isAbsolute(chromePath)) throw new Error('chromePath mutlak olmalı.');
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Geçersiz extensionId.');
  if (!/^(Default|Profile \d+)$/.test(profile.directory) || profile.restricted) throw new Error('profile_restricted');
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol) && url !== 'about:blank') throw new Error('Yalnızca HTTP(S) veya about:blank başlangıç adresleri desteklenir.');
  const marker = new URL(`chrome-extension://${extensionId}/harness.html`);
  marker.search = new URLSearchParams({ run: sessionId, at: String(Math.floor(Date.now() / 1000)), via: 'remote-mesh-node', profileId: profile.profileId, label: profile.name || profile.directory }).toString();
  const args = [`--user-data-dir=${profile.userDataPath}`, `--profile-directory=${profile.directory}`, '--new-window', marker.href, url];
  const result = { sessionId, profileId: profile.profileId, directory: profile.directory, applied: apply,
    state: apply ? 'launch_requested' : 'preview', profileIdentityVerified: false };
  if (!apply) return result;
  await new Promise((resolve, reject) => {
    const child = spawn(chromePath, args, { shell: false, detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  // A launcher PID is never treated as ownership of Chrome's shared process.
  return result;
}
