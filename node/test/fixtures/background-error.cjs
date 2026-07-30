module.exports.task = async function failingBackgroundTask() {
  const error = new Error('background boom')
  error.code = 'BACKGROUND_BOOM'
  throw error
}
