const test = require('node:test')
const assert = require('node:assert/strict')
const cron = require('..')

test('exposes the common node-cron inline API from the package root', async () => {
  for (const name of ['schedule', 'createTask', 'validate', 'validateDetailed', 'parse', 'getTasks', 'getTask', 'shutdown']) {
    assert.equal(typeof cron[name], 'function', `${name} is exported`)
  }
  assert.equal(cron.validate('*/15 * * * *'), true)
  assert.equal(cron.validate('L * * * *'), false)
  assert.deepEqual(cron.parse('*/15 * * * *').minute, [0, 15, 30, 45])

  const task = cron.createTask('* * * * *', () => 'ok', { name: 'compatibility-check' })
  assert.equal(task.getStatus(), 'stopped')
  assert.equal(task.getNextRun(), null)
  task.start()
  assert.equal(task.getStatus(), 'idle')
  assert.ok(task.getNextRun() instanceof Date)
  assert.equal(cron.getTask(task.id), task)
  assert.equal(await task.execute(), 'ok')
  assert.equal(task.lastRun().result, 'ok')
  task.destroy()
  assert.equal(cron.getTask(task.id), undefined)
})

test('rejects unsupported distributed and background task modes explicitly', () => {
  assert.throws(() => cron.createTask('* * * * *', './worker.js'), /inline task functions only/)
  assert.throws(() => cron.createTask('* * * * *', () => {}, { distributed: true }), /Distributed coordination/)
})
