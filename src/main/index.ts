import { app, shell, BrowserWindow, ipcMain, clipboard, IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
// @ts-ignore – vite ?asset import handled at build time
import icon from '../../resources/icon.png?asset'
import { exec, spawn, ChildProcess } from 'child_process'
import os from 'os'
import fs from 'fs'
import path from 'path'
import https from 'https'
import net from 'net'
import iconv from 'iconv-lite'

let mainWindow: BrowserWindow | null = null
let securityWindow: BrowserWindow | null = null
let gatewayProcess: ChildProcess | null = null

const GATEWAY_PORT = 18789

// Check if gateway port is actually in use (independent of our own process)
function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(1500)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => { socket.destroy(); resolve(false) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.connect(port, '127.0.0.1')
  })
}


// ─── Helpers ───────────────────────────────────────────────────────────────

function runCmd(cmd: string, timeout = 15000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    // Force buffer encoding on Windows to handle GBK correctly
    exec(cmd, { timeout, env: process.env, encoding: process.platform === 'win32' ? 'buffer' : 'utf8' }, (error, stdout, stderr) => {
      let out = '', err = ''
      if (process.platform === 'win32') {
        out = iconv.decode(stdout as Buffer, 'gbk')
        err = iconv.decode(stderr as Buffer, 'gbk')
      } else {
        out = stdout.toString()
        err = stderr.toString()
      }
      resolve({ ok: !error, out: out.trim(), err: err.trim() })
    })
  })
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'OpenClawManager/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        httpsGet(res.headers.location!).then(resolve).catch(reject)
        return
      }
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}


// ─── Preferences ──────────────────────────────────────────────────────────

const PREFS_FILE = path.join(app.getPath('userData'), 'prefs.json')

function readPrefs(): Record<string, unknown> {
  try {
    if (fs.existsSync(PREFS_FILE)) {
      return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8'))
    }
  } catch {/* */}
  return {}
}

function writePrefs(data: Record<string, unknown>) {
  try {
    const existing = readPrefs()
    fs.writeFileSync(PREFS_FILE, JSON.stringify({ ...existing, ...data }, null, 2))
  } catch { /* */ }
}

// ─── Openclaw Detection ───────────────────────────────────────────────────

const VARIANTS = ['openclaw', 'openclaw-cn', 'moltbot', 'clawdbot']

async function detectOpenClaw() {
  const homeDir = os.homedir()
  const configDir = path.join(homeDir, '.openclaw')
  const configFile = path.join(configDir, 'openclaw.json')
  const hasConfigDir = fs.existsSync(configDir)
  const hasConfig = fs.existsSync(configFile)

  const found: { name: string; execPath: string; via: 'global' | 'pnpm' }[] = []

  // Check PATH-accessible commands
  for (const name of VARIANTS) {
    const checkCmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`
    const res = await runCmd(checkCmd)
    if (res.ok && res.out) {
      found.push({ name, execPath: res.out.split('\n')[0].trim(), via: 'global' })
    }
  }

  // Check pnpm global bin
  const pnpmRes = await runCmd('pnpm bin -g')
  let pnpmBinDir = ''
  if (pnpmRes.ok && pnpmRes.out) {
    pnpmBinDir = pnpmRes.out
    for (const name of VARIANTS) {
      const ext = process.platform === 'win32' ? '.cmd' : ''
      const binPath = path.join(pnpmBinDir, name + ext)
      if (fs.existsSync(binPath)) {
        const alreadyFound = found.some((f) => f.name === name)
        if (!alreadyFound) {
          found.push({ name, execPath: binPath, via: 'pnpm' })
        }
      }
    }
  }

  // Get version of primary
  let version = ''
  if (found.length > 0) {
    const primary = found[0]
    const vCmd =
      primary.via === 'pnpm'
        ? `"${primary.execPath}" --version`
        : `"${primary.execPath}" --version`
    const vRes = await runCmd(vCmd, 5000)
    version = vRes.ok ? vRes.out : ''
  }

  // Node version
  const nodeRes = await runCmd('node --version')
  // npm version
  const npmRes = await runCmd('npm --version')

  // Config contents
  let configData: Record<string, unknown> | null = null
  if (hasConfig) {
    try {
      configData = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
    } catch { /* */ }
  }

  return {
    installed: found.length > 0,
    found,
    primary: found.length > 0 ? found[0] : null,
    version,
    configDir: hasConfigDir ? configDir : null,
    configFile: hasConfig ? configFile : null,
    configData,
    nodeVersion: nodeRes.ok ? nodeRes.out : null,
    npmVersion: npmRes.ok ? npmRes.out : null,
    pnpmBinDir,
  }
}

// ─── Environment Check ───────────────────────────────────────────────────

async function checkEnvironment() {
  const platform = process.platform
  const checks: { id: string; name: string; status: 'ok' | 'missing'; detail: string }[] = []

  if (platform === 'win32') {
    // PowerShell execution policy
    const psRes = await runCmd('powershell.exe -Command "Get-ExecutionPolicy"')
    const policy = psRes.out.toLowerCase()
    const policyOk = ['remotesigned', 'unrestricted', 'bypass'].includes(policy)
    checks.push({ id: 'ps-policy', name: 'PowerShell 执行策略', status: policyOk ? 'ok' : 'missing', detail: psRes.ok ? psRes.out : '无法检测' })

    // Git
    const gitRes = await runCmd('git --version')
    checks.push({ id: 'git', name: 'Git', status: gitRes.ok ? 'ok' : 'missing', detail: gitRes.ok ? gitRes.out : '未安装' })

    // Node
    const nodeRes = await runCmd('node --version')
    const nodeOk = nodeRes.ok && isNodeVersionOk(nodeRes.out)
    checks.push({ id: 'node', name: 'Node.js (≥22.12.0)', status: nodeOk ? 'ok' : 'missing', detail: nodeRes.ok ? nodeRes.out : '未安装' })

    // pnpm
    const pnpmRes = await runCmd('pnpm --version')
    checks.push({ id: 'pnpm', name: 'pnpm', status: pnpmRes.ok ? 'ok' : 'missing', detail: pnpmRes.ok ? pnpmRes.out : '未安装' })

  } else if (platform === 'darwin') {
    // Xcode CLT (provides git)
    const xcodeRes = await runCmd('xcode-select -p')
    checks.push({ id: 'xcode', name: 'Xcode Command Line Tools (Git)', status: xcodeRes.ok ? 'ok' : 'missing', detail: xcodeRes.ok ? xcodeRes.out : '未安装' })

    // Node
    const nodeRes = await runCmd('node --version')
    const nodeOk = nodeRes.ok && isNodeVersionOk(nodeRes.out)
    checks.push({ id: 'node', name: 'Node.js (≥22.12.0)', status: nodeOk ? 'ok' : 'missing', detail: nodeRes.ok ? nodeRes.out : '未安装' })

    // pnpm
    const pnpmRes = await runCmd('pnpm --version')
    checks.push({ id: 'pnpm', name: 'pnpm', status: pnpmRes.ok ? 'ok' : 'missing', detail: pnpmRes.ok ? pnpmRes.out : '未安装' })


  } else {
    // Linux
    const gitRes = await runCmd('git --version')
    checks.push({ id: 'git', name: 'Git', status: gitRes.ok ? 'ok' : 'missing', detail: gitRes.ok ? gitRes.out : '未安装' })

    const nodeRes = await runCmd('node --version')
    const nodeOk = nodeRes.ok && isNodeVersionOk(nodeRes.out)
    checks.push({ id: 'node', name: 'Node.js (≥22.12.0)', status: nodeOk ? 'ok' : 'missing', detail: nodeRes.ok ? nodeRes.out : '未安装' })

    // pnpm
    const pnpmRes = await runCmd('pnpm --version')
    checks.push({ id: 'pnpm', name: 'pnpm', status: pnpmRes.ok ? 'ok' : 'missing', detail: pnpmRes.ok ? pnpmRes.out : '未安装' })
  }

  return { platform, checks, allOk: checks.every((c) => c.status === 'ok') }
}

async function refreshWindowsPath() {
  if (process.platform !== 'win32') return
  const res = await runCmd('powershell.exe -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'Machine\') + \';\' + [Environment]::GetEnvironmentVariable(\'Path\', \'User\')"')
  if (res.ok && res.out.trim()) {
    process.env.PATH = res.out.trim()
  }
}

function isNodeVersionOk(version: string): boolean {
  const m = version.match(/v?(\d+)\.(\d+)/)
  if (!m) return false
  const major = parseInt(m[1]), minor = parseInt(m[2])
  if (major > 22) return true
  if (major < 22) return false
  return minor >= 12
}

// ─── Installation Steps ──────────────────────────────────────────────────

// Download a file from url to dest using https
async function downloadFile(url: string, dest: string): Promise<void> {
  // Follow redirects manually
  const finalUrl = await resolveRedirectUrl(url)
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https.get(finalUrl, { headers: { 'User-Agent': 'OpenClawManager/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        fs.unlinkSync(dest)
        downloadFile(res.headers.location!, dest).then(resolve).catch(reject)
        return
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    }).on('error', (err) => {
      fs.unlinkSync(dest)
      reject(err)
    })
  })
}

function resolveRedirectUrl(url: string): Promise<string> {
  return new Promise((resolve) => {
    https.get(url, { method: 'HEAD', headers: { 'User-Agent': 'OpenClawManager/1.0' } }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        resolveRedirectUrl(res.headers.location).then(resolve)
      } else {
        resolve(url)
      }
    }).on('error', () => resolve(url))
  })
}

function spawnAndStream(
  event: Electron.IpcMainInvokeEvent,
  cmd: string,
  args: string[],
  options: { shell?: boolean; env?: NodeJS.ProcessEnv; cwd?: string } = {}
): Promise<number> {
  return new Promise((resolve) => {
    let proc: ChildProcess

    if (process.platform === 'win32' && options.shell !== false) {
      // Robust Windows spawning for commands with spaces
      // Using /s /c and quoting the entire command line
      const escapedCmd = cmd.includes(' ') && !cmd.startsWith('"') ? `"${cmd}"` : cmd
      const escapedArgs = args.map(a => (a.includes(' ') && !a.startsWith('"')) ? `"${a}"` : a)
      const fullCmd = [escapedCmd, ...escapedArgs].join(' ')
      
      proc = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${fullCmd}"`], {
        shell: false, // already calling cmd.exe
        windowsVerbatimArguments: true,
        env: options.env ?? process.env,
        cwd: options.cwd,
      })
    } else {
      proc = spawn(cmd, args, {
        shell: options.shell ?? true,
        env: options.env ?? process.env,
        cwd: options.cwd,
      })
    }

    const handleData = (data: Buffer, type: 'info' | 'error') => {
      let content = ''
      if (process.platform === 'win32') {
        try {
          content = iconv.decode(data, 'gbk')
        } catch {
          content = data.toString()
        }
      } else {
        content = data.toString()
      }

      const lines = content.split('\n')
      lines.forEach((l, i) => {
        if (i === lines.length - 1 && l === '') return
        event.sender.send('log', { line: l, type, ts: Date.now() })
      })
    }

    proc.stdout?.on('data', (data: Buffer) => handleData(data, 'info'))
    proc.stderr?.on('data', (data: Buffer) => handleData(data, 'error'))
    proc.on('error', (err) => {
      event.sender.send('log', { line: `Spawn Error: ${err.message}`, type: 'error', ts: Date.now() })
      resolve(1)
    })
    proc.on('close', (code) => resolve(code ?? 1))
  })
}

