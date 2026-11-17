import { app, net, shell } from 'electron'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { access, copyFile, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ToolboxEvent, ToolboxState, ToolboxToolId, ToolboxToolState } from './types.js'
import { selectOfficialReleaseAsset, type GitHubRelease } from './toolbox-release.js'

const execFileAsync = promisify(execFile)
const PAVISE_ARCHIVE = 'Pavise-Game-pavise3x.zip'
const PAVISE_VERSION = '3.3.1.1'
const PAVISE_SHA256 = '06414dd58e20d872620dada773a689ef68cf35776461c4a74ccd7de88a7046b1'
const RUFUS_VERSION = '4.15'
const RUFUS_SHA256 = '84c8a437f8af89257524478489e5c85f1edf25f761d299e2bcde46ac0afbe106'
const PECOFENCE_VERSION = '0.4.0'
const PECOFENCE_SHA256 = 'cc985abb49bf7fc7a4f24612daa34f928c49a944ffab887b840d6d5294187385'
const busy = new Set<ToolboxToolId>()
let emitEvent: ((event: ToolboxEvent) => void) | undefined
let transient = new Map<ToolboxToolId, Pick<ToolboxToolState, 'status' | 'progress' | 'message'>>()

type ExternalToolId = Exclude<ToolboxToolId, 'localsend' | 'pavise' | 'rufus' | 'pecofence'>
type InstallMode = 'installer-exe' | 'installer-msi' | 'portable-zip'

interface ExternalToolDefinition {
  id: ExternalToolId
  name: string
  summary: string
  repository: string
  assetPattern: RegExp
  executableName: string
  processName: string
  mode: InstallMode
  license: string
  candidates: () => string[]
  defaults?: 'winisland' | 'filee' | 'folia' | 'clash-verge'
}

const localAppData = () => process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
const roamingAppData = () => process.env.APPDATA || path.join(app.getPath('home'), 'AppData', 'Roaming')
const programFiles = () => process.env.ProgramFiles || 'C:\\Program Files'

const EXTERNAL_TOOLS: ExternalToolDefinition[] = [
  { id: 'sunshine', name: 'Sunshine', summary: '低延迟设备串流主机，按需获取官方 Windows MSI。', repository: 'SunshineStream/Sunshine', assetPattern: /Sunshine-Windows-AMD64-installer\.msi$/i, executableName: 'sunshine.exe', processName: 'sunshine.exe', mode: 'installer-msi', license: 'GPL-3.0', candidates: () => [path.join(programFiles(), 'Sunshine', 'sunshine.exe')] },
  { id: 'winisland', name: 'WinIsland', summary: '你正在使用的 Windows 灵动岛，支持插件、硬件状态和媒体交互。', repository: 'luolangaga/WinLand', assetPattern: /WinIsland-[\d.]+-x64-setup\.exe$/i, executableName: 'WinIsland.exe', processName: 'WinIsland.exe', mode: 'installer-exe', license: 'Upstream license', defaults: 'winisland', candidates: () => ['D:\\WinIsland\\WinIsland.exe', path.join(localAppData(), 'Programs', 'WinIsland', 'WinIsland.exe'), path.join(programFiles(), 'WinIsland', 'WinIsland.exe')] },
  { id: 'filee', name: 'Filee', summary: '文件格式转换与自动化处理工具，复用你的暗色主题和托盘习惯。', repository: 'KnifeLemon/Filee', assetPattern: /Filee-[\d.]+-win-Setup\.exe$/i, executableName: 'Filee.exe', processName: 'Filee.exe', mode: 'installer-exe', license: 'MIT', defaults: 'filee', candidates: () => ['D:\\Filee\\Filee.exe', path.join(localAppData(), 'Programs', 'Filee', 'Filee.exe'), path.join(programFiles(), 'Filee', 'Filee.exe')] },
  { id: 'windhawk', name: 'Windhawk', summary: 'Windows 程序定制与 Mod 管理器，使用官方在线安装器。', repository: 'ramensoftware/windhawk', assetPattern: /^windhawk_setup\.exe$/i, executableName: 'windhawk.exe', processName: 'windhawk.exe', mode: 'installer-exe', license: 'GPL-3.0', candidates: () => [path.join(programFiles(), 'Windhawk', 'windhawk.exe')] },
  { id: 'folia', name: 'Folia', summary: '桌面动态壁纸与音频体验，保留中文界面但不复制设备会话。', repository: 'chthollyphile/folia-major', assetPattern: /Folia-Setup-[\d.]+\.exe$/i, executableName: 'Folia.exe', processName: 'Folia.exe', mode: 'installer-exe', license: 'AGPL-3.0', defaults: 'folia', candidates: () => ['D:\\folia\\Folia.exe', path.join(localAppData(), 'Programs', 'Folia', 'Folia.exe'), path.join(programFiles(), 'Folia', 'Folia.exe')] },
  { id: 'kazumi', name: 'Kazumi', summary: '番剧聚合与在线播放工具，下载官方 Windows 便携包。', repository: 'Predidit/Kazumi', assetPattern: /Kazumi_windows_[\d.]+\.zip$/i, executableName: 'Kazumi.exe', processName: 'Kazumi.exe', mode: 'portable-zip', license: 'GPL-3.0', candidates: () => [path.join(toolboxRoot(), 'kazumi', 'app', 'Kazumi.exe')] },
  { id: 'clash-verge', name: 'Clash Verge Rev', summary: 'Mihomo 图形客户端；只继承界面偏好，不复制订阅、节点或密钥。', repository: 'clash-verge-rev/clash-verge-rev', assetPattern: /^Clash\.Verge_[\d.]+_x64-setup\.exe$/i, executableName: 'clash-verge.exe', processName: 'clash-verge.exe', mode: 'installer-exe', license: 'GPL-3.0', defaults: 'clash-verge', candidates: () => [path.join(programFiles(), 'Clash Verge', 'clash-verge.exe'), path.join(localAppData(), 'Programs', 'Clash Verge', 'clash-verge.exe')] },
]

