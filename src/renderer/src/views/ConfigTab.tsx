import { useState, useEffect, useRef } from 'react'
import { Save, FolderOpen, AlertTriangle, CheckCircle, Edit3, Code, RefreshCcw, HelpCircle } from 'lucide-react'
import ProvidersSection from './ProvidersSection'

// Simple hover tooltip component
function Tooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)}>
      <HelpCircle size={13} color="var(--text-secondary)" style={{ opacity: 0.5, cursor: 'help' }} />
      {visible && (
        <div style={{
          position: 'absolute', bottom: '100%', right: 0, marginBottom: '6px',
          width: '220px', background: '#1a1a2e', border: '1px solid var(--border)',
          borderRadius: '8px', padding: '8px 10px', fontSize: '11px',
          color: 'var(--text-secondary)', lineHeight: '1.6', zIndex: 999,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', pointerEvents: 'none',
          whiteSpace: 'normal',
        }}>
          {text}
        </div>
      )}
    </div>
  )
}

type ViewMode = 'visual' | 'raw'

interface ConfigBlock {
  title: string; key: string; color: string; desc: string
  fields: { key: string; label: string; type: 'text' | 'number' | 'boolean' | 'select' | 'password'; options?: string[]; path: string[]; hint?: string }[]
}

const CONFIG_BLOCKS: ConfigBlock[] = [
  {
    title: '网关 Gateway', key: 'gateway', color: '#3b82f6',
    desc: '控制 OpenClaw Gateway 服务的监听端口、认证方式和网络绑定范围。Gateway 是所有频道和 Control UI 的核心接入点。',
    fields: [
      { key: 'port', label: '端口', type: 'number', path: ['gateway', 'port'] },
      { key: 'bind', label: '绑定模式', type: 'select', options: ['loopback', 'lan', 'tailnet'], path: ['gateway', 'bind'] },
      { key: 'token', label: '访问令牌', type: 'password', path: ['gateway', 'auth', 'token'] },
      { key: 'authMode', label: '认证模式', type: 'select', options: ['token', 'password', 'none'], path: ['gateway', 'auth', 'mode'] },
      { key: 'reloadMode', label: '热重载', type: 'select', options: ['hybrid', 'off'], path: ['gateway', 'reload', 'mode'] },
      { key: 'controlUiEnabled', label: '启用 Control UI', type: 'boolean', path: ['gateway', 'controlUi', 'enabled'] },
    ],
  },
  {
    title: 'Cron 定时任务', key: 'cron', color: '#f59e0b',
    desc: '全局定时任务调度器。启用后，在「定时任务」页面配置的任务将在 Gateway 运行时自动执行。maxConcurrentRuns 控制同时运行的最大任务数。',
    fields: [
      { key: 'enabled', label: '启用定时任务', type: 'boolean', path: ['cron', 'enabled'], hint: '全局开关，关闭后所有定时任务暂停执行' },
      { key: 'maxConcurrent', label: '最大并发数', type: 'number', path: ['cron', 'maxConcurrentRuns'], hint: '同时运行的最大任务数，建议设为 1-4' },
    ],
  },
  {
    title: 'Agent 默认设置', key: 'agents', color: '#a78bfa',
    desc: '所有 Agent 的默认行为。heartbeat 心跳可让 Agent 定期主动发送消息（如早报、状态检查等），不需要等待用户触发。',
    fields: [
      { key: 'heartbeatEvery', label: '心跳间隔', type: 'text', path: ['agents', 'defaults', 'heartbeat', 'every'], hint: '支持 30m、1h、2h 等格式。空则不启用心跳' },
      { key: 'heartbeatTarget', label: '心跳目标会话', type: 'select', options: ['last', 'new'], path: ['agents', 'defaults', 'heartbeat', 'target'], hint: 'last: 继续上次会话；new: 每次新建会话' },
      { key: 'heartbeatPrompt', label: '心跳提示词', type: 'text', path: ['agents', 'defaults', 'heartbeat', 'prompt'], hint: '心跳触发时发送给 Agent 的指令文本' },
    ],
  },
  {
    title: 'Canvas 文件服务', key: 'canvas', color: '#10b981',
    desc: 'Canvas 是 OpenClaw 的内嵌文件预览服务，用于在 Control UI 中展示 Markdown、图片、代码等内容。默认端口为 Gateway 端口 +4。',
    fields: [
      { key: 'canvasEnabled', label: '启用 Canvas', type: 'boolean', path: ['canvasHost', 'enabled'], hint: '关闭后 Control UI 无法预览富媒体内容' },
      { key: 'canvasPort', label: '端口', type: 'number', path: ['canvasHost', 'port'], hint: '默认为 gateway.port + 4（即 18793）' },
    ],
  },
  {
    title: 'Webhook Hooks', key: 'hooks', color: '#f43f5e',
    desc: '允许外部系统（如 GitHub Actions、Zapier 等）通过 HTTP POST 触发 Agent 操作。使用 Bearer Token 认证，请妥善保管 token。',
    fields: [
      { key: 'hooksEnabled', label: '启用 Hooks', type: 'boolean', path: ['hooks', 'enabled'], hint: '启用后外部可通过 HTTP 请求触发 Agent' },
      { key: 'hooksToken', label: '认证令牌', type: 'password', path: ['hooks', 'token'], hint: '请求头需带 Authorization: Bearer <token>' },
      { key: 'hooksPath', label: 'URL 路径前缀', type: 'text', path: ['hooks', 'path'], hint: '默认 /hooks，如 /hooks/gmail' },
    ],
  },
]

