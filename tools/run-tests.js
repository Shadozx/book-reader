'use strict';
// Runs the autotest scenarios one after another and prints a summary:
//   npm test                      all scenarios
//   npm test -- search library    only these
//   npm test -- --lang en         with the English interface
// Logs and screenshots go to test-results/<scenario>/. The exit code is 1 if anything failed.
//
// A scenario made of several steps (an exported array) is run step by step: the app is closed
// after each step and started again on the same data, so a single scenario checks a restart.
// A scenario with packaged = true tests the built app (npm run dist) and is skipped without a build.

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const electron = require('electron');   // from Node this is the path to electron.exe

const ROOT = path.resolve(__dirname, '..');
const SCENARIO_DIR = path.join(__dirname, 'scenarios');
const OUT = path.join(ROOT, 'test-results');
const PACKAGED_APP = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar');
const TIMEOUT = 5 * 60 * 1000;   // per step

const args = process.argv.slice(2);
const langIndex = args.indexOf('--lang');
const lang = langIndex >= 0 ? args[langIndex + 1] : undefined;
const wanted = args.filter((a, i) => !a.startsWith('--') && (langIndex < 0 || i !== langIndex + 1));

const scenarios = fs.readdirSync(SCENARIO_DIR)
  .filter((f) => f.endsWith('.scenario.js'))
  .map((f) => {
    const scenario = require(path.join(SCENARIO_DIR, f));
    return {
      name: f.replace('.scenario.js', ''),
      file: path.join(SCENARIO_DIR, f),
      steps: Array.isArray(scenario) ? scenario.length : 1,
      packaged: scenario.packaged,
    };
  });

for (const name of wanted) {
  if (!scenarios.some((s) => s.name === name)) {
    console.error(`Unknown scenario "${name}". Available: ${scenarios.map((s) => s.name).join(', ')}`);
    process.exit(2);
  }
}
const plan = wanted.length ? scenarios.filter((s) => wanted.includes(s.name)) : scenarios;

// One step in its own Electron process; resolves with the exit status and the checks it reported
function runStep(scenario, step, outDir, log) {
  const env = { ...process.env };
  if (scenario.packaged) env.AUTOTEST_APP = PACKAGED_APP;
  if (lang) env.CHYTALKA_TEST_LANG = lang;

  return new Promise((resolve) => {
    const child = spawn(electron, [path.join(__dirname, 'autotest.js'), scenario.file, outDir, `--step=${step}`], { cwd: ROOT, env });
    const result = { passed: 0, total: 0, skipped: 0 };
    let buffer = '';
    const onData = (data) => {
      log.write(data);
      buffer += data;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        const text = line.replace(/^\[autotest\] /, '');
        const m = text.match(/^RESULT (\d+)\/(\d+) passed(?:, (\d+) skipped)?/);
        if (m) Object.assign(result, { passed: Number(m[1]), total: Number(m[2]), skipped: Number(m[3] ?? 0) });
        else if (/^(OK |FAIL|SKIP|SCENARIO ERROR|APP LOAD ERROR|TIMEOUT|RENDERER CRASH)/.test(text)) console.log('   ' + text);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      console.log(`   TIMEOUT: stopped after ${TIMEOUT / 60000} min`);
      child.kill();
    }, TIMEOUT);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, ...result });
    });
  });
}

async function run(scenario) {
  const outDir = path.join(OUT, scenario.name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const log = fs.createWriteStream(path.join(outDir, `${scenario.name}.log`));
  const start = Date.now();
  const total = { ok: true, passed: 0, total: 0, skipped: 0 };
  for (let step = 0; step < scenario.steps; step++) {
    if (step > 0) console.log('   — restart —');
    const r = await runStep(scenario, step, outDir, log);
    total.ok &&= r.ok;
    total.passed += r.passed;
    total.total += r.total;
    total.skipped += r.skipped;
  }
  log.end();
  return { ...total, seconds: Math.round((Date.now() - start) / 1000) };
}

async function main() {
  const summary = [];
  for (const scenario of plan) {
    if (scenario.packaged && !fs.existsSync(PACKAGED_APP)) {
      console.log(`\n▸ ${scenario.name}: skipped (no build; run npm run dist first)`);
      summary.push({ name: scenario.name, status: 'skipped' });
      continue;
    }
    console.log(`\n▸ ${scenario.name}`);
    const r = await run(scenario);
    const counts = `${r.passed}/${r.total}${r.skipped ? ` (+${r.skipped} skipped)` : ''}`;
    summary.push({ name: scenario.name, status: r.ok ? 'passed' : 'FAILED', counts, seconds: r.seconds });
  }

  console.log('\nScenario'.padEnd(26) + 'Result'.padEnd(10) + 'Checks'.padEnd(22) + 'Time');
  for (const s of summary) {
    console.log(s.name.padEnd(25) + s.status.padEnd(10) + (s.counts ?? '').padEnd(22) + (s.seconds != null ? `${s.seconds} s` : ''));
  }
  const failed = summary.filter((s) => s.status === 'FAILED');
  console.log(failed.length ? `\n${failed.length} scenario(s) failed: ${failed.map((s) => s.name).join(', ')}` : '\nAll scenarios passed.');
  console.log(`Logs and screenshots: ${path.relative(ROOT, OUT)}${path.sep}`);
  process.exitCode = failed.length ? 1 : 0;
}

main();
