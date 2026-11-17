import { describe, expect, it } from 'vitest'
import { selectOfficialReleaseAsset, selectSunshineInstaller, type GitHubRelease } from '../electron/toolbox-release'

const digest = `sha256:${'a'.repeat(64)}`

function release(url = 'https://github.com/SunshineStream/Sunshine/releases/download/v1/Sunshine-Windows-AMD64-installer.msi', checksum: string | undefined = digest): GitHubRelease {
  return { tag_name: 'v1', assets: [{ name: 'Sunshine-Windows-AMD64-installer.msi', browser_download_url: url, digest: checksum, size: 42 }] }
}

describe('Sunshine official installer selection', () => {
  it('accepts the signed-off asset shape from the current official repository', () => {
    expect(selectSunshineInstaller(release()).name).toBe('Sunshine-Windows-AMD64-installer.msi')
  })

  it('rejects a lookalike asset from another repository', () => {
    expect(() => selectSunshineInstaller(release('https://github.com/example/Sunshine/releases/download/v1/Sunshine-Windows-AMD64-installer.msi'))).toThrow(/来源校验/)
  })

  it('rejects releases without a valid SHA-256 digest', () => {
    expect(() => selectSunshineInstaller(release(undefined, ''))).toThrow(/SHA-256/)
  })
})

describe('generic toolbox release selection', () => {
  it('accepts only the requested repository and Windows asset', () => {
    const winIsland: GitHubRelease = { tag_name: 'v1.1.3', assets: [{ name: 'WinIsland-1.1.3-x64-setup.exe', browser_download_url: 'https://github.com/luolangaga/WinLand/releases/download/v1.1.3/WinIsland-1.1.3-x64-setup.exe', digest }] }
    expect(selectOfficialReleaseAsset(winIsland, 'luolangaga/WinLand', /WinIsland-[\d.]+-x64-setup\.exe$/i, 'WinIsland').name).toContain('x64')
  })

  it('rejects a matching filename hosted by a lookalike repository', () => {
    const fake: GitHubRelease = { tag_name: 'v1', assets: [{ name: 'Filee-2.4.1-win-Setup.exe', browser_download_url: 'https://github.com/lookalike/Filee/releases/download/v1/Filee-2.4.1-win-Setup.exe', digest }] }
    expect(() => selectOfficialReleaseAsset(fake, 'KnifeLemon/Filee', /Filee-[\d.]+-win-Setup\.exe$/i, 'Filee')).toThrow(/来源校验/)
  })
})
