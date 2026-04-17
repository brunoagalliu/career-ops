import { useState, useEffect, useRef } from 'react'
import { authFetch, getToken } from '../api.js'

export default function ScanPanel({ mode = 'scan', onClose, onScanComplete }) {
  const label = mode === 'pipeline' ? 'Pipeline' : 'Portal Scan'
  const apiBase = `/api/${mode}`

  const [lines, setLines]       = useState([{ type: 'status', text: 'Connecting…' }])
  const [done, setDone]         = useState(false)
  const [exitCode, setExit]     = useState(null)
  const [progress, setProgress] = useState(null) // { current, total } or null
  const bottomRef               = useRef(null)
  const esRef                   = useRef(null)

  useEffect(() => {
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
      const es = new EventSource(`${apiBase}?token=${token}`)
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
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  async function handleStop() {
    esRef.current?.close()
    await authFetch(apiBase, { method: 'DELETE' })
    setLines(prev => [...prev, { type: 'error', text: 'Cancelled.' }])
    setDone(true)
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
            {!done && (
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
            {!done && (
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

      {/* Terminal output */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.type === 'error'  ? 'text-rose-400' :
              line.type === 'status' ? 'text-zinc-500 italic' :
              'text-zinc-300'
            }
          >
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

    </div>
  )
}
