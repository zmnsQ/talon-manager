import { useState, useEffect } from 'react'
import SecurityView from './views/SecurityView'
import SetupView from './views/SetupView'
import OnboardingView from './views/OnboardingView'
import MainView from './views/MainView'
import UninstallView from './views/UninstallView'

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

const searchParams = new URLSearchParams(window.location.search)
const windowMode = searchParams.get('mode')
// Security window mode: loaded with ?mode=security by the main process
const isSecurityMode = windowMode === 'security'
// Uninstall confirmation window
const isUninstallMode = windowMode === 'uninstall'
const uninstallPackageName = searchParams.get('pkg') ?? 'OpenClaw'

// Security window: separate small window that only shows the accept dialog
function SecurityApp() {
  const api = (window as any).api
  return <SecurityView onAccept={() => api.acceptSecurity()} />
}

// Main window app with setup flow
type Phase = 'loading' | 'setup' | 'onboarding' | 'main' | 'reinstall'

function MainApp() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [detection, setDetection] = useState<Detection | null>(null)
  const api = (window as any).api

  useEffect(() => {
    Promise.all([api.checkEnvironment(), api.detectOpenClaw(), api.getPrefs()])
      .then(([env, det, prefs]: [any, any, any]) => {
        setDetection(det)
        if (env.allOk && det.installed) {
          setPhase(prefs.onboardingComplete ? 'main' : 'onboarding')
        } else {
          setPhase('setup')
        }
      })
      .catch(() => setPhase('setup'))
  }, [])

  async function handleSetupComplete() {
    const det = await api.detectOpenClaw()
    setDetection(det)
    setPhase('onboarding')
  }

  if (phase === 'loading') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'transparent', // Aurora bg is behind
        flexDirection: 'column',
        gap: '16px',
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '3px solid rgba(255,87,87,0.2)',
          borderTopColor: '#ff5757',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>初始化中...</p>
      </div>
    )
  }

  if (phase === 'setup' || phase === 'reinstall') {
    return <SetupView onComplete={handleSetupComplete} />
  }

  if (phase === 'onboarding') {
    return <OnboardingView onComplete={() => setPhase('main')} execPath={detection?.primary?.execPath ?? ''} />
  }

  if (phase === 'main' && detection) {
    return (
      <MainView
        detection={detection}
        onReinstall={() => setPhase('reinstall')}
      />
    )
  }

  return null
}

export default function App() {
  return (
    <>
      <div className="aurora-bg" />
      <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>
        {isSecurityMode ? <SecurityApp /> : isUninstallMode ? <UninstallView packageName={uninstallPackageName} /> : <MainApp />}
      </div>
    </>
  )
}
