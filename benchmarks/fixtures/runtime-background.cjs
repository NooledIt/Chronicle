'use strict'

module.exports.task = async function runtimeBackgroundTask(context) {
  return {
    pid: process.pid,
    receivedAt: Date.now(),
    executionId: context.execution?.id,
  }
}
