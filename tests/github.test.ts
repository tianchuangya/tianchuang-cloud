import { describe, expect, it } from 'vitest'
import { parseGitHubRepository, validateRepositoryName } from '../electron/github'

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

describe('GitHub repository addresses', () => {
  it('parses HTTPS and SSH repository addresses', () => {
    expect(parseGitHubRepository('https://github.com/tianchuangya/tianchuang-cloud.git')).toEqual({ owner: 'tianchuangya', repository: 'tianchuang-cloud' })
    expect(parseGitHubRepository('git@github.com:team/notes.git')).toEqual({ owner: 'team', repository: 'notes' })
  })

  it('rejects non-GitHub remotes', () => {
    expect(() => parseGitHubRepository('https://gitee.com/team/notes.git')).toThrow('有效的 GitHub')
  })
})
