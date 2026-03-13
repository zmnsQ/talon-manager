import React, { useState, useEffect, useRef } from 'react'
import {
  Activity, Settings, Terminal, MessageSquare, ShieldCheck,
  PanelLeftClose, Database, RefreshCcw, Clock, Zap, Radio, 
  Trash2, Copy, Github, Power, Save, 
  Cpu, Eye, EyeOff, FolderOpen, Info, Download, Plus
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import logoUrl from '../assets/logo.png'
import WindowControls from '../components/WindowControls'
import ChatTab from './ChatTab'
import ChannelsTab from './ChannelsTab'
import CronTab from './CronTab'
import ConfigTab from './ConfigTab'

// Defined outside component – stable reference for AnimatePresence/framer-motion
const PageTransition = ({ children }: { children: React.ReactNode }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.18 }}
    style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}
  >
    {children}
  </motion.div>
)

type LogEntry = { line: string; type: 'info' | 'success' | 'error' | 'system'; ts: number }

interface Detection {
  installed: boolean
  primary: { name: string; execPath: string; via: 'global' | 'pnpm' } | null
  found: { name: string; execPath: string; via: 'global' | 'pnpm' }[]
  version: string
  configDir: string | null
  configFile: string | null
  configData: Record<string, unknown> | null
  nodeVersion: string | null
  npmVersion: string | null
  pnpmBinDir: string
}


interface Skill { name: string; title: string; content: string }

interface Props { detection: Detection; onReinstall: () => void }

interface TokenStats { today: number; week: number; month: number; total: number }

// Threshold below which sidebar auto-collapses
const SIDEBAR_COLLAPSE_WIDTH = 980

