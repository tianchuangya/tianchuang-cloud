import { describe, expect, it } from 'vitest'
import { validateRepositoryName } from '../electron/github'

describe('GitHub repository names', () => {
  it('accepts common and Chinese repository names', () => {
    expect(validateRepositoryName(' study-notes_2026 ')).toBe('study-notes_2026')
    expect(validateRepositoryName('大学学习计划')).toBe('大学学习计划')
  })

  it('rejects empty and path-like names', () => {
    expect(() => validateRepositoryName('')).toThrow('请输入仓库名称')
    expect(() => validateRepositoryName('../notes')).toThrow('仓库名称只能包含')
  })
})
