export type ProviderKind = 'git' | 'local' | 'webdav'
export type SyncState = 'idle' | 'checking' | 'syncing' | 'attention' | 'error'

export interface GitTargetConfig {
  kind: 'git'
  remoteUrl: string
  branch: string
  provider: 'github' | 'gitee' | 'generic'
  /** 多账号：绑定的 GCM GitHub 账号用户名；凭据仍由系统凭据管理器保管 */
  accountUsername?: string
  /** 统一 Warehouse 模式：多个资料库共享仓库，各自写入 libraries/<libraryId>/files */
  warehouse?: boolean
  libraryId?: string
}

export interface LocalTargetConfig {
  kind: 'local'
  destinationPath: string
  /** ASCII-only remote folder key for new targets; omitted on legacy targets to preserve their existing path. */
  remoteDirectory?: string
  locationType?: 'local' | 'removable' | 'network'
}

export interface WebDavTargetConfig {
  kind: 'webdav'
  endpoint: string
  username: string
  remotePath: string
  secretId?: string
}

export type TargetConfig = GitTargetConfig | LocalTargetConfig | WebDavTargetConfig

export interface SyncTarget {
  id: string
  name: string
  enabled: boolean
  maxFileSizeMb: number
  config: TargetConfig
  lastSyncAt?: string
  lastError?: string
  connectionId?: string
}

export interface StorageConnection {
  id: string
  name: string
  maxFileSizeMb: number
  config: TargetConfig
  createdAt: string
  updatedAt?: string
}

export interface StorageConnectionSummary extends StorageConnection {
  usageCount: number
}

export interface StorageConnectionUpdate {
  name: string
  maxFileSizeMb: number
  config: TargetConfig
  /** WebDAV only. Empty or omitted keeps the current encrypted credential. */
  password?: string
}

export interface StorageConnectionHealth {
  connectionId: string
  ok: boolean
  checkedAt: string
  detail: string
}

export interface WorkspaceProfile {
  id: string
  name: string
  /** Stable ASCII key shared by new remote targets; unlike the display name it does not change after renaming. */
  remoteKey?: string
  path: string
  autoSync: boolean
  syncOnChange?: boolean
  syncOnFocus: boolean
  autoSyncDelaySeconds?: number
  errorNotifyCooldownMinutes?: number
  state: SyncState
  lastSyncAt?: string
  /** 左侧资料库轨道使用的方形缩略图；旧版本继续沿用 coverPath。 */
  coverPath?: string
  /** 资料库概览聚焦舞台使用的横向背景图。 */
  backgroundPath?: string
  targets: SyncTarget[]
  /** 新设备恢复的资料库：首次同步忽略受管清单，把云端文件当作可下载内容而不是待删除项 */
  freshRestore?: boolean
}

export interface WorkspaceDeleteOptions {
  deleteCloud: boolean
  deleteLocal: boolean
}

export interface ActivityItem {
  id: string
  workspaceId: string
  level: 'info' | 'success' | 'warning' | 'error'
  title: string
  detail: string
  createdAt: string
}

export interface AppSnapshot {
  workspaces: WorkspaceProfile[]
  activity: ActivityItem[]
}

export interface NearbyDevice {
  alias: string
  fingerprint: string
  model?: string
  deviceType: 'mobile' | 'desktop' | 'web' | 'headless' | 'server' | string
  host?: string
  port?: number
  protocol?: 'http' | 'https' | string
}

export interface NearbyOfferedFile {
  id: string
  name: string
  size: number
  fileType: string
}

export interface NearbyReceiveRequest {
  sessionId: string
  alias: string
  fingerprint: string
  files: NearbyOfferedFile[]
  totalBytes: number
}

export interface NearbyTransfer {
  id: string
  direction: 'send' | 'receive'
  status: 'running' | 'complete' | 'error'
  transferredBytes: number
  totalBytes: number
  message?: string
}

export interface NearbyState {
  status: 'stopped' | 'starting' | 'ready' | 'unavailable'
  alias?: string
  fingerprint?: string
  port?: number
  error?: string
  devices: NearbyDevice[]
  receiveRequests: NearbyReceiveRequest[]
  transfers: NearbyTransfer[]
}

export type NearbyEvent =
  | { type: 'state'; state: NearbyState }
  | { type: 'devices'; devices: NearbyDevice[] }
  | { type: 'receive-request'; request: NearbyReceiveRequest }
  | { type: 'text-received'; alias: string; fingerprint: string; text: string }
  | { type: 'transfer'; transfer: NearbyTransfer }
  | { type: 'file-received'; sessionId: string; path: string; success: boolean; message: string }
  | { type: 'error'; command: string; message: string }
  | { type: 'diagnostic'; message: string }

export type ToolboxToolId = 'localsend' | 'sunshine' | 'pavise' | 'winisland' | 'pecofence' | 'filee' | 'rufus' | 'windhawk' | 'folia' | 'kazumi' | 'clash-verge'
export type ToolboxToolStatus = 'built-in' | 'not-installed' | 'downloading' | 'installing' | 'installer-opened' | 'installed' | 'running' | 'error'