// ─── Window Creation ─────────────────────────────────────────────────────

function createSecurityWindow(): void {
  const isMac = process.platform === 'darwin'
  securityWindow = new BrowserWindow({
    width: 660,
    height: 720,
    show: false,
    resizable: true,
    minWidth: 500,
    minHeight: 600,
    center: true,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: undefined,
    trafficLightPosition: undefined,
    icon: process.platform !== 'darwin' ? join(__dirname, '../../resources/icon.png') : undefined,
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    backgroundColor: isMac ? '#00000000' : '#07070a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  securityWindow.on('ready-to-show', () => securityWindow?.show())
  securityWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    securityWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?mode=security')
  } else {
    securityWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { mode: 'security' },
    })
  }
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 920,
    minHeight: 525,
    show: false,
    autoHideMenuBar: true,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : undefined,
    trafficLightPosition: { x: 14, y: 14 },
    icon: process.platform !== 'darwin' ? join(__dirname, '../../resources/icon.png') : undefined,
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#07070a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler((details: any) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────

ipcMain.handle('get-prefs', () => readPrefs())
ipcMain.handle('set-prefs', (_e, data) => { writePrefs(data); return true })

// Security window: user accepted → close security window, open main window
ipcMain.handle('security-accept', () => {
  writePrefs({ securityAccepted: true })
  securityWindow?.close()
  securityWindow = null
  createMainWindow()
})

ipcMain.handle('detect-openclaw', () => detectOpenClaw())
ipcMain.handle('check-environment', () => checkEnvironment())

