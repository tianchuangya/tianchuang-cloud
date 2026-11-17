import { writeFile } from 'node:fs/promises'

const [, , temporaryPath, contents] = process.argv
await writeFile(temporaryPath, contents)
process.stdout.write('TEMPORARY_READY\n')
setInterval(() => {}, 60_000)
