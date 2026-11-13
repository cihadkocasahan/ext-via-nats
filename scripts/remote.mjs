import { readFile } from 'node:fs/promises';
import { ExtViaNatsClient } from './client.mjs';
const [action, inst, arg] = process.argv.slice(2);
const client = new ExtViaNatsClient();
try {
  let result;
  switch (action) {
    case 'list': result = await client.list(); break;
    case 'info': result = await client.request(inst, 'info'); break;
    case 'abort': result = await client.request(inst, 'abort', { id: arg }); break;
    case 'run': result = await client.command(inst, JSON.parse(await readFile(arg, 'utf8'))); break;
    default: throw new Error('Kullanım: npm run remote -- list | info <inst> | run <inst> <command.json> | abort <inst> <command-id>');
  }
  console.log(JSON.stringify(result, null, 2));
  if (result?.ok === false) process.exitCode = 1;
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await client.close(); }
