import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { RemoteMeshClient } from './client.mjs';
import { inventory, resolveProfile, launchProfile } from './profiles.mjs';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (!/^[a-zA-Z0-9_-]+$/.test(config.nodeId) || !Array.isArray(config.userDataPaths) || !config.userDataPaths.length) throw new Error('nodeId ve userDataPaths gerekli.');
const client = new RemoteMeshClient();
const ledgerPath = path.join(path.dirname(path.resolve(process.argv[2])), `${config.nodeId}.launches.json`);
let launches = {};
try { launches = JSON.parse(await readFile(ledgerPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const save = async () => {
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(`${ledgerPath}.tmp`, JSON.stringify(launches), { mode: 0o600 });
  await rename(`${ledgerPath}.tmp`, ledgerPath);
};
const nc = await client.connect();
const prefix = `${client.config.prefix}.node`;
const scan = async () => (await Promise.all(config.userDataPaths.map(inventory))).flat();
const info = () => ({ nodeId: config.nodeId, label: config.label, platform: process.platform });
let launching = false;
function listen(subject, fn) {
  nc.subscribe(subject, { callback: (_err, msg) => {
    if (!msg || !/^_INBOX\.[a-zA-Z0-9_.-]+$/.test(msg.reply || '')) return;
    void Promise.resolve().then(() => fn(msg.json())).then(data => msg.respond(JSON.stringify(data)))
      .catch(e => msg.respond(JSON.stringify({ ok: false, error: e.message })));
  } });
}
listen(`${prefix}.discover`, info);
listen(`${prefix}.profiles.${config.nodeId}`, async () => ({ ...info(), profiles: await scan() }));
listen(`${prefix}.launch.${config.nodeId}`, async args => {
  if (launching) throw new Error('node_busy');
  launching = true;
  try {
    if (!args.requestId || !/^[a-zA-Z0-9_-]{1,128}$/.test(args.requestId)) throw new Error('Kararlı requestId gerekli.');
    const fingerprint = createHash('sha256').update(JSON.stringify([args.profileId || null, args.email || null, args.url || 'about:blank'])).digest('hex');
    if (args.apply && Object.hasOwn(launches, args.requestId)) {
      if (launches[args.requestId].fingerprint !== fingerprint) throw new Error('id_conflict');
      return launches[args.requestId].result || { ok: false, code: 'interrupted', sessionId: args.requestId };
    }
    const profile = resolveProfile(await scan(), args);
    if (args.apply) { launches[args.requestId] = { fingerprint }; await save(); }
    const result = await launchProfile({ chromePath: config.chromePath, extensionId: config.extensionId, profile, url: args.url, apply: args.apply === true, sessionId: args.requestId });
    if (args.apply) { launches[args.requestId].result = result; await save(); }
    return result;
  } finally { launching = false; }
});
await nc.flush();
console.error(`Remote Mesh node ready: ${config.nodeId}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void client.close().finally(() => process.exit(0)); });
await nc.closed();
