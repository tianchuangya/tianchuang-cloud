// 浏览器预览支持的范围；之外的类型交给系统默认应用。
// 该模块被主进程与渲染层共同使用，不得引入 electron 依赖。
export type PreviewKind = 'image' | 'markdown' | 'text' | 'audio' | 'video' | 'pdf' | 'unknown'

const PREVIEW_EXTENSIONS: Record<Exclude<PreviewKind, 'unknown'>, string[]> = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'],
  markdown: ['.md', '.markdown'],
  text: ['.txt', '.json', '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.xml', '.yml', '.yaml', '.csv', '.log', '.py', '.java', '.c', '.cpp', '.h', '.sh', '.bat', '.toml', '.ini', '.sql', '.rs', '.go'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'],
  video: ['.mp4', '.webm', '.mkv', '.mov', '.avi'],
  pdf: ['.pdf'],
}

export function previewKindOf(fileName: string, size: number): PreviewKind {
  const lower = fileName.toLowerCase()
  for (const [kind, extensions] of Object.entries(PREVIEW_EXTENSIONS) as Array<[Exclude<PreviewKind, 'unknown'>, string[]]>) {
    if (extensions.some((extension) => lower.endsWith(extension))) {
      // 超大文本不进渲染器预览，交给系统应用
      if ((kind === 'markdown' || kind === 'text') && size > 1024 * 1024) return 'unknown'
      return kind
    }
  }
  return 'unknown'
}
