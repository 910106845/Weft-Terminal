/* 打包完成后清理解包目录，避免 Spotlight 把 release 里的 .app 当成第二个应用。 */
const fs = require('fs')
const path = require('path')

module.exports = async function afterAllArtifactBuild (buildResult) {
  const outDir = buildResult?.outDir || path.join(process.cwd(), 'release')
  const folders = [
    'mac-universal',
    'mac-universal-arm64-temp',
    'mac-universal-x64-temp',
    'mac-arm64',
    'mac-x64',
    'win-unpacked',
    'win-ia32-unpacked',
    'linux-unpacked'
  ]
  for (const name of folders) {
    try {
      fs.rmSync(path.join(outDir, name), { recursive: true, force: true })
    } catch {
      // 清理失败不影响打包结果
    }
  }
  try {
    fs.writeFileSync(path.join(outDir, '.metadata_never_index'), '')
  } catch {
    // 忽略
  }
  return []
}
