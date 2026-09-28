// macOS 公证钩子（electron-builder afterSign）。
// 只有在 CI/本地提供了全部 Apple 凭据、且应用已完成签名时才公证；
// 未配置凭据时跳过，保持与未签名构建的兼容。
const { notarize } = require('@electron/notarize')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID
  if (!appleId || !appleIdPassword || !teamId) {
    console.warn('跳过 macOS 公证：未配置 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID（未签名的构建也会跳过签名）')
    return
  }

  const appName = context.packager.appInfo.productFilename
  console.log(`正在公证 ${appName}.app（team ${teamId}）…`)
  await notarize({
    appBundleId: 'com.tianchuang.cloud',
    appPath: `${appOutDir}/${appName}.app`,
    appleId,
    appleIdPassword,
    teamId,
  })
  console.log('公证完成')
}
