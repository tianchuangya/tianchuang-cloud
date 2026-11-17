import { describe, expect, it } from 'vitest'
import { parseGitHubRepository, validateRepositoryName } from '../electron/github'
import { remoteKeyForWorkspace, repositoryNameForDisplayName } from '../electron/repository-name'

describe('GitHub repository names', () => {
  it('accepts common ASCII repository names', () => {
    expect(validateRepositoryName(' study-notes_2026 ')).toBe('study-notes_2026')
  })

  it('keeps a stored key stable after a display-name change', () => {
    expect(remoteKeyForWorkspace({ id: 'workspace-a', name: '新名称', remoteKey: 'old-name-123456789abc', targets: [] }))
      .toBe('old-name-123456789abc')
  })

  it('recovers a generated key from a legacy Git target', () => {
    expect(remoteKeyForWorkspace({
      id: 'workspace-a',
      name: '干物妹 小埋',
      targets: [{ id: 'target', name: 'GitHub', enabled: true, maxFileSizeMb: 100, config: { kind: 'git', provider: 'github', branch: 'main', remoteUrl: 'https://github.com/me/gan-wu-mei-xiao-mai-567366cfdddd.git' } }],
    })).toBe('gan-wu-mei-xiao-mai-567366cfdddd')
  })

  it('rejects empty, path-like and Unicode names before the GitHub request', () => {
    expect(() => validateRepositoryName('')).toThrow('请输入仓库名称')
    expect(() => validateRepositoryName('../notes')).toThrow('只能包含 ASCII')
    expect(() => validateRepositoryName('大学学习计划')).toThrow('只能包含 ASCII')
  })

  it('transliterates Chinese display names and prevents same-pinyin collisions', () => {
    const first = repositoryNameForDisplayName('干物妹 小埋', 'workspace-a')
    const second = repositoryNameForDisplayName('干物妹 小埋', 'workspace-b')
    const homophone = repositoryNameForDisplayName('事例', 'workspace-a')
    const otherHomophone = repositoryNameForDisplayName('示例', 'workspace-a')
    expect(first).toMatch(/^gan-wu-mei-xiao-mai-[0-9a-f]{12}$/)
    expect(first).not.toBe(second)
    expect(homophone.startsWith('shi-li-')).toBe(true)
    expect(otherHomophone.startsWith('shi-li-')).toBe(true)
    expect(homophone).not.toBe(otherHomophone)
    expect([first, second, homophone, otherHomophone].every((name) => /^[A-Za-z0-9._-]{1,100}$/.test(name))).toBe(true)
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
