export async function task(context) {
  return { pid: process.pid, dateIsDate: context.date instanceof Date, format: 'esm' }
}
