const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const cron = require('../node/node_modules/node-cron')
const { nextOccurrence } = require('../node')

const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'shared-corpus.json'), 'utf8'))
const output = { node: process.version, cases: [], validation: [] }

for (const expression of corpus.valid) {
  const after = new Date()
  const task = cron.createTask(expression, () => {}, { timezone: 'UTC' })
  task.start()
  const incumbent = task.getNextRun()
  task.stop()
  const chronicle = nextOccurrence(expression, after.toISOString())
  const incumbentIso = incumbent.toISOString().replace('.000Z', 'Z')
  assert.equal(chronicle, incumbentIso, `next occurrence diverged for ${expression}`)
  output.cases.push({ expression, after: after.toISOString(), chronicle, nodeCron: incumbentIso, matched: true })
}

for (const expression of [...corpus.valid, ...corpus.invalid]) {
  let chronicleValid = true
  try { nextOccurrence(expression, '2026-01-01T00:00:00Z') } catch { chronicleValid = false }
  const nodeCronValid = cron.validate(expression)
  assert.equal(chronicleValid, nodeCronValid, `validation diverged for ${expression}`)
  output.validation.push({ expression, chronicleValid, nodeCronValid })
}

const fallbackAfter = '2026-11-01T05:30:00Z'
output.dstPolicyEvidence = {
  expression: '30 1 * * *',
  timezone: 'America/New_York',
  after: fallbackAfter,
  wallClockOnce: nextOccurrence('30 1 * * *', fallbackAfter, { timezone: 'America/New_York', dstPolicy: 'wallClockOnce' }),
  wallClockTwice: nextOccurrence('30 1 * * *', fallbackAfter, { timezone: 'America/New_York', dstPolicy: 'wallClockTwice' }),
  note: 'This is an explicit Chronicle policy comparison. node-cron is not called for this fixed historical instant because its public next-run API is clock-based rather than parameterized by an input instant.'
}

console.log(JSON.stringify(output, null, 2))
