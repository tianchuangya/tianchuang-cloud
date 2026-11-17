import { describe, expect, it } from 'vitest'
import { isMissingGitHubResourceError } from './github-error.js'

describe('GitHub optional resource handling', () => {
  it.each([
    'Not Found',
    'This repository is empty.',
  ])('treats %j as a missing optional resource', (message) => {
    expect(isMissingGitHubResourceError(new Error(message))).toBe(true)
  })

  it('does not hide authentication or transport failures', () => {
    expect(isMissingGitHubResourceError(new Error('Bad credentials'))).toBe(false)
    expect(isMissingGitHubResourceError(new Error('Connection reset'))).toBe(false)
  })
})
