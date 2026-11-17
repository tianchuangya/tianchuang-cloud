import type { StorageConnection, TargetConfig, WorkspaceProfile } from './types.js'

export function storageConnectionConfigTemplate(config: TargetConfig): TargetConfig {
  const template = structuredClone(config)
  if (template.kind === 'git' && template.warehouse) delete template.libraryId
  return template
}

export function storageConnectionUsageCount(workspaces: WorkspaceProfile[], connectionId: string): number {
  return workspaces.reduce((count, workspace) => count + workspace.targets.filter((target) => target.connectionId === connectionId).length, 0)
}

export function propagateStorageConnection(workspaces: WorkspaceProfile[], connection: StorageConnection): WorkspaceProfile[] {
  return workspaces.map((workspace) => ({
    ...workspace,
    targets: workspace.targets.map((target) => {
      if (target.connectionId !== connection.id) return target
      const config = storageConnectionConfigTemplate(connection.config)
      if (config.kind === 'git' && config.warehouse) {
        config.libraryId = target.config.kind === 'git' && target.config.warehouse ? target.config.libraryId || workspace.id : workspace.id
      }
      return { ...target, name: connection.name, maxFileSizeMb: connection.maxFileSizeMb, config }
    }),
  }))
}

export function referencedWebDavSecretIds(workspaces: WorkspaceProfile[], connections: StorageConnection[]): Set<string> {
  return new Set([
    ...workspaces.flatMap((workspace) => workspace.targets.flatMap((target) => target.config.kind === 'webdav' && target.config.secretId ? [target.config.secretId] : [])),
    ...connections.flatMap((connection) => connection.config.kind === 'webdav' && connection.config.secretId ? [connection.config.secretId] : []),
  ])
}
