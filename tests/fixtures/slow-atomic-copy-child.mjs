import { Readable } from 'node:stream'
import { setTimeout as wait } from 'node:timers/promises'
import { writeReadableAtomically } from '../../electron/files.ts'

const [, , destination] = process.argv
let sent = 0
const source = Readable.from((async function* () {
  while (sent < 64 * 1024 * 1024) {
    await wait(5)
    sent += 64 * 1024
    yield Buffer.alloc(64 * 1024, 0x51)
  }
})())

process.stdout.write('COPY_STARTED\n')
await writeReadableAtomically(source, destination)
process.stdout.write('COPY_COMPLETED\n')
