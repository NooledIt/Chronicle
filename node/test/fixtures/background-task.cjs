let calls = 0

module.exports = async function backgroundTask(context) {
  calls += 1
  return {
    calls,
    pid: process.pid,
    task: context.task,
    dateIsDate: context.date instanceof Date,
    triggeredAtIsDate: context.triggeredAt instanceof Date,
  }
}
