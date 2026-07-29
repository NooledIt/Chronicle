# @nooledit/chronicle

Install Chronicle as a node-cron-compatible package for the supported inline
scheduling subset:

```bash
npm install @nooledit/chronicle
```

```js
const cron = require('@nooledit/chronicle')

const task = cron.schedule('*/5 * * * *', async () => {
  await refreshCache()
}, { timezone: 'UTC', noOverlap: true })

task.stop()
```

The package exports `schedule`, `createTask`, `validate`, `validateDetailed`,
`parse`, `getTask`, `getTasks`, and `shutdown`, along with Chronicle's
`nextOccurrence` extension. It supports five/six fields, lists, ranges, steps,
and named months/weekdays. It explicitly rejects node-cron background task
paths, distributed coordination, and advanced calendar tokens (`L`, `W`, `#`,
`?`, and inverted ranges). See the repository README for the complete
compatibility matrix.
