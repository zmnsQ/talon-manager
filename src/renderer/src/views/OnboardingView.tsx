import { useState, useRef } from 'react'
import { CheckCircle, ChevronRight, Loader, ExternalLink, ArrowLeft, RefreshCcw } from 'lucide-react'
import logoUrl from '../assets/logo.png'
import WindowControls from '../components/WindowControls'

interface ProviderDef {
  id: string; name: string; color: string
  modes: ('oauth' | 'apikey')[]
  oauthUrl?: string
  apiKeyLabel: string
  modelsEndpoint?: string
  exampleModel: string
  oauthMethod?: string
  baseUrlSupport?: boolean
}

const PROVIDERS: ProviderDef[] = [
  { id: 'anthropic', name: 'Anthropic', color: '#D4A27F', modes: ['oauth', 'apikey'], oauthUrl: 'https://console.anthropic.com/settings/keys', apiKeyLabel: 'API Key', exampleModel: 'anthropic/claude-opus-4-6' },
  { id: 'openai', name: 'OpenAI', color: '#74AA9C', modes: ['oauth', 'apikey'], oauthMethod: 'codex', apiKeyLabel: 'API Key', modelsEndpoint: 'https://api.openai.com/v1/models', exampleModel: 'openai/gpt-4o' },
  { id: 'google', name: 'Google Gemini', color: '#4285F4', modes: ['oauth', 'apikey'], apiKeyLabel: 'API Key', modelsEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models', exampleModel: 'google/gemini-2.0-flash' },
  { id: 'deepseek', name: 'DeepSeek', color: '#3B6BDC', modes: ['apikey'], apiKeyLabel: 'API Key', modelsEndpoint: 'https://api.deepseek.com/v1/models', exampleModel: 'deepseek/deepseek-chat', baseUrlSupport: true },
  { id: 'groq', name: 'Groq', color: '#F55036', modes: ['apikey'], apiKeyLabel: 'API Key', modelsEndpoint: 'https://api.groq.com/openai/v1/models', exampleModel: 'groq/llama-3.3-70b-versatile' },
  { id: 'mistral', name: 'Mistral', color: '#FA520F', modes: ['apikey'], apiKeyLabel: 'API Key', modelsEndpoint: 'https://api.mistral.ai/v1/models', exampleModel: 'mistral/mistral-large-latest' },
  { id: 'openrouter', name: 'OpenRouter', color: '#7C3AED', modes: ['apikey'], apiKeyLabel: 'API Key', modelsEndpoint: 'https://openrouter.ai/api/v1/models', exampleModel: 'openrouter/anthropic/claude-opus-4' },
  { id: 'qwen', name: '通义千问', color: '#5B6FD4', modes: ['oauth', 'apikey'], apiKeyLabel: 'DashScope API Key', modelsEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models', exampleModel: 'qwen/qwen-max', baseUrlSupport: false },
  { id: 'custom', name: '自定义兼容接口', color: '#64748B', modes: ['apikey'], apiKeyLabel: 'API Key', exampleModel: 'custom/model-name', baseUrlSupport: true },
]

type Step = 'welcome' | 'choose' | 'configure' | 'done'

interface Props {
  onComplete: () => void
  execPath: string
}

export default function OnboardingView({ onComplete, execPath }: Props) {
  const [step, setStep] = useState<Step>('welcome')
  const [provider, setProvider] = useState<ProviderDef | null>(null)
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>('apikey')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [testLoading, setTestLoading] = useState(false)
  const [testModels, setTestModels] = useState<string[]>([])
  const [testError, setTestError] = useState('')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // OAuth CLI flow state
  type OAuthState = 'idle' | 'loading' | 'waiting' | 'success' | 'error'
  const [oauthState, setOauthState] = useState<OAuthState>('idle')
  const [oauthUrl, setOauthUrl] = useState('')
  const [oauthError, setOauthError] = useState('')
  const oauthUnsubRef = useRef<(() => void) | null>(null)

  const api = (window as any).api
  const isMac = (window.navigator.platform || '').toLowerCase().includes('mac')

  const STEP_ORDER: Step[] = ['welcome', 'choose', 'configure', 'done']
  const stepIdx = STEP_ORDER.indexOf(step)

  async function handleOAuthLogin() {
    if (!provider) return
    setOauthState('loading')
    setOauthUrl('')
    setOauthError('')
    if (oauthUnsubRef.current) { oauthUnsubRef.current(); oauthUnsubRef.current = null }
    oauthUnsubRef.current = api.onOauthUrl(({ url }: { url: string }) => {
      setOauthUrl(url)
      setOauthState('waiting')
    })
    const result = await api.oauthLogin(execPath, provider.id, (provider as any).oauthMethod)
    if (oauthUnsubRef.current) { oauthUnsubRef.current(); oauthUnsubRef.current = null }
    if (result.ok) {
      setOauthState('success')
    } else {
      setOauthState('error')
      setOauthError(result.error ?? '授权失败')
    }
  }

  async function handleOAuthDone() {
    setSaving(true); setSaveError('')
    try {
      if (model && provider) {
        const cfg: any = (await api.getConfigObject()) ?? {}
        cfg.agent = { ...(cfg.agent ?? {}), model }
        const r = await api.writeConfigValidated(JSON.stringify(cfg, null, 2))
        if (!r?.ok) { setSaveError(r?.error ?? '保存失败'); return }
      }
      await api.setPrefs({ onboardingComplete: true })
      setStep('done')
    } catch (err: any) {
      setSaveError(err.message ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  function selectProvider(p: ProviderDef) {
    setProvider(p)
    setAuthMode(p.modes[0])
    setApiKey('')
    setBaseUrl('')
    setTestModels([])
    setTestError('')
    setModel(p.exampleModel)
    setOauthState('idle')
    setOauthUrl('')
    setOauthError('')
    setStep('configure')
  }

  async function handleTest() {
    if (!provider || !apiKey) return
    setTestLoading(true); setTestModels([]); setTestError('')
    const endpoint = provider.modelsEndpoint ?? (baseUrl ? `${baseUrl}/models` : '')
    const result = await api.testProvider(provider.id, apiKey, endpoint)
    setTestLoading(false)
    if (result.ok) {
      const models: string[] = result.models ?? []
      setTestModels(models)
      if (!model && models.length > 0) setModel(models[0])
    } else {
      setTestError(result.error ?? '连接失败')
    }
  }

  async function handleSave() {
    if (!provider) return
    setSaving(true); setSaveError('')
    try {
      const profileKey = `${provider.id}:${authMode}-${Date.now()}`
      const profile: Record<string, unknown> = { provider: provider.id, mode: authMode }
      if (authMode === 'apikey') profile.apiKey = apiKey
      if (baseUrl) profile.baseUrl = baseUrl

      const cfg: any = (await api.getConfigObject()) ?? {}
      if (!cfg.auth) cfg.auth = {}
      if (!cfg.auth.profiles) cfg.auth.profiles = {}
      if (!cfg.auth.order) cfg.auth.order = {}
      cfg.auth.profiles[profileKey] = profile
      cfg.auth.order[provider.id] = [profileKey]
      cfg.agent = { ...(cfg.agent ?? {}), model: model || provider.exampleModel }

      const result = await api.writeConfigValidated(JSON.stringify(cfg, null, 2))
      if (!result?.ok) { setSaveError(result?.error ?? '保存失败'); return }
      await api.setPrefs({ onboardingComplete: true })
      setStep('done')
    } catch (err: any) {
      setSaveError(err.message ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleSkip() {
    await api.setPrefs({ onboardingComplete: true })
    onComplete()
  }

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
        WebkitAppRegion: 'drag' as any,
      }}>
        <div style={{ width: '32px', height: '32px', flexShrink: 0 }}>
          <img src={logoUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="logo" />
        </div>
        <h2 style={{ fontFamily: "'Orbitron', sans-serif", fontSize: '13px', fontWeight: 900 }}>
          初始配置向导
        </h2>
        <div style={{ flex: 1 }} />
        {/* Step indicator */}
        {step !== 'welcome' && step !== 'done' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', WebkitAppRegion: 'no-drag' as any }}>
            {(['choose', 'configure'] as Step[]).map((s, i) => (
              <div key={s} style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: stepIdx - 1 > i ? '#22c55e' : stepIdx - 1 === i ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
                transition: 'background 0.3s',
              }} />
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 32px 32px',
        WebkitAppRegion: 'no-drag' as any,
        overflow: 'hidden',
      }}>
        <div style={{ width: '100%', maxWidth: '560px' }}>

          {/* ── Welcome ── */}
          {step === 'welcome' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '64px', height: '64px',
                borderRadius: '50%',
                background: 'rgba(34,197,94,0.1)',
                border: '1px solid rgba(34,197,94,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 20px',
              }}>
                <CheckCircle size={32} color="#22c55e" />
              </div>
              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '10px' }}>
                OpenClaw 安装成功 🎉
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.7', marginBottom: '32px' }}>
                接下来需要配置一个 AI 模型提供商，OpenClaw 才能正常运行。<br />
                只需 2 步，填写 API Key 即可完成。
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
                <button
                  onClick={() => setStep('choose')}
                  style={{
                    padding: '12px 36px',
                    background: 'var(--accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  开始配置 <ChevronRight size={16} />
                </button>
                <button
                  onClick={handleSkip}
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--text-secondary)', fontSize: '12px',
                    cursor: 'pointer', padding: '4px 8px',
                    textDecoration: 'underline',
                  }}
                >
                  跳过，稍后手动配置
                </button>
              </div>
            </div>
          )}

          {/* ── Choose Provider ── */}
          {step === 'choose' && (
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>选择 AI 提供商</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                选择你持有 API Key 的服务商
              </p>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '10px',
                marginBottom: '20px',
              }}>
                {PROVIDERS.map((p) => (
                  <ProviderCard key={p.id} provider={p} onClick={() => selectProvider(p)} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={handleSkip}
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--text-secondary)', fontSize: '12px',
                    cursor: 'pointer', textDecoration: 'underline',
                  }}
                >
                  跳过配置
                </button>
              </div>
            </div>
          )}

          {/* ── Configure API Key + Model ── */}
          {step === 'configure' && provider && (
            <div>
              {/* Header with back button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <button
                  onClick={() => setStep('choose')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '4px 0' }}
                >
                  <ArrowLeft size={14} /> 返回
                </button>
                <div style={{ width: '1px', height: '14px', background: 'var(--border)' }} />
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: provider.color }} />
                <h3 style={{ fontSize: '15px', fontWeight: 700 }}>{provider.name}</h3>
              </div>

              {/* Auth mode tabs (only if provider supports both) */}
              {provider.modes.length > 1 && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                  {provider.modes.map((m) => (
                    <button
                      key={m}
                      onClick={() => setAuthMode(m)}
                      style={{
                        padding: '6px 16px',
                        background: authMode === m ? 'rgba(255,87,87,0.12)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${authMode === m ? 'rgba(255,87,87,0.35)' : 'var(--border)'}`,
                        borderRadius: '8px',
                        color: authMode === m ? 'var(--accent)' : 'var(--text-secondary)',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: authMode === m ? 700 : 400,
                      }}
                    >
                      {m === 'oauth' ? 'OAuth 授权' : 'API Key'}
                    </button>
                  ))}
                </div>
              )}

              {/* OAuth flow — command-driven */}
              {authMode === 'oauth' && (
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '20px',
                  marginBottom: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}>
                  {/* idle: start button */}
                  {oauthState === 'idle' && (
                    <>
                      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.7' }}>
                        点击下方按钮，将在后台运行{' '}
                        <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 5px', borderRadius: '4px', fontSize: '11px' }}>
                          {provider.id === 'openai' && (provider as any).oauthMethod === 'codex'
                            ? 'openclaw models auth login-github-copilot'
                            : `openclaw models auth login --provider ${provider.id}${(provider as any).oauthMethod ? ` --method ${(provider as any).oauthMethod}` : ''}`}
                        </code>，获取授权链接后自动打开浏览器。
                      </p>
                      <button
                        onClick={handleOAuthLogin}
                        style={{
                          padding: '10px 20px',
                          background: `${provider.color}22`,
                          border: `1px solid ${provider.color}44`,
                          borderRadius: '10px',
                          color: provider.color,
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <ExternalLink size={14} /> 开始 OAuth 授权
                      </button>
                    </>
                  )}

                  {/* loading: waiting for URL from CLI */}
                  {oauthState === 'loading' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Loader size={16} color={provider.color} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                      <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                        正在运行 <code style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                          {provider.id === 'openai' && (provider as any).oauthMethod === 'codex'
                            ? 'openclaw models auth login-github-copilot'
                            : `openclaw models auth login --provider ${provider.id}${(provider as any).oauthMethod ? ` --method ${(provider as any).oauthMethod}` : ''}`}
                        </code>，获取授权链接中...
                      </p>
                    </div>
                  )}

                  {/* waiting: URL opened, awaiting browser auth */}
                  {oauthState === 'waiting' && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        <Loader size={16} color={provider.color} style={{ animation: 'spin 1s linear infinite', flexShrink: 0, marginTop: '2px' }} />
                        <div>
                          <p style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                            浏览器已打开，等待你在网页中完成授权...
                          </p>
                          <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            完成授权后此页面将自动跳转
                          </p>
                        </div>
                      </div>
                      {oauthUrl && (
                        <div style={{
                          background: 'rgba(0,0,0,0.25)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          padding: '10px 12px',
                        }}>
                          <p style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '5px' }}>授权链接（若浏览器未打开可手动访问）</p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <p style={{
                              fontSize: '11px', fontFamily: 'monospace', color: '#60a5fa',
                              wordBreak: 'break-all', flex: 1,
                            }}>{oauthUrl}</p>
                            <button
                              onClick={() => api.openExternal(oauthUrl)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#60a5fa', flexShrink: 0, padding: '2px' }}
                              title="手动打开"
                            >
                              <ExternalLink size={13} />
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* success: auth done, pick model */}
                  {oauthState === 'success' && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <CheckCircle size={18} color="#22c55e" />
                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#22c55e' }}>
                          授权成功！令牌已由 openclaw 保存
                        </p>
                      </div>
                      {/* Model selection */}
                      <div>
                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                          默认模型
                          <span style={{ opacity: 0.6, marginLeft: '6px', fontFamily: 'monospace', fontSize: '10px' }}>
                            agent.model
                          </span>
                        </label>
                        <input
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          placeholder={provider.exampleModel}
                          style={{
                            width: '100%',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            padding: '10px 14px',
                            color: 'white',
                            fontSize: '12px',
                            outline: 'none',
                            fontFamily: 'monospace',
                            boxSizing: 'border-box',
                          }}
                          onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255,87,87,0.5)' }}
                          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                        />
                      </div>
                      {saveError && <p style={{ fontSize: '12px', color: '#ff5757' }}>✗ {saveError}</p>}
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                          onClick={handleOAuthDone}
                          disabled={saving}
                          style={{
                            flex: 1, padding: '11px',
                            background: 'var(--accent)',
                            border: 'none', borderRadius: '10px',
                            color: 'white', fontSize: '13px', fontWeight: 700,
                            cursor: saving ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                          }}
                        >
                          {saving
                            ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> 保存中...</>
                            : <><ChevronRight size={16} /> 完成配置</>}
                        </button>
                        <button
                          onClick={handleSkip}
                          style={{
                            padding: '11px 16px',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid var(--border)',
                            borderRadius: '10px',
                            color: 'var(--text-secondary)',
                            fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
                          }}
                        >
                          跳过
                        </button>
                      </div>
                    </>
                  )}

                  {/* error */}
                  {oauthState === 'error' && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <p style={{ fontSize: '13px', color: '#ff5757' }}>✗ {oauthError || '授权失败，请重试'}</p>
                      </div>
                      <button
                        onClick={handleOAuthLogin}
                        style={{
                          padding: '8px 18px',
                          background: 'rgba(255,87,87,0.08)',
                          border: '1px solid rgba(255,87,87,0.25)',
                          borderRadius: '8px',
                          color: 'var(--accent)',
                          fontSize: '12px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '6px',
                          width: 'fit-content',
                        }}
                      >
                        <RefreshCcw size={13} /> 重试
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* API Key flow */}
              {authMode === 'apikey' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* API Key input */}
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                      {provider.apiKeyLabel}
                    </label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={`输入 ${provider.name} API Key`}
                      style={{
                        width: '100%',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        padding: '10px 14px',
                        color: 'white',
                        fontSize: '13px',
                        outline: 'none',
                        fontFamily: 'monospace',
                        boxSizing: 'border-box',
                      }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255,87,87,0.5)' }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                    />
                  </div>

                  {/* Optional Base URL */}
                  {provider.baseUrlSupport && (
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                        Base URL <span style={{ opacity: 0.5 }}>(可选)</span>
                      </label>
                      <input
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="https://api.example.com/v1"
                        style={{
                          width: '100%',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          padding: '10px 14px',
                          color: 'white',
                          fontSize: '12px',
                          outline: 'none',
                          fontFamily: 'monospace',
                          boxSizing: 'border-box',
                        }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255,87,87,0.5)' }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                      />
                    </div>
                  )}

                  {/* Test connection (only for providers with modelsEndpoint or baseUrlSupport) */}
                  {(provider.modelsEndpoint || provider.baseUrlSupport) && (
                    <div>
                      <button
                        onClick={handleTest}
                        disabled={!apiKey || testLoading}
                        style={{
                          padding: '7px 16px',
                          background: 'rgba(59,130,246,0.08)',
                          border: '1px solid rgba(59,130,246,0.25)',
                          borderRadius: '8px',
                          color: '#60a5fa',
                          fontSize: '12px',
                          cursor: !apiKey || testLoading ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          opacity: !apiKey ? 0.4 : 1,
                          transition: 'opacity 0.15s',
                        }}
                      >
                        {testLoading && <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                        测试并获取模型列表
                      </button>
                      {testError && (
                        <p style={{ fontSize: '11px', color: '#ff5757', marginTop: '8px' }}>
                          ✗ {testError}
                        </p>
                      )}
                      {testModels.length > 0 && (
                        <div style={{
                          marginTop: '10px',
                          background: 'rgba(0,0,0,0.25)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          padding: '10px 12px',
                          maxHeight: '130px',
                          overflowY: 'auto',
                        }}>
                          <p style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                            可用模型 ({testModels.length}) · 点击选择
                          </p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {testModels.map((m) => (
                              <div
                                key={m}
                                onClick={() => setModel(m)}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: '5px',
                                  fontSize: '11px',
                                  fontFamily: 'monospace',
                                  cursor: 'pointer',
                                  color: model === m ? 'white' : '#94a3b8',
                                  background: model === m ? 'rgba(255,87,87,0.12)' : 'transparent',
                                  border: `1px solid ${model === m ? 'rgba(255,87,87,0.3)' : 'transparent'}`,
                                  transition: 'all 0.1s',
                                  wordBreak: 'break-all',
                                }}
                              >
                                {model === m && '✓ '}{m}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Model input */}
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                      默认模型
                      <span style={{ opacity: 0.6, marginLeft: '6px', fontFamily: 'monospace', fontSize: '10px' }}>
                        agent.model
                      </span>
                    </label>
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={provider.exampleModel}
                      style={{
                        width: '100%',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        padding: '10px 14px',
                        color: 'white',
                        fontSize: '12px',
                        outline: 'none',
                        fontFamily: 'monospace',
                        boxSizing: 'border-box',
                      }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255,87,87,0.5)' }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                    />
                    <p style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '5px' }}>
                      格式: <code style={{ fontFamily: 'monospace' }}>{provider.id}/模型名称</code>，例如 <code style={{ fontFamily: 'monospace' }}>{provider.exampleModel}</code>
                    </p>
                  </div>

                  {saveError && (
                    <p style={{ fontSize: '12px', color: '#ff5757' }}>✗ {saveError}</p>
                  )}

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', paddingTop: '4px' }}>
                    <button
                      onClick={handleSave}
                      disabled={!apiKey || saving}
                      style={{
                        flex: 1,
                        padding: '11px',
                        background: apiKey ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                        border: 'none',
                        borderRadius: '10px',
                        color: 'white',
                        fontSize: '13px',
                        fontWeight: 700,
                        cursor: !apiKey || saving ? 'not-allowed' : 'pointer',
                        opacity: !apiKey ? 0.4 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        transition: 'opacity 0.15s',
                      }}
                    >
                      {saving
                        ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> 保存中...</>
                        : <><ChevronRight size={16} /> 保存并完成</>
                      }
                    </button>
                    <button
                      onClick={handleSkip}
                      style={{
                        padding: '11px 16px',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        color: 'var(--text-secondary)',
                        fontSize: '12px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      跳过
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Done ── */}
          {step === 'done' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '64px', height: '64px',
                borderRadius: '50%',
                background: 'rgba(167,139,250,0.1)',
                border: '1px solid rgba(167,139,250,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 20px',
              }}>
                <CheckCircle size={32} color="#a78bfa" />
              </div>
              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '10px' }}>
                配置完成！
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.7', marginBottom: '10px' }}>
                已成功配置 <strong style={{ color: 'white' }}>{provider?.name}</strong> 作为 AI 提供商
              </p>
              {(model || provider?.exampleModel) && (
                <p style={{
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  fontFamily: 'monospace',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '8px 14px',
                  display: 'inline-block',
                  marginBottom: '28px',
                }}>
                  模型: {model || provider?.exampleModel}
                </p>
              )}
              {!(model || provider?.exampleModel) && <div style={{ marginBottom: '28px' }} />}
              <div>
                <button
                  onClick={onComplete}
                  style={{
                    padding: '12px 36px',
                    background: '#a78bfa',
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  进入管理界面 <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      <WindowControls />
    </div>
  )
}

function ProviderCard({ provider, onClick }: { provider: ProviderDef; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '14px 10px',
        borderRadius: '12px',
        cursor: 'pointer',
        background: hovered ? `${provider.color}10` : 'rgba(255,255,255,0.02)',
        border: `1px solid ${hovered ? provider.color + '55' : 'var(--border)'}`,
        textAlign: 'center',
        transition: 'all 0.15s',
      }}
    >
      <div style={{
        width: '12px', height: '12px',
        borderRadius: '50%',
        background: provider.color,
        margin: '0 auto 8px',
      }} />
      <p style={{ fontSize: '12px', fontWeight: 600, lineHeight: '1.3' }}>{provider.name}</p>
      <p style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '3px' }}>
        {provider.modes.includes('oauth') ? 'OAuth · ' : ''}{provider.modes.includes('apikey') ? 'API Key' : ''}
      </p>
    </div>
  )
}
