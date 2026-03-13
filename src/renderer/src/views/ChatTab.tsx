import { useState, useEffect, useRef } from 'react'
import { Send, Plus, Search, RefreshCcw, BrainCircuit, Paperclip, MessageSquare, ChevronDown } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
  attachments?: string[]
  thinking?: string
}

interface ChatSession {
  id: string
  title: string
  ts: number
  channel?: string   // channel source if from external channel
  agentId?: string
}

interface Props {
  execPath: string | null
  via: 'global' | 'pnpm'
  gatewayRunning: boolean
  agents: string[]
}

const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram', discord: 'Discord', slack: 'Slack',
  whatsapp: 'WhatsApp', signal: 'Signal', webchat: 'WebChat',
}

export default function ChatTab({ execPath, gatewayRunning, agents }: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [streamBuffer, setStreamBuffer] = useState('')
  const [selectedAgent, setSelectedAgent] = useState(agents[0] ?? 'main')
  const [thinking, setThinking] = useState(false)
  const [showThinkingFor, setShowThinkingFor] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const api = (window as any).api

  const activeMessages = activeSessionId ? (messages[activeSessionId] ?? []) : []
  const activeSession = sessions.find((s) => s.id === activeSessionId)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeMessages, streamBuffer])

  useEffect(() => {
    const unsub = api.onLog((entry: any) => {
      if (sending) setStreamBuffer((prev: string) => prev + entry.line + '\n')
    })
    return unsub
  }, [sending])

  function newSession() {
    const id = Date.now().toString()
    const session: ChatSession = { id, title: '新建会话', ts: Date.now(), agentId: selectedAgent }
    setSessions((prev: ChatSession[]) => [session, ...prev])
    setActiveSessionId(id)
    setMessages((prev) => ({ ...prev, [id]: [] }))
    setStreamBuffer('')
    setAttachments([])
  }

  async function sendMessage() {
    if (!input.trim() || !execPath || sending) return

    let sid = activeSessionId
    if (!sid) {
      sid = Date.now().toString()
      const session: ChatSession = { id: sid, title: input.slice(0, 30), ts: Date.now(), agentId: selectedAgent }
      setSessions((prev: ChatSession[]) => [session, ...prev])
      setMessages((prev) => ({ ...prev, [sid!]: [] }))
      setActiveSessionId(sid)
    }
    // Update title from first message
    if ((messages[sid] ?? []).length === 0) {
      setSessions((prev: ChatSession[]) =>
        prev.map((s) => s.id === sid ? { ...s, title: input.slice(0, 30) } : s)
      )
    }

    const userMsg: Message = {
      id: Date.now().toString(), role: 'user', content: input,
      ts: Date.now(), attachments: attachments.length ? [...attachments] : undefined,
    }
    setMessages((prev) => ({ ...prev, [sid!]: [...(prev[sid!] ?? []), userMsg] }))
    const sentInput = input
    setInput('')
    setAttachments([])
    setSending(true)
    setStreamBuffer('')

    try {
      // Never pass --thinking flag — button only controls UI display
      await api.runChatMessage(execPath, sentInput, selectedAgent, false)
    } finally {
      setStreamBuffer((buf: string) => {
        if (buf.trim()) {
          const assistantMsg: Message = {
            id: (Date.now() + 1).toString(), role: 'assistant', content: buf.trim(), ts: Date.now(),
          }
          setMessages((prev) => ({ ...prev, [sid!]: [...(prev[sid!] ?? []), assistantMsg] }))
        }
        return ''
      })
      setSending(false)
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    setAttachments((prev) => [...prev, ...files.map((f) => f.name)])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const canSend = !!(input.trim() && execPath && !sending && gatewayRunning)

  return (
    <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
      {/* Session list */}
      <div style={{ width: '240px', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', padding: '14px', display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', flexShrink: 0 }}>
        <button onClick={newSession} style={{ width: '100%', padding: '9px', background: 'var(--accent)', border: 'none', borderRadius: '10px', color: 'white', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '10px', cursor: 'pointer', fontSize: '13px' }}>
          <Plus size={14} /> 新建会话
        </button>
        <div style={{ position: 'relative', marginBottom: '10px' }}>
          <Search size={12} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索..." style={{ width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: '8px', padding: '7px 7px 7px 28px', color: 'white', fontSize: '12px', outline: 'none' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {filteredSessions.length === 0 ? (
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '20px' }}>暂无会话</p>
          ) : (
            filteredSessions.map((s) => (
              <div key={s.id} onClick={() => { setActiveSessionId(s.id); setStreamBuffer('') }} style={{ padding: '9px 11px', borderRadius: '8px', cursor: 'pointer', background: s.id === activeSessionId ? 'rgba(255,255,255,0.06)' : 'transparent', border: `1px solid ${s.id === activeSessionId ? 'rgba(255,87,87,0.25)' : 'transparent'}` }}>
                <p style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || '新建会话'}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                  {s.channel && (
                    <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '10px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', fontWeight: 600 }}>
                      {CHANNEL_LABELS[s.channel] ?? s.channel}
                    </span>
                  )}
                  {s.agentId && s.agentId !== 'main' && (
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{s.agentId}</span>
                  )}
                  <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                    {new Date(s.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat window */}
      <div style={{ flex: 1, background: 'rgba(255,255,255,0.02)', borderRadius: '16px', display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', overflow: 'hidden', minWidth: 0 }}>
        {/* Header */}
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.01)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h4 style={{ fontSize: '12px' }}>
                {activeSession ? activeSession.title || '新建会话' : '对话'}
              </h4>
              {activeSession?.channel && (
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', fontWeight: 600 }}>
                  来自 {CHANNEL_LABELS[activeSession.channel] ?? activeSession.channel}
                </span>
              )}
            </div>
            <p style={{ fontSize: '11px', marginTop: '2px', color: gatewayRunning ? '#22c55e' : '#ff5757' }}>
              {gatewayRunning ? '● 网关已连接' : '● 网关未运行，请先启动网关'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Agent selector */}
            {agents.length > 1 && (
              <div style={{ position: 'relative' }}>
                <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '8px', padding: '6px 28px 6px 10px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', appearance: 'none' }}>
                  {agents.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <ChevronDown size={12} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-secondary)' }} />
              </div>
            )}
            {/* Thinking toggle */}
            <button
              onClick={() => setThinking(!thinking)}
              title={thinking ? '隐藏思考过程' : '显示思考过程'}
              style={{ padding: '6px 10px', background: thinking ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.05)', border: `1px solid ${thinking ? 'rgba(167,139,250,0.3)' : 'var(--border)'}`, borderRadius: '8px', color: thinking ? '#a78bfa' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              <BrainCircuit size={13} /> {thinking ? '隐藏思考' : '显示思考'}
            </button>
            <button onClick={() => { if (activeSessionId) setMessages((prev) => ({ ...prev, [activeSessionId]: [] })) }} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '8px', padding: '6px 10px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <RefreshCcw size={12} /> 清空
            </button>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {!activeSessionId || activeMessages.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', gap: '12px' }}>
              <MessageSquare size={40} style={{ opacity: 0.2 }} />
              <p style={{ fontSize: '12px' }}>
                {!execPath ? '请先安装 OpenClaw' : !gatewayRunning ? '请先启动网关' : '开始新对话'}
              </p>
              {execPath && gatewayRunning && !activeSessionId && (
                <button onClick={newSession} style={{ background: 'rgba(255,87,87,0.1)', border: '1px solid rgba(255,87,87,0.2)', borderRadius: '8px', padding: '8px 16px', color: 'var(--accent)', fontSize: '13px', cursor: 'pointer' }}>
                  新建会话
                </button>
              )}
            </div>
          ) : (
            <>
              {activeMessages.map((msg) => (
                <div key={msg.id} style={{ display: 'flex', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{ width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0, background: msg.role === 'user' ? 'var(--accent)' : 'rgba(167,139,250,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: msg.role === 'user' ? 'white' : '#a78bfa' }}>
                    {msg.role === 'user' ? '我' : <BrainCircuit size={14} />}
                  </div>
                  <div style={{ maxWidth: '76%' }}>
                    {msg.thinking && (
                      <div>
                        <button onClick={() => setShowThinkingFor(showThinkingFor === msg.id ? null : msg.id)} style={{ background: 'none', border: 'none', color: '#a78bfa', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px', padding: 0 }}>
                          <BrainCircuit size={11} /> 思考过程 {showThinkingFor === msg.id ? '▲' : '▼'}
                        </button>
                        {showThinkingFor === msg.id && (
                          <div style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.15)', borderRadius: '10px', padding: '10px 14px', marginBottom: '6px', fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', lineHeight: '1.6' }}>
                            {msg.thinking}
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ background: msg.role === 'user' ? 'rgba(255,87,87,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${msg.role === 'user' ? 'rgba(255,87,87,0.2)' : 'var(--border)'}`, borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px', padding: '11px 15px' }}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '13px', lineHeight: '1.7', fontFamily: 'inherit' }}>{msg.content}</pre>
                      {msg.attachments?.length && (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                          {msg.attachments.map((a) => (
                            <span key={a} style={{ fontSize: '11px', padding: '2px 8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', color: 'var(--text-secondary)' }}>{a}</span>
                          ))}
                        </div>
                      )}
                      <p style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '5px', textAlign: msg.role === 'user' ? 'right' : 'left' }}>
                        {new Date(msg.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {/* Streaming */}
              {sending && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{ width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0, background: 'rgba(167,139,250,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a78bfa' }}>
                    <BrainCircuit size={14} />
                  </div>
                  <div style={{ maxWidth: '76%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '4px 16px 16px 16px', padding: '11px 15px' }}>
                    {streamBuffer ? (
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '13px', lineHeight: '1.7', fontFamily: 'inherit' }}>{streamBuffer}</pre>
                    ) : (
                      <div style={{ display: 'flex', gap: '4px', padding: '2px 0' }}>
                        {[0, 1, 2].map((i) => (
                          <div key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#a78bfa', animation: `blink ${0.8 + i * 0.15}s ease-in-out infinite` }} />
                        ))}
                      </div>
                    )}
                    {streamBuffer && <span style={{ display: 'inline-block', width: '8px', height: '14px', background: '#a78bfa', animation: 'blink 0.8s step-end infinite', verticalAlign: 'middle', marginLeft: '2px' }} />}
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border)' }}>
          {/* Attachments preview */}
          {attachments.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {attachments.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 8px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  <Paperclip size={10} />
                  {a}
                  <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#ff5757', cursor: 'pointer', padding: '0 2px', fontSize: '12px' }}>×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', gap: '8px', padding: '10px 12px', alignItems: 'flex-end' }}>
            {/* File attach */}
            <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
            <button onClick={() => fileInputRef.current?.click()} title="添加附件" style={{ padding: '6px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              <Paperclip size={16} />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder={!execPath ? '请先安装 OpenClaw' : !gatewayRunning ? '请先启动网关' : '输入消息… (Enter 发送，Shift+Enter 换行)'}
              disabled={!execPath || !gatewayRunning || sending}
              rows={1}
              style={{ flex: 1, background: 'transparent', border: 'none', color: 'white', outline: 'none', fontSize: '13px', resize: 'none', fontFamily: 'inherit', lineHeight: '1.5', maxHeight: '100px', overflowY: 'auto' }}
            />
            <button onClick={sendMessage} disabled={!canSend} style={{ background: canSend ? 'var(--accent)' : 'rgba(255,255,255,0.05)', color: canSend ? 'white' : 'var(--text-secondary)', border: 'none', borderRadius: '8px', padding: '7px', cursor: canSend ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
              <Send size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
