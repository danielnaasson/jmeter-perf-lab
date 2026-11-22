// Stress test: runs tests/load.jmx in steps of more and more users, with no think
// time, and reports where the API starts to degrade (p95 above the limit) and
// where it starts refusing requests (503). It does not fail the build: the goal
// is to find the breaking point, not to pass.
//
// Usage: node scripts/stress.js [--steps=10,20,40,60,80] [--duration=30] [--p95=500]

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { readJtl, writeSummary } = require('./jtl');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const steps = option('steps', '10,20,40,60,80').split(',').map(Number);
const duration = Number(option('duration', 30));
const maxP95 = Number(option('p95', 500));

const results = [];
const problems = [];
for (const users of steps) {
  const out = `stress-${users}`;
  console.log(`\n=== Step: ${users} users for ${duration}s ===`);
  const run = spawnSync(process.execPath, [
    path.join(__dirname, 'run-jmeter.js'), 'tests/load.jmx', `--out=${out}`,
    `-Jusers=${users}`, `-Jrampup=${Math.min(users, 10)}`, `-Jduration=${duration}`, '-Jthink=0',
  ], { stdio: 'inherit' });

  // A failed step is reported, not fatal: the samples may still be in the .jtl
  // (for example when only the HTML dashboard failed), and the next steps still run.
  if (run.status !== 0) {
    const log = path.join('results', out, 'jmeter.log');
    const tail = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => /ERROR|WARN|Exception|Caused by/.test(l)).slice(-15).join('\n') : 'no jmeter.log';
    problems.push({ users, status: run.status, tail });
  }

  const jtlFile = path.join('results', out, `${out}.jtl`);
  let stats;
  try {
    stats = readJtl(jtlFile);
  } catch (err) {
    problems.push({ users, status: 'no results', tail: err.message });
    continue;
  }
  const total = stats.find((s) => s.label === 'TOTAL');
  results.push({
    users,
    samples: total.samples,
    avg: total.avg,
    p95: total.p95,
    errorRate: total.errorRate,
    refused: total.codes['503'] || 0,
    throughput: total.throughput,
  });
}

const degraded = results.find((r) => r.p95 > maxP95);
const refusing = results.find((r) => r.refused > 0);
const verdict = [
  degraded ? `p95 went above ${maxP95} ms at **${degraded.users} users**.` : `p95 stayed under ${maxP95} ms up to ${results.length ? results.at(-1).users : 0} users.`,
  refusing ? `The API started refusing requests (503) at **${refusing.users} users**.` : `No 503 up to ${results.length ? results.at(-1).users : 0} users.`,
].join(' ');

console.log('\nStress steps');
console.table(results.map((r) => ({
  users: r.users,
  samples: r.samples,
  'avg (ms)': r.avg,
  'p95 (ms)': r.p95,
  'errors (%)': r.errorRate.toFixed(2),
  '503s': r.refused,
  'req/s': r.throughput.toFixed(1),
})));
console.log(verdict.replace(/\*\*/g, ''));

fs.mkdirSync('results', { recursive: true });
fs.writeFileSync(path.join('results', 'stress-steps.json'), JSON.stringify({ duration, maxP95, results }, null, 2));

writeSummary([
  '### 📈 Stress test (steps, no think time)',
  `Each step runs \`tests/load.jmx\` for ${duration}s.`,
  '',
  '| Users | Samples | Avg (ms) | p95 (ms) | Errors (%) | 503s | req/s |',
  '|--:|--:|--:|--:|--:|--:|--:|',
  ...results.map((r) => `| ${r.users} | ${r.samples} | ${r.avg} | ${r.p95} | ${r.errorRate.toFixed(2)} | ${r.refused} | ${r.throughput.toFixed(1)} |`),
  '',
  verdict,
  '',
  ...problems.map((p) => [`#### ⚠️ Step with ${p.users} users exited with ${p.status}`, '```', p.tail, '```', ''].join('\n')),
].join('\n'));

for (const p of problems) console.error(`\nStep with ${p.users} users exited with ${p.status}:\n${p.tail}`);
// Fail only when a step produced no results at all.
process.exit(problems.some((p) => p.status === 'no results') ? 1 : 0);
