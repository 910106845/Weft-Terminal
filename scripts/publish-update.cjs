#!/usr/bin/env node
/* 上传安装包到 OSS，并生成 latest.json。
 * 用法: npm run publish:update -- [--notes=...] [--dry-run]
 * 凭证从项目根目录 .env.local 读取，该文件已被 git 忽略。
 */
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const OSS = require('ali-oss')

const ROOT = path.resolve(__dirname, '..')

function loadEnv (file) {
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index < 0) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnv(path.join(ROOT, '.env.local'))

const pkg = require(path.join(ROOT, 'package.json'))
const version = pkg.version
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const notesArg = args.find((arg) => arg.startsWith('--notes='))
const notes =
  notesArg?.slice('--notes='.length) ||
  process.env.UPDATE_NOTES ||
  `Weft Terminal ${version}`

const bucket = process.env.OSS_BUCKET
const region = process.env.OSS_REGION || 'oss-cn-shenzhen'
const endpoint = (process.env.OSS_ENDPOINT || '').replace(/^https?:\/\//, '')
const accessKeyId = process.env.OSS_ACCESS_KEY_ID
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET
const prefix = (process.env.OSS_PREFIX || 'zhangfan/Weft-Terminal').replace(
  /^\/+|\/+$/g,
  ''
)

if (!bucket || !accessKeyId || !accessKeySecret) {
  console.error('缺少 OSS 配置，请在项目根目录维护 .env.local')
  process.exit(1)
}

const publicBase = (
  process.env.UPDATE_PUBLIC_BASE ||
  `https://${bucket}.${endpoint || `${region}.aliyuncs.com`}/${prefix}`
).replace(/\/+$/, '')

const artifacts = [
  {
    platform: 'darwin',
    local: path.join(ROOT, 'release', `Weft Terminal-${version}-universal.dmg`),
    remoteName: `Weft.Terminal-${version}-universal.dmg`,
    remoteDir: 'MAC',
    contentType: 'application/x-apple-diskimage'
  },
  {
    platform: 'win32',
    local: path.join(ROOT, 'release', `Weft Terminal Setup ${version}.exe`),
    remoteName: `Weft.Terminal.Setup.${version}.exe`,
    remoteDir: 'Win',
    contentType: 'application/x-msdownload'
  }
]

function sha256File (file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () =>
      resolve({ sha256: hash.digest('hex'), size: fs.statSync(file).size })
    )
  })
}

function encodePath (value) {
  return value.split('/').map(encodeURIComponent).join('/')
}

async function main () {
  const assets = {}
  const uploads = []
  for (const item of artifacts) {
    if (!fs.existsSync(item.local)) {
      console.warn(`[skip] 未找到 ${path.basename(item.local)}`)
      continue
    }
    const meta = await sha256File(item.local)
    const key = `${prefix}/${item.remoteDir}/${item.remoteName}`
    const url = `${publicBase}/${encodePath(`${item.remoteDir}/${item.remoteName}`)}`
    assets[item.platform] = {
      name: item.remoteName,
      url,
      size: meta.size,
      sha256: meta.sha256,
      contentType: item.contentType
    }
    uploads.push({ ...item, key, meta })
  }

  if (!Object.keys(assets).length) {
    console.error('没有可上传的安装包，请先执行打包')
    process.exit(1)
  }

  const manifest = {
    version,
    title: `Weft Terminal ${version}`,
    notes,
    publishedAt: new Date().toISOString(),
    releaseUrl: `https://github.com/910106845/Weft-Terminal/releases/tag/v${version}`,
    assets
  }
  const manifestKey = `${prefix}/latest.json`
  const manifestBody = Buffer.from(
    JSON.stringify(manifest, null, 2),
    'utf8'
  )

  if (dryRun) {
    console.log('[dry-run] manifest:', manifestKey)
    console.log(JSON.stringify(manifest, null, 2))
    return
  }

  const client = new OSS({
    region,
    endpoint: endpoint || `${region}.aliyuncs.com`,
    accessKeyId,
    accessKeySecret,
    bucket,
    secure: true
  })

  for (const upload of uploads) {
    console.log(
      `[upload] ${path.basename(upload.local)} -> ${upload.key} (${(
        upload.meta.size /
        1024 /
        1024
      ).toFixed(1)} MB)`
    )
    await client.multipartUpload(upload.key, upload.local, {
      headers: { 'x-oss-object-acl': 'public-read' },
      progress: (percent) => {
        process.stdout.write(
          `\r  ${Math.round(percent * 100)}%`
        )
      }
    })
    await client.putACL(upload.key, 'public-read')
    console.log('')
  }

  console.log(`[manifest] ${manifestKey}`)
  await client.put(manifestKey, manifestBody, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Expires': '0'
    }
  })
  await client.putACL(manifestKey, 'public-read')

  console.log('完成：')
  console.log(`  manifest: ${publicBase}/latest.json`)
  for (const [platform, asset] of Object.entries(assets)) {
    console.log(`  ${platform}: ${asset.url}`)
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exit(1)
})
