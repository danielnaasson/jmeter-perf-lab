// Reads a JMeter results file (.jtl saved as CSV) and computes the numbers
// the other scripts need: samples, average, p95, error rate and throughput.

const fs = require('node:fs');

// Minimal CSV parser that understands quoted fields (failure messages can contain commas).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

// Returns one entry per label plus a TOTAL entry, in the order labels first appear.
function readJtl(file) {
  if (!file || !fs.existsSync(file)) throw new Error(`Results file not found: ${file || '(none given)'}`);
  const [header, ...lines] = parseCsv(fs.readFileSync(file, 'utf8'));
  const col = (name) => {
    const index = header.indexOf(name);
    if (index === -1) throw new Error(`Column "${name}" not found. Save results as CSV with the default JMeter columns.`);
    return index;
  };
  const i = {
    time: col('timeStamp'),
    label: col('label'),
    elapsed: col('elapsed'),
    code: col('responseCode'),
    response: col('responseMessage'),
    success: col('success'),
    message: col('failureMessage'),
  };

  const groups = new Map();
  const add = (label, line) => {
    if (!groups.has(label)) groups.set(label, { label, elapsed: [], errors: 0, codes: {}, messages: new Set(), start: Infinity, end: 0 });
    const g = groups.get(label);
    const start = Number(line[i.time]);
    const elapsed = Number(line[i.elapsed]);
    g.elapsed.push(elapsed);
    g.start = Math.min(g.start, start);
    g.end = Math.max(g.end, start + elapsed);
    g.codes[line[i.code]] = (g.codes[line[i.code]] || 0) + 1;
    if (line[i.success] !== 'true') {
      g.errors++;
      if (line[i.message]) g.messages.add(line[i.message]);
    }
  };
  for (const line of lines) {
    add(line[i.label], line);
    // A Transaction Controller writes its own row that sums its children; leave it
    // out of TOTAL so the requests are not counted twice.
    const isTransaction = (line[i.response] || '').startsWith('Number of samples in transaction');
    if (!isTransaction) add('TOTAL', line);
  }
  if (groups.size === 0) throw new Error(`No samples in ${file}`);

  const total = groups.get('TOTAL');
  groups.delete('TOTAL');
  return [...groups.values(), total].map((g) => {
    const seconds = Math.max((g.end - g.start) / 1000, 0.001);
    return {
      label: g.label,
      samples: g.elapsed.length,
      avg: Math.round(g.elapsed.reduce((a, b) => a + b, 0) / g.elapsed.length),
      p95: percentile(g.elapsed, 95),
      max: Math.max(...g.elapsed),
      errorRate: (g.errors / g.elapsed.length) * 100,
      throughput: g.elapsed.length / seconds,
      codes: g.codes,
      messages: [...g.messages],
    };
  });
}

// Appends markdown to the GitHub Actions job summary when running in CI.
function writeSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

module.exports = { readJtl, writeSummary };
