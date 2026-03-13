import { useState } from 'react'
import { ShieldCheck, AlertTriangle, ExternalLink } from 'lucide-react'
import logoUrl from '../assets/logo.png'

interface Props {
  onAccept: () => void
}

export default function SecurityView({ onAccept }: Props) {
  const [checked, setChecked] = useState(false)

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      background: 'radial-gradient(circle at top right, #1a1a2e 0%, #07070a 60%)',
      padding: '40px 50px',
      overflowY: 'auto',
      position: 'relative',
      WebkitAppRegion: 'drag',
      boxSizing: 'border-box'
    } as any}>
      <div className="top-drag-region" />
      <div style={{
        width: '100%',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        WebkitAppRegion: 'no-drag',
      } as any}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '32px' }}>
          <div style={{ width: '48px', height: '48px', flexShrink: 0 }}>
            <img src={logoUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="logo" />
          </div>
          <div>
            <h1 style={{ fontSize: '12px', fontWeight: 900, fontFamily: "'Orbitron', sans-serif" }}>Talon</h1>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>OpenClaw 管理器</p>
          </div>
        </div>

        {/* Warning Banner */}
        <div style={{
          background: 'rgba(255,87,87,0.08)',
          border: '1px solid rgba(255,87,87,0.25)',
          borderRadius: '14px',
          padding: '20px',
          marginBottom: '24px',
          display: 'flex',
          gap: '16px',
          alignItems: 'flex-start',
        }}>
          <AlertTriangle size={24} color="#ff5757" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <h2 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', color: '#ff5757' }}>
              安全须知
            </h2>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.8', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p>OpenClaw 是一个 AI Agent 框架，它需要访问您计算机上的文件和执行终端命令。在安装和使用前，请知悉以下重要事项：</p>
              <ul style={{ paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <li>OpenClaw 会接收来自消息平台的指令，请将其视为<strong style={{ color: 'var(--text-primary)' }}>不可信来源</strong></li>
                <li>建议在<strong style={{ color: 'var(--text-primary)' }}>隔离的测试机器</strong>或云实例上运行，而非主力机</li>
                <li>危险功能（Shell 命令、文件访问）默认<strong style={{ color: '#22c55e' }}>已禁用</strong>，请根据需要谨慎开启</li>
                <li>请定期轮换 API Keys，不要将其提交到公开仓库</li>
                <li>未知发送者会收到配对码，Agent 将忽略所有未经批准的消息来源</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Info Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '28px' }}>
          {[
            { icon: ShieldCheck, title: '沙盒模式', desc: '文件和命令访问受到限制', color: '#22c55e' },
            { icon: ExternalLink, title: '开放源码', desc: '代码完全透明，可自行审计', color: '#3b82f6' },
          ].map((item) => (
            <div key={item.title} style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '16px',
            }}>
              <item.icon size={18} color={item.color} style={{ marginBottom: '8px' }} />
              <p style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>{item.title}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{item.desc}</p>
            </div>
          ))}
        </div>

        {/* Agreement Checkbox */}
        <label style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          cursor: 'pointer',
          marginBottom: '24px',
          padding: '14px',
          background: checked ? 'rgba(34,197,94,0.05)' : 'rgba(255,255,255,0.02)',
          border: `1px solid ${checked ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
          borderRadius: '10px',
          transition: 'all 0.2s ease',
        }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={{ marginTop: '2px', accentColor: '#22c55e', width: '16px', height: '16px', flexShrink: 0, cursor: 'pointer' }}
          />
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            我已阅读并理解上述安全须知，了解 OpenClaw 的工作原理和潜在风险，并同意在合理的安全边界内使用本程序
          </span>
        </label>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => (window as any).api.appQuit()}
            style={{
              flex: 1,
              padding: '14px',
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            不同意并退出
          </button>
          <button
            disabled={!checked}
            onClick={onAccept}
            style={{
              flex: 1,
              padding: '14px',
              background: checked ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
              color: checked ? 'white' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: '12px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: checked ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
              boxShadow: checked ? '0 0 20px rgba(255,87,87,0.3)' : 'none',
            }}
          >
            我已了解，开始使用
          </button>
        </div>
      </div>
    </div>
  )
}
