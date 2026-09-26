import type { NotificationPreferences, SyncProgress } from './types.js'

// 系统通知统一门控：只有明确开启的类别才弹出系统通知。
// 应用内进度浮层与资料库的失败告警冷却不受此处影响。
export function shouldShowSystemNotification(preferences: NotificationPreferences, phase: SyncProgress['phase']): boolean {
  if (phase === 'complete') return preferences.syncSuccess
  if (phase === 'error') return preferences.syncFailure
  return false
}
