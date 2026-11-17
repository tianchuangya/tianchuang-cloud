# 天创云端 · Tianchuang Cloud

面向多台电脑和多个备份目标的跨平台资料同步桌面应用。它先检查版本与文件差异，再决定拉取、合并或上传；没有变化时不会制造重复提交。

## 当前完成度

当前源码版本为 `0.2.0`，核心工作流已可运行：

- Windows、macOS、Linux 桌面应用框架
- 按钮选择与拖拽导入资料文件夹
- 自动识别资料库根目录中的 `.tianchuang-cover.*`、`tianchuang-cover.*`、`cover.*` 或 `folder.*` 图片作为封面
- 可从资料库右键菜单选择封面；图片会复制为根目录中的 `.tianchuang-cover.*`，便于随资料同步到其他设备
- 设置封面时可拖动选区并缩放，最终保存为统一的 1280×720 PNG
- 资料库首页支持玻璃图标、有序动态网格、手风琴封面和深度轮播四种视图，无封面时使用本地白色占位图标
- 动态网格在资料库较少时使用当前背景图构成环境块，真实资料库只出现一次，避免重复铺满同一封面
- 右键从列表移除资料库，不删除本地文件或远端备份
- GitHub、Gitee 和通用 Git 仓库同步
- GitHub 浏览器登录、登录状态检测和仓库自动创建
- 目标按真实服务显示为 GitHub、Gitee、Git、WebDAV 或具体磁盘类型，仓库地址单独展示
- WebDAV 云盘备份
- 本地磁盘、移动硬盘和已挂载网络盘镜像
- 同一资料库配置多个备份目标
- 后台文件监听、应用聚焦检查、系统托盘和通知
- 同步前版本检查、所有目标的统一大文件预检（含限制原因与更换目标建议）和分支分叉拦截
- 远端较新或远端有本地缺少的文件时，先展示差异并询问保留方向，Git、WebDAV 与磁盘镜像行为一致
- 远端较新且本地有独有文件时，询问保留并合并或以远端为准
- 执行覆盖前在应用数据目录建立恢复副本
- 删除本地文件时先列出即将删除的受管云端文件，只有确认后才传播到 Git、WebDAV 或磁盘镜像
- GitHub 目标支持邀请协作者，并设置只读或可更新权限
- 多账号：支持在系统凭据管理器中登录多个 GitHub 账号，创建目标时可选择使用哪个身份，仓库按账号创建，令牌不离开系统凭据库
- 多云迁移：把某个目标的备份迁移到同一资料库的另一个目标，迁移前展示文件量、目标容量与冲突，确认后执行，可选解除原目标绑定
- 默认创建可改名的私人 `TC-cloud-Warehouse` 主仓库；多个资料库按稳定 ID 写入 `libraries/<library-id>/files`，设备文档与资料库状态写入 `.tc-cloud/`，不保存密码、令牌或 WebDAV 密钥
- Git、WebDAV 与磁盘连接可在设置中全局查看、检查、编辑、删除未使用项，并直接复用到其他资料库；WebDAV 支持轮换加密密码；每个目标维护独立同步基线，一个目标成功不会覆盖另一个目标的确认版本
- 每个资料库使用 `.tianchuang-cloud/state.tc` 保存32位十六进制版本ID、父版本、文件哈希、删除墓碑和各目标确认版本
- 新设备登录 GitHub 后立即发现其他设备备份的资料库并弹出恢复提示，逐项选择本机目录后合并，不静默覆盖；恢复后的首次同步会把云端文件下载到本机（Git 目标在空文件夹时自动克隆远端历史）
- Windows Acrylic、macOS Vibrancy 和深色分层毛玻璃界面
- 与玻璃材质协调的分层模糊渐现、状态微光与减少动态效果适配
- 可切换的矩形/系统指针；矩形指针会贴合交互控件边界，空白区域点击时向中心点收束，并支持自定义空闲与吸附颜色
- 左键与右键使用不同的矩形回波反馈，保持自定义指针下的点击感知
- 按需加载的流体彩雾和点击烟花效果
- 可选水波折射背景，互动只影响背景资产，不干扰内容层
- 背景图与背景动态效果独立配置：默认使用内置背景，也可选择本地图片并复制到应用数据目录
- 背景图上可单独叠加水波折射、侧光流束、微光粒子、柔光极光、虹彩流光、光丝网络或动态地形，全部按需加载，关闭效果不会清除自定义背景
- 背景图支持独立调整模糊度与不透明度；动态效果选项支持搜索，悬停 1 秒进入沉浸预览，预览期间隐藏设置窗口，移动鼠标立即恢复
- 启动画面显示加载进度，加载完成后按任意键或点击画面进入
- 设置中心按顶部大类与左侧子类组织启动、外观、资料库、账户与关于
- 底部项目与作者循环带，提供仓库与作者主页入口
- 主题系统：云玻璃（默认）与新拟物派（Soft UI 浅色浮雕）一键切换，支持导入/导出 JSON 主题文件（仅令牌数据，不含可执行代码）
- 资料库内文件浏览与预览：面包屑目录导航；图片、Markdown、文本、音视频与 PDF 直接预览（音视频支持进度拖动），未知格式用系统应用打开
- 深色模式、降低动态效果和降低透明度辅助设置

