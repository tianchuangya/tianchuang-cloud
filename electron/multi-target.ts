export interface MultiTargetItem {
  id: string
  name: string
}

export interface MultiTargetFailure {
  targetId: string
  targetName: string
  message: string
}

export interface MultiTargetResult {
  succeededTargetIds: string[]
  failures: MultiTargetFailure[]
}

/**
 * Targets are intentionally executed in order: providers share the workspace state file
 * and Git working tree, so parallel writes would create races. A failure is isolated and
 * does not prevent the remaining targets from being checked and synchronized.
 */
export async function executeTargetsIndependently<T extends MultiTargetItem>(
  targets: T[],
  execute: (target: T) => Promise<void>,
): Promise<MultiTargetResult> {
  const succeededTargetIds: string[] = []
  const failures: MultiTargetFailure[] = []
  for (const target of targets) {
    try {
      await execute(target)
      succeededTargetIds.push(target.id)
    } catch (error) {
      failures.push({
        targetId: target.id,
        targetName: target.name,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { succeededTargetIds, failures }
}

export function multiTargetFailureDetail(failures: MultiTargetFailure[]): string {
  return failures.map((failure) => `${failure.targetName}：${failure.message}`).join('；')
}
