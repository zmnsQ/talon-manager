import { useState, useEffect, useRef } from 'react'
import { CheckCircle, XCircle, Terminal, Copy, ChevronRight, RefreshCcw, Loader } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import logoUrl from '../assets/logo.png'
import WindowControls from '../components/WindowControls'

type LogEntry = { line: string; type: 'info' | 'success' | 'error' | 'system'; ts: number }

interface EnvCheck {
  id: string
  name: string
  status: 'ok' | 'missing'
  detail: string
}

interface EnvState {
  platform: string
  checks: EnvCheck[]
  allOk: boolean
}

interface Props {
  onComplete: () => void
}

type Phase = 'detecting' | 'env-ok' | 'needs-setup' | 'choose-package' | 'installing' | 'done' | 'error'

export default function SetupView({ onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>('detecting')
  const [envState, setEnvState] = useState<EnvState | null>(null)
  const [detection, setDetection] = useState<any | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [currentStep, setCurrentStep] = useState<string | null>(null)
  const [stepsDone, setStepsDone] = useState<Set<string>>(new Set())
  const packageChoice = 'openclaw'
  const logEndRef = useRef<HTMLDivElement>(null)

  const api = (window as any).api

  useEffect(() => {
    const stripAnsi = (str: string) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')

    const unsub = api.onLog((entry: LogEntry) => {
      setLogs((prev: LogEntry[]) => {
        let line = stripAnsi(entry.line)
        const isUpdate = line.includes('\r')
        
        if (isUpdate) {
          const parts = line.split('\r').filter(p => p.trim() !== '')
          line = parts.length > 0 ? parts[parts.length - 1] : ''
        }

        const last = prev[prev.length - 1]
        
        // If the current line is an update (\r) or looks like a progress bar,
        // and the last line was also a normal info line, replace it.
        const looksLikeProgress = (l: string) => /^\s*[\-\|\/\\]\s*|Progress:|^[\=\>\.]{5,}/.test(l)
        
        if (last && last.type === entry.type && last.type === 'info') {
          if (isUpdate || (looksLikeProgress(line) && looksLikeProgress(last.line))) {
            const next = [...prev]
            next[next.length - 1] = { ...entry, line }
            return next
          }
        }

        if (!line.trim() && !isUpdate) return prev // Skip empty lines unless they were updates

        return [...prev, { ...entry, line }]
      })
    })
    return unsub
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    runDetection()
  }, [])

  async function runDetection() {
    setPhase('detecting')
    setLogs([])
    try {
      const [env, det] = await Promise.all([api.checkEnvironment(), api.detectOpenClaw()])
      setEnvState(env)
      setDetection(det)
      if (env.allOk && det.installed) {
        setPhase('env-ok')
      } else if (env.allOk && !det.installed) {
        setPhase('env-ok')
      } else {
        setPhase('needs-setup')
      }
    } catch (err) {
      setPhase('error')
    }
  }

  // Determine required steps based on platform and env checks
  function getRequiredSteps(): { id: string; label: string; desc: string }[] {
    if (!envState) return []
    const steps: { id: string; label: string; desc: string }[] = []
    const missing = envState.checks.filter((c: EnvCheck) => c.status === 'missing').map((c: EnvCheck) => c.id)

    if (envState.platform === 'win32') {
      if (missing.includes('ps-policy'))
        steps.push({ id: 'ps-policy', label: '开启 PowerShell 执行策略', desc: '允许 PowerShell 运行远程签名脚本' })
      if (missing.includes('git'))
        steps.push({ id: 'git-windows', label: '安装 Git', desc: '使用 winget 或下载最新安装包' })
      if (missing.includes('node'))
        steps.push({ id: 'node-windows', label: '安装 Node.js', desc: '使用 winget 或下载最新 MSI 静默安装' })
    } else if (envState.platform === 'darwin') {
      if (missing.includes('xcode'))
        steps.push({ id: 'xcode-clt', label: '安装 Xcode Command Line Tools', desc: '包含 Git，通过弹窗引导安装' })
      if (missing.includes('node'))
        steps.push({ id: 'node-macos', label: '安装 Node.js', desc: '通过 Homebrew 或下载最新 pkg 安装' })
    } else {
      if (missing.includes('git'))
        steps.push({ id: 'git-linux', label: '安装 Git', desc: '通过系统包管理器安装' })
      if (missing.includes('node'))
        steps.push({ id: 'node-linux', label: '安装 Node.js 22', desc: '通过 NodeSource 脚本安装' })
    }

    // pnpm setup + install
    const pnpmMissing = missing.includes('pnpm')
    steps.push({ 
      id: 'pnpm-setup', 
      label: pnpmMissing ? '安装并配置 pnpm' : '配置 pnpm 全局路径', 
      desc: pnpmMissing ? '通过 npm 全局安装 pnpm 并初始化环境' : '运行 pnpm setup，确保全局安装路径正确配置' 
    })
    steps.push({
      id: 'install-openclaw',
      label: `安装 ${packageChoice}`,
      desc: `通过淘宝 pnpm 镜像 (registry.npmmirror.com) 安装 ${packageChoice}`,
    })
    return steps
  }

  async function runAllSteps() {
    setPhase('installing')
    setLogs([])
    setStepsDone(new Set())
    const steps = getRequiredSteps()

    for (const step of steps) {
      setCurrentStep(step.id)
      addLog(`[步骤] ${step.label}`, 'system')
      const result = step.id === 'install-openclaw'
        ? await api.runInstallStep(step.id, packageChoice)
        : await api.runInstallStep(step.id)
      if (!result?.ok) {
        addLog(`步骤失败: ${result?.error || '未知错误'}`, 'error')
        setPhase('error')
        return
      }
      setStepsDone((prev: Set<string>) => new Set([...prev, step.id]))
      addLog(`[完成] ${step.label}`, 'success')
    }

    setCurrentStep(null)
    setPhase('done')
  }

  function addLog(line: string, type: LogEntry['type'] = 'info') {
    setLogs((prev: LogEntry[]) => [...prev, { line, type, ts: Date.now() }])
  }

  function copyLogs() {
    const text = logs.map((l) => `[${l.type.toUpperCase()}] ${l.line}`).join('\n')
    api.writeClipboard(text)
  }

  const isMac = (window.navigator.platform || '').toLowerCase().includes('mac')
  const steps = getRequiredSteps()

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: 'radial-gradient(circle at top right, #1a1a2e 0%, #07070a 60%)',
      flexDirection: 'column',
      position: 'relative',
    }}>
      <div className="top-drag-region" />
      {/* Top bar */}
      <div style={{
        paddingTop: isMac ? '44px' : '16px',
        paddingLeft: '32px',
        paddingRight: '32px',
        paddingBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        WebkitAppRegion: 'drag',
      } as any}>
        <div style={{ width: '32px', height: '32px', flexShrink: 0 }}>
          <img src={logoUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="logo" />
        </div>
        <h2 style={{ fontFamily: "'Orbitron', sans-serif", fontSize: '13px', fontWeight: 900 }}>Talon 安装向导</h2>
      </div>

      <div style={{
        flex: 1,
        display: 'flex',
        gap: '24px',
        padding: '0 32px 32px',
        minHeight: 0,
        WebkitAppRegion: 'no-drag',
      } as any}>
        {/* Left: steps list */}
        <div style={{
          width: '300px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          flexShrink: 0,
        }}>
          {/* Env check results */}
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            padding: '16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>环境检测</h4>
              {phase === 'detecting' && <Loader size={14} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />}
              {(phase !== 'detecting') && (
                <button onClick={runDetection} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                  <RefreshCcw size={12} /> 重新检测
                </button>
              )}
            </div>
            {phase === 'detecting' ? (
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>正在检测环境...</p>
            ) : envState ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {envState.checks.map((c: EnvCheck) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    {c.status === 'ok'
                      ? <CheckCircle size={15} color="#22c55e" style={{ flexShrink: 0, marginTop: '1px' }} />
                      : <XCircle size={15} color="#ff5757" style={{ flexShrink: 0, marginTop: '1px' }} />
                    }
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <p style={{ fontSize: '13px', fontWeight: 500 }}>{c.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Installation steps */}
          {(phase === 'needs-setup' || phase === 'env-ok' || phase === 'installing' || phase === 'done' || phase === 'error') && (
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              padding: '16px',
              flex: 1,
            }}>
              <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '14px' }}>
                安装步骤
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <AnimatePresence>
                  {steps.map((step, i) => {
                    const isDone = stepsDone.has(step.id)
                    const isCurrent = currentStep === step.id
                    return (
                      <motion.div 
                        key={step.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px',
                        borderRadius: '12px',
                        background: isCurrent ? 'rgba(255,87,87,0.08)' : 'transparent',
                        border: `1px solid ${isCurrent ? 'rgba(255,87,87,0.2)' : 'transparent'}`,
                        transition: 'background 0.3s, border 0.3s',
                      }}>
                        <div style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: isDone ? '#22c55e' : isCurrent ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        fontSize: '11px',
                        fontWeight: 700,
                        marginTop: '1px',
                      }}>
                        {isDone ? <CheckCircle size={12} color="white" /> :
                         isCurrent ? <Loader size={12} color="white" style={{ animation: 'spin 1s linear infinite' }} /> :
                         <span style={{ color: 'var(--text-secondary)' }}>{i + 1}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <p style={{ fontSize: '13px', fontWeight: 500, color: isDone ? '#22c55e' : isCurrent ? 'white' : 'var(--text-secondary)' }}>
                          {step.label}
                        </p>
                      </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>

        {/* Right: log panel + actions */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
          {/* Status card */}
          <AnimatePresence mode="wait">
            <motion.div 
              key={phase}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              style={{
                background: phase === 'done' ? 'rgba(34,197,94,0.06)' : phase === 'error' ? 'rgba(255,87,87,0.06)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${phase === 'done' ? 'rgba(34,197,94,0.2)' : phase === 'error' ? 'rgba(255,87,87,0.2)' : 'var(--border)'}`,
                borderRadius: '16px',
                padding: '24px',
                boxShadow: 'var(--shadow-sm)'
              }}>
              {phase === 'detecting' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}>
                    <Loader size={24} color="var(--accent)" />
                  </motion.div>
                  <div>
                    <h3 style={{ fontSize: '14px', fontWeight: 600 }}>正在检测环境...</h3>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>检查 Git、Node.js 及 OpenClaw 安装状态</p>
                  </div>
                </div>
              )}
              {phase === 'needs-setup' && (
                   <div>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>需要安装依赖环境</h3>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
                    检测到部分环境依赖缺失。点击下方按钮，管理器将自动完成所有安装步骤。
                  </p>
                    <motion.button 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={runAllSteps} style={{
                      padding: '12px 24px',
                      background: 'var(--accent)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      boxShadow: 'var(--shadow-sm)'
                    }}>
                      <ChevronRight size={16} /> 开始安装
                    </motion.button>
                  </div>
                )}
            {phase === 'env-ok' && (
              <div>
                {detection?.installed ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                      <CheckCircle size={24} color="#22c55e" />
                      <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#22c55e' }}>检测到已安装 OpenClaw</h3>
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
                      你在系统中已经安装过 OpenClaw {detection.version ? `(${detection.version})` : ''}。你可以直接进入管理界面，或者重新安装。
                    </p>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <motion.button 
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={onComplete}
                        style={{
                          padding: '12px 24px',
                          background: '#22c55e',
                          color: 'white',
                          border: 'none',
                          borderRadius: '12px',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          boxShadow: '0 4px 12px rgba(34,197,94,0.2)'
                        }}>
                        <ChevronRight size={16} /> 直接进入
                      </motion.button>
                      <button 
                        onClick={runAllSteps}
                        style={{
                          padding: '12px 20px',
                          background: 'rgba(255,255,255,0.05)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border)',
                          borderRadius: '12px',
                          fontSize: '13px',
                          cursor: 'pointer',
                        }}>
                        重新安装
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>环境就绪，OpenClaw 未安装</h3>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                      环境检测通过，将通过 pnpm 安装官方版本。
                    </p>
                    <button onClick={runAllSteps} style={{
                      padding: '12px 24px',
                      background: 'var(--accent)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}>
                      <ChevronRight size={16} /> 安装 OpenClaw
                    </button>
                  </>
                )}
              </div>
            )}
            {phase === 'installing' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Loader size={20} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
                <div>
                  <h3 style={{ fontSize: '13px', fontWeight: 600 }}>安装中...</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>请勿关闭窗口</p>
                </div>
              </div>
            )}
            {phase === 'done' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <CheckCircle size={24} color="#22c55e" />
                  <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#22c55e' }}>安装成功！</h3>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  所有组件已安装完毕，正在进入管理界面...
                </p>
                <button onClick={onComplete} style={{
                  padding: '12px 24px',
                  background: '#22c55e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <ChevronRight size={16} /> 进入管理界面
                </button>
              </div>
            )}
            {phase === 'error' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <XCircle size={24} color="#ff5757" />
                  <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#ff5757' }}>安装失败</h3>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  安装过程中发生错误，请复制下方日志发送给开发者以协助定位问题。
                </p>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button onClick={runDetection} style={{
                    padding: '10px 20px',
                    background: 'rgba(255,255,255,0.05)',
                    color: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}>
                    <RefreshCcw size={14} /> 重新检测
                  </button>
                  <button onClick={runAllSteps} style={{
                    padding: '10px 20px',
                    background: 'rgba(255,87,87,0.1)',
                    color: 'var(--accent)',
                    border: '1px solid rgba(255,87,87,0.2)',
                    borderRadius: '10px',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}>
                    重试安装
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

          {/* Log Terminal */}
          <div style={{
            flex: 1,
            background: '#000',
            border: '1px solid var(--border)',
            borderRadius: '14px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}>
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(255,255,255,0.02)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <Terminal size={13} />
                安装日志
              </div>
              {logs.length > 0 && (
                <button onClick={copyLogs} style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  color: 'var(--text-secondary)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}>
                  <Copy size={11} /> 复制日志
                </button>
              )}
            </div>
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '14px 16px',
              fontFamily: 'monospace',
              fontSize: '12px',
              lineHeight: '1.7',
            }}>
              {logs.length === 0 ? (
                <p style={{ color: 'rgba(255,255,255,0.2)' }}>等待操作...</p>
              ) : (
                logs.map((log: LogEntry, i: number) => (
                  <div key={i} style={{
                    color: log.type === 'success' ? '#22c55e' :
                           log.type === 'error' ? '#ff5757' :
                           log.type === 'system' ? '#a78bfa' : '#94a3b8',
                    wordBreak: 'break-all',
                  }}>
                    {log.type === 'system' ? `\u25B6 ${log.line}` :
                     log.type === 'success' ? `\u2713 ${log.line}` :
                     log.type === 'error' ? `\u2717 ${log.line}` :
                     `  ${log.line}`}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>
      <WindowControls />
    </div>
  )
}
