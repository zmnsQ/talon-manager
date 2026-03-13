import React from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import { motion } from 'framer-motion'

const WindowControls: React.FC = () => {
  const [isMaximized, setIsMaximized] = React.useState(false)
  const isWin = (window.navigator.platform || '').toLowerCase().includes('win')
  if (!isWin) return null

  const api = (window as any).api

  React.useEffect(() => {
    // We can't easily listen to maximize events across IPC without a subscription, 
    // but for simple UI we can just toggle locally after click or use a polling/interval 
    // if we really wanted to be perfectly synced. 
    // Toggling locally as a start.
  }, [])

  const handleMaximize = () => {
    api.maximize()
    setIsMaximized(!isMaximized)
  }

  const buttonStyle: React.CSSProperties = {
    width: '46px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    WebkitAppRegion: 'no-drag' as any,
    color: 'var(--text-secondary)',
    opacity: 0.8,
  }

  return (
    <div style={{
      display: 'flex',
      position: 'absolute',
      top: 0,
      right: 0,
      zIndex: 10000,
      WebkitAppRegion: 'no-drag',
      pointerEvents: 'auto',
    } as any}>
      <motion.div
        style={buttonStyle}
        onClick={() => api.minimize()}
        whileHover={{ backgroundColor: 'rgba(255,255,255,0.08)', opacity: 1 }}
        transition={{ duration: 0.15 }}
      >
        <Minus size={16} strokeWidth={1.5} />
      </motion.div>
      <motion.div
        style={buttonStyle}
        onClick={handleMaximize}
        whileHover={{ backgroundColor: 'rgba(255,255,255,0.08)', opacity: 1 }}
        transition={{ duration: 0.15 }}
      >
        {isMaximized ? (
          <Copy size={12} strokeWidth={1.5} style={{ transform: 'scaleX(-1) rotate(-90deg)' }} />
        ) : (
          <Square size={13} strokeWidth={1.5} />
        )}
      </motion.div>
      <motion.div
        style={buttonStyle}
        onClick={() => api.close()}
        whileHover={{ backgroundColor: '#e81123', color: '#ffffff', opacity: 1 }}
        transition={{ duration: 0.15 }}
      >
        <X size={16} strokeWidth={1.5} />
      </motion.div>
    </div>
  )
}

export default WindowControls