// Install a specific setup step (packageName only used for install-openclaw)
ipcMain.handle('run-install-step', async (event: any, step: string, packageName?: string) => {
  // Attach packageName to event so inner step logic can read it
  ;(event as any).__packageName = packageName || 'openclaw'
  const log = (line: string, type: 'info' | 'success' | 'error' | 'system' = 'info') => {
    event.sender.send('log', { line, type, ts: Date.now() })
  }

  log(`[步骤开始] ${step}`, 'system')

  try {
    if (step === 'ps-policy') {
      // Windows only: fix PowerShell execution policy
      log('正在设置 PowerShell 执行策略...', 'info')
      const code = await spawnAndStream(event, 'powershell.exe', [
        '-Command',
        'Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force'
      ])
      return { ok: code === 0 }

    } else if (step === 'git-windows') {
      // Windows: install Git via winget, fallback to download
      log('正在检查 winget...', 'info')
      const wingetRes = await runCmd('winget --version')
      if (wingetRes.ok) {
        log('通过 winget 安装 Git...', 'info')
        const code = await spawnAndStream(event, 'winget', [
          'install', 'Git.Git', '--silent', '--accept-source-agreements', '--accept-package-agreements'
        ])
        if (code === 0) {
          await refreshWindowsPath()
          return { ok: true }
        }
      }
      // Fallback: download from GitHub releases
      log('正在从 GitHub 获取最新 Git 版本信息...', 'info')
      const releaseData = await httpsGet('https://api.github.com/repos/git-for-windows/git/releases/latest')
      const release = JSON.parse(releaseData)
      const asset = release.assets?.find((a: any) => a.name.match(/Git-\d+.*-64-bit\.exe$/))
      if (!asset) { log('无法获取 Git 下载链接', 'error'); return { ok: false } }
      const dest = path.join(os.tmpdir(), asset.name)
      log(`正在下载 Git: ${asset.name}`, 'info')
      await downloadFile(asset.browser_download_url, dest)
      log('正在静默安装 Git...', 'info')
      const code = await spawnAndStream(event, dest, ['/VERYSILENT', '/NORESTART', '/NOCANCEL'])
      if (code === 0) await refreshWindowsPath()
      return { ok: code === 0 }

    } else if (step === 'node-windows') {
      // Windows: install Node.js via winget, fallback to download
      log('正在检查 winget...', 'info')
      const wingetRes = await runCmd('winget --version')
      if (wingetRes.ok) {
        log('通过 winget 安装 Node.js LTS...', 'info')
        const code = await spawnAndStream(event, 'winget', [
          'install', 'OpenJS.NodeJS.LTS', '--silent', '--accept-source-agreements', '--accept-package-agreements'
        ])
        if (code === 0) {
          await refreshWindowsPath()
          return { ok: true }
        }
      }
      // Fallback: download MSI from nodejs.org
      log('正在从 nodejs.org 获取最新 Node.js 版本...', 'info')
      const indexData = await httpsGet('https://nodejs.org/dist/index.json')
      const versions = JSON.parse(indexData)
      const lts = versions.find((v: any) => v.lts && parseInt(v.version.slice(1)) >= 22)
      if (!lts) { log('无法获取 Node.js LTS 版本', 'error'); return { ok: false } }
      const arch = process.arch === 'x64' ? 'x64' : 'x86'
      const msiName = `node-${lts.version}-${arch}.msi`
      const msiUrl = `https://nodejs.org/dist/${lts.version}/${msiName}`
      const dest = path.join(os.tmpdir(), msiName)
      log(`正在下载 Node.js ${lts.version}...`, 'info')
      await downloadFile(msiUrl, dest)
      log('正在静默安装 Node.js...', 'info')
      const code = await spawnAndStream(event, 'msiexec', ['/i', dest, '/qn', '/norestart'])
      if (code === 0) await refreshWindowsPath()
      return { ok: code === 0 }

    } else if (step === 'xcode-clt') {
      // macOS: install Xcode Command Line Tools
      log('正在触发 Xcode Command Line Tools 安装...', 'system')
      log('请在弹出的对话框中点击「安装」，完成后点击继续', 'info')
      // Check if already installed first
      const checkRes = await runCmd('xcode-select -p')
      if (checkRes.ok) {
        log('Xcode Command Line Tools 已安装', 'success')
        return { ok: true }
      }
      // Trigger install dialog
      await spawnAndStream(event, 'xcode-select', ['--install'])
      // Wait and poll for installation
      log('等待安装完成（可能需要几分钟）...', 'info')
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        const check = await runCmd('xcode-select -p')
        if (check.ok) {
          log('Xcode Command Line Tools 安装成功', 'success')
          return { ok: true }
        }
        log(`等待中... (${(i + 1) * 5}s)`, 'info')
      }
      return { ok: false }

    } else if (step === 'node-macos') {
      // macOS: try homebrew first, fallback to pkg download
      log('正在检查 Homebrew...', 'info')
      const brewRes = await runCmd('brew --version')
      if (brewRes.ok) {
        log('通过 Homebrew 安装 Node.js 22...', 'info')
        const code = await spawnAndStream(event, 'brew', ['install', 'node@22'])
        if (code === 0) {
          // Link node
          await spawnAndStream(event, 'brew', ['link', 'node@22', '--force', '--overwrite'])
          return { ok: true }
        }
      }
      // Fallback: download pkg
      log('正在从 nodejs.org 获取最新 Node.js v22 版本...', 'info')
      const indexData = await httpsGet('https://nodejs.org/dist/index.json')
      const versions = JSON.parse(indexData)
      const v22 = versions.find((v: any) => parseInt(v.version.slice(1)) >= 22 && v.lts)
      if (!v22) { log('无法获取 Node.js 版本信息', 'error'); return { ok: false } }
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
      const pkgName = `node-${v22.version}-darwin-${arch}.pkg`
      const pkgUrl = `https://nodejs.org/dist/${v22.version}/${pkgName}`
      const dest = path.join(os.tmpdir(), pkgName)
      log(`正在下载 Node.js ${v22.version} (${arch})...`, 'info')
      await downloadFile(pkgUrl, dest)
      log('正在打开安装程序，请按提示完成安装...', 'system')
      await spawnAndStream(event, 'open', [dest])
      // Wait for user to install
      log('等待安装完成，请完成安装向导后点击继续...', 'info')
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        const check = await runCmd('node --version')
        if (check.ok && isNodeVersionOk(check.out)) {
          log(`Node.js ${check.out} 安装成功`, 'success')
          return { ok: true }
        }
        log(`等待中... (${(i + 1) * 5}s)`, 'info')
      }
      return { ok: false }

    } else if (step === 'node-linux') {
      // Linux: use NodeSource setup script
      log('正在从 NodeSource 安装 Node.js 22...', 'info')
      const code = await spawnAndStream(event, 'bash', [
        '-c',
        'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs'
      ])
      return { ok: code === 0 }

    } else if (step === 'pnpm-setup') {
      // Configure pnpm global bin path and refresh PATH
      log('检测 pnpm...', 'info')
      const pnpmCheck = await runCmd(
        process.platform === 'win32' ? 'pnpm --version' : '/bin/sh -l -c "pnpm --version"'
      )
      if (!pnpmCheck.ok) {
        log('pnpm 未安装，正在通过 npm 全局安装 pnpm...', 'info')
        const npmBin = await resolveNpm('')
        const installCode = await runPmCommand(event, npmBin, ['install', '-g', 'pnpm'])
        if (installCode !== 0) { log('pnpm 安装失败', 'error'); return { ok: false } }
        await refreshWindowsPath()
        log('pnpm 安装成功', 'success')
      } else {
        log(`pnpm 已安装: ${pnpmCheck.out}`, 'info')
      }

      const isMac = process.platform === 'darwin'
      const isWin = process.platform === 'win32'
      
      // Explicitly set PNPM_HOME so immediate sub-commands won't fail with ERR_PNPM_NO_GLOBAL_BIN_DIR
      if (!isWin && !process.env.PNPM_HOME) {
        const homeDir = os.homedir()
        const defaultHome = isMac ? path.join(homeDir, 'Library', 'pnpm') : path.join(homeDir, '.local', 'share', 'pnpm')
        process.env.PNPM_HOME = defaultHome
        log(`设置环境变量 PNPM_HOME = ${defaultHome}`, 'system')
      }

      // Explicitly add PNPM_HOME into process PATH to satisfy pnpm install checks
      if (!isWin && process.env.PNPM_HOME && !process.env.PATH?.includes(process.env.PNPM_HOME)) {
        process.env.PATH = `${process.env.PNPM_HOME}${path.delimiter}${process.env.PATH}`
        log(`将 PNPM_HOME 注入当前安装进程: ${process.env.PNPM_HOME}`, 'system')
      }

      log('运行 pnpm setup，配置全局安装路径...', 'system')
      // pnpm setup may return non-zero if already configured – treat as OK
      await spawnAndStream(event, 'pnpm', ['setup'], { shell: true, env: { ...process.env } })
      await refreshWindowsPath()

      // Get pnpm global bin dir and add to current process PATH
      const binRes = await runCmd(
        process.platform === 'win32' ? 'pnpm bin -g' : '/bin/sh -l -c "pnpm bin -g"'
      )
      if (binRes.ok && binRes.out.trim()) {
        const pnpmBinPath = binRes.out.trim()
        if (!process.env.PATH?.includes(pnpmBinPath)) {
          process.env.PATH = `${pnpmBinPath}${path.delimiter}${process.env.PATH}`
          log(`pnpm 全局路径已加入运行环境: ${pnpmBinPath}`, 'success')
        } else {
          log(`pnpm 全局路径已在环境中: ${pnpmBinPath}`, 'info')
        }
      }
      return { ok: true }


    } else if (step === 'install-openclaw') {
      // Install via pnpm with taobao mirror (called with extra packageName param)
      // packageName comes from ipcMain.handle wrapper above via extra arg
      const pkgName = (event as any).__packageName as string || 'openclaw'
      log(`正在通过淘宝 pnpm 镜像安装 ${pkgName}...`, 'system')
      log('使用镜像: https://registry.npmmirror.com', 'info')

      const pnpmBin = await resolvePnpm(
        process.env.PATH?.split(path.delimiter).find(d => {
          const p = path.join(d, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
          return fs.existsSync(p)
        }) ?? ''
      )
      log(`使用 pnpm: ${pnpmBin}`, 'system')

      const pnpmVersion = await runCmd(`"${pnpmBin}" --version`)
      if (!pnpmVersion.ok) { log('pnpm 不可用，请先完成 pnpm setup 步骤', 'error'); return { ok: false } }

      const code = await runPmCommand(event, pnpmBin,
        ['add', '-g', `${pkgName}@latest`, '--registry=https://registry.npmmirror.com']
      )
      if (code !== 0) { log(`${pkgName} 安装失败`, 'error'); return { ok: false } }

      // Refresh PATH with new pnpm bin dir
      const binRes = await runCmd(
        process.platform === 'win32' ? `"${pnpmBin}" bin -g` : `/bin/sh -l -c "pnpm bin -g"`
      )
      if (binRes.ok && binRes.out.trim()) {
        const p = binRes.out.trim()
        if (!process.env.PATH?.includes(p)) process.env.PATH = `${p}${path.delimiter}${process.env.PATH}`
      }

      // Verify
      const binName = pkgName === 'openclaw-cn' ? 'openclaw-cn' : 'openclaw'
      const initConfig = async () => {
        log('初始化默认配置和工作区...', 'system')
        const initRes = await runCmd(`"${pnpmBin}" exec ${binName} onboard --non-interactive --accept-risk`)
        if (initRes.ok) log('配置初始化完成', 'success')
        else log(`配置初始化可能有误 (${initRes.out})，可稍后手动配置`, 'info')
      }

      const verify = await runCmd(`"${pnpmBin}" exec ${binName} --version`)
      if (verify.ok) {
        log(`${pkgName} 安装成功 (${verify.out.trim()})`, 'success')
        await initConfig()
        return { ok: true }
      }
      
      // Fallback: check by path
      const globalBin = await runCmd(process.platform === 'win32' ? `"${pnpmBin}" bin -g` : `"${pnpmBin}" bin -g`)
      if (globalBin.ok) {
        const binPath = path.join(globalBin.out.trim(), process.platform === 'win32' ? `${binName}.cmd` : binName)
        if (fs.existsSync(binPath)) {
          log(`安装验证通过: ${binPath}`, 'success')
          await initConfig()
          return { ok: true }
        }
      }
      log('安装验证失败，可能需要重新打开终端使环境变量生效', 'error')
      return { ok: false }
    }
  } catch (err: any) {
    log(`步骤出错: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }

  return { ok: false, error: `未知步骤: ${step}` }
})

// Gateway management

// Real-time status: checks actual port occupancy, not just our child process
ipcMain.handle('gateway-status', async () => {
  const ownProcess = gatewayProcess !== null && !gatewayProcess.killed
  const portInUse = await checkPortInUse(GATEWAY_PORT)
  return {
    running: ownProcess || portInUse,
    ownProcess,          // started by this app instance
    external: !ownProcess && portInUse,  // started externally
    pid: gatewayProcess?.pid ?? null,
  }
})

ipcMain.handle('start-gateway', async (event, execPath: string, _via: 'global' | 'pnpm') => {
  const send = (line: string, type = 'system') =>
    event.sender.send('log', { line, type, ts: Date.now() })

  // Check if port is already in use (external gateway)
  const portBusy = await checkPortInUse(GATEWAY_PORT)
  if (portBusy) {
    send(`端口 ${GATEWAY_PORT} 已被占用，网关已在运行中`, 'system')
    event.sender.send('gateway-external', { port: GATEWAY_PORT })
    return { ok: true, alreadyRunning: true }
  }

  if (gatewayProcess && !gatewayProcess.killed) {
    send('网关已在运行中 (本实例)', 'system')
    return { ok: true }
  }

  send(`启动网关: ${execPath} gateway`, 'system')
  gatewayProcess = spawn(execPath, ['gateway'], { shell: true, env: process.env })

  gatewayProcess.stdout?.on('data', (d: Buffer) => {
    const lines = d.toString().split('\n')
    lines.forEach((line, i) => {
      if (i === lines.length - 1 && line === '') return
      mainWindow?.webContents.send('log', { line, type: 'info', ts: Date.now() })
    })
  })
  gatewayProcess.stderr?.on('data', (d: Buffer) => {
    const lines = d.toString().split('\n')
    lines.forEach((line, i) => {
      if (i === lines.length - 1 && line === '') return
      mainWindow?.webContents.send('log', { line, type: 'error', ts: Date.now() })
    })
  })
  gatewayProcess.on('close', (code) => {
    mainWindow?.webContents.send('log', { line: `网关进程退出，代码: ${code}`, type: 'system', ts: Date.now() })
    mainWindow?.webContents.send('gateway-stopped', { code })
    gatewayProcess = null
  })
  return { ok: true, pid: gatewayProcess.pid }
})

ipcMain.handle('stop-gateway', async (_e, execPath: string) => {
  // If we own the process, kill it directly
  if (gatewayProcess && !gatewayProcess.killed) {
    gatewayProcess.kill()
    gatewayProcess = null
    return { ok: true }
  }
  // Otherwise stop the external gateway via the CLI command
  const res = await runCmd(`"${execPath}" gateway stop`, 8000)
  if (res.ok) return { ok: true }
  // Fallback: kill by port
  const platform = process.platform
  const killCmd = platform === 'win32'
    ? `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${GATEWAY_PORT}') do taskkill /F /PID %a`
    : `lsof -ti:${GATEWAY_PORT} | xargs kill -9`
  const killRes = await runCmd(killCmd, 5000)
  return { ok: killRes.ok }
})

// Config management
ipcMain.handle('read-config', () => {
  const configFile = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  if (!fs.existsSync(configFile)) return null
  try { return fs.readFileSync(configFile, 'utf-8') } catch { return null }
})

ipcMain.handle('write-config', (_e, content: string) => {
  const configDir = path.join(os.homedir(), '.openclaw')
  const configFile = path.join(configDir, 'openclaw.json')
  try {
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(configFile, content, 'utf-8')
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('open-config-dir', () => {
  const configDir = path.join(os.homedir(), '.openclaw')
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })
  shell.openPath(configDir)
})

ipcMain.handle('write-clipboard', (_e, text: string) => {
  clipboard.writeText(text)
  return true
})

ipcMain.handle('open-external', (_e, url: string) => {
  shell.openExternal(url)
})

ipcMain.handle('get-system-info', async () => {
  const nodeRes = await runCmd('node --version')
  const npmRes = await runCmd('npm --version')
  const pnpmRes = await runCmd('pnpm --version')
  return {
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    homeDir: os.homedir(),
    nodeVersion: nodeRes.ok ? nodeRes.out : null,
    npmVersion: npmRes.ok ? npmRes.out : null,
    pnpmVersion: pnpmRes.ok ? pnpmRes.out : null,
    electronVersion: process.versions.electron,
  }
})

// ─── Skills / Memory / Chat IPC ──────────────────────────────────────────

ipcMain.handle('list-skills', () => {
  const skillsDir = path.join(os.homedir(), '.openclaw', 'workspace', 'skills')
  if (!fs.existsSync(skillsDir)) return []
  try {
    return fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const mdPath = path.join(skillsDir, d.name, 'SKILL.md')
        const content = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : ''
        const firstLine = content.split('\n').find((l) => l.trim().replace(/^#+\s*/, '')) || d.name
        return { name: d.name, title: firstLine.replace(/^#+\s*/, '').trim(), content }
      })
  } catch { return [] }
})

ipcMain.handle('list-sessions', () => {
  const sessionsDir = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions')
  if (!fs.existsSync(sessionsDir)) return { sessions: [], totalSize: 0 }
  try {
    const files = fs.readdirSync(sessionsDir)
    let totalSize = 0
    const sessions = files.map((f) => {
      const stat = fs.statSync(path.join(sessionsDir, f))
      totalSize += stat.size
      return { name: f, size: stat.size, mtime: stat.mtime.toISOString() }
    }).sort((a, b) => b.mtime.localeCompare(a.mtime))
    return { sessions, totalSize }
  } catch { return { sessions: [], totalSize: 0 } }
})

ipcMain.handle('clear-sessions', () => {
  const sessionsDir = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions')
  try {
    if (fs.existsSync(sessionsDir)) {
      fs.readdirSync(sessionsDir).forEach((f) =>
        fs.unlinkSync(path.join(sessionsDir, f))
      )
    }
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('read-workspace-file', (_e, filename: string) => {
  const workspaceDir = path.join(os.homedir(), '.openclaw', 'workspace')
  const filePath = path.join(workspaceDir, filename)
  try { return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null } catch { return null }
})

ipcMain.handle('write-workspace-file', (_e, filename: string, content: string) => {
  const workspaceDir = path.join(os.homedir(), '.openclaw', 'workspace')
  try {
    if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true })
    fs.writeFileSync(path.join(workspaceDir, filename), content, 'utf-8')
    return { ok: true }
  } catch (err: any) { return { ok: false, error: err.message } }
})

// Chat: run openclaw agent --message "..." --agent <id> [--thinking high]
ipcMain.handle('run-chat-message', async (event, execPath: string, message: string, agentId = 'main', thinking = false) => {
  const args = ['agent', '--message', message, '--agent', agentId]
  if (thinking) args.push('--thinking', 'high')
  const code = await spawnAndStream(event, execPath, args)
  return { ok: code === 0 }
})

// ─── Config management ────────────────────────────────────────────────────

/** Best-effort JSON5 → plain object. Handles comments, trailing commas, unquoted keys. */
function parseConfigLoose(content: string): Record<string, unknown> | null {
  // Strategy 1: plain JSON
  try { return JSON.parse(content) } catch {}
  // Strategy 2: strip comments + trailing commas + quote bare keys
  try {
    const text = content
      .replace(/\/\*[\s\S]*?\*\//g, '')              // block comments
      .replace(/\/\/[^\n\r]*/g, '')                   // line comments
      .replace(/,(\s*[}\]])/g, '$1')                  // trailing commas
      .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3') // unquoted keys
    return JSON.parse(text)
  } catch {}
  // Strategy 3: aggressive – also remove single-quoted strings (rare but seen)
  try {
    const text = content
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n\r]*/g, '')
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/'([^'\\]*)'/g, '"$1"')
      .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3')
    return JSON.parse(text)
  } catch {}
  return null
}

