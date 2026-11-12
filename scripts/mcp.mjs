import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { RemoteMeshClient } from './client.mjs';
const client = new RemoteMeshClient();
const server = new McpServer({ name: 'remote-mesh', version: '0.1.0' });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError: value?.ok === false });
const safe = fn => async args => {
  try { return result(await fn(args)); }
  catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
};
server.registerTool('remote_mesh_nodes', { description: 'Profil envanteri ve Chrome başlatma servisi çalışan Windows/Linux makinelerini listele.', inputSchema: {}, annotations: { readOnlyHint: true } }, safe(() => client.list(1500, true)));
server.registerTool('remote_mesh_disk_profiles', { description: 'Seçilen makinede izin verilmiş Chrome User Data köklerini tara; kapalı profiller dahil profil kimliği ve hesap metadata listesi. Oturum/parola/çerez içeriğini okumaz.', inputSchema: { node_id: z.string() }, annotations: { readOnlyHint: true } }, safe(({ node_id }) => client.nodeRequest(node_id, 'profiles')));
server.registerTool('remote_mesh_launch_profile', {
  description: 'Makinedeki Chrome profilini profile_id veya tekil maille seçip yeni pencerede mevcut oturumuyla aç. apply:false önizleme; apply:true kullanıcı yetkisiyle açar. Chrome veya siteye yeniden giriş yapmaz. Başlatma sonucu kimlik doğrulaması sayılmaz; dönen sessionId ile remote_mesh_profiles launch.run eşleşmesini doğrula. Aynı request_id yeniden başlatmaz.',
  inputSchema: { node_id: z.string(), profile_id: z.string().optional(), email: z.string().optional(), url: z.string().optional(), apply: z.boolean().default(false), request_id: z.string() },
  annotations: { destructiveHint: false, openWorldHint: true },
}, safe(({ node_id, profile_id, request_id, ...args }) => client.nodeRequest(node_id, 'launch', { ...args, profileId: profile_id, requestId: request_id })));
server.registerTool('remote_mesh_script', {
  description: 'Belirli profil ve sekmede kullanıcının yetkilendirdiği JavaScript kodunu userScripts üzerinden çalıştır (Chrome 135+, kullanıcı script izni). DOM ve sayfa davranışını değiştirebilir. Ham dönüş değeri ağ üzerinden gönderilmez; yalnızca yürütme sonucu döner.',
  inputSchema: { inst: z.string(), id: z.string(), tab_id: z.number().int(), code: z.string().min(1).max(100000), world: z.enum(['USER_SCRIPT', 'MAIN']).default('USER_SCRIPT') },
  annotations: { destructiveHint: true, openWorldHint: true },
}, safe(({ inst, id, tab_id, code, world }) => client.command(inst, { id, steps: [{ v: 'script', tab: { tabId: tab_id }, code, world }] })));
server.registerTool('remote_mesh_profiles', { description: 'NATS üzerinden çevrimiçi Chrome profillerini ve kesin profil kimliklerini listele.', inputSchema: { wait_ms: z.number().min(100).max(10000).optional() }, annotations: { readOnlyHint: true } },
  safe(({ wait_ms }) => client.list(wait_ms)));
server.registerTool('remote_mesh_info', { description: 'Belirli Chrome profilinin pencere, sekme ve çalışan komut bilgisini al.', inputSchema: { inst: z.string() }, annotations: { readOnlyHint: true } },
  safe(({ inst }) => client.request(inst, 'info')));
server.registerTool('remote_mesh_command', {
  description: 'Kesin inst kimliğiyle tarayıcı adımlarını çalıştır. v: version, whoami, openWindow, close, openTab, closeTab, navigate, waitFor, click, fill, assert, query, relay, move, swap, clear, setStore, activate, hub, key, inject, captcha, sleep, reload. DOM hedefi: tab:{url:"https://example.com/*"} veya tab:{tabId:123}, sel:"CSS". fill için literal kullan. secret/put yerel secret store gerektirir ve bu sürümde kapalıdır. Aynı id tekrar çalıştırılmaz (son 100 komut); timeout sonucunda aynı id ile sorgula. Gönderim/silme gibi işlemler için kullanıcının açık yetkisini al.',
  inputSchema: { inst: z.string(), id: z.string().optional(), steps: z.array(z.record(z.string(), z.unknown())).min(1).max(200), dnd: z.boolean().optional(), follow: z.boolean().optional(), onError: z.enum(['halt', 'continue']).optional(), timeout_ms: z.number().min(1000).max(240000).optional() },
  annotations: { destructiveHint: true, openWorldHint: true },
}, safe(({ inst, timeout_ms, ...command }) => client.command(inst, command, timeout_ms)));
server.registerTool('remote_mesh_abort', { description: 'Yalnızca belirtilen id ile çalışan komutu adım sınırında durdur; cleanup adımları çalışır.', inputSchema: { inst: z.string(), id: z.string() }, annotations: { destructiveHint: false } },
  safe(({ inst, id }) => client.request(inst, 'abort', { id })));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void client.close().finally(() => process.exit(0)); });
await server.connect(new StdioServerTransport());
