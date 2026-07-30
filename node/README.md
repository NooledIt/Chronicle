# @nool/chronicle

Install Chronicle as a node-cron-compatible package for the supported inline
scheduling subset:

```bash
npm install @nool/chronicle
```

```js
const cron = require('@nool/chronicle')

const task = cron.schedule('*/5 * * * *', async () => {
  await refreshCache()
}, { timezone: 'UTC', noOverlap: true })

task.stop()
```

The package exports `schedule`, `createTask`, `validate`, `validateDetailed`,
`parse`, `getTask`, `getTasks`, and `shutdown`, along with Chronicle's
`nextOccurrence` extension. It supports node-cron's advanced calendar tokens,
wrapping ranges, isolated background module paths, and coordinator-backed
distributed execution. Jobs remain in-memory and require a caller-provided
coordinator for cross-process election.
