// Pass/fail gate for a JMeter run. JMeter itself always exits 0, even when every
// request failed, so CI needs something that reads the results and decides.
//
// Usage: node scripts/check-thresholds.js results/smoke/smoke.jtl --p95=500 --errors=1
//   --p95     max 95th percentile response time in ms, per label and overall
//   --errors  max error rate in percent, per label and overall

const { readJtl, writeSummary } = require('./jtl');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
};
const maxP95 = option('p95', 500);
const maxErrors = option('errors', 1);

let stats;
try {
  stats = readJtl(file);
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

const rows = stats.map((s) => ({ ...s, ok: s.p95 <= maxP95 && s.errorRate <= maxErrors }));
const failed = rows.some((r) => !r.ok);

console.log(`Thresholds: p95 <= ${maxP95} ms, errors <= ${maxErrors}%`);
console.table(rows.map((r) => ({
  label: r.label,
  samples: r.samples,
  'avg (ms)': r.avg,
  'p95 (ms)': r.p95,
  'errors (%)': r.errorRate.toFixed(2),
  'req/s': r.throughput.toFixed(1),
  result: r.ok ? 'PASS' : 'FAIL',
})));
for (const r of rows.filter((x) => x.label !== 'TOTAL')) for (const message of r.messages) console.log(`  ${r.label}: ${message}`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');

writeSummary([
  `### ${failed ? '❌' : '✅'} ${file}`,
  `Thresholds: p95 ≤ ${maxP95} ms, errors ≤ ${maxErrors}%`,
  '',
  '| Label | Samples | Avg (ms) | p95 (ms) | Errors (%) | req/s | Result |',
  '|---|--:|--:|--:|--:|--:|---|',
  ...rows.map((r) => `| ${r.label} | ${r.samples} | ${r.avg} | ${r.p95} | ${r.errorRate.toFixed(2)} | ${r.throughput.toFixed(1)} | ${r.ok ? 'PASS' : 'FAIL'} |`),
  '',
].join('\n'));

process.exit(failed ? 1 : 0);
