# JMeter Performance Lab

[![performance](https://github.com/danielnaasson/jmeter-perf-lab/actions/workflows/performance.yml/badge.svg)](https://github.com/danielnaasson/jmeter-perf-lab/actions/workflows/performance.yml)

Performance tests written in **Apache JMeter** against a small shop API. The API slows down on purpose under load, so the tests have a real breaking point to find. Every push runs smoke, load and stress tests in GitHub Actions and publishes the results in the run summary.

## Results

See [FINDINGS.md](FINDINGS.md): where the API starts to degrade, where it starts refusing requests, and the numbers from the CI run.

## The three tests

| Test | Plan | What it answers | Gate |
|---|---|---|---|
| **Smoke** | `tests/smoke.jmx` | Does the main flow work? One user: health, login, product list, order, plus a product detail and three negative cases (wrong password → 401, unknown product → 404, quantity 50 → 400). | p95 ≤ 500 ms, 0 errors |
| **Load** | `tests/load.jmx` | Does it hold the expected traffic? 20 users for 2 minutes, 500 ms think time. | p95 ≤ 500 ms, errors ≤ 1% |
| **Stress** | `tests/load.jmx` via `scripts/stress.js` | Where does it break? Steps of 10, 20, 40, 60 and 80 users with no think time, 30 s each. | None: it reports the breaking point |

## How the plans are built

- **HTTP Request Defaults** keep host and port in one place, overridable with `-Jhost` and `-Jport`.
- **Properties** (`${__P(users,20)}`) make one plan serve load and stress: the same file runs with different `-J` values.
- **CSV Data Set Config** gives each virtual user a different account from `data/users.csv`.
- **JSON Extractor** takes the token from the login response; a **Header Manager** sends it as `Bearer` on the order.
- **Transaction Controller** groups login + list + order as one business action, `Buy`, so the report shows how long a purchase takes, not only each request.
- **Assertion scope**: the Duration Assertion and the "No server error" assertion sit at thread-group level, so they apply to every request below them. Assertions inside a request apply to that request only.
- **Negative tests** use *Ignore Status* on the Response Assertion. Without it JMeter marks a 401 as an error even when 401 is the expected answer.

## Why there is a gate script

JMeter exits with code 0 even when every request fails, so CI cannot rely on it. `scripts/check-thresholds.js` reads the `.jtl` results, computes p95 and error rate per request and overall, and fails the build when a limit is crossed. Transaction rows are left out of the total so requests are not counted twice.

## Project layout

| Path | What it is |
|---|---|
| `api/server.js` | System under test: login, products and orders, no dependencies. Above `CAPACITY` concurrent requests every extra request adds latency; above `HARD_LIMIT` it answers `503`. |
| `tests/smoke.jmx` | Functional checks with one user. |
| `tests/load.jmx` | Many users buying for a fixed duration. |
| `scripts/run-jmeter.js` | Runs a plan in non-GUI mode and builds the HTML dashboard. |
| `scripts/check-thresholds.js` | Pass/fail gate. |
| `scripts/stress.js` | Runs the load plan in steps and reports the breaking point. |
| `scripts/jtl.js` | Reads JMeter results and computes the numbers. |
| `.github/workflows/performance.yml` | CI: starts the API, runs the three tests, uploads the HTML reports. |

## Run it locally

Requirements: Node 18+, Java 17+ and JMeter 5.6+ (`jmeter` on the PATH or `JMETER_HOME` set).

```powershell
# terminal 1
npm run api

# terminal 2
npm run smoke
npm run check:smoke
npm run load
npm run check:load
npm run stress
```

HTML dashboards are written to `results/<test>/report/index.html`. In CI they are uploaded as the `jmeter-reports` artifact.

## API knobs

| Variable | Default | Effect |
|---|---|---|
| `LATENCY_MS` | 20 | Base latency of every request |
| `CAPACITY` | 10 | Concurrent requests served at full speed |
| `PENALTY_MS` | 15 | Extra latency per request above capacity |
| `HARD_LIMIT` | 60 | Above this many concurrent requests the API answers 503 |
