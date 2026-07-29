const test = require('node:test')
const assert = require('node:assert/strict')
const { createTask } = require('../scheduler')

test('lifecycle and maximum executions are explicit', async () => {
  let calls = 0
  const task = createTask('* * * * *', () => { calls += 1 }, { name: 'limited', maxExecutions: 1 })
  assert.equal(task.getStatus(), 'stopped')
  assert.equal(await task.execute(), undefined)
  assert.equal(calls, 1)
  assert.equal(task.getStatus(), 'destroyed')
  assert.equal(await task.execute(), false)
})

test('noOverlap skips concurrent manual execution', async () => {
  let release
  const waiting = new Promise((resolve) => { release = resolve })
  const task = createTask('* * * * *', async () => waiting, { noOverlap: true })
  const first = task.execute()
  assert.equal(await task.execute(), false)
  release()
  assert.equal(await first, undefined)
})

test('task exposes the native timezone-aware next run', () => {
  const task = createTask('30 1 * * *', () => {}, { timezone: 'America/New_York', dstPolicy: 'wallClockTwice' })
  task.start()
  assert.ok(task.getNextRun() instanceof Date)
  task.destroy()
})
