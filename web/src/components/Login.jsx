import { useState } from 'react'
import { setToken } from '../api.js'

export default function Login({ needsSetup, onAuth }) {
  const [mode, setMode]       = useState(needsSetup ? 'setup' : 'login')
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(false)

  const isSetup    = mode === 'setup'
  const isRegister = mode === 'register'

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const endpoint = isSetup ? '/api/auth/setup' : isRegister ? '/api/auth/register' : '/api/auth/login'
      const res  = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setToken(data.token)
      onAuth(data.user)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        <div className="flex items-center gap-2 mb-8 justify-center">
          <span className="text-violet-400 text-sm">◆</span>
          <span className="font-semibold text-sm tracking-tight">career-ops</span>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h1 className="text-sm font-semibold mb-1">
            {isSetup ? 'Set up your account' : isRegister ? 'Create account' : 'Sign in'}
          </h1>
          {isSetup && (
            <p className="text-xs text-zinc-500 mb-5">
              First user — your existing data will be migrated to your workspace.
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-3 mt-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>

            {error && (
              <p className="text-xs text-rose-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {loading ? '…' : isSetup ? 'Set up' : isRegister ? 'Create account' : 'Sign in'}
            </button>
          </form>

          {!isSetup && (
            <p className="text-xs text-zinc-500 mt-4 text-center">
              {isRegister ? (
                <>Already have an account?{' '}
                  <button onClick={() => { setMode('login'); setError(null) }} className="text-violet-400 hover:text-violet-300">
                    Sign in
                  </button>
                </>
              ) : (
                <>No account?{' '}
                  <button onClick={() => { setMode('register'); setError(null) }} className="text-violet-400 hover:text-violet-300">
                    Create one
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
