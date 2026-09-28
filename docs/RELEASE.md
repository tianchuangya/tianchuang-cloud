# macOS 签名与公证发布指南

目标：macOS 用户安装 DMG 后直接打开，不被 Gatekeeper 拦截（"已损坏，无法打开"/"无法验证开发者"）。完整要求 = **Developer ID 签名 + 公证（Notarization）+ 硬化运行时**。前两者需要付费的 Apple Developer Program 账号。

## 1. 在你的 Apple 开发者账号里准备证书

1. 登录 [developer.apple.com/account](https://developer.apple.com/account) → Certificates, Identifiers & Profiles → Certificates → **+**。
2. 选择 **Developer ID Application**（注意不是 "Apple Development"，那个只能用于 App Store）。
3. 按网页指引在 Mac 上用「钥匙串访问 → 证书助理 → 从证书颁发机构请求证书」生成 CSR 并上传，然后下载 `.cer` 并双击导入钥匙串。
   （装了 Xcode 的话更简单：Xcode → Settings → Accounts → 选中团队 → Manage Certificates → **+** → Developer ID Application。）
4. 确认 Apple Developer Program 的 Team ID（Membership details 页面的 10 位 Team ID，例如 `ABC123DEFG`）。

## 2. 导出 .p12 证书

钥匙串访问 → 我的证书 → 找到 "Developer ID Application: 你的名字 (TEAMID)" → 右键「导出」→ 格式选 `.p12`，设置一个导出密码（这就是后面的 `CSC_KEY_PASSWORD`）。

## 3. 配置 GitHub 仓库 Secrets

仓库页面 → Settings → Secrets and variables → Actions → New repository secret，逐条添加：

| Secret 名 | 值 |
| --- | --- |
| `CSC_LINK` | `.p12` 文件的 base64。Mac 终端执行：`base64 -i DeveloperIDApplication.p12 \| pbcopy` 然后粘贴 |
| `CSC_KEY_PASSWORD` | 导出 .p12 时设置的密码 |
| `APPLE_ID` | 你的 Apple ID 邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 在 [appleid.apple.com](https://appleid.apple.com) → 登录与安全 → App 专用密码 生成（公证必须用专用密码，不能用账号主密码） |
| `APPLE_TEAM_ID` | 10 位 Team ID |

## 4. 发布

什么都不用改：`release.yml` 已配置好。检测到这些 Secrets 存在时，macOS 构建会自动：

1. 用 Developer ID 证书签名（硬化运行时 + `build/entitlements.mac.plist` 权限）；
2. `scripts/notarize.cjs` 钩子把 `.app` 提交 Apple 公证（几分钟）；
3. 公证通过后打包 DMG，附到 GitHub Release。

流程照旧：改版本号 → 提交 → 打 `v*` 标签推送 → 等 Actions 变绿 → Release 页下载的 DMG 即可直接安装打开。

在 **自己的 Mac 上本地构建**同理：钥匙串里有证书 + 终端导出 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 后运行 `npm run dist -- --mac`，效果一致。

## 5. 未签名 DMG 的临时打开办法（本机已装的旧包）

- 安装时若提示"无法验证开发者"：右键点击 App → 打开 → 再点打开（仅一次）；
- 若提示"已损坏"：终端执行 `sudo xattr -rd com.apple.quarantine /Applications/天创云端.app`。

## 6. 边界与说明

- 公证由 Apple 服务器处理，构建时长会多几分钟；偶尔 Apple 服务波动导致公证失败，重跑该次 Action 即可。
- Electron 的代码签名必须包含 `entitlements.mac.plist` 中的权限（JIT/可执行内存/库校验豁免），否则 V8 无法启动。
- Windows 安装包的 SmartScreen 提示是另一个问题，需要单独的 Windows 代码签名证书（如 Azure Trusted Signing 或 EV 证书），未在本指南范围内。
- Secrets 缺失时 macOS 构建回退为未签名模式，不会导致发布失败。
