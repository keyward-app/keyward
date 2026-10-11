import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const file = process.argv[2] ?? fileURLToPath(new URL('../Cargo.lock', import.meta.url));
if (/^\s*name\s*=\s*"rbw"\s*$/m.test(fs.readFileSync(file, 'utf8'))) {
  console.error('FAIL: rbw must not return to the dependency graph');
  process.exitCode = 1;
} else {
  console.log('PASS: rbw is absent from Cargo.lock');
}
