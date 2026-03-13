import { useState, useEffect } from 'react'
import { RefreshCcw, CheckCircle, XCircle, ExternalLink, Save } from 'lucide-react'

interface ChannelDef {
  id: string
  label: string
  desc: string
  setupUrl: string
  fields: { key: string; label: string; type: 'text' | 'password' | 'select'; options?: string[] }[]
}

const CHANNEL_DEFS: ChannelDef[] = [
  {
    id: 'telegram', label: 'Telegram', desc: '通过 Bot Token 接入，设置最简单',
    setupUrl: 'https://core.telegram.org/bots#botfather',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password' },
      { key: 'dmPolicy', label: 'DM 策略', type: 'select', options: ['pairing', 'allowlist', 'open', 'disabled'] },
    ],
  },
  {
    id: 'discord', label: 'Discord', desc: '通过 Bot Token 接入',
    setupUrl: 'https://discord.com/developers/applications',
    fields: [
      { key: 'token', label: 'Bot Token', type: 'password' },
    ],
  },
  {
    id: 'slack', label: 'Slack', desc: '通过 App OAuth Token 接入',
    setupUrl: 'https://api.slack.com/apps',
    fields: [
      { key: 'token', label: 'OAuth Token', type: 'password' },
    ],
  },
  {
    id: 'whatsapp', label: 'WhatsApp', desc: '通过二维码扫码授权',
    setupUrl: 'https://docs.openclaw.ai/zh-CN/channels/whatsapp',
    fields: [
      { key: 'dmPolicy', label: 'DM 策略', type: 'select', options: ['pairing', 'allowlist', 'open', 'disabled'] },
    ],
  },
  {
    id: 'signal', label: 'Signal', desc: '需要 signal-cli',
    setupUrl: 'https://docs.openclaw.ai/zh-CN/channels/signal',
    fields: [
      { key: 'phoneNumber', label: '手机号 (E.164)', type: 'text' },
    ],
  },
]

const CHANNEL_COLORS: Record<string, string> = {
  telegram: '#229ED9', discord: '#5865F2', slack: '#4A154B',
  whatsapp: '#25D366', signal: '#3A76F0',
}

export default function ChannelsTab() {
  const [channels, setChannels] = useState<Record<string, any>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, any>>({})
  const [saved, setSaved] = useState(false)
  const api = (window as any).api

  useEffect(() => { load() }, [])

  async function load() {
    const cfg = await api.getChannelsConfig()
    setChannels(cfg ?? {})
  }

  async function save(channelId: string) {
    const updated = { ...channels, [channelId]: { ...(channels[channelId] ?? {}), ...drafts[channelId] } }
    setChannels(updated)
    await api.saveChannelsConfig(updated)
    setSaved(true)
    setEditing(null)
    setTimeout(() => setSaved(false), 2000)
  }

  function isEnabled(id: string) {
    const ch = channels[id]
    if (!ch) return false
    return ch.enabled !== false && (ch.botToken || ch.token || ch.phoneNumber || id === 'whatsapp')
  }

  function startEdit(id: string) {
    setDrafts((prev) => ({ ...prev, [id]: { ...(channels[id] ?? {}) } }))
    setEditing(id)
  }

  function updateDraft(channelId: string, key: string, value: string) {
    setDrafts((prev) => ({ ...prev, [channelId]: { ...(prev[channelId] ?? {}), [key]: value } }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 className="tech-font" style={{ fontSize: '14px' }}>频道管理</h2>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            配置消息平台接入，多频道可同时运行
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {saved && <span style={{ fontSize: '12px', color: '#22c55e' }}>已保存</span>}
          <button onClick={load} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 14px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <RefreshCcw size={12} /> 刷新
          </button>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 0 }}>
        {CHANNEL_DEFS.map((def) => {
          const isActive = isEnabled(def.id)
          const isEdit = editing === def.id
          const color = CHANNEL_COLORS[def.id] ?? '#94a3b8'
          return (
            <div key={def.id} className="card">
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: `${color}22`, border: `1px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color }}>{def.label[0]}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h4 style={{ fontSize: '13px' }}>{def.label}</h4>
                    {isActive
                      ? <CheckCircle size={13} color="#22c55e" />
                      : <XCircle size={13} color="#475569" />}
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{def.desc}</p>
                </div>
              </div>

              {/* Fields */}
              {isEdit ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                  {def.fields.map((field) => (
                    <div key={field.key}>
                      <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>{field.label}</label>
                      {field.type === 'select' ? (
                        <select
                          value={(drafts[def.id]?.[field.key] ?? channels[def.id]?.[field.key] ?? field.options![0])}
                          onChange={(e) => updateDraft(def.id, field.key, e.target.value)}
                          style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '6px', padding: '7px 10px', color: 'white', fontSize: '12px' }}
                        >
                          {field.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
                          type={field.type === 'password' ? 'password' : 'text'}
                          value={drafts[def.id]?.[field.key] ?? channels[def.id]?.[field.key] ?? ''}
                          onChange={(e) => updateDraft(def.id, field.key, e.target.value)}
                          placeholder={`输入 ${field.label}`}
                          style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '6px', padding: '7px 10px', color: 'white', fontSize: '12px', outline: 'none' }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  {isActive ? (
                    <span style={{ color: '#22c55e' }}>● 已配置</span>
                  ) : (
                    <span>● 未配置</span>
                  )}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px' }}>
                {isEdit ? (
                  <>
                    <button onClick={() => setEditing(null)} style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer' }}>
                      取消
                    </button>
                    <button onClick={() => save(def.id)} style={{ flex: 2, padding: '8px', background: `${color}22`, border: `1px solid ${color}44`, borderRadius: '8px', color, fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                      <Save size={12} /> 保存
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => api.openExternal(def.setupUrl)} style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <ExternalLink size={11} /> 文档
                    </button>
                    <button onClick={() => startEdit(def.id)} style={{ flex: 1, padding: '8px', background: `${color}15`, border: `1px solid ${color}33`, borderRadius: '8px', color, fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      {isActive ? '编辑配置' : '立即配置'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Plugin channels note */}
      <div className="card" style={{ padding: '16px' }}>
        <h4 style={{ fontSize: '13px', marginBottom: '8px' }}>插件频道</h4>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
          飞书、LINE、Matrix、Teams、Mattermost、Nostr 等平台通过插件方式接入。
          安装对应插件后，在「技能扩展」标签页的插件列表中进行配置。
        </p>
        <button onClick={() => api.openExternal('https://docs.openclaw.ai/zh-CN/channels')} style={{ marginTop: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '8px', padding: '7px 14px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ExternalLink size={12} /> 查看全部频道文档
        </button>
      </div>
    </div>
  )
}
