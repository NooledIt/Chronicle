const native = require('./index.js')
const scheduler = require('./scheduler.js')

const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 }
const WEEKDAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 }
const FIELDS = [
  ['second', 0, 59], ['minute', 0, 59], ['hour', 0, 23], ['dayOfMonth', 1, 31], ['month', 1, 12, MONTHS], ['dayOfWeek', 0, 7, WEEKDAYS],
]

function validate(expression) {
  if (typeof expression !== 'string') return false
  try { native.nextOccurrence(expression, '2026-01-01T00:00:00Z'); return true } catch { return false }
}

function parseToken(token, min, max, names) {
  const normalize = (value) => {
    const named = names?.[String(value).toLowerCase()]
    const parsed = named ?? Number(value)
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`invalid cron value: ${value}`)
    return max === 7 && parsed === 7 ? 0 : parsed
  }
  const result = new Set()
  for (const part of token.split(',')) {
    const [range, stepText] = part.split('/')
    if (part.split('/').length > 2) throw new Error(`invalid cron field: ${token}`)
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step <= 0) throw new Error(`invalid cron step: ${part}`)
    let start = min; let end = max
    if (range !== '*') {
      const bounds = range.split('-')
      if (bounds.length === 1) start = end = normalize(bounds[0])
      else if (bounds.length === 2) { start = normalize(bounds[0]); end = normalize(bounds[1]) }
      else throw new Error(`invalid cron range: ${range}`)
    }
    if (start > end) throw new Error(`inverted ranges are not supported: ${range}`)
    for (let value = start; value <= end; value += step) result.add(max === 7 && value === 7 ? 0 : value)
  }
  return [...result].sort((a, b) => a - b)
}

function parse(expression) {
  if (!validate(expression)) throw new Error(`invalid cron expression: ${expression}`)
  const raw = expression.trim().split(/\s+/)
  const values = raw.length === 5 ? ['0', ...raw] : raw
  return Object.fromEntries(FIELDS.map(([key, min, max, names], index) => [key, parseToken(values[index], min, max, names)]))
}

function validateDetailed(expression) {
  try { return { valid: true, errors: [], fields: parse(expression) } }
  catch (error) { return { valid: false, errors: [{ field: 'expression', value: expression, message: error.message }] } }
}

function solvePath(filePath) { return require('node:path').resolve(filePath) }

const api = {
  ...scheduler,
  validate,
  validateDetailed,
  parse,
  solvePath,
  nextOccurrence: native.nextOccurrence,
}

module.exports = { ...api, default: api, nodeCron: api }
