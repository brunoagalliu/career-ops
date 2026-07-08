import { useState, useEffect, useRef } from 'react'
import { authFetch, getToken } from '../api.js'

const FRESHNESS_OPTIONS = [
  { value: 'day',   label: 'Last 24 hours' },
  { value: 'week',  label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'any',   label: 'Any time' },
]

export default function ScanPanel({ mode = 'scan', onClose, onScanComplete }) {
  const label    = mode === 'pipeline' ? 'Pipeline' : 'Portal Scan'
  const apiBase  = `/api/${mode}`
  const isScan   = mode === 'scan'

  const [freshness, setFreshness] = useState('week')
  const [started, setStarted]     = useState(!isScan) // pipeline starts immediately
  const [lines, setLines]         = useState(isScan ? [] : [{ type: 'status', text: 'Connecting…' }])
  const [done, setDone]           = useState(false)
  const [exitCode, setExit]       = useState(null)
  const [progress, setProgress]   = useState(null)
  const bottomRef                 = useRef(null)
  const esRef                     = useRef(null)

  useEffect(() => {
    if (!started) return

    authFetch(`${apiBase}/status`)
      .then(r => r.json())
      .then(({ available }) => {
        if (!available) {
          setLines([{ type: 'error', text: `${label} is not configured.` }])
          setDone(true); setExit(1)
          return
        }
        startStream()
      })
      .catch(() => { startStream() })

    function startStream() {
      const token = getToken()
      const params = new URLSearchParams({ token })
      if (isScan) params.set('freshness', freshness)
      const es = new EventSource(`${apiBase}?${params}`)
      esRef.current = es

      es.onmessage = (e) => {
        const msg = JSON.parse(e.data)

        if (msg.type === 'done') {
          setExit(parseInt(msg.text, 10)); setDone(true); es.close(); return
        }

        if (msg.type === 'progress') {
          setProgress(JSON.parse(msg.text)); return
        }

        const chunks = msg.text.split('\n').filter(l => l.trim())
        if (chunks.length === 0) return
        setLines(prev => [...prev, ...chunks.map(text => ({ type: msg.type, text }))])
      }

      es.onerror = () => {
        setLines(prev => [...prev, { type: 'error', text: 'Connection lost.' }])
        setDone(true); es.close()
      }
    }

    return () => esRef.current?.close()
  }, [started])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  async function handleStop() {
    esRef.current?.close()
    await authFetch(apiBase, { method: 'DELETE' })
    setLines(prev => [...prev, { type: 'error', text: 'Cancelled.' }])
    setDone(true)
  }

  function handleStart() {
    setLines([{ type: 'status', text: 'Connecting…' }])
    setStarted(true)
  }

  const success = done && exitCode === 0
  const pct     = progress?.total > 0 ? Math.round((progress.current / progress.total) * 100) : null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950">

      {/* Header */}
      <div className="flex-shrink-0 border-b border-zinc-800 bg-zinc-900/80">
        <div className="flex items-center justify-between px-4 h-13">
          <div className="flex items-center gap-2">
            <span className="text-violet-400 text-xs">◆</span>
            <span className="text-sm font-medium">{label}</span>
            {started && !done && (
              <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                running
              </span>
            )}
            {done && success && <span className="text-xs text-emerald-400">complete</span>}
            {done && !success && exitCode !== null && <span className="text-xs text-rose-400">exited {exitCode}</span>}
            {progress && (
              <span className="text-xs text-zinc-500 ml-1">
                {progress.current}/{progress.total}
                {pct !== null && <span className="text-zinc-600"> · {pct}%</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {started && !done && (
              <button
                onClick={handleStop}
                className="text-xs text-zinc-500 hover:text-rose-400 transition-colors px-2 py-1 rounded border border-zinc-700 hover:border-rose-500/50"
              >
                Stop
              </button>
            )}
            {done && (
              <button
                onClick={() => { onScanComplete?.(); onClose() }}
                className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors px-3 py-1 rounded border border-emerald-500/40 hover:border-emerald-400/60 bg-emerald-500/10"
              >
                Refresh pipeline ↺
              </button>
            )}
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none p-0.5" aria-label="Close">×</button>
          </div>
        </div>

        {/* Progress bar */}
        {progress && progress.total > 0 && (
          <div className="h-0.5 bg-zinc-800">
            <div
              className={`h-full transition-all duration-500 ${done && success ? 'bg-emerald-500' : 'bg-violet-500'}`}
              style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* Freshness picker (scan only, before start) */}
      {isScan && !started && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <div className="text-center">
            <p className="text-zinc-300 text-sm font-medium mb-1">Search freshness</p>
            <p className="text-zinc-600 text-xs">Filter results to recently posted jobs only</p>
          </div>
          <div className="flex flex-col gap-2 w-56">
            {FRESHNESS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setFreshness(opt.value)}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors text-left ${
                  freshness === opt.value
                    ? 'bg-violet-600/20 text-violet-300 border-violet-500/50'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleStart}
            className="px-6 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors"
          >
            Start Scan
          </button>
        </div>
      )}

      {/* Terminal output */}
      {(started || !isScan) && (
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
          {lines.map((line, i) => (
            <div
              key={i}
              className={
                line.type === 'error'  ? 'text-rose-400' :
                line.type === 'status' && line.text.startsWith('→') ? 'text-violet-400/80' :
                line.type === 'status' ? 'text-zinc-500 italic' :
                'text-zinc-300'
              }
            >
              {line.text}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

    </div>
  )
}
