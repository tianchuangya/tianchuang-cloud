import webdavServer from 'webdav-server'
import { mkdirSync } from 'node:fs'

const port = Number(process.argv[2] || 8766)
const physicalRoot = process.argv[3]
const server = new webdavServer.v2.WebDAVServer({ port })
if (physicalRoot) {
  mkdirSync(physicalRoot, { recursive: true })
  server.setFileSystemSync('/', new webdavServer.v2.PhysicalFileSystem(physicalRoot))
}

server.start(() => process.stdout.write(`WEBDAV_SERVER_READY ${port}\n`))

const stop = () => server.stop(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