async function exists(filePath: string): Promise<boolean> { try { await access(filePath); return true } catch { return false } }
function toolboxRoot(): string { return path.join(app.getPath('userData'), 'toolbox') }
function bundledResource(...segments: string[]): string { return app.isPackaged ? path.join(process.resourcesPath, 'toolbox', ...segments) : path.join(app.getAppPath(), 'resources', 'toolbox', ...segments) }
function paviseExecutable(): string { return path.join(toolboxRoot(), 'pavise', 'Pavise.exe') }
function rufusExecutable(): string { return path.join(toolboxRoot(), 'rufus', 'Rufus.exe') }
function pecofenceCandidates(): string[] { return ['D:\\PecoFence\\pecofence.exe', path.join(localAppData(), 'Programs', 'PecoFence', 'pecofence.exe'), path.join(toolboxRoot(), 'pecofence', 'app', 'pecofence.exe')] }

async function firstExisting(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) if (await exists(candidate)) return candidate
  return undefined
}

async function executableFor(id: ToolboxToolId): Promise<string | undefined> {
  if (id === 'pavise') return await exists(paviseExecutable()) ? paviseExecutable() : undefined
  if (id === 'rufus') return await exists(rufusExecutable()) ? rufusExecutable() : undefined
  if (id === 'pecofence') return firstExisting(pecofenceCandidates())
  const definition = EXTERNAL_TOOLS.find((item) => item.id === id)
  return definition ? firstExisting(definition.candidates()) : undefined
}

async function runningImages(): Promise<Set<string>> {
  if (process.platform !== 'win32') return new Set()
  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 })
    return new Set(stdout.split(/\r?\n/).map((line) => /^"([^"]+)"/.exec(line)?.[1]?.toLowerCase()).filter((value): value is string => Boolean(value)))
  } catch { return new Set() }
}

function withTransient(tool: ToolboxToolState): ToolboxToolState { return { ...tool, ...transient.get(tool.id) } }

