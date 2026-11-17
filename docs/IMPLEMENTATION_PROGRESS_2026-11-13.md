# 天创云端工程进度（2026-11-13）

## 本轮落地

1. WebDAV 上传与下载改为流式，不再把整个大文件读入 Buffer。
2. 磁盘、移动硬盘和 NAS 镜像复制支持 `AbortSignal`，中止时清理本次临时文件。
3. 主进程增加每资料库活动同步控制器和 `sync:cancel` IPC；进度浮层对 WebDAV/NAS 显示“取消同步”。
4. 取消属于用户操作：资料库恢复 `idle`，不会被记录为目标故障；Git 因底层 push 仍不可可靠中断，不显示取消入口。
5. WebDAV ETag 写入 `state.tc`；大小与 ETag 均未变化时复用已确认 SHA，避免每次规划重新下载大文件。
6. 兼容真实客户端的 detailed response、缺失深层目录 403、Depth infinity 不可用等服务端差异。
7. 新增真实兼容矩阵、传输中服务终止、磁盘满、独立进程强杀、64 MiB 取消和 256 MiB 流式上传测试。

## 真实验证数字

- WsgiDAV 4.4.0 + Cheroot 11.1.2：通过。
- webdav-server 2.6.3：通过。
- WSL UNC 网络文件系统：通过，但不标记为 SMB。
- 256 MiB WsgiDAV 上传：通过，RSS 峰值增长 54.5 MiB；第二次规划为 `none`。
- 服务进程在 32 MiB 上传途中被终止：明确失败；同一存储重启后重试成功。
- 64 MiB WebDAV 真实取消：通过，未发布最终文件、状态或临时项。
- 全量自动化：22 个测试文件，21 个通过、1 个条件矩阵文件跳过；124 项通过、4 项按环境跳过。
- `npm run lint`、`npm run build`、`git diff --check`：通过。

## 本轮发现的真实缺陷

- 真实 `webdav` detailed response 不是数组，旧代码会在目录创建后崩溃。
- Node 流上传不触发库声明的 `onUploadProgress`；旧方案表面支持取消，实际 64 MiB 文件仍完整上传。现改用自有 Transform 计数与中止。
- 部分服务端拒绝 Depth infinity，旧代码直接报 403；现安全降级为浅层递归。
- 大文件每次规划都重新下载计算 SHA，网络成本与资料库总量线性增长；现用已提交 ETag 缓存避免重复读取。
- ETag 收集扫描曾把本次事务隔离文件误认成上次崩溃残留；现区分普通恢复扫描与事务内部扫描。

## 明确剩余边界

- `\\localhost\Desktop` SMB 共享只授权给 `tianchuangya`，当前 `ASUS` 账号被共享层拒绝；未把该项伪报为通过。
- Synology/QNAP/Nextcloud、TLS证书、认证方式、限流和实际配额尚需产品级真实服务。
- 没有打安装包，没有提交或推送代码。

## 正式主题与 LocalSend 模块续作

1. 全局视觉改为更克制的深色产品主题，统一主色、面板、按钮、导航、状态与设置弹窗；保留已有流畅动画，但减少装饰性渐变和高饱和玻璃效果。
2. 新增侧栏一级入口“附近传送”，包含实时设备列表、手动 IP 探测、文本发送、文件多选、文件夹发送、接收确认、取消、进度与最近传送。
3. 新增 Electron 主进程服务 `electron/nearby-service.ts`，负责 sidecar 生命周期、受限 IPC、设备状态和传输状态；证书与私钥不暴露给渲染层。
4. 新增 Rust sidecar `native/localsend-sidecar`，使用项目内固定的 LocalSend Rust core 最小快照；支持 v2 HTTPS、证书指纹、UDP 组播、文本及文件/目录传输。
5. 接收端采用随机 `.part` 临时文件，核心校验成功后原子改名；清理 `.`/`..` 路径段，同名文件追加序号，不覆盖已有文件。
6. 官方 LocalSend 已占用 53317 时，天创云端自动选择 53318–53327；实机同时运行两者时完成发现和中文文本实传。
7. 修复 Electron `file://` 生产加载下应用图标、作者头像和默认背景使用绝对 `/assets` 导致资源损坏的问题。
8. 安装构建已配置 release sidecar 与 Apache 2.0 许可证/第三方声明资源，但遵照当前要求没有实际生成安装包。

### LocalSend 验证证据

- sidecar 单元测试：2 项通过（路径穿越隔离、同名文件不覆盖）。
- 双实例集成：53417/53418 互相发现，中文文本发送成功，中文文件名文件发送/接收及内容校验成功。
- release sidecar 构建成功，并使用 release 二进制重复通过双实例集成测试。
- 官方 LocalSend Windows 客户端：与天创云端同时监听 53317/53318，成功发现；中文测试文本实际显示在官方客户端，关闭接收结果页后发送会话完成。
- sidecar 强制终止恢复：手动强杀 PID 27252 后，主进程按退避策略启动新 PID 5216 并重新监听 53318；主程序强制退出后 sidecar 随 stdin 关闭退出，没有残留孤儿进程。
- Electron preload smoke：`desktop bridge: object; nearby: function/function`。
- 最终 `npm run lint`、`npm run build`、124 项项目测试与 2 项 sidecar 测试通过。

### LocalSend 剩余边界

- 尚未生成安装包，也未验证安装后 Windows 防火墙提示、卸载清理和自动更新。
- macOS/Linux sidecar 构建、签名与运行尚未验证。
- Android/iOS/macOS/Linux 官方 LocalSend 客户端互操作、大文件断网恢复、睡眠唤醒和低磁盘空间仍需跨设备矩阵。
- 可信设备持久化、黑名单、接收目录自定义和传输历史持久化尚未实现。
- Sunshine 串流尚未开始实现；当前架构只预留独立扩展模块定位，不能把 LocalSend 传输当作 Sunshine 串流已完成。
