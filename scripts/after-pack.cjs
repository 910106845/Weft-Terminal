const fs = require('fs/promises')
const path = require('path')

const TARGETS = {
  'win32-x64': ['win32-x64', 'node.napi.node'],
  'win32-ia32': ['win32-ia32', 'node.napi.node'],
  'darwin-x64': ['darwin-x64+arm64', 'node.napi.node'],
  'darwin-arm64': ['darwin-x64+arm64', 'node.napi.node'],
  'linux-x64': ['linux-x64', 'node.napi.glibc.node'],
  'linux-arm64': ['linux-arm64', 'node.napi.armv8.node']
}

const ARCH_NAMES = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64'
}

module.exports = async function afterPack(context) {
  const platform = context.electronPlatformName
  const arch = ARCH_NAMES[context.arch] || process.arch
  const target = TARGETS[`${platform}-${arch}`]
  const appDir =
    platform === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
      : context.appOutDir
  const resourcesDir =
    platform === 'darwin'
      ? path.join(appDir, 'Contents/Resources')
      : path.join(appDir, 'resources')

  // node-pty ships prebuilt spawn-helper binaries. Preserve their executable bit
  // when the app is assembled on macOS.
  if (platform === 'darwin') {
    for (const folder of ['darwin-arm64', 'darwin-x64']) {
      const helper = path.join(
        resourcesDir,
        'app.asar.unpacked/node_modules/node-pty/prebuilds',
        folder,
        'spawn-helper'
      )
      try {
        await fs.chmod(helper, 0o755)
      } catch {
        // 该架构未打包时忽略
      }
    }
  }

  if (!target) {
    console.log(`[after-pack] no serialport binding mapping for ${platform}-${arch}`)
    return
  }

  const [folder, fileName] = target
  const source = path.join(
    context.packager.projectDir,
    'node_modules/@serialport/bindings-cpp/prebuilds',
    folder,
    fileName
  )
  const destinationDir = path.join(
    resourcesDir,
    'app.asar.unpacked/node_modules/@serialport/bindings-cpp/build/Release'
  )
  const destination = path.join(destinationDir, 'bindings.node')

  await fs.mkdir(destinationDir, { recursive: true })
  await fs.copyFile(source, destination)
  console.log(`[after-pack] installed serialport binding for ${platform}-${arch}`)
}