function readConfigObject(): Record<string, unknown> | null {
  const f = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  if (!fs.existsSync(f)) return null
  try { return parseConfigLoose(fs.readFileSync(f, 'utf-8')) } catch { return null }
}

function writeConfigObject(obj: Record<string, unknown>): void {
  const dir = path.join(os.homedir(), '.openclaw')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'openclaw.json'), JSON.stringify(obj, null, 2), 'utf-8')
}

ipcMain.handle('get-config-object', () => readConfigObject())

ipcMain.handle('validate-config', (_e, content: string) => {
  const parsed = parseConfigLoose(content)
  if (parsed !== null) return { ok: true, parsed }
  // Return the specific JSON error for user feedback
  try { JSON.parse(content) } catch (err: any) { return { ok: false, error: err.message } }
  return { ok: false, error: '无法解析配置文件格式' }
})

ipcMain.handle('write-config-validated', (_e, content: string, force = false) => {
  try {
    if (!parseConfigLoose(content)) throw new Error('parse failed')
  } catch (err: any) {
    if (!force) return { ok: false, error: err.message }
  }
  const f = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  try {
    if (!fs.existsSync(path.dirname(f))) fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, content, 'utf-8')
    return { ok: true }
  } catch (err: any) { return { ok: false, error: err.message } }
})

