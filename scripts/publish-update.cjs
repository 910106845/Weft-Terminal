#!/usr/bin/env node
/* 发布 Windows electron-updater 元数据、macOS zip/dmg 和兼容旧版自定义更新器的 latest.json。
 * 用法: npm run publish:update -- [--notes=...] [--dry-run]
 * 凭证从项目根目录 .env.local 读取，该文件已被 git 忽略。
 */
const fs = require('fs')
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
const releaseDir = path.join(ROOT, 'release')

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

function readYamlPath (file) {
  const text = fs.readFileSync(file, 'utf8')
  const match = text.match(/^path:\s*(.+)$/m)
  return match ? match[1].trim() : ''
}

function fileIfExists (file) {
  return fs.existsSync(file) ? file : ''
}

const winYml = fileIfExists(path.join(releaseDir, 'latest.yml'))
const macYml = fileIfExists(path.join(releaseDir, 'latest-mac.yml'))
const winExe = fileIfExists(path.join(releaseDir, `Weft Terminal Setup ${version}.exe`))
const winExeBlockmap = fileIfExists(
  path.join(releaseDir, `Weft Terminal Setup ${version}.exe.blockmap`)
)
const macZipName = macYml ? readYamlPath(macYml) : ''
const macZip = macZipName ? fileIfExists(path.join(releaseDir, macZipName)) : ''
const macZipBlockmap = macZip ? fileIfExists(`${macZip}.blockmap`) : ''
const macDmg = fileIfExists(
  path.join(releaseDir, `Weft Terminal-${version}-universal.dmg`)
)
const macDmgBlockmap = macDmg ? fileIfExists(`${macDmg}.blockmap`) : ''

const uploads = []
const assets = {}

async function addUpload ({ local, key, contentType, cacheControl, metaOnly }) {
  if (!local || !fs.existsSync(local)) return
  const meta = metaOnly ? null : await sha256File(local)
  uploads.push({
    local,
    key: `${prefix}/${key}`,
    contentType,
    cacheControl,
    meta
  })
}

async function buildPlan () {
  if (winYml) {
    await addUpload({
      local: winYml,
      key: 'Win/latest.yml',
      contentType: 'text/yaml; charset=utf-8',
      cacheControl: 'no-cache, no-store, must-revalidate',
      metaOnly: true
    })
  }
  if (winExe) {
    const meta = await sha256File(winExe)
    uploads.push({
      local: winExe,
      key: `${prefix}/Win/${path.basename(winExe)}`,
      contentType: 'application/x-msdownload',
      meta
    })
    assets.win32 = {
      name: path.basename(winExe),
      url: `${publicBase}/${encodePath(`Win/${path.basename(winExe)}`)}`,
      size: meta.size,
      sha256: meta.sha256,
      contentType: 'application/x-msdownload'
    }
  }
  if (winExeBlockmap) {
    await addUpload({
      local: winExeBlockmap,
      key: `Win/${path.basename(winExeBlockmap)}`,
      contentType: 'application/octet-stream',
      metaOnly: true
    })
  }
  if (macYml) {
    await addUpload({
      local: macYml,
      key: 'MAC/latest-mac.yml',
      contentType: 'text/yaml; charset=utf-8',
      cacheControl: 'no-cache, no-store, must-revalidate',
      metaOnly: true
    })
  }
  if (macZip) {
    await addUpload({
      local: macZip,
      key: `MAC/${path.basename(macZip)}`,
      contentType: 'application/zip',
      metaOnly: true
    })
  }
  if (macZipBlockmap) {
    await addUpload({
      local: macZipBlockmap,
      key: `MAC/${path.basename(macZipBlockmap)}`,
      contentType: 'application/octet-stream',
      metaOnly: true
    })
  }
  if (macDmg) {
    const meta = await sha256File(macDmg)
    uploads.push({
      local: macDmg,
      key: `${prefix}/MAC/${path.basename(macDmg)}`,
      contentType: 'application/x-apple-diskimage',
      meta
    })
    assets.darwin = {
      name: path.basename(macDmg),
      url: `${publicBase}/${encodePath(`MAC/${path.basename(macDmg)}`)}`,
      size: meta.size,
      sha256: meta.sha256,
      contentType: 'application/x-apple-diskimage'
    }
  }
  if (macDmgBlockmap) {
    await addUpload({
      local: macDmgBlockmap,
      key: `MAC/${path.basename(macDmgBlockmap)}`,
      contentType: 'application/octet-stream',
      metaOnly: true
    })
  }
}

const manifest = {
  version,
  title: `Weft Terminal ${version}`,
  notes,
  publishedAt: new Date().toISOString(),
  releaseUrl: `https://github.com/910106845/Weft-Terminal/releases/tag/v${version}`,
  assets
}

async function main () {
  await buildPlan()
  if (!uploads.length) {
    console.error('没有可上传的安装包，请先执行打包')
    process.exit(1)
  }
  const manifestKey = `${prefix}/latest.json`
  const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')

  // 旧版自定义更新器 / macOS DMG 更新器仍使用 latest.json
  if (Object.keys(assets).length) {
    uploads.push({
      local: null,
      body: manifestBody,
      key: manifestKey,
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'no-cache, no-store, must-revalidate'
    })
  }

  if (dryRun) {
    console.log('[dry-run] uploads:')
    for (const item of uploads) {
      console.log(' -', item.key, item.local ? path.basename(item.local) : 'latest.json')
    }
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

  // 先上传安装包，最后上传版本元数据，避免客户端读到半套文件
  const metadata = uploads.filter((item) =>
    /(?:latest\.yml|latest-mac\.yml|latest\.json)$/.test(item.key)
  )
  const binaries = uploads.filter((item) => !metadata.includes(item))

  for (const upload of [...binaries, ...metadata]) {
    const size = upload.body
      ? upload.body.length
      : upload.local
        ? fs.statSync(upload.local).size
        : 0
    console.log(
      `[upload] ${path.basename(upload.local || upload.key)} -> ${upload.key} (${(
        size /
        1024 /
        1024
      ).toFixed(1)} MB)`
    )
    if (upload.body) {
      await client.put(upload.key, upload.body, {
        headers: {
          'Content-Type': upload.contentType,
          ...(upload.cacheControl ? { 'Cache-Control': upload.cacheControl } : {})
        }
      })
    } else {
      await client.multipartUpload(upload.key, upload.local, {
        headers: { 'x-oss-object-acl': 'public-read' },
        progress: (percent) => {
          process.stdout.write(`\r  ${Math.round(percent * 100)}%`)
        }
      })
    }
    await client.putACL(upload.key, 'public-read')
    console.log('')
  }

  console.log('完成：')
  console.log(`  latest.json: ${publicBase}/latest.json`)
  if (winYml) console.log(`  latest.yml: ${publicBase}/Win/latest.yml`)
  if (macYml) console.log(`  latest-mac.yml: ${publicBase}/MAC/latest-mac.yml`)
  for (const [platform, asset] of Object.entries(assets)) {
    console.log(`  ${platform}: ${asset.url}`)
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exit(1)
})
