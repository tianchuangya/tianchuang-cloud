# 天创云端同步兼容矩阵（2026-11-13）

## 测试基线

- Windows 11，Node.js `24.15.0`
- `webdav` 客户端 `5.11.0`
- 测试入口：`tests/live-targets.integration.test.ts`
- 故障入口：`tests/webdav-disconnect.integration.test.ts`、`tests/atomic-files.test.ts`
- 所有真实服务端与网络文件系统测试均使用随机专用目录，结束后清理，不复用用户资料。

## 真实服务端 / 网络文件系统

| 目标 | 版本 / 协议 | 结果 | 已验证内容 | 发现并修复的差异 |
| --- | --- | --- | --- | --- |
| WsgiDAV + Cheroot | WsgiDAV 4.4.0 / Cheroot 11.1.2 / HTTP WebDAV | 通过 | 中文路径、递归目录、MOVE 原子替换、远端新增回拉、确认删除、32 MiB 往返、64 MiB 取消、256 MiB 流式上传、ETag 缓存 | 真实 `details:true` 返回 `{ data, headers, status }`，不能直接当数组 |
| webdav-server | 2.6.3 / HTTP WebDAV | 通过 | 同一套中文路径、MOVE、回拉、删除、32 MiB 往返、64 MiB 取消、ETag | 缺失深层路径可能返回 403；拒绝 Depth infinity，需降级为 Depth 1 递归 |
| WSL UNC 网络文件系统 | `\\wsl.localhost\Ubuntu-24.04\tmp` | 通过 | UNC 路径、中文文件名、原子复制、远端新增回拉、确认删除 | 无 |
| Windows Desktop SMB 共享 | `\\localhost\Desktop` | 环境阻塞，未计为通过 | 已验证连接被共享 ACL 拒绝 | 共享仅授权 `是天创呀\tianchuangya`，当前进程身份为 `是天创呀\ASUS`；NTFS 权限正常，但非提升会话不能修改共享 ACL |

WSL UNC 使用 Windows 网络路径语义，但底层不是 SMB，因此不能替代 Synology/QNAP/Windows SMB 的最终兼容结论。

## 故障与大容量结果

| 场景 | 结果 | 验证结论 |
| --- | --- | --- |
| WebDAV 传输中服务进程被终止 | 通过 | 32 MiB 上传明确失败，远端状态未发布；同一物理存储重启后重新规划并成功完成 |
| 用户取消 WebDAV 上传 | 通过 | 真实 64 MiB HTTP 上传被底层 `AbortSignal` 中止，最终文件、状态和临时项均未发布 |
| 用户取消磁盘/NAS复制 | 通过 | 8 MiB 复制中止，最终文件和状态未发布，临时文件清理 |
| 目标写入返回 `ENOSPC` | 通过（故障注入） | 已确认文件保持不变，部分临时文件清理，错误向上传递 |
| 原子复制进程被 `SIGKILL` | 通过 | 已确认文件保持不变，残片不进入扫描；随后重试成功 |
| WebDAV 状态 MOVE 失败 | 通过 | 新状态不发布，本机 revision/基线不推进，待删除文件回滚 |
| 256 MiB 真实上传 | 通过 | 峰值 RSS 增长 54.5 MiB，没有按文件大小整块缓冲；第二次规划使用 ETag，结果为 `none` |

## 已实现的工程措施

- WebDAV 上传、下载及本地/NAS复制改为流式传输。
- WebDAV/NAS 任务支持真实取消；Git 不显示虚假的取消按钮。
- `SyncProgress` 包含当前文件、已传字节、总字节与可取消状态。
- ETag 与大小匹配时复用 `.tc` 中已提交 SHA；ETag 变化或缺失时回退到流式 SHA-256。
- WebDAV 兼容数组与 detailed response 两种目录返回结构。
- Depth infinity 不可用时安全降级为 Depth 1 递归，文件数上限 250000。
- 缺失路径的 403 只在 `exists` 明确返回 false 时按空目录处理；已存在路径的 403 仍作为权限错误。
- 所有数据文件先写临时项再原子替换；状态文档最后发布。

## 尚未冒充完成的范围

- Synology DSM、QNAP QTS、Nextcloud、坚果云等具体产品尚未接入真实账号测试。
- TLS、自签名证书、Digest/OAuth、反向代理限流和服务端配额差异尚需独立矩阵。
- Windows SMB 实测需先把当前 `ASUS` 账号加入专用测试共享，或提供可用的独立 NAS 测试共享；当前 ACL 问题不是同步实现通过的证据。
- 256 MiB 证明了流式内存模型，但不能替代数百 GiB、数十万文件和 24 小时持续运行压力测试。

## 重复执行

```powershell
$env:TC_WEBDAV_LIVE_URL='http://127.0.0.1:8765'
$env:TC_WEBDAV_LARGE_MB='256'
npm test -- --run tests/live-targets.integration.test.ts

$env:TC_NAS_LIVE_DESTINATION='\\wsl.localhost\Ubuntu-24.04\tmp'
npm test -- --run tests/live-targets.integration.test.ts

npm test -- --run tests/webdav-disconnect.integration.test.ts
```
