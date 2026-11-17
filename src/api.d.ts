import type {
  AppSnapshot,
  CloudConfigDocument,
  CloudConfigStatus,
  CloudRestoreSelection,
  GitHubRepositoryDraft,
  GitHubRepositoryResult,
  GitHubCollaborator,
  GitHubCollaboratorDraft,
  GitHubAccountSession,
  GitHubSession,
  MigrationPlan,
  NearbyEvent,
  NearbyState,
  NotificationPreferences,
  SyncDecision,
  WorkspaceFileEntry,
  SyncPlan,
  SyncProgress,
  StorageConnectionHealth,
  StorageConnectionSummary,
  StorageConnectionUpdate,
  TargetDraft,
  ToolboxEvent,
  ToolboxState,
  ToolboxToolId,
  WarehouseSettings,
  WorkspaceProfile,
  WorkspaceDeleteOptions,
} from '../electron/types'

declare global {
  interface Window {
    tianchuang: {
      getSnapshot(): Promise<AppSnapshot>
      suggestRepositoryName(displayName: string, stableKey?: string): Promise<string>
      openThemeFile(): Promise<unknown | undefined>
      saveThemeFile(name: string, document: unknown): Promise<string | undefined>
      getNotificationPreferences(): Promise<NotificationPreferences>
      saveNotificationPreferences(preferences: NotificationPreferences): Promise<NotificationPreferences>
      getWarehouseSettings(): Promise<WarehouseSettings>
      updateWarehouseSettings(changes: { warehouseName?: string; deviceName?: string }): Promise<WarehouseSettings>
      getWindowMaximized(): Promise<boolean>
      getCustomBackground(): Promise<string | undefined>
      selectCustomBackground(): Promise<string | undefined>
      resetCustomBackground(): Promise<void>
      selectFolder(): Promise<string | undefined>
      selectMirrorFolder(): Promise<string | undefined>
      folderFromFile(file: File): string
      addWorkspace(folderPath: string): Promise<WorkspaceProfile>
      getWorkspaceCover(workspaceId: string): Promise<string | undefined>
      pickWorkspaceCover(workspaceId: string): Promise<string | undefined>
      saveWorkspaceCover(workspaceId: string, dataUrl: string): Promise<WorkspaceProfile>
      getWorkspaceBackground(workspaceId: string): Promise<string | undefined>
      pickWorkspaceBackground(workspaceId: string): Promise<string | undefined>
      updateWorkspace(workspaceId: string, changes: Pick<WorkspaceProfile, 'autoSync' | 'syncOnChange' | 'syncOnFocus' | 'autoSyncDelaySeconds' | 'errorNotifyCooldownMinutes' | 'name'>): Promise<WorkspaceProfile>
      removeWorkspace(workspaceId: string): Promise<void>
      deleteWorkspace(workspaceId: string, options: WorkspaceDeleteOptions): Promise<string>
      addTarget(draft: TargetDraft): Promise<WorkspaceProfile>
      listStorageConnections(): Promise<StorageConnectionSummary[]>
      attachStorageConnection(workspaceId: string, connectionId: string): Promise<WorkspaceProfile>
      updateStorageConnection(connectionId: string, draft: StorageConnectionUpdate): Promise<StorageConnectionSummary>
      deleteStorageConnection(connectionId: string): Promise<string>
      checkStorageConnection(connectionId: string): Promise<StorageConnectionHealth>
      getGitHubSession(): Promise<GitHubSession>
      listGithubAccounts(): Promise<GitHubAccountSession[]>
      planMigration(workspaceId: string, sourceTargetId: string, destinationTargetId: string): Promise<MigrationPlan>
      loginGitHub(): Promise<GitHubSession>
      createGitHubRepository(draft: GitHubRepositoryDraft): Promise<GitHubRepositoryResult>
      listGitHubCollaborators(remoteUrl: string): Promise<GitHubCollaborator[]>
      inviteGitHubCollaborator(draft: GitHubCollaboratorDraft): Promise<void>
      getCloudConfigStatus(): Promise<CloudConfigStatus>
      publishCloudConfig(): Promise<CloudConfigStatus>
      restoreCloudConfig(config: CloudConfigDocument, selections: CloudRestoreSelection[]): Promise<void>
      removeTarget(workspaceId: string, targetId: string, options?: { deleteBackup?: boolean }): Promise<string>
      listWorkspaceFiles(workspaceId: string, relativeDir: string): Promise<WorkspaceFileEntry[]>
      openWorkspaceFileInSystem(workspaceId: string, relativePath: string): Promise<string>
      revealWorkspaceFileInFolder(workspaceId: string, relativePath: string): Promise<void>
      deleteWorkspaceBackups(workspaceId: string): Promise<string>
      planSync(workspaceId: string, targetId: string): Promise<SyncPlan>
      runSync(planId: string, decision: SyncDecision): Promise<AppSnapshot>
      cancelSync(workspaceId: string): Promise<boolean>
      syncWorkspace(workspaceId: string): Promise<AppSnapshot>
      getNearbyState(): Promise<NearbyState>
      refreshNearby(): Promise<void>
      probeNearby(host: string, port?: number): Promise<void>
      sendNearbyText(fingerprint: string, text: string): Promise<string>
      selectAndSendNearbyFiles(fingerprint: string, mode?: 'files' | 'folder'): Promise<string | undefined>
      answerNearbyRequest(sessionId: string, accept: boolean): Promise<void>
      cancelNearbyTransfer(transferId: string): Promise<void>
      getToolboxState(): Promise<ToolboxState>
      installTool(id: ToolboxToolId): Promise<ToolboxState>
      launchTool(id: ToolboxToolId): Promise<ToolboxState>
      openToolLocation(id: ToolboxToolId): Promise<void>
      onToolboxEvent(listener: (event: ToolboxEvent) => void): () => void
      onNearbyEvent(listener: (event: NearbyEvent) => void): () => void
      onProgress(listener: (progress: SyncProgress) => void): () => void
      onAttention(listener: (plan: SyncPlan) => void): () => void
      onSnapshot(listener: () => void): () => void
      onWindowMaximized(listener: (maximized: boolean) => void): () => void
    }
  }
}

export {}
