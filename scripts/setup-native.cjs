const fs = require('fs')
const path = require('path')

const prebuilds = path.join(__dirname, '../node_modules/node-pty/prebuilds')
for (const folder of ['darwin-arm64', 'darwin-x64']) {
  const helper = path.join(prebuilds, folder, 'spawn-helper')
  try {
    fs.chmodSync(helper, 0o755)
  } catch {
    // 非 macOS 或未安装 node-pty 时忽略
  }
}
