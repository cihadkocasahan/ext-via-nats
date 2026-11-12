import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const name = 'remote-mesh-nats';
const action = process.argv[2];
const args = action === 'stop' ? ['stop', name] : action === 'start'
  ? ['run', '-d', '--rm', '--name', name, '-p', '127.0.0.1:18222:8222',
    '--mount', `type=bind,source=${fileURLToPath(new URL('../infra/nats-docker.conf', import.meta.url))},target=/etc/nats/nats.conf,readonly`,
    'nats:2.11.9-alpine', '-c', '/etc/nats/nats.conf'] : null;
if (!args) throw new Error('start veya stop gerekli');
const child = spawnSync('docker', args, { stdio: 'inherit', shell: false });
if (child.error) console.error(child.error.message);
process.exitCode = child.status ?? 1;
if (!process.exitCode && action === 'start') console.log('NATS WebSocket: ws://127.0.0.1:18222 (yerel test, kimlik doğrulama yok)');
