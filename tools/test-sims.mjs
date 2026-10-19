// Runs every tools/sims/*.test.mjs against the pure simulation logic (AC.sims)
// defined in docs/assets/widgets/*.js. Widget files must not touch the DOM at load.
// Usage: node tools/test-sims.mjs [name ...]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const widgetDir = path.join(root, 'docs/assets/widgets');
const testDir = path.join(root, 'tools/sims');

// Same realm as the tests, so deepEqual compares plain arrays and objects without prototype mismatches.
globalThis.window = globalThis;
// A broken widget file must not block other authors' tests: report it and carry on.
const loadErrors = {};
for (const f of fs.readdirSync(widgetDir).filter((f) => f.endsWith('.js')).sort()) {
  try {
    vm.runInThisContext(fs.readFileSync(path.join(widgetDir, f), 'utf8'), { filename: f });
  } catch (err) {
    loadErrors[f.replace(/\.js$/, '')] = err;
    console.log(`LOAD ERROR ${f}: ${err.message}`);
  }
}
const sims = globalThis.AC && globalThis.AC.sims ? globalThis.AC.sims : {};

const only = process.argv.slice(2);
const tests = fs.existsSync(testDir)
  ? fs.readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).sort()
  : [];
let failed = 0;
for (const f of tests) {
  const name = f.replace('.test.mjs', '');
  if (only.length && !only.includes(name)) continue;
  try {
    const mod = await import(pathToFileURL(path.join(testDir, f)).href);
    if (!sims[name]) throw new Error(`AC.sims['${name}'] is not defined`);
    await mod.default(sims, assert);
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')}`);
  }
}
const relevantLoadErrors = Object.keys(loadErrors).filter((n) => !only.length || only.includes(n));
failed += relevantLoadErrors.length;
console.log(`\n${tests.length - failed}/${tests.length} sim test file(s) passed` + (relevantLoadErrors.length ? `, ${relevantLoadErrors.length} widget file(s) failed to load` : ''));
process.exit(failed ? 1 : 0);