ipcMain.handle('patch-config', (_e, patch: Record<string, unknown>) => {
  try {
    const existing = readConfigObject() ?? {}
    const merged = deepMerge(existing, patch)
    writeConfigObject(merged)
    return { ok: true }
  } catch (err: any) { return { ok: false, error: err.message } }
})

function deepMerge(base: any, patch: any): any {
  if (typeof patch !== 'object' || patch === null) return patch
  const result = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    result[k] = (typeof v === 'object' && v !== null && typeof base[k] === 'object' && base[k] !== null)
      ? deepMerge(base[k], v) : v
  }
  return result
}

// Gateway auth token
ipcMain.handle('get-gateway-token', () => {
  const cfg = readConfigObject() as any
  return cfg?.gateway?.auth?.token ?? null
})

ipcMain.handle('reset-gateway-token', async () => {
  const crypto = await import('crypto')
  const newToken = crypto.randomBytes(32).toString('hex')
  const cfg = readConfigObject() ?? {}
  if (!(cfg as any).gateway) (cfg as any).gateway = {}
  if (!(cfg as any).gateway.auth) (cfg as any).gateway.auth = {}
  ;(cfg as any).gateway.auth.token = newToken
  writeConfigObject(cfg)
  return { ok: true, token: newToken }
})

// Plugins
ipcMain.handle('list-plugins', () => {
  const cfg = readConfigObject()
  const entries = (cfg as any)?.plugins?.entries ?? {}
  return Object.entries(entries).map(([id, v]: [string, any]) => ({
    id,
    enabled: v?.enabled !== false,
    config: v?.config ?? {},
  }))
})

// Channels
ipcMain.handle('get-channels-config', () => {
  return (readConfigObject() as any)?.channels ?? {}
})

ipcMain.handle('save-channels-config', (_e, channels: Record<string, unknown>) => {
  try {
    const cfg = readConfigObject() ?? {}
    ;(cfg as any).channels = channels
    writeConfigObject(cfg)
    return { ok: true }
  } catch (err: any) { return { ok: false, error: err.message } }
})

// Agents
ipcMain.handle('get-agents-config', () => {
  const cfg = readConfigObject()
  return {
    list: (cfg as any)?.agents?.list ?? [],
    defaults: (cfg as any)?.agents?.defaults ?? {},
    bindings: (cfg as any)?.bindings ?? [],
  }
})

ipcMain.handle('save-agents-config', (_e, agents: Record<string, unknown>) => {
  try {
    const cfg = readConfigObject() ?? {}
    ;(cfg as any).agents = { ...(cfg as any).agents, ...agents }
    writeConfigObject(cfg)
    return { ok: true }
  } catch (err: any) { return { ok: false, error: err.message } }
})

ipcMain.handle('add-agent-cli', async (event, execPath: string, agentId: string) => {
  const code = await spawnAndStream(event, execPath, ['agents', 'add', agentId])
  return { ok: code === 0 }
})

// Cron / Schedule
ipcMain.handle('get-schedule', () => {
  const cfg = readConfigObject() as any
  return cfg?.schedule ?? []
})

ipcMain.handle('save-schedule', (_e, schedule: unknown[]) => {
  try {
    const cfg = readConfigObject() ?? {}
    ;(cfg as any).schedule = schedule
    writeConfigObject(cfg)
    return { ok: true }
  } catch (err: any) { return { ok: false, error: err.message } }
})

// List agent sessions (for all agents)
ipcMain.handle('list-all-sessions', () => {
  const agentsDir = path.join(os.homedir(), '.openclaw', 'agents')
  if (!fs.existsSync(agentsDir)) return {}
  const result: Record<string, { count: number; size: number; latest: string }> = {}
  try {
    for (const agentId of fs.readdirSync(agentsDir)) {
      const sessDir = path.join(agentsDir, agentId, 'sessions')
      if (!fs.existsSync(sessDir)) continue
      const files = fs.readdirSync(sessDir)
      let size = 0; let latest = ''
      for (const f of files) {
        const stat = fs.statSync(path.join(sessDir, f))
        size += stat.size
        if (!latest || stat.mtime.toISOString() > latest) latest = stat.mtime.toISOString()
      }
      result[agentId] = { count: files.length, size, latest }
    }
  } catch { /* */ }
  return result
})

ipcMain.handle('clear-agent-sessions', (_e, agentId: string) => {
  const sessDir = path.join(os.homedir(), '.openclaw', 'agents', agentId, 'sessions')
  try {
    if (fs.existsSync(sessDir)) fs.readdirSync(sessDir).forEach((f) => fs.unlinkSync(path.join(sessDir, f)))
    return { ok: true }
  } catch (err: any) { return { ok: false, error: err.message } }
})

