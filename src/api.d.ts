import type {
  AppSnapshot,
  GitHubRepositoryDraft,
  GitHubRepositoryResult,
  GitHubSession,
  SyncDecision,
  SyncPlan,
  SyncProgress,
  TargetDraft,
  WorkspaceProfile,
} from '../electron/types'

declare global {
  interface Window {
    tianchuang: {
      getSnapshot(): Promise<AppSnapshot>
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
      updateWorkspace(workspaceId: string, changes: Pick<WorkspaceProfile, 'autoSync' | 'syncOnFocus' | 'name'>): Promise<WorkspaceProfile>
      removeWorkspace(workspaceId: string): Promise<void>
      addTarget(draft: TargetDraft): Promise<WorkspaceProfile>
      getGitHubSession(): Promise<GitHubSession>
      loginGitHub(): Promise<GitHubSession>
      createGitHubRepository(draft: GitHubRepositoryDraft): Promise<GitHubRepositoryResult>
      removeTarget(workspaceId: string, targetId: string): Promise<WorkspaceProfile>
      planSync(workspaceId: string, targetId: string): Promise<SyncPlan>
      runSync(planId: string, decision: SyncDecision): Promise<AppSnapshot>
      syncWorkspace(workspaceId: string): Promise<AppSnapshot>
      onProgress(listener: (progress: SyncProgress) => void): () => void
      onAttention(listener: (plan: SyncPlan) => void): () => void
      onSnapshot(listener: () => void): () => void
    }
  }
}

export {}
