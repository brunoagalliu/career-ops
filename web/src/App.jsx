import { useState, useCallback, useEffect } from 'react'
import Pipeline from './components/Pipeline.jsx'
import Profile from './components/Profile.jsx'
import ScanPanel from './components/ScanPanel.jsx'
import Login from './components/Login.jsx'
import Settings from './components/Settings.jsx'
import { authFetch, getToken, clearToken } from './api.js'

function DownloadCvButton() {
  const [loading, setLoading] = useState(false)
  async function handleClick() {
    setLoading(true)
    try {
      const res = await authFetch('/api/cv/pdf')
      if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed'); return }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = 'cv.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { alert(e.message) }
    finally { setLoading(false) }
  }
  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border border-zinc-700/40 hover:border-zinc-600/60 disabled:opacity-50"
    >
      {loading ? <span className="inline-block w-3 h-3 border border-zinc-400 border-t-transparent rounded-full animate-spin" /> : '↓'} CV PDF
    </button>
  )
}

export default function App() {
  const [user, setUser]               = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [needsSetup, setNeedsSetup]   = useState(false)
  const [view, setView]               = useState('pipeline')
  const [activePanel, setActivePanel] = useState(null)
  const [pipelineKey, setPipelineKey] = useState(0)
  const [scanAvailable, setScanAvailable] = useState(null)
  const [jobStatus, setJobStatus]         = useState({ pipeline: false, scan: false })

  // On mount: check if setup needed, then verify token
  useEffect(() => {
    async function init() {
      try {
        const sr   = await fetch('/api/auth/status')
        const data = await sr.json()
        if (data.needsSetup) { setNeedsSetup(true); setAuthLoading(false); return }

        const token = getToken()
        if (!token) { setAuthLoading(false); return }

        const mr = await authFetch('/api/auth/me')
        if (mr.ok) {
          const me = await mr.json()
          setUser(me)
          setScanAvailable(me.hasApiKey)
        } else {
          clearToken()
        }
      } catch {
        clearToken()
      } finally {
        setAuthLoading(false)
      }
    }
    init()
  }, [])

  function handleAuth(u) {
    setUser(u)
    setNeedsSetup(false)
    setScanAvailable(u.hasApiKey)
  }

  function handleLogout() {
    setUser(null)
    setScanAvailable(null)
    setView('pipeline')
  }

  // After saving API key in Settings, refresh availability
  function handleSettingsSaved() {
    authFetch('/api/auth/me').then(r => r.json()).then(me => {
      setUser(me)
      setScanAvailable(me.hasApiKey)
    })
  }

  const handleScanComplete = useCallback(() => setPipelineKey(k => k + 1), [])

  // Poll job status every 5s so the header indicator stays accurate
  useEffect(() => {
    if (!user || !scanAvailable) return
    function poll() {
      Promise.all([
        authFetch('/api/pipeline/status').then(r => r.json()).catch(() => ({})),
        authFetch('/api/scan/status').then(r => r.json()).catch(() => ({})),
      ]).then(([p, s]) => setJobStatus({ pipeline: p.running, scan: s.running }))
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [user, scanAvailable])

  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <span className="text-zinc-600 text-sm">Loading…</span>
      </div>
    )
  }

  if (needsSetup || !user) {
    return <Login needsSetup={needsSetup} onAuth={handleAuth} />
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-screen-xl mx-auto px-4 h-13 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-violet-400 text-xs">◆</span>
            <span className="font-semibold text-sm tracking-tight">career-ops</span>
          </div>
          <div className="flex items-center gap-2">
            {scanAvailable === true && (
              <>
                <button
                  onClick={() => setActivePanel('pipeline')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 border border-amber-500/30 hover:border-amber-400/50"
                >
                  {jobStatus.pipeline
                    ? <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    : '▶'} Pipeline
                </button>
                <button
                  onClick={() => setActivePanel('scan')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors text-violet-300 hover:text-violet-200 hover:bg-violet-500/10 border border-violet-500/30 hover:border-violet-400/50"
                >
                  {jobStatus.scan
                    ? <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                    : '▶'} Scan
                </button>
              </>
            )}
            {scanAvailable === false && (
              <button
                onClick={() => setView('settings')}
                title="Add your Anthropic API key in Settings to enable Scan and Pipeline"
                className="px-3 py-1.5 rounded text-sm font-medium text-amber-500 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
              >
                ⚠ Add API key
              </button>
            )}
            <DownloadCvButton />
            <nav className="flex gap-1">
              {['pipeline', 'profile', 'settings'].map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 rounded text-sm font-medium capitalize transition-colors ${
                    view === v
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  {v}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-4 py-6">
        {view === 'pipeline' && <Pipeline key={pipelineKey} />}
        {view === 'profile'  && <Profile />}
        {view === 'settings' && (
          <Settings user={user} onLogout={handleLogout} onSaved={handleSettingsSaved} />
        )}
      </main>

      {activePanel && (
        <ScanPanel
          mode={activePanel}
          onClose={() => setActivePanel(null)}
          onScanComplete={handleScanComplete}
        />
      )}
    </div>
  )
}
