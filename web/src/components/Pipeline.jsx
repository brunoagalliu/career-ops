import { useState, useEffect } from 'react'
import Metrics from './Metrics.jsx'
import ReportDrawer from './ReportDrawer.jsx'
import { authFetch } from '../api.js'

const FILTERS = ['All', 'Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP']

const STATUS_PRIORITY = {
  Offer: 0, Interview: 1, Responded: 2, Applied: 3,
  Evaluated: 4, SKIP: 5, Rejected: 6, Discarded: 7,
}

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

function scoreStyle(score) {
  if (score >= 4.0) return { text: 'text-emerald-400', bg: 'bg-emerald-500/10' }
  if (score >= 3.0) return { text: 'text-amber-400',   bg: 'bg-amber-500/10' }
  return              { text: 'text-rose-400',   bg: 'bg-rose-500/10' }
}

function SortIcon({ active, dir }) {
  if (!active) return <span className="text-zinc-700 ml-1 text-xs">↕</span>
  return <span className="text-zinc-400 ml-1 text-xs">{dir === 'asc' ? '↑' : '↓'}</span>
}

export default function Pipeline() {
  const [apps, setApps]           = useState([])
  const [metrics, setMetrics]     = useState(null)
  const [filter, setFilter]       = useState('All')
  const [selectedApp, setSelected] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [sortBy, setSortBy]       = useState('status')
  const [sortDir, setSortDir]     = useState('asc')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [ar, mr] = await Promise.all([
        authFetch('/api/applications'),
        authFetch('/api/metrics'),
      ])
      setApps(await ar.json())
      setMetrics(await mr.json())
    } finally {
      setLoading(false)
    }
  }

  async function handleStatusUpdate(app, newStatus) {
    await authFetch(`/api/applications/${app.reportNumber}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newStatus }),
    })
    setApps(prev => prev.map(a =>
      a.reportNumber === app.reportNumber ? { ...a, status: newStatus } : a
    ))
    setSelected(prev =>
      prev?.reportNumber === app.reportNumber ? { ...prev, status: newStatus } : prev
    )
    const mr = await authFetch('/api/metrics')
    setMetrics(await mr.json())
  }

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  const visible = apps
    .filter(a => filter === 'All' || a.status === filter)
    .sort((a, b) => {
      let cmp = 0
      if (sortBy === 'score')  cmp = b.score - a.score
      else if (sortBy === 'date') cmp = b.date.localeCompare(a.date)
      else cmp = (STATUS_PRIORITY[a.status] ?? 8) - (STATUS_PRIORITY[b.status] ?? 8)
      return sortDir === 'asc' ? cmp : -cmp
    })

  return (
    <div className="flex gap-4 items-start">
      {/* Left: table */}
      <div className={`flex-1 min-w-0 ${selectedApp ? 'hidden lg:block' : ''}`}>
        {metrics && <Metrics metrics={metrics} />}

        {/* Filter pills */}
        <div className="flex flex-wrap gap-1.5 mt-5 mb-4">
          {FILTERS.map(f => {
            const count = f !== 'All' ? (metrics?.byStatus?.[f] || 0) : null
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  filter === f
                    ? 'bg-zinc-700 text-zinc-100 border-zinc-600'
                    : 'bg-transparent text-zinc-500 border-zinc-800 hover:border-zinc-600 hover:text-zinc-300'
                }`}
              >
                {f}{count ? ` · ${count}` : ''}
              </button>
            )
          })}
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-zinc-600 text-sm py-12 text-center">Loading…</div>
        ) : (
          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/70">
                  <th
                    onClick={() => toggleSort('score')}
                    className="text-left px-3 py-2.5 text-zinc-500 font-medium text-xs uppercase tracking-wide cursor-pointer hover:text-zinc-300 w-20 select-none"
                  >
                    Score <SortIcon active={sortBy === 'score'} dir={sortDir} />
                  </th>
                  <th className="text-left px-3 py-2.5 text-zinc-500 font-medium text-xs uppercase tracking-wide">Company</th>
                  <th className="text-left px-3 py-2.5 text-zinc-500 font-medium text-xs uppercase tracking-wide hidden md:table-cell">Role</th>
                  <th
                    onClick={() => toggleSort('status')}
                    className="text-left px-3 py-2.5 text-zinc-500 font-medium text-xs uppercase tracking-wide cursor-pointer hover:text-zinc-300 w-32 select-none"
                  >
                    Status <SortIcon active={sortBy === 'status'} dir={sortDir} />
                  </th>
                  <th
                    onClick={() => toggleSort('date')}
                    className="text-left px-3 py-2.5 text-zinc-500 font-medium text-xs uppercase tracking-wide cursor-pointer hover:text-zinc-300 w-28 hidden sm:table-cell select-none"
                  >
                    Date <SortIcon active={sortBy === 'date'} dir={sortDir} />
                  </th>
                  <th className="text-center px-3 py-2.5 text-zinc-500 font-medium text-xs uppercase tracking-wide w-10">PDF</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-zinc-600 py-10 text-sm">
                      No applications found
                    </td>
                  </tr>
                )}
                {visible.map(app => {
                  const { text, bg } = scoreStyle(app.score)
                  const isSelected = selectedApp?.reportNumber === app.reportNumber
                  return (
                    <tr
                      key={app.reportNumber || app.num}
                      onClick={() => setSelected(app)}
                      className={`border-b border-zinc-800/50 cursor-pointer transition-colors ${
                        isSelected ? 'bg-zinc-800/70' : 'hover:bg-zinc-800/30'
                      }`}
                    >
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center justify-center w-14 py-0.5 rounded font-mono text-sm font-semibold ${text} ${bg}`}>
                          {app.score > 0 ? app.score.toFixed(1) : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-zinc-100 font-medium">{app.company}</span>
                        {/* Show role inline on small screens */}
                        <span className="block text-zinc-500 text-xs mt-0.5 md:hidden">{app.role}</span>
                      </td>
                      <td className="px-3 py-3 hidden md:table-cell">
                        <span className="text-zinc-400">{app.role}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[app.status] || 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
                          {app.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-zinc-600 text-xs hidden sm:table-cell">{app.date}</td>
                      <td className="px-3 py-3 text-center">
                        {app.hasPDF
                          ? <span className="text-emerald-500 text-xs">✓</span>
                          : <span className="text-zinc-700 text-xs">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Right: report drawer */}
      {selectedApp && (
        <ReportDrawer
          app={selectedApp}
          onClose={() => setSelected(null)}
          onStatusUpdate={handleStatusUpdate}
        />
      )}
    </div>
  )
}
