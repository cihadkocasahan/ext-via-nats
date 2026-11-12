import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
await build({ entryPoints: ['src/background.js'], outfile: 'extension/background.js',
  bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', sourcemap: false });
await copyFile('src/protocol.js', 'extension/protocol.js');
console.log('Unpacked extension: extension/');
