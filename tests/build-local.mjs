// Builds the locally-servable test copy of the app: rewrites the pinned CDN
// import map to the npm-installed three@0.169.0 so tests run without network.
import { readFileSync, writeFileSync, copyFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

let html = readFileSync(join(repo, 'index.html'), 'utf8');
html = html
  .replaceAll('https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js',
    './vendor-three/build/three.module.js')
  .replaceAll('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/',
    './vendor-three/examples/jsm/');
writeFileSync(join(here, 'index.html'), html);
copyFileSync(join(repo, 'sw.js'), join(here, 'sw.js'));

const link = join(here, 'vendor-three');
if (existsSync(link)) rmSync(link, { recursive: false, force: true });
symlinkSync(join(here, 'node_modules', 'three'), link, 'junction');
console.log('test copy built: tests/index.html -> local three');
