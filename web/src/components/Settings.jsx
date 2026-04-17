import { useState } from 'react'
import { authFetch, clearToken } from '../api.js'

export default function Settings({ user, onLogout, onSaved }) {
  const [apiKey, setApiKey]         = useState('')
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const [error, setError]           = useState(null)
  const [migrating, setMigrating]   = useState(false)
  const [migrateMsg, setMigrateMsg] = useState(null)

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError(null); setSaved(false)
    try {
      const res  = await authFetch('/api/auth/apikey', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSaved(true)
      setApiKey('')
      onSaved?.()
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRemigrate() {
    setMigrating(true); setMigrateMsg(null)
    try {
      const res = await authFetch('/api/auth/remigrate', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMigrateMsg('Done — reload the page to see your data.')
    } catch (e) {
      setMigrateMsg(`Error: ${e.message}`)
    } finally {
      setMigrating(false)
    }
  }

  function handleLogout() {
    clearToken()
    onLogout()
  }

  return (
    <div className="max-w-sm space-y-4">

      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Account</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-zinc-200">{user.email}</p>
            <p className="text-xs text-zinc-600 mt-0.5">
              API key: {user.hasApiKey ? <span className="text-emerald-500">set</span> : <span className="text-amber-500">not set</span>}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-500 rounded px-3 py-1.5 transition-colors"
          >
            Sign out
          </button>
        </div>
      </section>

      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Data</h2>
        <p className="text-xs text-zinc-600 mb-3">Re-import your original data files (profile, tracker, reports) from the server root into your workspace.</p>
        <button
          onClick={handleRemigrate}
          disabled={migrating}
          className="text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors disabled:opacity-50"
        >
          {migrating ? 'Importing…' : 'Re-import original data'}
        </button>
        {migrateMsg && <p className="text-xs text-zinc-400 mt-2">{migrateMsg}</p>}
      </section>

      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Anthropic API Key</h2>
        <p className="text-xs text-zinc-600 mb-4">
          Required for Scan and Pipeline. Your key is stored on the server and used only for your jobs.
        </p>
        <form onSubmit={handleSave} className="space-y-3">
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-ant-…"
            required
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
          />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={saving || !apiKey}
            className="text-xs px-3 py-1.5 rounded border border-emerald-500/40 text-emerald-400 hover:text-emerald-300 hover:border-emerald-400/60 bg-emerald-500/10 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save key'}
          </button>
        </form>
      </section>

    </div>
  )
}