export interface ToolboxToolState {
  id: ToolboxToolId
  name: string
  summary: string
  status: ToolboxToolStatus
  version?: string
  installed: boolean
  canInstall: boolean
  canLaunch: boolean
  progress?: number
  message?: string
  sourceUrl: string
  license: string
  installPath?: string
  checksum?: string
  defaultsAvailable?: boolean
}

export interface ToolboxState {
  tools: ToolboxToolState[]
}

export type ToolboxEvent = { type: 'state'; state: ToolboxState }

export type DeviceSyncState = 'idle' | 'checking' | 'syncing' | 'attention' | 'error'

export interface DeviceProfile {
  schemaVersion: 1
  deviceId: string
  deviceName: string
  deviceModel: string
  platform: string
  appVersion: string
  registeredAt: string
  lastSeenAt: string
  lastSyncAt?: string
  syncState: DeviceSyncState
  lastSyncResult?: 'success' | 'error'
}

export interface WarehouseSettings {
  warehouseName: string
  device: DeviceProfile
}

export interface FileIssue {
  path: string
  size?: number
  limit?: number
  kind: 'local-only' | 'remote-only' | 'remote-delete' | 'conflict' | 'too-large' | 'changed'
}

export interface SyncPlan {
  id: string
  workspaceId: string
  targetId: string
  targetName: string
  provider: ProviderKind
  direction: 'none' | 'upload' | 'download' | 'bidirectional' | 'blocked'
  summary: string
  actions: string[]
  issues: FileIssue[]
  requiresConfirmation: boolean
  createdAt: string
  metadata: Record<string, string | number | boolean | string[]>
}

export interface SyncDecision {
  preserveLocalOnly: boolean
  deleteRemote?: boolean
}

export interface SyncProgress {
  workspaceId: string
  targetId?: string
  phase: 'checking' | 'downloading' | 'uploading' | 'finalizing' | 'complete' | 'cancelled' | 'error'
  title: string
  detail: string
  percent: number
  cancellable?: boolean
  transferredBytes?: number
  totalBytes?: number
}

export interface TransferProgress {
  path: string
  direction: 'upload' | 'download' | 'copy'
  transferredBytes: number
  totalBytes: number
}

export interface SyncExecutionOptions {
  signal?: AbortSignal
  onTransferProgress?: (progress: TransferProgress) => void
}

export interface TargetDraft {
  workspaceId: string
  name: string
  maxFileSizeMb: number
  config: TargetConfig
  password?: string
}

export interface GitHubSession {
  available: boolean
  authenticated: boolean
  username?: string
  displayName?: string
  avatarUrl?: string
  message?: string
  /** 多账号：本次登录新加入 GCM 的账号用户名 */
  newUsername?: string
}

export interface GitHubAccountSession {
  username: string
  displayName?: string
  avatarUrl?: string
  primary: boolean
}

export interface GitHubRepositoryDraft {
  name: string
  description?: string
  private: boolean
  /** 多账号：使用指定账号创建仓库（缺省为主账号） */
  accountUsername?: string
}

export interface GitHubRepositoryResult {
  name: string
  fullName: string
  cloneUrl: string
  htmlUrl: string
  private: boolean
}

export type GitHubCollaboratorPermission = 'pull' | 'push'

export interface GitHubCollaborator {
  username: string
  avatarUrl?: string
  permission: string
  pending: boolean
}

export interface GitHubCollaboratorDraft {
  remoteUrl: string
  username: string
  permission: GitHubCollaboratorPermission
}

export interface CloudWorkspaceConfig {
  id: string
  name: string
  remoteKey?: string
  folderName: string
  pathHint: string
  autoSync: boolean
  syncOnChange: boolean
  syncOnFocus: boolean
  autoSyncDelaySeconds: number
  errorNotifyCooldownMinutes: number
  targets: SyncTarget[]
}

export interface CloudConfigDocument {
  schemaVersion: 1
  updatedAt: string
  deviceName: string
  workspaces: CloudWorkspaceConfig[]
}

export interface CloudConfigStatus {
  authenticated: boolean
  username?: string
  repositoryExists: boolean
  repositoryUrl?: string
  hasRemoteConfig: boolean
  updatedAt?: string
  workspaceCount: number
  config?: CloudConfigDocument
  repositoryName?: string
  devices?: DeviceProfile[]
  message?: string
}

export interface CloudRestoreSelection {
  workspaceId: string
  localPath: string
}

export interface WorkspaceFileEntry {
  name: string
  path: string
  kind: 'dir' | 'file'
  size: number
  modifiedAt: number
}

export interface DestinationCapacity {
  freeBytes?: number
  quotaUsed?: number
  quotaTotal?: number
}

export interface MigrationPlan {
  sourceTargetId: string
  destinationTargetId: string
  sourceName: string
  destinationName: string
  plan: SyncPlan
  capacity?: DestinationCapacity
}

export interface NotificationPreferences {
  syncSuccess: boolean
  syncFailure: boolean
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  syncSuccess: true,
  syncFailure: true,
}
