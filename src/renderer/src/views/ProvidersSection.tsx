import { useState, useEffect } from 'react'
import { Plus, ChevronDown, ChevronRight, Check, Loader, ExternalLink, Trash2 } from 'lucide-react'

interface ProviderDef {
  id: string; name: string; color: string
  modes: ('oauth' | 'apikey')[]
  oauthLabel?: string; oauthUrl?: string
  apiKeyLabel: string
  modelsEndpoint?: string
  exampleModel: string
  baseUrlSupport?: boolean
}

const PROVIDERS: ProviderDef[] = [
  { id: 'anthropic', name: 'Anthropic', color: '#D4A27F', modes: ['oauth', 'apikey'], oauthLabel: '浏览器授权 (推荐)', oauthUrl: 'https://console.anthropic.com/settings/keys', apiKeyLabel: 'API Key', exampleModel: 'anthropic/claude-opus-4-6' },
  { id: 'openai', name: 'OpenAI', color: '#74AA9C', modes: ['apikey'], apiKeyLabel: 'API Key', modelsEndpoint: 'https://api.openai.com/v1/models', exampleModel: 'openai/gpt-4o' },
  { id: 'google', name: 'Google Gemini', color: '#4285F4', modes: ['apikey'], apiKeyLabel: 'API Key', modelsEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models', exampleModel: 'google/gemini-2.0-flash' },
  { id: 'deepseek', name: 'DeepSeek', color: '#3B6BDC', modes: ['apikey'], apiKeyLabel: 'API Key', modelsEndpoint: 'https://api.deepseek.com/v1/models', exampleModel: 'deepseek/deepseek-chat', baseUrlSupport: true },
  { id: 'groq', name: 'Groq', color: '#F55036', modes: ['apikey'], apiKeyLabel: 'API Key', modelsEndpoint: 'https://api.groq.com/openai/v1/models', exampleModel: 'groq/llama-3.3-70b-versatile' },
  { id: 'mistral', name: 'Mistral', color: '#FA520F', modes: ['apikey'], apiKeyLabel: 'API Key', modelsEndpoint: 'https://api.mistral.ai/v1/models', exampleModel: 'mistral/mistral-large-latest' },
  { id: 'openrouter', name: 'OpenRouter', color: '#7C3AED', modes: ['apikey'], apiKeyLabel: 'API Key', modelsEndpoint: 'https://openrouter.ai/api/v1/models', exampleModel: 'openrouter/anthropic/claude-opus-4' },
  { id: 'custom', name: '自定义兼容接口', color: '#64748B', modes: ['apikey'], apiKeyLabel: 'API Key', exampleModel: 'custom/model-name', baseUrlSupport: true },
]

interface Profile {
  profileKey: string; provider: string; mode: 'oauth' | 'apikey'
  email?: string; apiKey?: string; baseUrl?: string
}

interface Props {
  onModelChange?: (model: string) => void
  compact?: boolean
}

export default function ProvidersSection({ onModelChange, compact }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [currentModel, setCurrentModel] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<ProviderDef | null>(null)
  const [addMode, setAddMode] = useState<'oauth' | 'apikey'>('apikey')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [testLoading, setTestLoading] = useState(false)
  const [testModels, setTestModels] = useState<string[]>([])
  const [testError, setTestError] = useState('')
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const api = (window as any).api

  useEffect(() => { load() }, [])

  async function load() {
    const cfg = await api.getConfigObject() as any
    const rawProfiles = cfg?.auth?.profiles ?? {}
    const loaded: Profile[] = Object.entries(rawProfiles).map(([k, v]: [string, any]) => ({
      profileKey: k, provider: v.provider, mode: v.mode, email: v.email, apiKey: v.apiKey, baseUrl: v.baseUrl,
    }))
    setProfiles(loaded)
    setCurrentModel(cfg?.agent?.model ?? '')
  }

  async function addProfile() {
    if (!selectedProvider) return
    const profileKey = `${selectedProvider.id}:${addMode === 'oauth' ? 'oauth' : 'default'}-${Date.now()}`
    const profile: any = { provider: selectedProvider.id, mode: addMode }
    if (addMode === 'apikey') { profile.apiKey = apiKey }
    if (baseUrl) profile.baseUrl = baseUrl

    const cfg = await api.getConfigObject() as any ?? {}
    if (!cfg.auth) cfg.auth = {}
    if (!cfg.auth.profiles) cfg.auth.profiles = {}
    if (!cfg.auth.order) cfg.auth.order = {}
    cfg.auth.profiles[profileKey] = profile
    cfg.auth.order[selectedProvider.id] = [profileKey, ...(cfg.auth.order[selectedProvider.id] ?? [])]
    await api.writeConfigValidated(JSON.stringify(cfg, null, 2))
    await load()
    setShowAdd(false)
    setSelectedProvider(null)
    setApiKey(''); setBaseUrl(''); setTestModels([]); setTestError('')
  }

  async function removeProfile(profileKey: string) {
    const cfg = await api.getConfigObject() as any ?? {}
    delete cfg.auth?.profiles?.[profileKey]
    // Clean order
    if (cfg.auth?.order) {
      for (const [k, v] of Object.entries(cfg.auth.order)) {
        (cfg.auth.order as any)[k] = (v as string[]).filter((p: string) => p !== profileKey)
      }
    }
    await api.writeConfigValidated(JSON.stringify(cfg, null, 2))
    await load()
  }

  async function testProvider() {
    if (!selectedProvider || !apiKey) return
    setTestLoading(true); setTestModels([]); setTestError('')
    const endpoint = selectedProvider.modelsEndpoint ?? (baseUrl ? `${baseUrl}/models` : '')
    const result = await api.testProvider(selectedProvider.id, apiKey, endpoint)
    setTestLoading(false)
    if (result.ok) setTestModels(result.models ?? [])
    else setTestError(result.error ?? '连接失败')
  }

  async function setModel(model: string) {
    setCurrentModel(model)
    await api.patchConfig({ agent: { model } })
    onModelChange?.(model)
  }

  if (compact) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <p style={{ fontSize: '12px', fontWeight: 600 }}>已配置的提供商 ({profiles.length})</p>
          <button onClick={() => setShowAdd(true)} style={{ background: 'rgba(255,87,87,0.1)', border: '1px solid rgba(255,87,87,0.2)', borderRadius: '6px', padding: '4px 10px', color: 'var(--accent)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Plus size={11} /> 添加
          </button>
        </div>
        {profiles.length === 0 && (
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>未配置任何提供商，建议至少配置一个</p>
        )}
        {profiles.map((p) => {
          const def = PROVIDERS.find(d => d.id === p.provider)
          return (
            <div key={p.profileKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', marginBottom: '6px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: def?.color ?? '#888' }} />
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{def?.name ?? p.provider}</span>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '10px' }}>{p.mode}</span>
              </div>
              <Check size={13} color="#22c55e" />
            </div>
          )
        })}
        {showAdd && <AddProviderForm providers={PROVIDERS} onClose={() => setShowAdd(false)} onAdd={addProfile} selectedProvider={selectedProvider} setSelectedProvider={setSelectedProvider} addMode={addMode} setAddMode={setAddMode} apiKey={apiKey} setApiKey={setApiKey} baseUrl={baseUrl} setBaseUrl={setBaseUrl} testProvider={testProvider} testLoading={testLoading} testModels={testModels} testError={testError} api={api} />}
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div>
          <h4 style={{ fontSize: '13px', fontWeight: 700 }}>模型提供商</h4>
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>配置 AI 模型供应商的认证信息</p>
        </div>
        <button
          onClick={() => { setShowAdd(!showAdd); setSelectedProvider(null); setApiKey(''); setBaseUrl(''); setTestModels([]); setTestError('') }}
          style={{ padding: '6px 14px', background: 'var(--accent)', border: 'none', borderRadius: '8px', color: 'white', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Plus size={13} /> 添加提供商
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <AddProviderForm providers={PROVIDERS} onClose={() => { setShowAdd(false); setSelectedProvider(null) }} onAdd={addProfile} selectedProvider={selectedProvider} setSelectedProvider={setSelectedProvider} addMode={addMode} setAddMode={setAddMode} apiKey={apiKey} setApiKey={setApiKey} baseUrl={baseUrl} setBaseUrl={setBaseUrl} testProvider={testProvider} testLoading={testLoading} testModels={testModels} testError={testError} api={api} />
      )}

      {/* Current model */}
      <div style={{ marginBottom: '14px', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>当前默认模型</p>
            <p style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'monospace' }}>{currentModel || '(未设置)'}</p>
          </div>
        </div>
      </div>

      {/* Configured providers */}
      {profiles.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
          <Plus size={28} style={{ margin: '0 auto 10px', opacity: 0.2 }} />
          <p style={{ fontSize: '12px' }}>尚未配置任何提供商</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {Object.entries(
            profiles.reduce((acc, p) => { (acc[p.provider] = acc[p.provider] ?? []).push(p); return acc }, {} as Record<string, Profile[]>)
          ).map(([provider, provProfiles]) => {
            const def = PROVIDERS.find(d => d.id === provider)
            const isExpanded = expandedProvider === provider
            return (
              <div key={provider} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div
                  onClick={() => setExpandedProvider(isExpanded ? null : provider)}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', cursor: 'pointer' }}
                >
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: def?.color ?? '#888', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '13px', fontWeight: 600 }}>{def?.name ?? provider}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginRight: '6px' }}>{provProfiles.length} 个配置</span>
                  {isExpanded ? <ChevronDown size={13} color="var(--text-secondary)" /> : <ChevronRight size={13} color="var(--text-secondary)" />}
                </div>
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {provProfiles.map((p) => (
                      <div key={p.profileKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                        <div>
                          <p style={{ fontSize: '12px', fontWeight: 600 }}>{p.mode === 'oauth' ? `OAuth (${p.email ?? ''})` : 'API Key'}</p>
                          {p.baseUrl && <p style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>{p.baseUrl}</p>}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {def && (
                            <button
                              onClick={() => setModel(`${provider}/${def.exampleModel.split('/').slice(1).join('/')}`)}
                              style={{ fontSize: '10px', padding: '3px 8px', background: 'rgba(255,87,87,0.08)', border: '1px solid rgba(255,87,87,0.2)', borderRadius: '6px', color: 'var(--accent)', cursor: 'pointer' }}
                            >
                              设为默认
                            </button>
                          )}
                          <button onClick={() => removeProfile(p.profileKey)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ff5757', padding: '3px' }}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Add Provider Form ────────────────────────────────────────────────────

interface AddFormProps {
  providers: ProviderDef[]; onClose: () => void; onAdd: () => void
  selectedProvider: ProviderDef | null; setSelectedProvider: (p: ProviderDef | null) => void
  addMode: 'oauth' | 'apikey'; setAddMode: (m: 'oauth' | 'apikey') => void
  apiKey: string; setApiKey: (v: string) => void
  baseUrl: string; setBaseUrl: (v: string) => void
  testProvider: () => void; testLoading: boolean; testModels: string[]; testError: string
  api: any
}

function AddProviderForm({ providers, onClose, onAdd, selectedProvider, setSelectedProvider, addMode, setAddMode, apiKey, setApiKey, baseUrl, setBaseUrl, testProvider, testLoading, testModels, testError, api }: AddFormProps) {
  return (
    <div style={{ background: 'rgba(255,87,87,0.04)', border: '1px solid rgba(255,87,87,0.2)', borderRadius: '12px', padding: '16px', marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <h4 style={{ fontSize: '12px', fontWeight: 700 }}>添加模型提供商</h4>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '18px', lineHeight: 1 }}>×</button>
      </div>

      {/* Provider grid */}
      {!selectedProvider && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '8px' }}>
          {providers.map((p) => (
            <div
              key={p.id}
              onClick={() => { setSelectedProvider(p); setAddMode(p.modes[0]) }}
              style={{ padding: '10px', borderRadius: '10px', cursor: 'pointer', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', transition: 'all 0.15s', textAlign: 'center' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = p.color + '88' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
            >
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: p.color, margin: '0 auto 6px' }} />
              <p style={{ fontSize: '11px', fontWeight: 600 }}>{p.name}</p>
              <p style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {p.modes.includes('oauth') ? 'OAuth·' : ''}{p.modes.includes('apikey') ? 'API Key' : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Auth form for selected provider */}
      {selectedProvider && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: selectedProvider.color }} />
            <span style={{ fontSize: '13px', fontWeight: 700 }}>{selectedProvider.name}</span>
            <button onClick={() => setSelectedProvider(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '11px', marginLeft: 'auto' }}>← 返回</button>
          </div>

          {/* Mode toggle */}
          {selectedProvider.modes.length > 1 && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              {selectedProvider.modes.map(m => (
                <button key={m} onClick={() => setAddMode(m)} style={{ padding: '6px 14px', background: addMode === m ? 'rgba(255,87,87,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${addMode === m ? 'rgba(255,87,87,0.3)' : 'var(--border)'}`, borderRadius: '8px', color: addMode === m ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: addMode === m ? 700 : 400 }}>
                  {m === 'oauth' ? 'OAuth 授权' : 'API Key'}
                </button>
              ))}
            </div>
          )}

          {addMode === 'oauth' ? (
            <div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: '1.6' }}>
                点击下方按钮在浏览器中完成 OAuth 授权，授权后令牌会自动配置到 openclaw。
              </p>
              <button onClick={() => api.openExternal(selectedProvider.oauthUrl)} style={{ width: '100%', padding: '10px', background: `${selectedProvider.color}22`, border: `1px solid ${selectedProvider.color}44`, borderRadius: '10px', color: selectedProvider.color, fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <ExternalLink size={13} /> 在浏览器中进行 OAuth 授权
              </button>
              <p style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '10px' }}>授权完成后，请在 openclaw 中运行 <code>openclaw channels login {selectedProvider.id}</code> 完成绑定</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>{selectedProvider.apiKeyLabel}</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={`输入 ${selectedProvider.name} API Key`}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '12px', outline: 'none', fontFamily: 'monospace' }}
                />
              </div>
              {selectedProvider.baseUrlSupport && (
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Base URL (可选)</label>
                  <input
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '12px', outline: 'none', fontFamily: 'monospace' }}
                  />
                </div>
              )}

              {/* Test models button */}
              {(selectedProvider.modelsEndpoint || selectedProvider.baseUrlSupport) && (
                <div>
                  <button
                    onClick={testProvider}
                    disabled={!apiKey || testLoading}
                    style={{ padding: '7px 14px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '8px', color: '#60a5fa', fontSize: '11px', cursor: apiKey ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '6px', opacity: !apiKey ? 0.4 : 1 }}
                  >
                    {testLoading ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                    测试并获取模型列表
                  </button>
                  {testError && <p style={{ fontSize: '11px', color: '#ff5757', marginTop: '6px' }}>{testError}</p>}
                  {testModels.length > 0 && (
                    <div style={{ marginTop: '8px', maxHeight: '100px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', padding: '8px' }}>
                      <p style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>可用模型 ({testModels.length})</p>
                      {testModels.map(m => <p key={m} style={{ fontSize: '11px', fontFamily: 'monospace', color: '#94a3b8' }}>{m}</p>)}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={onClose} style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer' }}>取消</button>
                <button onClick={onAdd} disabled={!apiKey} style={{ flex: 2, padding: '8px', background: apiKey ? 'var(--accent)' : 'rgba(255,255,255,0.04)', border: 'none', borderRadius: '8px', color: 'white', fontSize: '12px', fontWeight: 700, cursor: apiKey ? 'pointer' : 'not-allowed', opacity: !apiKey ? 0.4 : 1 }}>
                  保存配置
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
