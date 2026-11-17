export interface GitHubAsset {
  name: string
  browser_download_url: string
  digest?: string
  size?: number
}

export interface GitHubRelease {
  tag_name: string
  assets: GitHubAsset[]
}

export function selectOfficialReleaseAsset(release: GitHubRelease, repository: string, pattern: RegExp, label: string): GitHubAsset {
  const asset = release.assets.find((item) => pattern.test(item.name))
  if (!asset) throw new Error(`官方最新版本中没有找到 ${label} 的 Windows 安装资源`)
  const prefix = `https://github.com/${repository}/releases/download/`.toLowerCase()
  if (!asset.browser_download_url.toLowerCase().startsWith(prefix)) throw new Error(`${label} 下载地址未通过来源校验`)
  if (!asset.digest?.startsWith('sha256:') || !/^[a-f\d]{64}$/i.test(asset.digest.slice(7))) throw new Error(`${label} 官方 Release 未提供有效 SHA-256 摘要，已拒绝下载`)
  return asset
}

export function selectSunshineInstaller(release: GitHubRelease): GitHubAsset {
  return selectOfficialReleaseAsset(release, 'SunshineStream/Sunshine', /Sunshine-Windows-AMD64-installer\.msi$/i, 'Sunshine')
}