## 同步规则

### GitHub / Gitee / Git

1. 新设备场景：目标文件夹为空而远端已有历史时，自动克隆远端到该文件夹。
2. 检查文件大小与工作区状态。
2. 查询远端分支，计算本地和远端各自领先的版本数。
3. 远端较新且本地存在未跟踪文件时，列出这些文件并等待选择。
4. 选择“保留并合并”后，先建立恢复副本，再暂存本地变化、拉取远端、恢复本地变化并提交。
5. 工作区没有变化且没有待上传版本时结束，不创建空提交，不执行重复上传。
6. 历史分叉或恢复本地变化发生冲突时停止自动流程，保留恢复副本并提示人工检查。

Git 认证交给系统 Git Credential Manager 或 SSH Agent，应用不保存 GitHub/Gitee 密码。

添加 GitHub 目标时可以选择“新建仓库”或“已有仓库”。新建模式会调用系统 Git Credential Manager 打开浏览器完成授权，随后可直接设置仓库名称与公开性；创建成功后，应用自动绑定远程地址并执行首次同步。访问令牌只保存在操作系统凭据库中。

### WebDAV

用于 Nextcloud、坚果云、群晖等提供 WebDAV 的服务。密码通过 Electron `safeStorage` 使用操作系统凭据能力加密。同步前会比较本地与远端文件：远端较新的修改会先询问保留方向；远端存在本地缺少的文件时先确认再下载到本机；仅对天创云端清单记录的文件传播删除，并且必须由用户确认。

### 本机、移动与网络磁盘

添加目标时必须明确选择“本机文件夹”“移动硬盘”或“网络磁盘 / NAS”，目标列表会显示实际类型和路径。网络磁盘、NAS 或云盘目录需要先由操作系统挂载为可访问目录。同步会复制新增和变化文件；镜像中较新的修改会先询问保留方向；镜像独有的文件确认后恢复到本机；删除只作用于受管清单中的文件，并且必须由用户确认。

## 开发

要求 Node.js 22 或更新版本，以及可用的 Git 命令行工具。

```bash
npm install
npm run dev
```

检查与构建：

```bash
npm run lint
npm test
npm run build
```

生成当前平台安装包：

```bash
npm run dist
```

安装包输出到 `release/`。推送 `v*` 标签后，GitHub Actions 会分别在 Windows、macOS 和 Ubuntu 构建机生成 NSIS、DMG、AppImage 与 DEB，并附加到对应 GitHub Release。

macOS 签名与公证（Developer ID + Notarization）已接入发布流程：在仓库 Secrets 中配置证书与 Apple 凭据后，DMG 会自动签名并公证，安装时不再被 Gatekeeper 拦截。完整配置步骤见 [docs/RELEASE.md](docs/RELEASE.md)。

`0.1.0` 暂未进行商业代码签名与 Apple 公证。Windows SmartScreen 与 macOS Gatekeeper 可能显示来源提示；正式签名将在后续版本加入。

## 项目结构

```text
electron/
  main.ts              窗口、托盘、通知、IPC 和文件监听
  preload.ts           最小权限渲染层 API
  sync-service.ts      同步任务编排与活动记录
  cloud-config.ts      配置文档结构与恢复合并逻辑
  config-service.ts    私人配置仓库的状态、发布与恢复
  providers/           Git、本地镜像、WebDAV 提供器
src/
  App.tsx              资料库、目标配置、冲突确认和进度界面
  App.css              跨平台玻璃材质与响应式布局
```

## 当前边界

