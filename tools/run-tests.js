'use strict';
// Runs the autotest scenarios one after another and prints a summary:
//   npm test                      all scenarios
//   npm test -- search library    only these (plus the scenarios that continue them)
//   npm test -- --lang en         with the English interface
// Logs and screenshots go to test-results/<scenario>/. The exit code is 1 if anything failed.
//
// Scenario options (properties of the exported function):
//   continues = 'name'   runs right after that scenario, on the state it saved (a restart check)
//   packaged = true      tests the built app (npm run dist); skipped if there is no build

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const electron = require('electron');   // from Node this is the path to electron.exe

const ROOT = path.resolve(__dirname, '..');
const SCENARIO_DIR = path.join(__dirname, 'scenarios');
const OUT = path.join(ROOT, 'test-results');
const PACKAGED_APP = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar');
const TIMEOUT = 5 * 60 * 1000;

const args = process.argv.slice(2);
const langIndex = args.indexOf('--lang');
const lang = langIndex >= 0 ? args[langIndex + 1] : undefined;
const wanted = args.filter((a, i) => !a.startsWith('--') && (langIndex < 0 || i !== langIndex + 1));

const scenarios = fs.readdirSync(SCENARIO_DIR)
  .filter((f) => f.endsWith('.scenario.js'))
  .map((f) => {
    const options = require(path.join(SCENARIO_DIR, f));
    return { name: f.replace('.scenario.js', ''), file: path.join(SCENARIO_DIR, f), continues: options.continues, packaged: options.packaged };
  });
const byName = new Map(scenarios.map((s) => [s.name, s]));

for (const name of wanted) {
  if (!byName.has(name)) {
    console.error(`Unknown scenario "${name}". Available: ${scenarios.map((s) => s.name).join(', ')}`);
    process.exit(2);
  }
}

// Each main scenario is followed by the ones that continue it
const roots = scenarios.filter((s) => !s.continues)
  .filter((s) => !wanted.length || wanted.some((w) => w === s.name || byName.get(w).continues === s.name));
const plan = roots.flatMap((s) => [s, ...scenarios.filter((c) => c.continues === s.name)]);

function run(scenario) {
  const outDir = path.join(OUT, scenario.continues ?? scenario.name);
  if (!scenario.continues) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const env = { ...process.env };
  if (scenario.continues) env.AUTOTEST_KEEP_STATE = '1';
  if (scenario.packaged) env.AUTOTEST_APP = PACKAGED_APP;
  if (lang) env.CHYTALKA_TEST_LANG = lang;

  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(electron, [path.join(__dirname, 'autotest.js'), scenario.file, outDir], { cwd: ROOT, env });
    const log = fs.createWriteStream(path.join(outDir, `${scenario.name}.log`));
    let result = null;
    let buffer = '';
    const onData = (data) => {
      log.write(data);
      buffer += data;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        const text = line.replace(/^\[autotest\] /, '');
        const m = text.match(/^RESULT (\d+)\/(\d+)/);
        if (m) result = { passed: Number(m[1]), total: Number(m[2]) };
        else if (/^(OK |FAIL|SCENARIO ERROR|APP LOAD ERROR|TIMEOUT|RENDERER CRASH)/.test(text)) console.log('   ' + text);
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
      log.end();
      resolve({ ok: code === 0, result, seconds: Math.round((Date.now() - start) / 1000) });
    });
  });
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
    const counts = r.result ? `${r.result.passed}/${r.result.total}` : '';
    summary.push({ name: scenario.name, status: r.ok ? 'passed' : 'FAILED', counts, seconds: r.seconds });
  }

  console.log('\nScenario'.padEnd(26) + 'Result'.padEnd(10) + 'Checks'.padEnd(9) + 'Time');
  for (const s of summary) {
    console.log(s.name.padEnd(25) + s.status.padEnd(10) + (s.counts ?? '').padEnd(9) + (s.seconds != null ? `${s.seconds} s` : ''));
  }
  const failed = summary.filter((s) => s.status === 'FAILED');
  console.log(failed.length ? `\n${failed.length} scenario(s) failed: ${failed.map((s) => s.name).join(', ')}` : '\nAll scenarios passed.');
  console.log(`Logs and screenshots: ${path.relative(ROOT, OUT)}${path.sep}`);
  process.exitCode = failed.length ? 1 : 0;
}

main();
