import { useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import logoUrl from '../assets/logo.png'

interface Props {
  packageName: string
}

export default function UninstallView({ packageName }: Props) {
  const [keepData, setKeepData] = useState(true)
  const api = (window as any).api
  const isMac = (window.navigator.platform || '').toLowerCase().includes('mac')

  function cancel() {
    api.submitUninstallResult({ confirmed: false, keepData: true })
  }

  function confirm() {
    api.submitUninstallResult({ confirmed: true, keepData })
  }

  return (
    <div style={{
      height: '100vh',
      background: 'radial-gradient(circle at top right, #1a1a2e 0%, #07070a 60%)',
      display: 'flex',
      flexDirection: 'column',
      padding: '0',
      overflow: 'hidden',
      WebkitAppRegion: 'drag' as any,
    }}>
      {/* Title bar drag area */}
      <div style={{ height: isMac ? '44px' : '16px', flexShrink: 0 }} />

      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: '0 28px 28px',
        WebkitAppRegion: 'no-drag' as any,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '7px', overflow: 'hidden', background: 'var(--accent)', flexShrink: 0 }}>
            <img src={logoUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="logo" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={16} color="#ff5757" />
            <h2 style={{ fontFamily: "'Orbitron', sans-serif", fontSize: '14px', fontWeight: 900, color: '#ff5757' }}>
              卸载 {packageName}
            </h2>
          </div>
        </div>

        {/* Description */}
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.7', marginBottom: '18px' }}>
          此操作将：停止网关服务、移除系统服务注册、卸载 npm 包
          {navigator.userAgent.includes('Mac') ? '、移除 macOS App bundle' : '、清理 Windows 计划任务'}。
        </p>

        {/* Keep data option */}
        <div style={{
          flex: 1,
          background: !keepData ? 'rgba(255,87,87,0.06)' : 'rgba(34,197,94,0.04)',
          border: `1px solid ${!keepData ? 'rgba(255,87,87,0.3)' : 'rgba(34,197,94,0.2)'}`,
          borderRadius: '12px',
          padding: '14px',
          marginBottom: '18px',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }} onClick={() => setKeepData(!keepData)}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <input
              type="checkbox"
              checked={!keepData}
              onChange={e => setKeepData(!e.target.checked)}
              style={{ marginTop: '2px', accentColor: '#ff5757', width: '14px', height: '14px', flexShrink: 0, cursor: 'pointer' }}
              onClick={e => e.stopPropagation()}
            />
            <div>
              <p style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: !keepData ? '#ff5757' : 'var(--text-primary)' }}>
                同时删除配置和数据目录
              </p>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                删除 <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: '3px' }}>~/.openclaw</code> 目录，包含所有配置、会话历史、Agent 记忆。
                {!keepData && <span style={{ color: '#ff5757', fontWeight: 600 }}> 此操作不可恢复！</span>}
              </p>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={cancel}
            style={{
              flex: 1, padding: '10px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            取消
          </button>
          <button
            onClick={confirm}
            style={{
              flex: 2, padding: '10px',
              background: 'rgba(255,87,87,0.12)',
              border: '1px solid rgba(255,87,87,0.35)',
              borderRadius: '10px',
              color: '#ff5757',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              fontFamily: 'inherit',
            }}
          >
            <Trash2 size={13} />
            确认卸载{!keepData ? '（含数据）' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
