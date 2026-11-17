export function isMissingGitHubResourceError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message === 'Not Found' || error.message === 'This repository is empty.'
}