export async function toolboxState(): Promise<ToolboxState> {
  const running = await runningImages()
  const externalPaths = new Map<ExternalToolId, string | undefined>()
  await Promise.all(EXTERNAL_TOOLS.map(async (definition) => externalPaths.set(definition.id, await firstExisting(definition.candidates()))))
  const [paviseInstalled, rufusInstalled, pecofencePath] = await Promise.all([exists(paviseExecutable()), exists(rufusExecutable()), firstExisting(pecofenceCandidates())])
  for (const [id, executable] of externalPaths) if (executable && transient.get(id)?.status === 'installer-opened') transient.delete(id)

  const externalStates = EXTERNAL_TOOLS.map((definition): ToolboxToolState => {
    const executable = externalPaths.get(definition.id)
    return withTransient({ id: definition.id, name: definition.name, summary: definition.summary, status: running.has(definition.processName.toLowerCase()) ? 'running' : executable ? 'installed' : 'not-installed', installed: Boolean(executable), canInstall: process.platform === 'win32', canLaunch: Boolean(executable), sourceUrl: `https://github.com/${definition.repository}`, license: definition.license, installPath: executable, defaultsAvailable: Boolean(definition.defaults) })
  })

  return { tools: [
    withTransient({ id: 'localsend', name: 'LocalSend', summary: '局域网文件与文本传送，已作为“附近传送”内置。', status: 'built-in', version: '兼容协议模块', installed: true, canInstall: false, canLaunch: true, sourceUrl: 'https://github.com/localsend/localsend', license: 'Apache-2.0' }),
    ...externalStates.slice(0, 1),
    withTransient({ id: 'pavise', name: 'Pavise Game', summary: '游戏调度优化工具；使用随应用提供的原始源码包本机编译。', status: running.has('pavise.exe') ? 'running' : paviseInstalled ? 'installed' : 'not-installed', version: PAVISE_VERSION, installed: paviseInstalled, canInstall: process.platform === 'win32', canLaunch: paviseInstalled, sourceUrl: 'https://github.com/dulaiduwang003/Pavise-Game', license: 'GPL-3.0', installPath: paviseInstalled ? paviseExecutable() : undefined, checksum: PAVISE_SHA256 }),
    ...externalStates.slice(1, 2),
    withTransient({ id: 'pecofence', name: 'PecoFence', summary: '轻量桌面围栏与图标整理工具；官方便携版已随工具箱提供。', status: running.has('pecofence.exe') ? 'running' : pecofencePath ? 'installed' : 'not-installed', version: pecofencePath?.startsWith(toolboxRoot()) ? PECOFENCE_VERSION : undefined, installed: Boolean(pecofencePath), canInstall: process.platform === 'win32', canLaunch: Boolean(pecofencePath), sourceUrl: 'https://github.com/DayuanJiang/PecoFence', license: 'Apache-2.0', installPath: pecofencePath, checksum: PECOFENCE_SHA256 }),
    ...externalStates.slice(2, 3),
    withTransient({ id: 'rufus', name: 'Rufus', summary: '制作启动 U 盘；约 2 MB 的官方便携版与对应源码已随工具箱提供。', status: running.has('rufus.exe') || running.has(`rufus-${RUFUS_VERSION}p.exe`) ? 'running' : rufusInstalled ? 'installed' : 'not-installed', version: RUFUS_VERSION, installed: rufusInstalled, canInstall: process.platform === 'win32', canLaunch: rufusInstalled, sourceUrl: 'https://github.com/pbatard/rufus', license: 'GPL-3.0', installPath: rufusInstalled ? rufusExecutable() : undefined, checksum: RUFUS_SHA256 }),
    ...externalStates.slice(3),
  ] }
}

async function publish(id?: ToolboxToolId, update?: Pick<ToolboxToolState, 'status' | 'progress' | 'message'>): Promise<ToolboxState> {
  if (id && update) transient.set(id, update)
  const state = await toolboxState()
  emitEvent?.({ type: 'state', state })
  return state
}

async function sha256(filePath: string): Promise<string> {
  const file = await open(filePath, 'r'); const hash = createHash('sha256')
  try { const buffer = Buffer.allocUnsafe(1024 * 1024); while (true) { const { bytesRead } = await file.read(buffer, 0, buffer.length, null); if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)) }; return hash.digest('hex') } finally { await file.close() }
}

