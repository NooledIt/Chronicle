const test = require('node:test')
const assert = require('node:assert/strict')
const { nextOccurrence } = require('..')

test('returns a UTC occurrence', () => {
  assert.equal(nextOccurrence('0 9 * * *', '2026-01-15T08:59:00Z'), '2026-01-15T09:00:00Z')
})

test('makes fall-back policy explicit', () => {
  const input = '2026-11-01T05:30:00Z'
  assert.equal(
    nextOccurrence('30 1 * * *', input, { timezone: 'America/New_York', dstPolicy: 'wallClockOnce' }),
    '2026-11-02T06:30:00Z',
  )
  assert.equal(
    nextOccurrence('30 1 * * *', input, { timezone: 'America/New_York', dstPolicy: 'wallClockTwice' }),
    '2026-11-01T06:30:00Z',
  )
})

test('rejects invalid input descriptively', () => {
  assert.throws(() => nextOccurrence('61 * * * *', '2026-01-01T00:00:00Z'), /minute value 61/)
  assert.throws(() => nextOccurrence('* * * * *', 'not-a-date'), /invalid RFC 3339 timestamp/)
  assert.throws(() => nextOccurrence('* * * * *', '2026-01-01T00:00:00Z', { timezone: 'No/SuchZone' }), /unknown IANA timezone/)
})
