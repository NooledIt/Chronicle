const { performance } = require('node:perf_hooks')
const { nextOccurrence } = require('../node')

const iterations = 100_000
const expression = '*/15 * * * *'
const after = '2026-01-15T09:01:00Z'

for (let i = 0; i < 5_000; i += 1) nextOccurrence(expression, after)
const started = performance.now()
for (let i = 0; i < iterations; i += 1) nextOccurrence(expression, after)
const elapsedMs = performance.now() - started

console.log(JSON.stringify({
  operation: 'Chronicle Node API: parse and evaluate one UTC next occurrence',
  iterations,
  totalMs: Number(elapsedMs.toFixed(3)),
  meanMicroseconds: Number(((elapsedMs * 1000) / iterations).toFixed(3)),
}, null, 2))