async function downloadOfficialAsset(definition: ExternalToolDefinition): Promise<{ filePath: string; version: string; checksum: string }> {
  const response = await fetch(`https://api.github.com/repos/${definition.repository}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Tianchuang-Cloud' } })
  if (!response.ok) throw new Error(`无法读取 ${definition.name} 官方版本（HTTP ${response.status}）`)
  const release = await response.json() as GitHubRelease
  const asset = selectOfficialReleaseAsset(release, definition.repository, definition.assetPattern, definition.name)
  const downloads = path.join(toolboxRoot(), 'downloads'); await mkdir(downloads, { recursive: true })
  const destination = path.join(downloads, asset.name); const temporary = `${destination}.download`
  await rm(temporary, { force: true })
  const controller = new AbortController()
  let stallTimer = setTimeout(() => controller.abort(new Error(`${definition.name} 下载连接超时`)), 45_000)
  const resetStallTimer = () => { clearTimeout(stallTimer); stallTimer = setTimeout(() => controller.abort(new Error(`${definition.name} 下载长时间没有收到数据`)), 45_000) }
  let download: Response
  try { download = await net.fetch(asset.browser_download_url, { redirect: 'follow', signal: controller.signal }) }
  catch (error) { clearTimeout(stallTimer); throw error }
  if (!download.ok || !download.body) { clearTimeout(stallTimer); throw new Error(`${definition.name} 下载失败（HTTP ${download.status}）`) }
  const file = await open(temporary, 'w'); const reader = download.body.getReader(); let received = 0
  let fileClosed = false
  const total = Number(download.headers.get('content-length') || asset.size || 0)
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; resetStallTimer(); await file.write(value); received += value.byteLength; await publish(definition.id, { status: 'downloading', progress: total ? Math.min(99, Math.round(received / total * 100)) : undefined, message: `正在从 ${definition.name} 官方发布页下载…` }) }
  } catch (error) {
    await file.close(); fileClosed = true; await rm(temporary, { force: true }); throw error
  } finally { clearTimeout(stallTimer); if (!fileClosed) await file.close() }
  const checksum = await sha256(temporary)
  if (checksum !== asset.digest!.slice(7).toLowerCase()) { await rm(temporary, { force: true }); throw new Error(`${definition.name} 安装资源 SHA-256 校验失败，已拒绝运行`) }
  await rm(destination, { force: true }); await rename(temporary, destination)
  return { filePath: destination, version: release.tag_name, checksum }
}

async function expandArchive(archive: string, destination: string): Promise<void> {
  await rm(destination, { recursive: true, force: true }); await mkdir(destination, { recursive: true })
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:TC_ARCHIVE -DestinationPath $env:TC_DESTINATION -Force'], { windowsHide: true, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, TC_ARCHIVE: archive, TC_DESTINATION: destination } })
}

async function findFile(root: string, name: string): Promise<string | undefined> {
  for (const entry of await readdir(root, { withFileTypes: true })) { const candidate = path.join(root, entry.name); if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return candidate; if (entry.isDirectory()) { const nested = await findFile(candidate, name); if (nested) return nested } }
  return undefined
}

async function installPavise(): Promise<void> {
  const archive = bundledResource(PAVISE_ARCHIVE)
  if (!await exists(archive) || await sha256(archive) !== PAVISE_SHA256) throw new Error('Pavise 源码包校验失败，已拒绝编译')
  const source = path.join(toolboxRoot(), 'pavise', 'source'); await mkdir(path.dirname(source), { recursive: true })
  await publish('pavise', { status: 'installing', progress: 20, message: '正在解压已校验的源码包…' }); await expandArchive(archive, source)
  const buildScript = await findFile(source, 'build.cmd'); if (!buildScript) throw new Error('Pavise 源码包中缺少 build.cmd')
  await publish('pavise', { status: 'installing', progress: 55, message: '正在使用项目自带脚本编译…' })
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '& $env:TC_PAVISE_BUILD -b dev $env:TC_PAVISE_OUTPUT'], { cwd: path.dirname(buildScript), windowsHide: true, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, TC_PAVISE_BUILD: buildScript, TC_PAVISE_OUTPUT: paviseExecutable() } })
  if (!await exists(paviseExecutable())) throw new Error('Pavise 构建结束，但没有生成 Pavise.exe')
}

async function installRufus(): Promise<void> {
  const source = bundledResource('rufus', `rufus-${RUFUS_VERSION}p.exe`)
  if (!await exists(source) || await sha256(source) !== RUFUS_SHA256) throw new Error('内置 Rufus 校验失败，已拒绝安装')
  await publish('rufus', { status: 'installing', progress: 60, message: '正在部署已校验的官方便携版…' })
  await mkdir(path.dirname(rufusExecutable()), { recursive: true }); await copyFile(source, rufusExecutable())
}

async function installPecoFence(): Promise<void> {
  const archive = bundledResource('pecofence', `pecofence-v${PECOFENCE_VERSION}-x64-portable.zip`)
  if (!await exists(archive) || await sha256(archive) !== PECOFENCE_SHA256) throw new Error('内置 PecoFence 校验失败，已拒绝安装')
  await publish('pecofence', { status: 'installing', progress: 45, message: '正在部署已校验的官方便携版…' })
  const destination = path.join(toolboxRoot(), 'pecofence', 'app'); await expandArchive(archive, destination)
  if (!await exists(path.join(destination, 'pecofence.exe'))) throw new Error('PecoFence 便携包中没有找到 pecofence.exe')
}

async function installExternal(definition: ExternalToolDefinition): Promise<void> {
  await publish(definition.id, { status: 'downloading', progress: 0, message: '正在读取官方最新版本…' })
  const result = await downloadOfficialAsset(definition)
  if (definition.mode === 'portable-zip') {
    await publish(definition.id, { status: 'installing', progress: 70, message: '正在部署便携版…' })
    const destination = path.join(toolboxRoot(), definition.id, 'app'); await expandArchive(result.filePath, destination)
    const executable = await findFile(destination, definition.executableName); if (!executable) throw new Error(`${definition.name} 压缩包中没有找到 ${definition.executableName}`)
    const canonical = path.join(destination, definition.executableName); if (executable !== canonical) await copyFile(executable, canonical)
    transient.delete(definition.id); return
  }
  await publish(definition.id, { status: 'installer-opened', progress: 100, message: `${result.version} 已校验（SHA-256 ${result.checksum.slice(0, 12)}…），请完成系统安装向导。` })
  if (definition.mode === 'installer-msi') spawn('msiexec.exe', ['/i', result.filePath], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
  else { const error = await shell.openPath(result.filePath); if (error) throw new Error(error) }
}

async function applyFreshDefaults(id: ToolboxToolId): Promise<boolean> {
  const definition = EXTERNAL_TOOLS.find((item) => item.id === id); if (!definition?.defaults) return false
  const destinations: Record<NonNullable<ExternalToolDefinition['defaults']>, string> = { winisland: path.join(localAppData(), 'WinIsland', 'settings.json'), filee: path.join(roamingAppData(), 'Filee', 'settings.json'), folia: path.join(roamingAppData(), 'Folia', 'config.json'), 'clash-verge': path.join(roamingAppData(), 'io.github.clash-verge-rev.clash-verge-rev', 'verge.yaml') }
  const destination = destinations[definition.defaults]; if (await exists(destination)) return false
  const extension = definition.defaults === 'clash-verge' ? 'yaml' : 'json'; const template = bundledResource('defaults', `${definition.defaults}.${extension}`)
  if (!await exists(template)) return false
  await mkdir(path.dirname(destination), { recursive: true })
  if (extension === 'json') { const parsed = JSON.parse(await readFile(template, 'utf8')) as Record<string, unknown>; await writeFile(destination, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8') } else await copyFile(template, destination)
  return true
}

export async function installTool(id: ToolboxToolId): Promise<ToolboxState> {
  if (busy.has(id) || id === 'localsend') return toolboxState()
  if (await executableFor(id)) return toolboxState()
  busy.add(id)
  try {
    if (id === 'pavise') await installPavise()
    else if (id === 'rufus') await installRufus()
    else if (id === 'pecofence') await installPecoFence()
    else { const definition = EXTERNAL_TOOLS.find((item) => item.id === id); if (!definition) throw new Error('未知工具'); await installExternal(definition) }
    if (id === 'pavise' || id === 'rufus' || id === 'pecofence') transient.delete(id)
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error); const message = raw.replace(/^Command failed:[^\r\n]*[\r\n]*/i, '').trim().slice(0, 360) || '安装失败，请稍后重试'; await publish(id, { status: 'error', message })
  } finally { busy.delete(id) }
  return publish()
}

export async function launchTool(id: ToolboxToolId): Promise<ToolboxState> {
  if (id === 'localsend') return toolboxState()
  const executable = await executableFor(id); if (!executable) throw new Error('该工具尚未安装')
  const defaultsApplied = await applyFreshDefaults(id); const error = await shell.openPath(executable); if (error) throw new Error(error)
  transient.delete(id); if (defaultsApplied) await publish(id, { status: 'installed', message: '已应用基于本机偏好的隐私清理默认配置。' }); return publish()
}

export async function openToolLocation(id: ToolboxToolId): Promise<void> {
  if (id === 'localsend') return shell.openExternal('https://github.com/localsend/localsend')
  const executable = await executableFor(id); if (executable) return shell.showItemInFolder(executable)
  if (id === 'pavise') return shell.openExternal('https://github.com/dulaiduwang003/Pavise-Game')
  if (id === 'rufus') return shell.openExternal('https://github.com/pbatard/rufus')
  if (id === 'pecofence') return shell.openExternal('https://github.com/DayuanJiang/PecoFence')
  const definition = EXTERNAL_TOOLS.find((item) => item.id === id); if (definition) await shell.openExternal(`https://github.com/${definition.repository}`)
}

export function setToolboxEventSink(sink: (event: ToolboxEvent) => void): void { emitEvent = sink }