export default function MainView({ detection: initialDetection, onReinstall }: Props) {
  const [activeTab, setActiveTab] = useState('install')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  // Track whether the user manually toggled; resets when window crosses threshold
  const sidebarManual = useRef(false)
  const [detection, setDetection] = useState<Detection>(initialDetection)

  // Gateway
  const [gatewayRunning, setGatewayRunning] = useState(false)
  const [gatewayExternal, setGatewayExternal] = useState(false)

  // Logs tab
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [copied, setCopied] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)



  // Skills tab
  const [skills, setSkills] = useState<Skill[]>([])
  const [plugins, setPlugins] = useState<any[]>([])
  const [skillsLoaded, setSkillsLoaded] = useState(false)

  // Memory tab
  const [allSessions, setAllSessions] = useState<Record<string, { count: number; size: number; latest: string }>>({})
  const [agentsList, setAgentsList] = useState<any[]>([])
  const [agentsMd, setAgentsMd] = useState<string | null>(null)
  const [soulMd, setSoulMd] = useState<string | null>(null)
  const [editingAgentsMd, setEditingAgentsMd] = useState(false)
  const [agentsMdDraft, setAgentsMdDraft] = useState('')
  const [memoryLoaded, setMemoryLoaded] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [addingAgent, setAddingAgent] = useState(false)

  // Settings tab
  const [sysInfo, setSysInfo] = useState<any>(null)

  // Dashboard – token stats
  const [tokenStats, setTokenStats] = useState<TokenStats | null>(null)

  // Web UI token management
  const [webToken, setWebToken] = useState<string | null>(null)
  const [showToken, setShowToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)

  // Version check
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [checkingVersion, setCheckingVersion] = useState(false)
  const [versionChecked, setVersionChecked] = useState(false)

  const api = (window as any).api
  const isMac = (window.navigator.platform || '').toLowerCase().includes('mac')

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    api.gatewayStatus().then((status: any) => {
      if (status?.running) { setGatewayRunning(true); setGatewayExternal(status.external === true) }
    })
    // Load token on mount (dashboard is default tab)
    loadWebToken()
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
        const looksLikeProgress = (l: string) => /^\s*[\-\|\/\\]\s*|Progress:|^[\=\>\.]{5,}/.test(l)
        if (last && last.type === entry.type && last.type === 'info') {
          if (isUpdate || (looksLikeProgress(line) && looksLikeProgress(last.line))) {
            const next = [...prev]
            next[next.length - 1] = { ...entry, line }
            return next
          }
        }
        if (!line.trim() && !isUpdate) return prev
        return [...prev, { ...entry, line }]
      })
    })
    const unsubStop = api.onGatewayStopped(() => { setGatewayRunning(false); setGatewayExternal(false) })
    const unsubExt = api.onGatewayExternal(() => { setGatewayRunning(true); setGatewayExternal(true) })
    return () => { unsub(); unsubStop(); unsubExt() }
  }, [])

  // ── Sidebar auto-collapse based on window width ────────────────────────
  useEffect(() => {
    function handleResize() {
      const narrow = window.innerWidth < SIDEBAR_COLLAPSE_WIDTH
      // Only auto-manage if user hasn't just manually toggled
      if (!sidebarManual.current) {
        setIsSidebarCollapsed(narrow)
      } else if (!narrow) {
        // Window is wide again — reset manual flag so auto-expand can work
        sidebarManual.current = false
        setIsSidebarCollapsed(false)
      }
    }
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs])

  useEffect(() => {
    if (activeTab === 'settings') loadSysInfo()
    if (activeTab === 'skills' && !skillsLoaded) loadSkills()
    if (activeTab === 'memory' && !memoryLoaded) loadMemory()
    if (activeTab === 'install') { loadTokenStats(); loadWebToken() }
  }, [activeTab])

  // ── Data Loaders ──────────────────────────────────────────────────────────
  async function loadSysInfo() {
    const info = await api.getSystemInfo()
    setSysInfo(info)
  }

  async function loadTokenStats() {
    const stats = await api.getTokenStats()
    setTokenStats(stats)
  }

  async function loadSkills() {
    const [skillData, pluginData] = await Promise.all([api.listSkills(), api.listPlugins()])
    setSkills(skillData ?? [])
    setPlugins(pluginData ?? [])
    setSkillsLoaded(true)
  }

  async function loadMemory() {
    const [sessData, agentsCfg, agentsMdContent, soulMdContent] = await Promise.all([
      api.listAllSessions(),
      api.getAgentsConfig(),
      api.readWorkspaceFile('AGENTS.md'),
      api.readWorkspaceFile('SOUL.md'),
    ])
    setAllSessions(sessData ?? {})
    setAgentsList(agentsCfg?.list ?? [])
    setAgentsMd(agentsMdContent)
    setSoulMd(soulMdContent)
    setMemoryLoaded(true)
  }

  async function clearAgentSessions(agentId: string) {
    await api.clearAgentSessions(agentId)
    await loadMemory()
  }

  async function loadWebToken() {
    const token = await api.getGatewayToken()
    setWebToken(token)
  }

  async function resetWebToken() {
    const result = await api.resetGatewayToken()
    if (result.ok) setWebToken(result.token)
  }

  async function checkVersion() {
    if (!detection.primary) return
    setCheckingVersion(true)
    setVersionChecked(false)
    const pkgName = detection.primary.name === 'openclaw' ? 'openclaw' : 'openclaw-cn'
    const result = await api.checkLatestVersion(pkgName)
    setCheckingVersion(false)
    setVersionChecked(true)
    if (result.ok) setLatestVersion(result.version)
  }

  function isNewerVersion(latest: string, current: string): boolean {
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
    const [la, lb, lc] = parse(latest)
    const [ca, cb, cc] = parse(current)
    if (la !== ca) return la > ca
    if (lb !== cb) return lb > cb
    return lc > cc
  }

  async function addAgent() {
    if (!newAgentName.trim() || !detection.primary) return
    setAddingAgent(true)
    await api.addAgentCli(detection.primary.execPath, newAgentName.trim())
    setNewAgentName('')
    setAddingAgent(false)
    setMemoryLoaded(false)
    loadMemory()
  }

  async function refreshDetection() {
    const det = await api.detectOpenClaw()
    setDetection(det)
  }

  async function restartGateway() {
    if (!detection.primary) return
    if (gatewayRunning) {
      await api.stopGateway(detection.primary.execPath)
      setGatewayRunning(false)
      setGatewayExternal(false)
      // Brief pause then restart
      await new Promise((r) => setTimeout(r, 800))
    }
    setLogs([])
    const result = await api.startGateway(detection.primary.execPath, detection.primary.via)
    if (result?.ok) { setGatewayRunning(true); setGatewayExternal(result.alreadyRunning === true) }
  }

  async function toggleGateway() {
    if (!detection.primary) return
    if (gatewayRunning) {
      await api.stopGateway(detection.primary.execPath)
      setGatewayRunning(false)
      setGatewayExternal(false)
    } else {
      setLogs([])
      const result = await api.startGateway(detection.primary.execPath, detection.primary.via)
      if (result?.ok) { setGatewayRunning(true); setGatewayExternal(result.alreadyRunning === true) }
    }
  }

  function copyLogs() {
    api.writeClipboard(logs.map((l: LogEntry) => `[${l.type.toUpperCase()}] ${l.line}`).join('\n'))
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  function formatTokens(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return `${n}`
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  // ── Uninstall ─────────────────────────────────────────────────────────────
  const [uninstalling, setUninstalling] = useState(false)

  async function doUninstall() {
    if (!detection.primary) return
    const result = await api.showUninstallDialog(detection.primary.name)
    if (!result?.confirmed) return

    setUninstalling(true)
    setLogs([])
    setActiveTab('logs')
    await api.openclawFullUninstall({
      keepData: result.keepData,
      via: detection.primary.via,
      cliName: detection.primary.name,
      execPath: detection.primary.execPath,
      pnpmBinDir: detection.pnpmBinDir,
    })
    setUninstalling(false)

    // Re-detect after uninstall to get fresh state
    const freshDet = await api.detectOpenClaw()
    setDetection(freshDet)

    if (!freshDet.installed) {
      // Openclaw successfully removed — transition to setup/install flow
      // Small delay so the user can see the "卸载完成" log message
      setTimeout(() => onReinstall(), 1500)
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  const navItems = [
    { id: 'install', label: '控制台', icon: Activity },
    { id: 'chat', label: '对话', icon: MessageSquare },
    { id: 'channels', label: '频道管理', icon: Radio },
    { id: 'skills', label: '技能扩展', icon: Zap },
    { id: 'cron', label: '定时任务', icon: Clock },
    { id: 'memory', label: '记忆管理', icon: Database },
    { id: 'logs', label: '网关日志', icon: Terminal },
    { id: 'config', label: '配置管理', icon: ShieldCheck },
    { id: 'settings', label: '全局设置', icon: Settings },
  ]

  return (
    <div className="app-container" style={{ position: 'relative' }}>
      {/* ── Sidebar ── */}
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`} style={{ paddingTop: isMac ? '60px' : '30px' }}>
        <div
          className="logo-container"
          style={{ marginBottom: '18px', display: 'flex', alignItems: 'center', cursor: 'pointer', paddingLeft: isSidebarCollapsed ? '0' : '4px', justifyContent: isSidebarCollapsed ? 'center' : 'flex-start' }}
          onClick={() => { sidebarManual.current = true; setIsSidebarCollapsed(!isSidebarCollapsed) }}
        >
          <div style={{ width: '32px', height: '32px', flexShrink: 0 }}>
            <img src={logoUrl} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <span style={{ marginLeft: isSidebarCollapsed ? '0' : '12px', opacity: isSidebarCollapsed ? 0 : 1, width: isSidebarCollapsed ? '0' : '125px', overflow: 'hidden', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)' }}>
            <h2 className="tech-font" style={{ fontSize: '14px', fontWeight: 900 }}>Talon</h2>
            <PanelLeftClose size={15} style={{ color: 'var(--text-secondary)', opacity: 0.6 }} strokeWidth={1.5} />
          </span>
        </div>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <motion.div 
                key={item.id} 
                className="nav-item"
                whileHover={{ scale: isActive ? 1 : 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveTab(item.id)} 
                title={isSidebarCollapsed ? item.label : undefined}
                style={{
                  position: 'relative',
                  padding: isSidebarCollapsed ? '12px' : '12px 16px',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                  color: isActive ? 'white' : 'var(--text-secondary)',
                  transition: 'color 0.3s ease'
                }}
              >
                {isActive && (
                  <motion.div 
                    layoutId="sidebar-active-indicator"
                    style={{ position: 'absolute', inset: 0, background: 'var(--accent)', borderRadius: '12px', zIndex: 0, boxShadow: 'var(--shadow-sm)' }}
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center' }}>
                  <item.icon size={16} strokeWidth={isActive ? 2.5 : 2} style={{ flexShrink: 0, transition: 'all 0.3s' }} />
                  <span style={{ 
                    marginLeft: isSidebarCollapsed ? '0' : '14px', 
                    opacity: isSidebarCollapsed ? 0 : 1, 
                    width: isSidebarCollapsed ? '0' : '110px', 
                    overflow: 'hidden', 
                    whiteSpace: 'nowrap', 
                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: '13px'
                  }}>
                    {item.label}
                  </span>
                </div>
              </motion.div>
            )
          })}
        </nav>

        <div style={{ paddingBottom: '16px' }}>
          <motion.div 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="nav-item" 
            onClick={() => api.openExternal('https://github.com/zmnsQ/talon-manager')} 
            title={isSidebarCollapsed ? '开源仓库' : undefined}
            style={{
              position: 'relative',
              padding: isSidebarCollapsed ? '12px' : '12px 16px',
              borderRadius: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
              color: 'var(--text-secondary)',
              transition: 'background 0.2s, color 0.2s'
            }}
          >
            <Github size={18} strokeWidth={2} style={{ flexShrink: 0 }} />
            <span style={{ 
              marginLeft: isSidebarCollapsed ? '0' : '14px', 
              opacity: isSidebarCollapsed ? 0 : 1, 
              width: isSidebarCollapsed ? '0' : '110px', 
              overflow: 'hidden', 
              whiteSpace: 'nowrap', 
              transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              fontWeight: 500,
              fontSize: '13px'
            }}>
              开源仓库
            </span>
          </motion.div>
        </div>
      </aside>

      {/* ── Content ── */}
      <main className="content-area" style={{ paddingTop: isMac ? '30px' : '60px' }}>
        <div className="top-drag-region" />

        {/* Status bar — non-interactive glowing dot only */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px', alignItems: 'center', gap: '8px' }}>
          {detection.primary && (
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
              {detection.primary.name}{detection.version ? ` ${detection.version}` : ''}
            </span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: !detection.installed ? '#475569' : gatewayRunning ? '#22c55e' : '#f59e0b',
              boxShadow: gatewayRunning ? '0 0 0 3px rgba(34,197,94,0.25), 0 0 8px rgba(34,197,94,0.5)' :
                         !detection.installed ? 'none' : '0 0 0 3px rgba(245,158,11,0.2)',
              transition: 'all 0.4s ease',
            }} />
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              {!detection.installed ? '未安装' : gatewayRunning ? '运行中' : '已停止'}
            </span>
          </div>
        </div>

        {/* ────────────────────── Tab Content ────────────────────── */}
        <AnimatePresence mode="wait">

          {/* ── Chat ── */}
          {activeTab === 'chat' && (
            <PageTransition key="chat">
              <ChatTab
                execPath={detection.primary?.execPath ?? null}
                via={detection.primary?.via ?? 'global'}
                gatewayRunning={gatewayRunning}
                agents={agentsList.length ? agentsList.map((a: any) => a.id) : ['main']}
              />
            </PageTransition>
          )}

          {/* ── Channels ── */}
          {activeTab === 'channels' && (
            <PageTransition key="channels">
              <ChannelsTab />
            </PageTransition>
          )}

          {/* ── Skills ── */}
          {activeTab === 'skills' && (
            <PageTransition key="skills">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 className="tech-font" style={{ fontSize: '14px' }}>技能扩展</h2>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => api.openExternal('https://clawhub.io')} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 14px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer' }}>
                    浏览技能库
                  </button>
                  <button onClick={() => { setSkillsLoaded(false); loadSkills() }} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 14px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <RefreshCcw size={12} /> 刷新
                  </button>
                </div>
              </div>

              {skills.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
                  <Zap size={36} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                  <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '8px' }}>未找到已安装的技能</p>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>技能目录: ~/.openclaw/workspace/skills/</p>
                  <button onClick={() => api.openConfigDir()} style={{ marginTop: '16px', background: 'rgba(255,87,87,0.1)', border: '1px solid rgba(255,87,87,0.2)', borderRadius: '8px', padding: '8px 16px', color: 'var(--accent)', fontSize: '13px', cursor: 'pointer' }}>
                    打开技能目录
                  </button>
                </div>
              ) : (
                <div className="grid" style={{ marginTop: 0 }}>
                  {skills.map((skill: Skill) => (
                    <div key={skill.name} className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(255,87,87,0.1)', border: '1px solid rgba(255,87,87,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Zap size={16} color="var(--accent)" />
                          </div>
                          <div>
                            <h4 style={{ fontSize: '13px', fontWeight: 600 }}>{skill.title || skill.name}</h4>
                            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{skill.name}</p>
                          </div>
                        </div>
                        {/* Toggle */}
                        <div style={{ width: '34px', height: '18px', background: 'var(--accent)', borderRadius: '10px', position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
                          <div style={{ width: '14px', height: '14px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: '18px', transition: '0.2s' }} />
                        </div>
                      </div>
                      {skill.content && (
                        <p style={{ color: 'var(--text-secondary)', fontSize: '12px', lineHeight: '1.6', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>
                          {skill.content.replace(/^#+.*$/mg, '').trim().slice(0, 120)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Plugins section */}
              {plugins.length > 0 && (
                <div style={{ marginTop: '24px' }}>
                  <h3 style={{ fontSize: '13px', marginBottom: '14px', color: 'var(--text-secondary)' }}>已安装插件</h3>
                  <div className="grid" style={{ marginTop: 0 }}>
                    {plugins.map((plugin: any) => (
                      <div key={plugin.id} className="card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Zap size={14} color="#3b82f6" />
                            </div>
                            <p style={{ fontWeight: 600, fontSize: '13px', fontFamily: 'monospace' }}>{plugin.id}</p>
                          </div>
                          <div style={{ width: '32px', height: '18px', background: plugin.enabled ? '#22c55e' : '#333', borderRadius: '9px', position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
                            <div style={{ width: '14px', height: '14px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: plugin.enabled ? '16px' : '2px', transition: '0.2s' }} />
                          </div>
                        </div>
                        <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {plugin.enabled ? '● 已启用' : '○ 已禁用'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </PageTransition>
          )}

          {/* ── Cron ── */}
          {activeTab === 'cron' && (
            <PageTransition key="cron">
              <CronTab />
            </PageTransition>
          )}

          {/* ── Memory ── */}
          {activeTab === 'memory' && (
            <PageTransition key="memory">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 className="tech-font" style={{ fontSize: '14px' }}>记忆管理</h2>
                <button onClick={() => { setMemoryLoaded(false); loadMemory() }} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 14px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <RefreshCcw size={12} /> 刷新
                </button>
              </div>

              {/* Multi-agent sessions */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '12px' }}>Agent 会话记忆</h4>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} placeholder="新 Agent ID" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: '7px', padding: '6px 10px', color: 'white', fontSize: '12px', outline: 'none', width: '130px' }} />
                    <button onClick={addAgent} disabled={!newAgentName.trim() || addingAgent || !detection.primary} style={{ padding: '6px 12px', background: 'rgba(255,87,87,0.1)', border: '1px solid rgba(255,87,87,0.2)', borderRadius: '7px', color: 'var(--accent)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', opacity: (!newAgentName.trim() || !detection.primary) ? 0.4 : 1 }}>
                      <Plus size={12} /> 添加
                    </button>
                  </div>
                </div>

                {Object.keys(allSessions).length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', padding: '24px' }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>暂无 Agent 会话记录</p>
                  </div>
                ) : (
                  <div className="grid" style={{ marginTop: 0 }}>
                    {Object.entries(allSessions).map(([agentId, info]) => (
                      <div key={agentId} className="card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Cpu size={14} color="#a78bfa" />
                          </div>
                          <div>
                            <p style={{ fontWeight: 600, fontSize: '12px', fontFamily: 'monospace' }}>{agentId}</p>
                            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                              {info.count} 条会话 · {formatSize(info.size)}
                            </p>
                          </div>
                        </div>
                        {info.latest && (
                          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                            最新: {new Date(info.latest).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                        <button onClick={() => clearAgentSessions(agentId)} style={{ width: '100%', padding: '8px', background: 'rgba(255,87,87,0.06)', border: '1px solid rgba(255,87,87,0.15)', borderRadius: '8px', color: '#ff5757', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                          <Trash2 size={12} /> 清除会话
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* AGENTS.md editor */}
              <div className="card" style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '12px' }}>AGENTS.md — Agent 行为指令</h4>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {editingAgentsMd ? (
                      <>
                        <button onClick={() => setEditingAgentsMd(false)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px 10px', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}>取消</button>
                        <button onClick={async () => { await api.writeWorkspaceFile('AGENTS.md', agentsMdDraft); setAgentsMd(agentsMdDraft); setEditingAgentsMd(false) }} style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '6px', padding: '5px 10px', color: '#22c55e', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Save size={11} /> 保存
                        </button>
                      </>
                    ) : (
                      <button onClick={() => { setAgentsMdDraft(agentsMd ?? ''); setEditingAgentsMd(true) }} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px 10px', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}>编辑</button>
                    )}
                  </div>
                </div>
                {editingAgentsMd ? (
                  <textarea value={agentsMdDraft} onChange={(e) => setAgentsMdDraft(e.target.value)} style={{ width: '100%', height: '160px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.6', resize: 'vertical', outline: 'none' }} />
                ) : (
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6', maxHeight: '140px', overflowY: 'auto' }}>
                    {agentsMd ?? '(未创建 — 点击编辑进行创建)'}
                  </pre>
                )}
              </div>

              {soulMd && (
                <div className="card">
                  <h4 style={{ fontSize: '12px', marginBottom: '10px' }}>SOUL.md — Agent 人设</h4>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6', maxHeight: '120px', overflowY: 'auto' }}>
                    {soulMd}
                  </pre>
                </div>
              )}
            </PageTransition>
          )}

          {/* ── Logs ── */}
          {activeTab === 'logs' && (
            <PageTransition key="logs">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 className="tech-font" style={{ fontSize: '14px' }}>网关日志</h2>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {logs.length > 0 && (
                    <button onClick={copyLogs} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 14px', color: copied ? '#22c55e' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Copy size={12} /> {copied ? '已复制' : '复制日志'}
                    </button>
                  )}
                  <button onClick={() => setLogs([])} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 14px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer' }}>清除</button>
                  <button onClick={toggleGateway} disabled={!detection.installed} style={{ background: gatewayRunning ? 'rgba(255,87,87,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${gatewayRunning ? 'rgba(255,87,87,0.2)' : 'rgba(34,197,94,0.2)'}`, borderRadius: '8px', padding: '8px 14px', color: gatewayRunning ? '#ff5757' : '#22c55e', fontSize: '12px', fontWeight: 600, cursor: detection.installed ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {gatewayRunning ? <><Power size={12} /> 停止</> : <><Activity size={12} /> 启动网关</>}
                  </button>
                </div>
              </div>
              <div style={{ flex: 1, background: '#000', borderRadius: '14px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: gatewayRunning ? '#22c55e' : '#475569', boxShadow: gatewayRunning ? '0 0 6px #22c55e' : 'none' }} />
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                    {detection.primary?.name || 'openclaw'} gateway · :18789
                  </span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.7' }}>
                  {logs.length === 0
                    ? <div style={{ color: 'rgba(255,255,255,0.2)' }}>{gatewayRunning ? '等待日志输出...' : '网关未运行'}</div>
                    : logs.map((log: LogEntry, i: number) => (
                      <div key={i} style={{ color: log.type === 'success' ? '#22c55e' : log.type === 'error' ? '#ff5757' : log.type === 'system' ? '#a78bfa' : '#94a3b8', wordBreak: 'break-all' }}>
                        <span style={{ color: 'rgba(255,255,255,0.2)', marginRight: '8px', userSelect: 'none' }}>
                          {new Date(log.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                        </span>
                        {log.line}
                      </div>
                    ))
                  }
                  <div ref={logEndRef} />
                </div>
              </div>
            </PageTransition>
          )}

          {/* ── Config ── */}
          {activeTab === 'config' && (
            <PageTransition key="config">
              <ConfigTab />
            </PageTransition>
          )}

          {/* ── 控制台 ── */}
          {activeTab === 'install' && (
            <PageTransition key="install">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 className="tech-font" style={{ fontSize: '14px' }}>控制台</h2>
                <button onClick={() => { refreshDetection(); loadTokenStats(); loadWebToken() }} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px 10px', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <RefreshCcw size={11} /> 刷新
                </button>
              </div>

              {/* Row 1: Token + Control Web UI side by side */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>

                {/* Token stats — compact left card */}
                <div className="card" style={{ flex: '0 0 210px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>Token 消耗</p>
                    <button onClick={loadTokenStats} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><RefreshCcw size={10} /></button>
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    <p style={{ fontSize: '11px', color: '#22c55e', fontWeight: 600, marginBottom: '4px' }}>今日</p>
                    <p style={{ fontSize: '28px', fontWeight: 900, fontFamily: 'monospace', color: '#22c55e', lineHeight: 1 }}>
                      {tokenStats === null ? '—' : formatTokens(tokenStats.today)}
                    </p>
                  </div>
                  {[
                    { label: '7 天', value: tokenStats?.week ?? 0, color: '#3b82f6' },
                    { label: '30 天', value: tokenStats?.month ?? 0, color: '#a78bfa' },
                    { label: '累计', value: tokenStats?.total ?? 0, color: 'var(--text-secondary)' },
                  ].map(row => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{row.label}</span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: row.color }}>{tokenStats === null ? '...' : formatTokens(row.value)}</span>
                    </div>
                  ))}
                </div>

                {/* Control Web UI card — right, with integrated gateway controls */}
                <div className="card" style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: gatewayRunning ? '#22c55e' : '#475569', boxShadow: gatewayRunning ? '0 0 6px rgba(34,197,94,0.7)' : 'none', transition: 'all 0.3s' }} />
                      <div>
                        <h4 style={{ fontSize: '12px' }}>Control Web UI</h4>
                        <p style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '1px' }}>localhost:18789 · {gatewayRunning ? (gatewayExternal ? '外部运行' : '运行中') : '未运行'}</p>
                      </div>
                    </div>
                    {/* Gateway controls in top-right of card */}
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      {gatewayRunning ? (
                        <>
                          <button onClick={toggleGateway} disabled={!detection.installed} style={{ padding: '5px 10px', background: 'rgba(255,87,87,0.1)', border: '1px solid rgba(255,87,87,0.25)', borderRadius: '6px', color: '#ff5757', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Power size={11} /> 停止
                          </button>
                          <button onClick={restartGateway} disabled={!detection.installed} style={{ padding: '5px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <RefreshCcw size={11} /> 重启
                          </button>
                        </>
                      ) : (
                        <button onClick={toggleGateway} disabled={!detection.installed} style={{ padding: '5px 12px', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '6px', color: '#22c55e', fontSize: '11px', fontWeight: 700, cursor: detection.installed ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '4px', boxShadow: '0 0 10px rgba(34,197,94,0.15)' }}>
                          <Activity size={11} /> 启动网关
                        </button>
                      )}
                    </div>
                  </div>

                  <button onClick={() => api.openExternal('http://localhost:18789')} disabled={!gatewayRunning} style={{ width: '100%', padding: '9px', background: gatewayRunning ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.02)', border: `1px solid ${gatewayRunning ? 'rgba(59,130,246,0.25)' : 'var(--border)'}`, borderRadius: '8px', color: gatewayRunning ? '#60a5fa' : 'var(--text-secondary)', fontSize: '12px', fontWeight: 600, cursor: gatewayRunning ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '10px', transition: 'all 0.2s' }}>
                    {gatewayRunning ? '在浏览器中打开' : '需先启动网关'}
                  </button>

                  {/* Token section */}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>访问令牌</p>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button onClick={() => setShowToken(!showToken)} style={{ padding: '3px 7px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-secondary)', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
                          {showToken ? <EyeOff size={10} /> : <Eye size={10} />}
                        </button>
                        {webToken && (
                          <button onClick={() => { api.writeClipboard(webToken); setTokenCopied(true); setTimeout(() => setTokenCopied(false), 2000) }} style={{ padding: '3px 7px', background: tokenCopied ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${tokenCopied ? 'rgba(34,197,94,0.2)' : 'var(--border)'}`, borderRadius: '5px', color: tokenCopied ? '#22c55e' : 'var(--text-secondary)', fontSize: '10px', cursor: 'pointer' }}>
                            {tokenCopied ? '✓' : '复制'}
                          </button>
                        )}
                        <button onClick={resetWebToken} style={{ padding: '3px 7px', background: 'rgba(255,87,87,0.06)', border: '1px solid rgba(255,87,87,0.15)', borderRadius: '5px', color: '#ff5757', fontSize: '10px', cursor: 'pointer' }}>
                          重置
                        </button>
                      </div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '6px', padding: '6px 10px', fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-secondary)', wordBreak: 'break-all', letterSpacing: showToken ? 'normal' : '0.12em' }}>
                      {webToken ? (showToken ? webToken : '•'.repeat(Math.min(webToken.length, 36))) : '未设置（点击重置生成）'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 2: Quick Actions */}
              <div className="card">
                <h4 style={{ fontSize: '12px', marginBottom: '12px' }}>快速操作</h4>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[
                    { label: '自动修复', desc: 'openclaw doctor', color: '#22c55e', icon: '🔧', action: () => detection.primary && api.runOpenclawCmd(detection.primary.execPath, ['doctor']) },
                    { label: '强制重启网关', desc: '停止后立即重启', color: '#3b82f6', icon: '⟳', action: restartGateway },
                    { label: '回滚配置', desc: '恢复上次保存的备份', color: '#f59e0b', icon: '↩', action: async () => { const r = await api.restoreConfig(); if (r.ok) alert('配置已回滚') } },
                    { label: '网关健康检查', desc: 'gateway health', color: '#a78bfa', icon: '❤', action: () => { setLogs([]); setActiveTab('logs'); detection.primary && api.runOpenclawCmd(detection.primary.execPath, ['gateway', 'health']) } },
                    { label: '完全卸载', desc: '彻底从本机移除', color: '#ef4444', icon: '🗑', action: doUninstall },
                    { label: '查看日志', desc: '跳转到日志页面', color: 'var(--text-secondary)', icon: '📋', action: () => setActiveTab('logs') },
                  ].map(item => (
                    <button
                      key={item.label}
                      onClick={item.action}
                      disabled={item.label !== '回滚配置' && item.label !== '查看日志' && !detection.installed}
                      style={{ 
                        padding: '10px 16px', 
                        background: `${item.color}11`, 
                        border: `1px solid ${item.color}33`, 
                        borderRadius: '12px', 
                        color: item.color, 
                        fontSize: '11px', 
                        fontWeight: 600, 
                        cursor: 'pointer', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        opacity: (item.label !== '回滚配置' && item.label !== '查看日志' && !detection.installed) ? 0.35 : 1, 
                        transition: 'all 0.15s',
                        boxShadow: item.label === '完全卸载' ? '0 1px 4px rgba(239, 68, 68, 0.1)' : 'none'
                      }}
                    >
                      <span style={{ fontSize: '14px' }}>{item.icon}</span>
                      <div style={{ textAlign: 'left' }}>
                        <p style={{ fontSize: '11px', fontWeight: 700 }}>{item.label}</p>
                        <p style={{ fontSize: '10px', opacity: 0.7, fontWeight: 400 }}>{item.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

            </PageTransition>
          )}

          {/* ── Settings ── */}
          {activeTab === 'settings' && (
            <PageTransition key="settings">
              <h2 className="tech-font" style={{ fontSize: '14px', marginBottom: '14px' }}>全局设置</h2>
              {/* Responsive grid: single column on narrow, 2-col when wide */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px', alignItems: 'start' }}>
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <h4>本机环境</h4>
                    <button onClick={loadSysInfo} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', gap: '4px', alignItems: 'center', fontSize: '12px' }}>
                      <RefreshCcw size={12} /> 刷新
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                    {[
                      { label: '操作系统', value: sysInfo ? `${sysInfo.platform} (${sysInfo.arch})` : '...' },
                      { label: '主机名', value: sysInfo?.hostname ?? '...' },
                      { label: 'Node.js', value: sysInfo?.nodeVersion ?? detection.nodeVersion ?? '未检测到' },
                      { label: 'npm', value: sysInfo?.npmVersion ?? detection.npmVersion ?? '未检测到' },
                      { label: 'pnpm', value: sysInfo?.pnpmVersion ?? (detection.pnpmBinDir ? '已安装' : '未安装') },
                      { label: 'Electron', value: sysInfo?.electronVersion ?? '...' },
                      { label: 'OpenClaw', value: detection.primary?.execPath ?? '未安装' },
                      { label: '配置目录', value: detection.configDir ?? '~/.openclaw (未创建)' },
                    ].map((row) => (
                      <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', paddingBottom: '10px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{row.label}</span>
                        <span style={{ textAlign: 'right', wordBreak: 'break-all', fontSize: '12px', fontFamily: 'monospace' }}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* 安装管理 — now second block */}
                <div className="card">
                  <h4 style={{ fontSize: '12px', fontWeight: 700, marginBottom: '10px' }}>OpenClaw 安装管理</h4>

                  {/* Version info row */}
                  {detection.primary && (
                    <div style={{ padding: '10px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '10px', fontSize: '11px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{detection.primary.name}</span>
                          <span style={{ color: 'var(--text-secondary)', marginLeft: '8px' }}>{detection.primary.via}</span>
                        </div>
                        <span style={{ fontFamily: 'monospace', color: '#22c55e' }}>{detection.version ? `v${detection.version}` : '已安装'}</span>
                      </div>

                      {/* Version check result */}
                      {versionChecked && latestVersion && (
                        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
                          {detection.version && isNewerVersion(latestVersion, detection.version) ? (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ color: '#f59e0b' }}>
                                发现新版本 <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>v{latestVersion}</span>
                              </span>
                              <button
                                onClick={async () => { setLogs([]); setActiveTab('logs'); const r = await api.openclawManage('update', detection.primary?.via, detection.primary?.name, detection.primary?.execPath, detection.pnpmBinDir); if (r?.ok) { refreshDetection(); setVersionChecked(false) } }}
                                style={{ padding: '4px 12px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', color: '#f59e0b', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                              >
                                立即更新
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: '#22c55e' }}>✓ 已是最新版本 v{latestVersion}</span>
                          )}
                        </div>
                      )}
                      {versionChecked && !latestVersion && (
                        <p style={{ marginTop: '6px', color: '#ff5757', fontSize: '10px' }}>检查失败，请检查网络连接</p>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                    <button
                      onClick={checkVersion}
                      disabled={!detection.installed || checkingVersion}
                      style={{ padding: '8px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '8px', color: '#22c55e', fontSize: '11px', fontWeight: 600, cursor: detection.installed ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '6px', opacity: detection.installed ? 1 : 0.4 }}
                    >
                      <RefreshCcw size={12} style={{ animation: checkingVersion ? 'spin 1s linear infinite' : 'none' }} />
                      {checkingVersion ? '检查中...' : '检查更新'}
                    </button>
                    <button onClick={onReinstall} style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Download size={12} /> 重新安装
                    </button>
                    <button onClick={doUninstall} disabled={!detection.installed || uninstalling} style={{ padding: '8px 14px', background: 'rgba(255,87,87,0.06)', border: '1px solid rgba(255,87,87,0.15)', borderRadius: '8px', color: '#ff5757', fontSize: '11px', fontWeight: 600, cursor: detection.installed ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '6px', opacity: (detection.installed && !uninstalling) ? 1 : 0.4 }}>
                      <Trash2 size={12} /> {uninstalling ? '卸载中...' : '卸载 OpenClaw'}
                    </button>
                  </div>
                </div>

                {/* 快捷操作 — now last */}
                <div className="card">
                  <h4 style={{ marginBottom: '12px', fontSize: '12px' }}>快捷操作</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                    {[
                      { label: '打开 ~/.openclaw 目录', icon: FolderOpen, action: () => api.openConfigDir() },
                      { label: 'openclaw-cn 仓库', icon: Github, action: () => api.openExternal('https://github.com/jiulingyun/openclaw-cn') },
                      { label: 'OpenClaw 仓库', icon: Github, action: () => api.openExternal('https://github.com/DevTalon/openclaw') },
                      { label: '问题与反馈', icon: Info, action: () => api.openExternal('https://github.com/DevTalon/openclaw/issues') },
                    ].map((item) => (
                      <button key={item.label} onClick={item.action} style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' }}>
                        <item.icon size={12} style={{ flexShrink: 0 }} />
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </PageTransition>
          )}

        </AnimatePresence>
      </main>
      <WindowControls />
    </div>
  )
}
