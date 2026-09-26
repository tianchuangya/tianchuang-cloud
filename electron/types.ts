export type ProviderKind = 'git' | 'local' | 'webdav'
export type SyncState = 'idle' | 'checking' | 'syncing' | 'attention' | 'error'

export interface GitTargetConfig {
  kind: 'git'
  remoteUrl: string
  branch: string
  provider: 'github' | 'gitee' | 'generic'
}

export interface LocalTargetConfig {
  kind: 'local'
  destinationPath: string
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
}

export interface WorkspaceProfile {
  id: string
  name: string
  path: string
  autoSync: boolean
  syncOnChange?: boolean
  syncOnFocus: boolean
  autoSyncDelaySeconds?: number
  errorNotifyCooldownMinutes?: number
  state: SyncState
  lastSyncAt?: string
  coverPath?: string
  targets: SyncTarget[]
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
  phase: 'checking' | 'downloading' | 'uploading' | 'finalizing' | 'complete' | 'error'
  title: string
  detail: string
  percent: number
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
}

export interface GitHubRepositoryDraft {
  name: string
  description?: string
  private: boolean
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
  message?: string
}

export interface CloudRestoreSelection {
  workspaceId: string
  localPath: string
}