// CLI name → npm package name mapping
function cliToPackageName(cliName: string): string {
  const map: Record<string, string> = {
    'openclaw': 'openclaw',
    'openclaw-cn': 'openclaw-cn',
    'moltbot': 'openclaw',
    'clawdbot': 'openclaw',
    'clawdbot-cn': 'openclaw-cn',
  }
  return map[cliName] ?? 'openclaw'
}

/**
 * Resolve the correct npm binary to uninstall/update the package.
 *
 * macOS / Linux strategy:
 *   1. <execBinDir>/npm — same nvm/homebrew/asdf node that installed openclaw
 *   2. /bin/sh -l -c "which npm" — login shell sees full shell-profile PATH
 *   3. bare 'npm' fallback
 *
 * Windows strategy:
 *   1. <execBinDir>/npm.cmd — works for:
 *      - nvm-windows (%APPDATA%\nvm\vX\npm.cmd)
 *      - standard Node.js installer (%APPDATA%\npm\npm.cmd lives alongside package bins)
 *   2. Known fixed paths:
 *      - %ProgramFiles%\nodejs\npm.cmd  (standard MSI installer)
 *      - %APPDATA%\npm\npm.cmd          (npm global bin copy)
 *      - %ChocolateyInstall%\bin\npm.cmd
 *      - %USERPROFILE%\scoop\shims\npm.cmd
 *   3. where npm.cmd / where npm — PATH search
 *   4. bare 'npm.cmd' fallback
 */
async function resolveNpm(execPath: string): Promise<string> {
  const isWin = process.platform === 'win32'

  // Strategy 1 – same directory as the detected openclaw binary
  if (execPath) {
    const binDir = path.dirname(execPath)
    for (const name of isWin ? ['npm.cmd', 'npm'] : ['npm']) {
      const c = path.join(binDir, name)
      if (fs.existsSync(c)) return c
    }
  }

  if (!isWin) {
    // Strategy 2 macOS/Linux – login shell
    const res = await runCmd('/bin/sh -l -c "which npm"')
    if (res.ok && res.out.trim()) return res.out.trim()
    return 'npm'
  }

  // Strategy 2 Windows – known fixed installation paths
  const env = process.env
  const winCandidates = [
    // Standard Node.js MSI
    path.join(env['ProgramFiles'] ?? 'C:\\Program Files', 'nodejs', 'npm.cmd'),
    path.join(env['ProgramW6432'] ?? 'C:\\Program Files', 'nodejs', 'npm.cmd'),
    // npm global bin directory (npm puts a copy of itself here)
    env['APPDATA'] ? path.join(env['APPDATA'], 'npm', 'npm.cmd') : '',
    // Chocolatey
    env['ChocolateyInstall'] ? path.join(env['ChocolateyInstall'], 'bin', 'npm.cmd') : '',
    // Scoop
    env['USERPROFILE'] ? path.join(env['USERPROFILE'], 'scoop', 'shims', 'npm.cmd') : '',
    env['USERPROFILE'] ? path.join(env['USERPROFILE'], 'scoop', 'apps', 'nodejs', 'current', 'npm.cmd') : '',
  ].filter(Boolean)

  for (const c of winCandidates) {
    if (c && fs.existsSync(c)) return c
  }

  // Strategy 3 Windows – where command (searches PATH)
  for (const cmd of ['where npm.cmd', 'where npm']) {
    const res = await runCmd(cmd)
    if (res.ok && res.out.trim()) {
      // where can return multiple lines; pick the first
      return res.out.split(/\r?\n/)[0].trim()
    }
  }

  return 'npm.cmd' // final fallback
}

/**
 * Resolve pnpm binary.
 *
 * macOS / Linux: pnpm is in pnpmBinDir (where package binaries also live)
 * Windows: pnpm.cmd is in %LOCALAPPDATA%\pnpm\ (same dir as package binaries)
 */
async function resolvePnpm(pnpmBinDir: string): Promise<string> {
  const isWin = process.platform === 'win32'

  // pnpm executable lives in the same directory as global package binaries
  if (pnpmBinDir) {
    for (const name of isWin ? ['pnpm.cmd', 'pnpm'] : ['pnpm']) {
      const c = path.join(pnpmBinDir, name)
      if (fs.existsSync(c)) return c
    }
  }

  if (!isWin) {
    const res = await runCmd('/bin/sh -l -c "which pnpm"')
    if (res.ok && res.out.trim()) return res.out.trim()
    return 'pnpm'
  }

  // Windows candidates
  const env = process.env
  const winCandidates = [
    ...(pnpmBinDir ? [path.join(pnpmBinDir, 'pnpm.cmd')] : []),
    env['PNPM_HOME'] ? path.join(env['PNPM_HOME'], 'pnpm.cmd') : '',
    env['LOCALAPPDATA'] ? path.join(env['LOCALAPPDATA'], 'pnpm', 'pnpm.cmd') : '',
    env['APPDATA'] ? path.join(env['APPDATA'], 'npm', 'pnpm.cmd') : '',
    'C:\\Program Files\\nodejs\\pnpm.cmd',
  ]
  
  for (const c of winCandidates) {
    if (c && fs.existsSync(c)) return c
  }
  const res = await runCmd('where pnpm.cmd')
  if (res.ok && res.out.trim()) return res.out.split(/\r?\n/)[0].trim()
  return 'pnpm.cmd'
}

/**
 * Execute pm command with the resolved absolute binary.
 * shell:true handles .cmd files on Windows and bare names on all platforms.
 */
async function runPmCommand(
  event: Electron.IpcMainInvokeEvent,
  pmBin: string,
  args: string[]
): Promise<number> {
  // Use standard shell on all platforms. Explicitly passed environments will do the job.
  return spawnAndStream(event, pmBin, args, { shell: true, env: { ...process.env } })
}

// Openclaw update / uninstall (cross-platform, correct-npm-aware)
ipcMain.handle('openclaw-manage', async (
  event,
  action: 'update' | 'uninstall',
  via: 'global' | 'pnpm' = 'global',
  cliName = 'openclaw',
  execPath = '',
  pnpmBinDir = ''
) => {
  const send = (line: string, type = 'system') =>
    event.sender.send('log', { line, type, ts: Date.now() })

  const pkgName = cliToPackageName(cliName)

  // Resolve the correct package manager binary
  let pmBin: string
  if (via === 'pnpm') {
    pmBin = await resolvePnpm(pnpmBinDir)
    send(`使用 pnpm: ${pmBin}`, 'system')
  } else {
    pmBin = await resolveNpm(execPath)
    send(`使用 npm: ${pmBin}`, 'system')
  }

  if (action === 'update') {
    send(`正在更新 ${pkgName} (淘宝镜像)...`, 'system')
    const args = via === 'pnpm'
      ? ['add', '-g', `${pkgName}@latest`, '--registry=https://registry.npmmirror.com']
      : ['install', '-g', `${pkgName}@latest`, '--registry=https://registry.npmmirror.com', '--prefer-online']
    const code = await runPmCommand(event, pmBin, args)
    if (code === 0) send(`✓ ${pkgName} 更新成功`, 'success')
    else send(`✗ 更新失败 (exit ${code})`, 'error')
    return { ok: code === 0 }
  } else {
    send(`正在卸载 ${pkgName}...`, 'system')
    const args = via === 'pnpm'
      ? ['remove', '-g', pkgName]
      : ['uninstall', '-g', pkgName]
    const code = await runPmCommand(event, pmBin, args)
    if (code === 0) send(`✓ ${pkgName} 卸载成功`, 'success')
    else send(`✗ 卸载失败 (exit ${code})`, 'error')
    return { ok: code === 0 }
  }
})

