// Expand test files ourselves: Node 20 does not expand quoted shell globs, and
// relying on the shell to do it differs between Unix and Windows npm scripts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = fileURLToPath(new URL('../src/utils/', import.meta.url));
const files = fs.readdirSync(directory).filter(file => file.endsWith('.test.js')).sort()
  .map(file => path.join(directory, file));
if (!files.length) throw new Error('No frontend utility tests found');
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
