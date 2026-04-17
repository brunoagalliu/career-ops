import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { authFetch } from '../api.js'

const STATUS_OPTIONS = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP']

const STATUS_STYLES = {
  Interview: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Offer:     'bg-emerald-400/25 text-emerald-300 border-emerald-400/40',
  Applied:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
  Responded: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  Evaluated: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/40',
  Rejected:  'bg-rose-500/15 text-rose-400 border-rose-500/30',
  Discarded: 'bg-zinc-800/40 text-zinc-500 border-zinc-700/40',
  SKIP:      'bg-zinc-800/40 text-zinc-600 border-zinc-700/30',
}

function scoreColor(score) {
  if (score >= 4.0) return 'text-emerald-400'
  if (score >= 3.0) return 'text-amber-400'
  return 'text-rose-400'
}

export default function ReportDrawer({ app, onClose, onStatusUpdate }) {
  const [content, setContent]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [updating, setUpdating] = useState(false)
  const [toast, setToast]       = useState(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    setContent(null)
    setLoading(true)
    if (!app.reportPath) { setLoading(false); return }

    authFetch(`/api/report?path=${encodeURIComponent(app.reportPath)}`)
      .then(r => r.json())
      .then(data => { setContent(data.content || null); setLoading(false) })
      .catch(() => { setContent(null); setLoading(false) })
  }, [app.reportPath])

  // Scroll to top when switching apps
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0)
  }, [app.reportNumber])

  async function handleStatusChange(newStatus) {
    if (newStatus === app.status || !app.reportNumber) return
    setUpdating(true)
    try {
      await onStatusUpdate(app, newStatus)
      showToast(`Status → ${newStatus}`)
    } catch {
      showToast('Update failed')
    } finally {
      setUpdating(false)
    }
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  return (
    <div className="w-full lg:w-[600px] xl:w-[680px] flex-shrink-0 bg-zinc-900 border border-zinc-800 rounded-lg flex flex-col sticky top-20 max-h-[calc(100vh-6rem)]">

      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-zinc-800 flex-shrink-0">
        <div className="flex-1 min-w-0 pr-3">
          <h2 className="font-semibold text-zinc-100 leading-snug">{app.company}</h2>
          <p className="text-sm text-zinc-400 mt-0.5 leading-snug">{app.role}</p>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-600 hover:text-zinc-300 transition-colors p-0.5 flex-shrink-0 text-lg leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Score + Status + Status selector */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 flex-shrink-0">
        {app.score > 0 && (
          <span className={`font-mono text-lg font-bold tabular-nums ${scoreColor(app.score)}`}>
            {app.score.toFixed(1)}<span className="text-zinc-600 font-normal text-sm">/5</span>
          </span>
        )}
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[app.status] || 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
          {app.status}
        </span>
        <div className="ml-auto">
          <select
            value={app.status}
            onChange={e => handleStatusChange(e.target.value)}
            disabled={updating || !app.reportNumber}
            className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-zinc-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Report body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 min-h-0">
        {loading ? (
          <div className="text-zinc-600 text-sm py-12 text-center">Loading report…</div>
        ) : !content ? (
          <div className="text-zinc-600 text-sm py-12 text-center">No report available</div>
        ) : (
          <div className="report-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>

      {/* Notes footer */}
      {app.notes && (
        <div className="px-4 py-2.5 border-t border-zinc-800 flex-shrink-0">
          <p className="text-xs text-zinc-500 leading-relaxed">{app.notes}</p>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-4 left-4 right-4 bg-zinc-700 border border-zinc-600 text-zinc-100 text-xs px-3 py-2 rounded-lg text-center shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