ipcMain.handle('get-token-stats', () => {
  const sessionsDir = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions')
  if (!fs.existsSync(sessionsDir)) return { today: 0, week: 0, month: 0, total: 0 }
  try {
    const now = Date.now()
    const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()
    const weekStart = now - 7 * 24 * 60 * 60 * 1000
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
    let today = 0, week = 0, month = 0, total = 0

    for (const file of fs.readdirSync(sessionsDir)) {
      try {
        const filePath = path.join(sessionsDir, file)
        const stat = fs.statSync(filePath)
        const content = fs.readFileSync(filePath, 'utf-8')
        const session = JSON.parse(content)

        // Extract tokens — try multiple common formats
        let tokens = 0
        if (session.usage?.total_tokens) tokens = session.usage.total_tokens
        else if (session.usage?.input_tokens) tokens = (session.usage.input_tokens || 0) + (session.usage.output_tokens || 0)
        else if (typeof session.tokens === 'number') tokens = session.tokens
        else if (Array.isArray(session.messages)) {
          for (const msg of session.messages) {
            if (msg.usage?.total_tokens) tokens += msg.usage.total_tokens
            else if (msg.usage?.input_tokens) tokens += (msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0)
          }
        }

        // Extract timestamp — prefer field, fallback to mtime
        const ts = session.created_at ? new Date(session.created_at).getTime()
          : session.timestamp ? new Date(session.timestamp).getTime()
          : stat.mtimeMs

        total += tokens
        if (ts >= monthStart) month += tokens
        if (ts >= weekStart) week += tokens
        if (ts >= todayStart) today += tokens
      } catch { /* skip malformed file */ }
    }
    return { today, week, month, total }
  } catch { return { today: 0, week: 0, month: 0, total: 0 } }
})

// ─── Extra utility IPC ───────────────────────────────────────────────────

// Open a dedicated uninstall confirmation child window
let uninstallWindow: BrowserWindow | null = null

ipcMain.handle('show-uninstall-dialog', async (_e, packageName: string) => {
  return new Promise<{ confirmed: boolean; keepData: boolean }>((resolve) => {
    if (uninstallWindow) { uninstallWindow.focus(); return }

    uninstallWindow = new BrowserWindow({
      width: 480,
      height: 340,
      resizable: false,
      parent: mainWindow ?? undefined,
      modal: true,
      show: false,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 14, y: 14 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
      },
    })

    const query = `mode=uninstall&pkg=${encodeURIComponent(packageName)}`
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      uninstallWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${query}`)
    } else {
      uninstallWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { mode: 'uninstall', pkg: packageName } })
    }

    uninstallWindow.once('ready-to-show', () => uninstallWindow?.show())

    // Listen for result from the uninstall window
    const onResult = (
      _e: IpcMainInvokeEvent,
      result: { confirmed: boolean; keepData: boolean }
    ) => {
      ipcMain.removeHandler('uninstall-dialog-result')
      uninstallWindow?.close()
      uninstallWindow = null
      resolve(result)
    }
    ipcMain.handleOnce('uninstall-dialog-result', onResult)

    uninstallWindow.on('closed', () => {
      ipcMain.removeHandler('uninstall-dialog-result')
      uninstallWindow = null
      resolve({ confirmed: false, keepData: true })
    })
  })
})

// Check latest version from taobao npm mirror
ipcMain.handle('check-latest-version', async (_e: IpcMainInvokeEvent, packageName: string) => {
  try {
    const data = await httpsGet(`https://registry.npmmirror.com/${packageName}/latest`)
    const pkg = JSON.parse(data)
    return { ok: true, version: pkg.version as string }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})

// Run any openclaw CLI command with streaming output
ipcMain.handle('run-openclaw-cmd', async (event: IpcMainInvokeEvent, execPath: string, args: string[]) => {
  const code = await spawnAndStream(event, execPath, args, { shell: true })
  return { ok: code === 0 }
})

// OAuth login via CLI: spawns `openclaw channels login <provider>`,
// streams output via 'log' events, extracts the auth URL and emits
// it as an 'oauth-url' event (and opens it in the browser), then
// resolves when the process exits.
ipcMain.handle('oauth-login', async (event: IpcMainInvokeEvent, execPath: string, provider: string, method?: string) => {
  let args: string[] = []
  
  if (provider === 'qwen') {
    // Auto-enable plugin for Qwen
    try { await runCmd(`"${execPath}" plugins enable qwen-portal-auth`) } catch {}
    args = ['models', 'auth', 'login', '--provider', 'qwen-portal']
  } else if (provider === 'openai' && method === 'codex') {
    // OpenAI Codex uses GitHub Copilot device flow natively
    args = ['models', 'auth', 'login-github-copilot']
  } else if (provider === 'google') {
    // Auto-enable plugin for Google Gemini
    try { await runCmd(`"${execPath}" plugins enable google-gemini-cli-auth`) } catch {}
    args = ['models', 'auth', 'login', '--provider', 'google-gemini-cli']
  } else {
    args = ['models', 'auth', 'login', '--provider', provider]
    if (method) args.push('--method', method)
  }

  return new Promise<{ ok: boolean; url: string | null; error?: string }>((resolve) => {
    let urlFound: string | null = null
    let finished = false
    let proc: ChildProcess

    if (process.platform === 'win32') {
      const escapedPath = execPath.includes(' ') && !execPath.startsWith('"') ? `"${execPath}"` : execPath
      const escapedArgs = args.map(a => a.includes(' ') && !a.startsWith('"') ? `"${a}"` : a)
      const fullCmd = [escapedPath, ...escapedArgs].join(' ')
      proc = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${fullCmd}"`], {
        shell: false, windowsVerbatimArguments: true, env: process.env,
      })
    } else {
      // Ensure PNPM_HOME is in PATH so openclaw can be found if installed globally
      const env = { ...process.env }
      if (env.PNPM_HOME && !env.PATH?.includes(env.PNPM_HOME)) {
        env.PATH = `${env.PNPM_HOME}${path.delimiter}${env.PATH}`
      }
      proc = spawn(execPath, args, { shell: true, env })
    }

    const processChunk = (data: Buffer) => {
      let text = ''
      if (process.platform === 'win32') {
        try { text = iconv.decode(data, 'gbk') } catch { text = data.toString() }
      } else {
        text = data.toString()
      }
      for (const line of text.split('\n')) {
        const trimmed = line.replace(/\r$/, '')
        if (!trimmed.trim()) continue
        event.sender.send('log', { line: trimmed, type: 'info', ts: Date.now() })
        if (!urlFound) {
          const match = trimmed.match(/https?:\/\/[^\s\x00-\x1f]+/)
          if (match) {
            urlFound = match[0].replace(/[.,;]$/, '') // strip trailing punctuation
            event.sender.send('oauth-url', { url: urlFound })
            shell.openExternal(urlFound)
          }
        }
      }
    }

    proc.stdout?.on('data', processChunk)
    proc.stderr?.on('data', processChunk)
    proc.on('error', (err: Error) => {
      if (finished) return
      finished = true
      resolve({ ok: false, url: urlFound, error: err.message })
    })
    proc.on('close', (code) => {
      if (finished) return
      finished = true
      resolve({ ok: code === 0, url: urlFound })
    })
    // 5-minute timeout
    setTimeout(() => {
      if (!finished) {
        finished = true
        try { proc.kill() } catch { /* */ }
        resolve({ ok: false, url: urlFound, error: '授权超时（5分钟）' })
      }
    }, 5 * 60 * 1000)
  })
})

// Test provider connectivity and optionally list models
ipcMain.handle('test-provider', async (_e: IpcMainInvokeEvent, _provider: string, apiKey: string, modelsEndpoint: string) => {
  if (!modelsEndpoint) return { ok: true, models: [], message: '该提供商不支持自动获取模型列表' }
  try {
    const url = new URL(modelsEndpoint)
    const data = await new Promise<string>((resolve, reject) => {
      const req = require('https').request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      }, (res: any) => {
        let body = ''
        res.on('data', (c: Buffer) => body += c)
        res.on('end', () => resolve(body))
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
      req.end()
    })
    const parsed = JSON.parse(data)
    const models: string[] = (parsed.data || parsed.models || [])
      .map((m: any) => m.id || m.name || String(m)).filter(Boolean)
    return { ok: true, models }
  } catch (err: any) {
    return { ok: false, models: [], error: err.message }
  }
})

