# Findings

Numbers from the CI run [#4](https://github.com/danielnaasson/jmeter-perf-lab/actions/runs/45030711304) on a GitHub-hosted Ubuntu runner, with the API on its default settings (`CAPACITY=10`, `PENALTY_MS=15`, `HARD_LIMIT=60`). The runner shares its CPU with JMeter, so absolute numbers vary between runs; the shape of the curve is what matters.

## Summary

| Question | Answer |
|---|---|
| Does the main flow work? | Yes. Smoke: 8 checks, 0 errors. |
| Does it hold the expected traffic? | Yes. Load: 20 users for 2 minutes, 4,202 requests, p95 26 ms, 0 errors. |
| Where does it start to degrade? | **Around 60 concurrent users**, where p95 goes above 500 ms. |
| Where does it start refusing requests? | **At 80 concurrent users**, where 99.6% of requests get `503`. |

## Stress steps

Each step runs `tests/load.jmx` for 30 s with no think time, so every user fires requests back to back.

| Users | Samples | Avg (ms) | p95 (ms) | Errors | 503s | req/s |
|--:|--:|--:|--:|--:|--:|--:|
| 10 | 11,094 | 23 | 26 | 0% | 0 | 371 |
| 20 | 4,362 | 116 | 175 | 0% | 0 | 145 |
| 40 | 3,214 | 316 | 475 | 0% | 0 | 106 |
| 60 | 2,861 | 533 | 776 | 0% | 0 | 94 |
| 80 | 560,319 | 4 | 2 | 99.6% | 557,577 | 18,254 |

## What the numbers say

1. **More users, less throughput.** From 10 to 60 users the API served fewer requests per second (371 → 94), not more. Every request above the capacity of 10 makes all the others slower, so adding users only adds waiting. This is saturation: the system is already doing all it can.
2. **Degradation comes before errors.** At 60 users there were no errors at all, but p95 was 776 ms. A test that only checks for errors would call this a pass. That is why the gate checks p95 too.
3. **The 80-user step looks like the best result, and it is the worst.** Average 4 ms and 18,254 req/s look excellent, but 99.6% of those responses are `503`. The API is fast because it is refusing the work. Throughput and response time mean nothing without the error rate next to them.

## Recommendation

For this API, the safe operating limit is below 40 concurrent users (p95 under 500 ms with margin). Between 40 and 60 it still answers but slowly. Above 60 it refuses most requests. To serve more users it needs more capacity, not just a higher `HARD_LIMIT`, since the limit only decides when it starts refusing.

## A bug in the test tooling found on the way

The first three CI runs failed in the 80-user step. The cause was not the API or JMeter: `scripts/jtl.js` used `Math.max(...samples)`, and with more than about 100 thousand samples the spread throws `Maximum call stack size exceeded`. The fast `503` answers produced 560 thousand samples. Fixed by computing the maximum with `reduce`, and tested locally with a 300 thousand row file. The stress script now reports a failed step in the run summary instead of stopping, so the next problem shows up without digging through logs.