- Git 分支已经分叉时会停止自动处理，避免错误合并。
- Warehouse 和普通 Git 均支持空目录首次恢复；已有本地内容与远端历史同时存在时仍会先生成冲突计划，不会静默覆盖。
- WebDAV 已用状态 SHA-256 检测同大小内容变化，状态通过临时远端文件加 MOVE 发布；MOVE 失败不会推进本机 revision 或目标基线。WsgiDAV 4.4.0 与 webdav-server 2.6.3 的真实协议、断网重试、64 MiB 取消和 256 MiB 流式传输已经验证；群晖、QNAP、Nextcloud、原生 SMB、TLS/认证及服务端配额仍需产品级矩阵。详见 [`docs/compatibility-matrix-2026-11-13.md`](docs/compatibility-matrix-2026-11-13.md)。
- 全局连接支持自动迁移、查看、复用、健康检查、编辑和删除未使用项；编辑会原子传播到已绑定目标，WebDAV 新密码留空时保留旧凭据，填写后轮换系统加密存储中的凭据。
- “附近传送”已接入 LocalSend v2 兼容协议核心：支持局域网发现、HTTPS 证书指纹校验、文本与文件/文件夹发送、接收确认、取消、进度、临时文件原子落盘和冲突文件自动改名。开发环境已通过两个独立实例互传，并与本机官方 LocalSend 客户端完成发现和中文文本实传；三平台安装包与更多官方客户端版本仍需发布矩阵验证。
- “工具箱”提供可选扩展入口：LocalSend 直接打开内置的“附近传送”；Sunshine、WinIsland、Filee、Windhawk、Folia、Kazumi 与 Clash Verge Rev 从各自官方 GitHub Release 按需下载，严格限定仓库和 Windows 资产名称并校验发布 SHA-256；Pavise Game 使用随应用保留的原始 GPL-3.0 源码 ZIP 本机构建；约 2 MB 的 Rufus 官方便携版与对应源码、约 5 MB 的 PecoFence 官方便携版直接随工具箱提供。外部工具不会静默安装或静默提权。
- WinIsland、Filee、Folia 和 Clash Verge Rev 可在首次创建配置时应用基于当前电脑偏好的默认模板。模板不会覆盖已有配置，并排除了订阅地址、代理节点、令牌、会话、设备标识、历史记录和机器绝对路径。
- 端到端加密、S3/OSS 原生适配、版本浏览和安装包自动更新尚未实现。

## 设计依据

界面参考 Apple Human Interface Guidelines、React Bits、Aceternity UI 与 Uiverse：玻璃材质用于导航、工具栏和瞬时弹窗，背景纹理提供深度，微动效只承担状态反馈与空间关系；所有关键覆盖操作都提供选择、恢复路径和明确反馈。

## 开源致谢

“附近传送”模块使用并适配 [LocalSend](https://github.com/localsend/localsend) 的 Rust 协议核心与局域网安全传输协议。感谢 LocalSend 项目及其贡献者提供优秀的跨平台开源实现。LocalSend 使用 Apache License 2.0；天创云端在安装资源中保留许可证、上游版权声明和修改说明。天创云端不是 LocalSend 官方版本。接入边界见 [`docs/localsend-integration.md`](docs/localsend-integration.md)。

工具箱还提供 [Sunshine](https://github.com/SunshineStream/Sunshine) 的官方安装入口，以及 [Pavise Game](https://github.com/dulaiduwang003/Pavise-Game) 的本机源码构建入口。感谢两个项目及其贡献者。Sunshine 与 Pavise Game 均为独立第三方 GPL-3.0 程序，不与天创云端链接为同一程序；Sunshine 安装包按需从官方发布页下载，Pavise 原始源码包与许可证作为独立聚合内容保留。天创云端不是这些项目的官方发行版。

其他可选入口来自 [WinIsland](https://github.com/luolangaga/WinLand)、[PecoFence](https://github.com/DayuanJiang/PecoFence)、[Filee](https://github.com/KnifeLemon/Filee)、[Rufus](https://github.com/pbatard/rufus)、[Windhawk](https://github.com/ramensoftware/windhawk)、[Folia](https://github.com/chthollyphile/folia-major)、[Kazumi](https://github.com/Predidit/Kazumi) 与 [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev)。PecoFence 和 Rufus 为随包聚合的独立便携程序；其他工具按需下载。PecoFence 保留 Apache-2.0 的 LICENSE/NOTICE，Rufus 4.15 保留 GPL-3.0 许可证和对应源码归档。

## License

MIT
