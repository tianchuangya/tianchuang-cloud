# macOS 签名与公证发布指南

目标：macOS 用户安装 DMG 后直接打开，不被 Gatekeeper 拦截（"已损坏，无法打开"/"无法验证开发者"）。完整要求 = **Developer ID 签名 + 公证（Notarization）+ 硬化运行时**。前两者需要付费的 Apple Developer Program 账号。

全部流程**不需要 Mac**：签名与公证发生在 GitHub 的 macOS 云服务器上，本机只负责用 OpenSSL 生成证书材料并配置仓库 Secrets。

## 1. 生成 Developer ID 证书（在 Windows 上即可）

1. 登录 [developer.apple.com/account](https://developer.apple.com/account) → Certificates, Identifiers & Profiles → Certificates → **+** → 选择 **Developer ID Application**（注意不是 "Apple Development"）→ 页面会要求上传 CSR 文件。
2. 在 Git Bash 中生成私钥和 CSR（把邮箱、姓名、Team ID 换成自己的）：

   ```bash
   openssl req -new -newkey rsa:2048 -nodes \
     -keyout DeveloperIDApplication.key \
     -out CertificateSigningRequest.certSigningRequest \
     -subj "/emailAddress=你的AppleID邮箱/CN=你的名字/OU=你的10位TeamID/C=CN"
   ```

3. 回到网页上传这个 `.certSigningRequest`，下载生成的 `.cer` 文件（如 `developerID_application.cer`）。
4. 下载 Apple 中间证书：[apple.com/certificate-authority](https://www.apple.com/certificate-authority/) 页面的 **AppleWWDRCAG6.cer**（Worldwide Developer Relations - G6）。
5. 合成 `.p12`（Git Bash 中执行，`你的导出密码` 就是后面的 `CSC_KEY_PASSWORD`）：

   ```bash
   openssl x509 -in developerID_application.cer -inform DER -out developer_cert.pem -outform PEM
   openssl x509 -in AppleWWDRCAG6.cer -inform DER -out AppleWWDRCA.pem -outform PEM
   openssl pkcs12 -export \
     -inkey DeveloperIDApplication.key \
     -in developer_cert.pem \
     -certfile AppleWWDRCA.pem \
     -passout pass:你的导出密码 \
     -out DeveloperIDApplication.p12
   ```

6. 生成 `CSC_LINK` 需要的 base64：

   ```bash
   base64 -w 0 DeveloperIDApplication.p12 > csc_link_base64.txt
   ```

> 私钥文件 `DeveloperIDApplication.key` 和 `.p12` 要妥善保管，不要提交进仓库；备份到安全位置后从项目目录移走。

## 2. 准备公证所需的 Apple 凭据

- `APPLE_ID`：你的 Apple ID 邮箱；
- `APPLE_APP_SPECIFIC_PASSWORD`：在 [appleid.apple.com](https://appleid.apple.com) → 登录与安全 → **App 专用密码** 生成（公证必须用专用密码，不能用账号主密码）；
- `APPLE_TEAM_ID`：开发者账号的 10 位 Team ID（Membership details 页面）。

## 3. 配置 GitHub 仓库 Secrets

仓库页面 → Settings → Secrets and variables → Actions → New repository secret，逐条添加：

| Secret 名 | 值 |
| --- | --- |
| `CSC_LINK` | `.p12` 的 base64（第 1 步生成的 `csc_link_base64.txt` 内容） |
| `CSC_KEY_PASSWORD` | 生成 .p12 时 `-passout` 使用的导出密码 |
| `APPLE_ID` | 你的 Apple ID 邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 第 2 步生成的 App 专用密码 |
| `APPLE_TEAM_ID` | 10 位 Team ID |

## 4. 发布

什么都不用改：`release.yml` 已配置好。检测到这些 Secrets 存在时，macOS 构建会自动：

1. 用 Developer ID 证书签名（硬化运行时 + `build/entitlements.mac.plist` 权限）；
2. `scripts/notarize.cjs` 钩子把 `.app` 提交 Apple 公证（几分钟）；
3. 公证通过后打包 DMG，附到 GitHub Release。

流程照旧：改版本号 → 提交 → 打 `v*` 标签推送 → 等 Actions 变绿 → Release 页下载的 DMG 即可直接安装打开。

## 5. 未签名 DMG 的临时打开办法（本机已装的旧包）

- 安装时若提示"无法验证开发者"：右键点击 App → 打开 → 再点打开（仅一次）；
- 若提示"已损坏"：终端执行 `sudo xattr -rd com.apple.quarantine /Applications/天创云端.app`。

## 6. 边界与说明

- 公证由 Apple 服务器处理，构建时长会多几分钟；偶尔 Apple 服务波动导致公证失败，重跑该次 Action 即可。
- Electron 的代码签名必须包含 `entitlements.mac.plist` 中的权限（JIT/可执行内存/库校验豁免），否则 V8 无法启动。
- Windows 安装包的 SmartScreen 提示是另一个问题，需要单独的 Windows 代码签名证书（如 Azure Trusted Signing 或 EV 证书），未在本指南范围内。
- Secrets 缺失时 macOS 构建回退为未签名模式，不会导致发布失败。
