import { createRequire } from 'node:module';
import path from 'node:path';
import { ensurePtyHelpersExecutable } from '../src/tooling/stripPackagedNatives.mjs';

// 不再为 Electron 重编 node-pty 后直接用它的 prebuilds，本地开发同样需要可执行的 spawn-helper
const root = path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
ensurePtyHelpersExecutable(path.join(root, 'prebuilds'));
