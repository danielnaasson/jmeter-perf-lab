// Runs a JMeter plan in non-GUI mode and builds the HTML dashboard.
// Usage: node scripts/run-jmeter.js tests/smoke.jmx [--out=name] [-Jusers=10 -Jloops=5 ...]
//   --out   results folder name under results/ (default: the plan name)
// Finds JMeter through JMETER_HOME, or falls back to `jmeter` on the PATH.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cli = process.argv.slice(2);
const outArg = cli.find((a) => a.startsWith('--out='));
const [plan, ...jmeterArgs] = cli.filter((a) => a !== outArg);
if (!plan) {
  console.error('Usage: node scripts/run-jmeter.js <plan.jmx> [-Jname=value ...]');
  process.exit(2);
}

const name = outArg ? outArg.slice('--out='.length) : path.basename(plan, '.jmx');
const resultsDir = path.join('results', name);
const jtl = path.join(resultsDir, `${name}.jtl`);
const report = path.join(resultsDir, 'report');

// JMeter refuses to write the dashboard into a folder that is not empty.
fs.rmSync(resultsDir, { recursive: true, force: true });
fs.mkdirSync(resultsDir, { recursive: true });

const isWindows = process.platform === 'win32';
const exe = process.env.JMETER_HOME
  ? path.join(process.env.JMETER_HOME, 'bin', isWindows ? 'jmeter.bat' : 'jmeter')
  : isWindows ? 'jmeter.bat' : 'jmeter';

const args = ['-n', '-t', plan, '-l', jtl, '-e', '-o', report, '-j', path.join(resultsDir, 'jmeter.log'), ...jmeterArgs];
console.log(`> ${exe} ${args.join(' ')}`);

const run = spawnSync(exe, args, { stdio: 'inherit', shell: isWindows });
if (run.error || run.status !== 0) {
  console.error(`\nJMeter exited with ${run.error ? run.error.message : `code ${run.status}`}.`);
  const log = path.join(resultsDir, 'jmeter.log');
  if (fs.existsSync(log)) {
    console.error(`Last lines of ${log}:`);
    console.error(fs.readFileSync(log, 'utf8').split('\n').slice(-40).join('\n'));
  } else {
    console.error('No jmeter.log was written. Is Java installed and is JMeter on the PATH (or JMETER_HOME set)?');
  }
  process.exit(run.status || 1);
}
console.log(`\nResults: ${jtl}\nReport:  ${path.join(report, 'index.html')}`);