function getNestedValue(obj: any, path: string[]): any {
  return path.reduce((acc, key) => acc?.[key], obj)
}

function setNestedValue(obj: any, path: string[], value: any): any {
  if (path.length === 0) return value
  const [head, ...rest] = path
  return { ...obj, [head]: setNestedValue(obj?.[head] ?? {}, rest, value) }
}

const DEFAULT_CONFIG_TEXT = '{\n  "agent": {\n    "model": "anthropic/claude-opus-4-6"\n  }\n}'

export default function ConfigTab() {
  const [viewMode, setViewMode] = useState<ViewMode>('visual')
  const [config, setConfig] = useState<Record<string, any>>({})
  const [rawText, setRawText] = useState(DEFAULT_CONFIG_TEXT)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [validation, setValidation] = useState<{ ok: boolean; error?: string } | null>(null)
  const api = (window as any).api

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [obj, raw] = await Promise.all([
        api.getConfigObject() as Promise<Record<string, any> | null>,
        api.readConfig() as Promise<string | null>,
      ])
      if (raw) setRawText(raw)
      if (obj) setConfig(obj)
      else if (raw) { try { setConfig(JSON.parse(raw)) } catch {} }
    } finally { setLoading(false) }
  }

  function patchLocal(p: string[], value: any) {
    setConfig((prev: any) => setNestedValue(prev, p, value))
  }

  async function saveVisual() {
    await api.backupConfig()
    await api.writeConfigValidated(JSON.stringify(config, null, 2))
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  async function validateRaw() {
    const result = await api.validateConfig(rawText)
    setValidation(result)
    return result.ok
  }

  async function saveRaw(force = false) {
    if (!force) { const ok = await validateRaw(); if (!ok) return }
    await api.backupConfig()
    const result = await api.writeConfigValidated(rawText, force)
    if (result.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); setValidation(null) }
  }

  function renderField(field: ConfigBlock['fields'][0]) {
    const value = getNestedValue(config, field.path)
    const strVal = value === undefined || value === null ? '' : String(value)
    if (field.type === 'boolean') {
      return (
        <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{field.label}</span>
            {field.hint && <Tooltip text={field.hint} />}
          </div>
          <div onClick={() => patchLocal(field.path, !value)} style={{ width: '32px', height: '18px', background: value ? 'var(--accent)' : '#333', borderRadius: '9px', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}>
            <div style={{ width: '14px', height: '14px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: value ? '16px' : '2px', transition: 'left 0.2s' }} />
          </div>
        </div>
      )
    }
    if (field.type === 'select') {
      return (
        <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{field.label}</span>
            {field.hint && <Tooltip text={field.hint} />}
          </div>
          <select value={strVal || field.options![0]} onChange={e => patchLocal(field.path, e.target.value)} style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 8px', color: 'white', fontSize: '11px', cursor: 'pointer' }}>
            {field.options!.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      )
    }
    return (
      <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{field.label}</span>
          {field.hint && <Tooltip text={field.hint} />}
        </div>
        <input
          type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
          value={strVal} placeholder="未设置"
          onChange={e => patchLocal(field.path, field.type === 'number' ? Number(e.target.value) : e.target.value)}
          style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 8px', color: 'white', fontSize: '11px', outline: 'none', width: '160px', textAlign: 'right' }}
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Header — save button prominent top-right */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexShrink: 0 }}>
        <h2 className="tech-font" style={{ fontSize: '14px' }}>配置管理</h2>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {loading && <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}><RefreshCcw size={10} style={{ animation: 'spin 1s linear infinite' }} />加载中</span>}
          {saved && <span style={{ fontSize: '11px', color: '#22c55e' }}>✓ 已保存</span>}
          <button onClick={load} title="重载" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }}><RefreshCcw size={12} /></button>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
            <button onClick={() => setViewMode('visual')} style={{ padding: '5px 10px', background: viewMode === 'visual' ? 'rgba(255,87,87,0.15)' : 'transparent', border: 'none', color: viewMode === 'visual' ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: viewMode === 'visual' ? 700 : 400 }}>
              <Edit3 size={11} /> 可视化
            </button>
            <button onClick={() => setViewMode('raw')} style={{ padding: '5px 10px', background: viewMode === 'raw' ? 'rgba(255,87,87,0.15)' : 'transparent', border: 'none', color: viewMode === 'raw' ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: viewMode === 'raw' ? 700 : 400 }}>
              <Code size={11} /> JSON
            </button>
          </div>
          <button onClick={() => api.openConfigDir()} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px 8px', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <FolderOpen size={11} />
          </button>
          <button onClick={() => viewMode === 'visual' ? saveVisual() : saveRaw()} style={{ padding: '5px 14px', background: 'var(--accent)', border: 'none', borderRadius: '6px', color: 'white', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Save size={11} /> 保存
          </button>
        </div>
      </div>

      {viewMode === 'visual' && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="card"><ProvidersSection /></div>
          <div className="grid" style={{ marginTop: 0 }}>
            {CONFIG_BLOCKS.map(block => (
              <div key={block.key} className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                  <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: block.color, flexShrink: 0 }} />
                  <h4 style={{ fontSize: '12px', color: block.color, flex: 1 }}>{block.title}</h4>
                  <Tooltip text={block.desc} />
                </div>
                <div>{block.fields.map(f => renderField(f))}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'raw' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}>
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 }}>
            <code>~/.openclaw/openclaw.json</code> · 支持 JSON5 · 保存前自动验证 · 自动备份
          </p>
          <textarea value={rawText} onChange={e => { setRawText(e.target.value); setValidation(null) }} spellCheck={false}
            style={{ flex: 1, background: '#000', border: `1px solid ${validation ? (validation.ok ? 'rgba(34,197,94,0.3)' : 'rgba(255,87,87,0.4)') : 'var(--border)'}`, borderRadius: '10px', padding: '14px', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.6', resize: 'none', outline: 'none', minHeight: '220px' }}
          />
          {validation && (
            <div style={{ padding: '10px 14px', borderRadius: '8px', background: validation.ok ? 'rgba(34,197,94,0.08)' : 'rgba(255,87,87,0.08)', border: `1px solid ${validation.ok ? 'rgba(34,197,94,0.2)' : 'rgba(255,87,87,0.2)'}`, display: 'flex', alignItems: 'flex-start', gap: '8px', flexShrink: 0 }}>
              {validation.ok ? <CheckCircle size={13} color="#22c55e" /> : <AlertTriangle size={13} color="#ff5757" />}
              <div>
                <p style={{ fontSize: '12px', fontWeight: 600, color: validation.ok ? '#22c55e' : '#ff5757' }}>{validation.ok ? '格式验证通过' : '格式验证失败'}</p>
                {!validation.ok && <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', fontFamily: 'monospace' }}>{validation.error}</p>}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button onClick={validateRaw} style={{ padding: '7px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}>验证</button>
            <button onClick={() => saveRaw()} style={{ flex: 1, padding: '7px', background: 'var(--accent)', border: 'none', borderRadius: '8px', color: 'white', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <Save size={12} /> 保存
            </button>
            {validation && !validation.ok && (
              <button onClick={() => saveRaw(true)} style={{ padding: '7px 12px', background: 'rgba(255,165,0,0.1)', border: '1px solid rgba(255,165,0,0.25)', borderRadius: '8px', color: '#f97316', fontSize: '11px', cursor: 'pointer' }}>强制写入</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