// Backup config before write
ipcMain.handle('backup-config', () => {
  const src = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  if (!fs.existsSync(src)) return { ok: false, error: '配置文件不存在' }
  const dst = path.join(os.homedir(), '.openclaw', `openclaw.json.bak.${Date.now()}`)
  try { fs.copyFileSync(src, dst); return { ok: true, path: dst } }
  catch (err: any) { return { ok: false, error: err.message } }
})

// Restore latest config backup
ipcMain.handle('restore-config', () => {
  const dir = path.join(os.homedir(), '.openclaw')
  try {
    const backups = fs.readdirSync(dir).filter(f => f.match(/^openclaw\.json\.bak\.\d+$/)).sort()
    if (!backups.length) return { ok: false, error: '没有可用的备份文件' }
    const latest = path.join(dir, backups[backups.length - 1])
    fs.copyFileSync(latest, path.join(dir, 'openclaw.json'))
    return { ok: true, restoredFrom: latest }
  } catch (err: any) { return { ok: false, error: err.message } }
})

// Full uninstall with robust per-platform sequence
ipcMain.handle('openclaw-full-uninstall', async (event: IpcMainInvokeEvent, opts: {
  keepData: boolean; via: 'global' | 'pnpm'; cliName: string; execPath: string; pnpmBinDir: string
}) => {
  const send = (line: string, type = 'system') =>
    event.sender.send('log', { line, type, ts: Date.now() })
  const { keepData, execPath, pnpmBinDir } = opts
  const isWin = process.platform === 'win32'
  const isMac = process.platform === 'darwin'

  // Collect all binary paths that need to be cleaned up
  const binaryPaths: string[] = []

  try {
    // Step 1: Stop gateway gracefully (ignore errors – may already be stopped)
    send('停止 openclaw 网关...', 'system')
    if (execPath && fs.existsSync(execPath)) {
      await runCmd(`"${execPath}" gateway stop`)
      await runCmd(`"${execPath}" gateway uninstall`)
    }

    // Step 2: Platform-specific service cleanup
    if (isWin) {
      send('清理 Windows 计划任务...', 'system')
      await runCmd('schtasks /Delete /F /TN "OpenClaw Gateway"')
      // Also clean up gateway.cmd if present
      const gwCmd = path.join(os.homedir(), '.openclaw', 'gateway.cmd')
      if (fs.existsSync(gwCmd)) fs.unlinkSync(gwCmd)
    }

    // Step 3: Remove ALL known package names via ALL available package managers
    // This is the robust approach: try every combination to ensure complete removal
    send('从所有包管理器卸载 openclaw 包...', 'system')
    const pkgNames = ['openclaw-cn', 'openclaw']  // try both
    let anyUninstalled = false

    // Collect known binary locations before removal
    for (const variant of ['openclaw', 'openclaw-cn', 'moltbot', 'clawdbot', 'clawdbot-cn']) {
      const whereRes = await runCmd(isWin ? `where ${variant}` : `which ${variant}`)
      if (whereRes.ok && whereRes.out.trim()) {
        whereRes.out.trim().split('\n').forEach(p => {
          if (p.trim()) binaryPaths.push(p.trim())
        })
      }
    }
    if (pnpmBinDir) {
      for (const variant of ['openclaw', 'openclaw-cn', 'moltbot', 'clawdbot']) {
        const p = path.join(pnpmBinDir, isWin ? `${variant}.cmd` : variant)
        if (fs.existsSync(p)) binaryPaths.push(p)
      }
    }

    // Try npm uninstall for all package names
    const npmBin = await resolveNpm(execPath)
    send(`尝试 npm 卸载 (${npmBin})...`, 'info')
    for (const pkg of pkgNames) {
      const code = await runPmCommand(event, npmBin, ['uninstall', '-g', pkg])
      if (code === 0) { send(`✓ npm: ${pkg} 已卸载`, 'success'); anyUninstalled = true }
    }

    // Try pnpm remove for all package names
    const pnpmBin = await resolvePnpm(pnpmBinDir)
    const pnpmOk = (await runCmd(`"${pnpmBin}" --version`)).ok
    if (pnpmOk) {
      send(`尝试 pnpm 卸载 (${pnpmBin})...`, 'info')
      for (const pkg of pkgNames) {
        const code = await runPmCommand(event, pnpmBin, ['remove', '-g', pkg])
        if (code === 0) { send(`✓ pnpm: ${pkg} 已卸载`, 'success'); anyUninstalled = true }
      }
    }

    if (!anyUninstalled) {
      send('⚠ 包管理器未找到可卸载的包，尝试直接删除二进制文件...', 'info')
    }

    // Step 4: Forcefully remove any remaining binary files
    // This is the safety net: even if package manager failed, binaries are gone
    const deletedBins: string[] = []
    for (const binPath of [...new Set(binaryPaths)]) {
      if (fs.existsSync(binPath)) {
        try {
          fs.unlinkSync(binPath)
          deletedBins.push(binPath)
          send(`✓ 已删除: ${binPath}`, 'success')
        } catch {
          // Some paths may be cmd wrappers for the same binary; try anyway
        }
      }
    }
    // Also delete execPath explicitly
    if (execPath && fs.existsSync(execPath)) {
      try { fs.unlinkSync(execPath); send(`✓ 已删除主二进制: ${execPath}`, 'success') } catch {}
    }

    // Step 5: macOS app bundle
    if (isMac) {
      send('移除 macOS App bundle...', 'system')
      await runCmd('rm -rf /Applications/OpenClaw.app')
    }

    // Step 6: Optionally delete config/data directory
    if (!keepData) {
      const configDir = path.join(os.homedir(), '.openclaw')
      if (fs.existsSync(configDir)) {
        send('删除配置和数据目录 (~/.openclaw)...', 'system')
        if (isWin) {
          await runCmd(`Remove-Item -Recurse -Force "${configDir}"`, 8000)
        } else {
          await runCmd(`rm -rf "${configDir}"`)
        }
        send('✓ 配置数据已删除', 'success')
      }
    } else {
      send('保留配置数据 (~/.openclaw)', 'info')
    }

    // Step 7: Final verification
    send('验证卸载结果...', 'system')
    const verifyRes = await runCmd(isWin ? 'where openclaw' : 'which openclaw')
    if (verifyRes.ok && verifyRes.out.trim()) {
      send(`⚠ 仍检测到 openclaw 命令: ${verifyRes.out.trim()}`, 'error')
      send('请手动删除该文件，或检查 shell 的 hash 缓存（执行 hash -r）', 'info')
    } else {
      send('✓ 验证通过，openclaw 命令已不可用', 'success')
    }

    send('✓ 卸载流程完成', 'success')
    return { ok: true }
  } catch (err: any) {
    send(`卸载出错: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// Window control IPC
ipcMain.handle('window-minimize', (event: IpcMainInvokeEvent) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})
ipcMain.handle('window-maximize', (event: IpcMainInvokeEvent) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.handle('window-close', (event: IpcMainInvokeEvent) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})

ipcMain.handle('app-quit', () => {
  app.quit()
})

// ─── App Lifecycle ───────────────────────────────────────────────────────

app.setName('Talon')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.talon.openclaw')
  
  if (process.platform === 'darwin') {
    app.dock.setIcon(join(__dirname, '../../resources/icon.png'))
  }

  app.on('browser-window-created', (_: any, window: BrowserWindow) => optimizer.watchWindowShortcuts(window))

  const prefs = readPrefs()
  if (prefs.securityAccepted) {
    createMainWindow()
  } else {
    createSecurityWindow()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const p = readPrefs()
      if (p.securityAccepted) createMainWindow()
      else createSecurityWindow()
    }
  })
})

app.on('window-all-closed', () => {
  gatewayProcess?.kill()
  if (process.platform !== 'darwin') app.quit()
})
