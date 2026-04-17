import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
import { execFile, spawn } from 'child_process'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT       = path.resolve(__dirname, '..')
const PORT       = process.env.PORT || 3001
const isProd     = process.env.NODE_ENV === 'production'
const JWT_SECRET = process.env.JWT_SECRET || 'career-ops-dev-secret-change-in-prod'
const WORKSPACES = path.join(ROOT, 'workspaces')

fs.mkdirSync(WORKSPACES, { recursive: true })

// ── Database ──────────────────────────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set. Add a PostgreSQL service in Railway and link it to this service.')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      api_key       TEXT NOT NULL DEFAULT '',
      profile_yml   TEXT NOT NULL DEFAULT '',
      portals_yml   TEXT NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_yml TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS portals_yml TEXT NOT NULL DEFAULT ''`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_files (
      user_id    TEXT NOT NULL,
      path       TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, path)
    )
  `)
}

async function countUsers()          { const r = await pool.query('SELECT COUNT(*) FROM users'); return parseInt(r.rows[0].count, 10) }
async function findUserByEmail(email){ const r = await pool.query('SELECT * FROM users WHERE email = $1', [email]); return r.rows[0] || null }
async function findUserById(id)      { const r = await pool.query('SELECT * FROM users WHERE id = $1',    [id]);    return r.rows[0] || null }
async function createUser({ id, email, passwordHash }) {
  const r = await pool.query(
    'INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
    [id, email, passwordHash]
  )
  return r.rows[0]
}
async function setApiKey(id, apiKey)  { await pool.query('UPDATE users SET api_key    = $1 WHERE id = $2', [apiKey, id]) }
async function setProfileYml(id, yml) { await pool.query('UPDATE users SET profile_yml = $1 WHERE id = $2', [yml,    id]) }
async function setPortalsYml(id, yml) { await pool.query('UPDATE users SET portals_yml = $1 WHERE id = $2', [yml,    id]) }

// ── File store ────────────────────────────────────────────────────────────────

async function saveFile(userId, filePath, content) {
  await pool.query(`
    INSERT INTO user_files (user_id, path, content, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (user_id, path) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
  `, [userId, filePath, content])
}

async function getFile(userId, filePath) {
  const r = await pool.query('SELECT content FROM user_files WHERE user_id = $1 AND path = $2', [userId, filePath])
  return r.rows[0]?.content ?? null
}

async function getAllFiles(userId) {
  const r = await pool.query('SELECT path, content FROM user_files WHERE user_id = $1', [userId])
  return r.rows
}

// map snake_case DB row → camelCase object used throughout the server
function toUser(row) {
  if (!row) return null
  return {
    id: row.id, email: row.email, passwordHash: row.password_hash,
    apiKey: row.api_key, profileYml: row.profile_yml, portalsYml: row.portals_yml,
    createdAt: row.created_at,
  }
}

// ── Express app ──────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())
if (isProd) app.use(express.static(path.join(__dirname, 'dist')))

// ── Workspace ─────────────────────────────────────────────────────────────────

function getWorkspace(userId) { return path.join(WORKSPACES, userId) }

function ensureWorkspace(userId) {
  const ws = getWorkspace(userId)
  for (const dir of ['data', 'config', 'reports', 'modes', path.join('batch', 'tracker-additions')]) {
    fs.mkdirSync(path.join(ws, dir), { recursive: true })
  }

  const tracker = path.join(ws, 'data', 'applications.md')
  if (!fs.existsSync(tracker)) {
    fs.writeFileSync(tracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n', 'utf8')
  }

  const profile = path.join(ws, 'config', 'profile.yml')
  if (!fs.existsSync(profile)) {
    const ex = path.join(ROOT, 'config', 'profile.example.yml')
    if (fs.existsSync(ex)) fs.copyFileSync(ex, profile)
  }

  const profileMd = path.join(ws, 'modes', '_profile.md')
  if (!fs.existsSync(profileMd)) {
    const tmpl = path.join(ROOT, 'modes', '_profile.template.md')
    if (fs.existsSync(tmpl)) fs.copyFileSync(tmpl, profileMd)
  }

  const portals = path.join(ws, 'portals.yml')
  if (!fs.existsSync(portals)) {
    const src = path.join(ROOT, 'portals.yml')
    if (fs.existsSync(src)) fs.copyFileSync(src, portals)
  }
}

async function migrateExistingData(userId) {
  // data files
  for (const f of ['applications.md', 'pipeline.md', 'scan-history.tsv']) {
    const src = path.join(ROOT, 'data', f)
    if (fs.existsSync(src)) {
      const content = fs.readFileSync(src, 'utf8')
      await saveFile(userId, `data/${f}`, content)
    }
  }
  // profile
  const ps = path.join(ROOT, 'config', 'profile.yml')
  if (fs.existsSync(ps)) await setProfileYml(userId, fs.readFileSync(ps, 'utf8'))
  // portals
  const portals = path.join(ROOT, 'portals.yml')
  if (fs.existsSync(portals)) await setPortalsYml(userId, fs.readFileSync(portals, 'utf8'))
  // modes/_profile.md
  const ms = path.join(ROOT, 'modes', '_profile.md')
  if (fs.existsSync(ms)) await saveFile(userId, 'modes/_profile.md', fs.readFileSync(ms, 'utf8'))
  // reports
  const rs = path.join(ROOT, 'reports')
  if (fs.existsSync(rs)) {
    for (const f of fs.readdirSync(rs)) {
      if (f.endsWith('.md')) await saveFile(userId, `reports/${f}`, fs.readFileSync(path.join(rs, f), 'utf8'))
    }
  }
}

// Write all DB files to workspace filesystem (before claude job)
async function syncDbToWorkspace(userId) {
  const ws    = getWorkspace(userId)
  const files = await getAllFiles(userId)
  for (const { path: p, content } of files) {
    const full = path.join(ws, p)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf8')
  }
  // also write profile and portals from users columns
  const user = toUser(await findUserById(userId))
  if (user?.profileYml) fs.writeFileSync(path.join(ws, 'config', 'profile.yml'), user.profileYml, 'utf8')
  if (user?.portalsYml) fs.writeFileSync(path.join(ws, 'portals.yml'), user.portalsYml, 'utf8')
}

// Read workspace files back to DB (after claude job)
async function syncWorkspaceToDb(userId) {
  const ws = getWorkspace(userId)
  const TRACKED = ['data/applications.md', 'data/pipeline.md', 'data/scan-history.tsv']
  for (const rel of TRACKED) {
    try { await saveFile(userId, rel, fs.readFileSync(path.join(ws, rel), 'utf8')) } catch {}
  }
  for (const dir of ['reports', path.join('batch', 'tracker-additions')]) {
    const full = path.join(ws, dir)
    if (!fs.existsSync(full)) continue
    for (const f of fs.readdirSync(full)) {
      if (f.endsWith('.md') || f.endsWith('.tsv')) {
        try { await saveFile(userId, `${dir}/${f}`, fs.readFileSync(path.join(full, f), 'utf8')) } catch {}
      }
    }
  }
}

// ── Auth middleware ───────────────────────────────────────────────────────────

async function requireAuth(req, res, next) {
  const header = req.headers.authorization
  const token  = (header?.startsWith('Bearer ') ? header.slice(7) : null) || req.query.token
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user    = toUser(await findUserById(payload.id))
    if (!user) return res.status(401).json({ error: 'User not found' })
    req.user = user
    ensureWorkspace(user.id)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// ── Auth routes ───────────────────────────────────────────────────────────────

app.get('/api/auth/status', async (_req, res) => {
  try {
    res.json({ needsSetup: (await countUsers()) === 0 })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/auth/setup', async (req, res) => {
  try {
    if ((await countUsers()) > 0) return res.status(403).json({ error: 'Setup already complete' })
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'email and password required' })
    if (password.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters' })

    const id           = randomUUID()
    const passwordHash = await bcrypt.hash(password, 12)
    await createUser({ id, email, passwordHash })

    ensureWorkspace(id)
    await migrateExistingData(id)

    const token = jwt.sign({ id, email }, JWT_SECRET, { expiresIn: '30d' })
    res.json({ token, user: { id, email, hasApiKey: false } })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/auth/register', async (req, res) => {
  try {
    if ((await countUsers()) === 0) return res.status(403).json({ error: 'Use /api/auth/setup for first user' })
    const { email, password } = req.body
    if (!email || !password)  return res.status(400).json({ error: 'email and password required' })
    if (password.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters' })
    if (await findUserByEmail(email)) return res.status(409).json({ error: 'Email already registered' })

    const id           = randomUUID()
    const passwordHash = await bcrypt.hash(password, 12)
    await createUser({ id, email, passwordHash })
    ensureWorkspace(id)

    const token = jwt.sign({ id, email }, JWT_SECRET, { expiresIn: '30d' })
    res.json({ token, user: { id, email, hasApiKey: false } })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    const user = toUser(await findUserByEmail(email))
    if (!user) return res.status(401).json({ error: 'Invalid email or password' })

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' })

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' })
    res.json({ token, user: { id: user.id, email: user.email, hasApiKey: Boolean(user.apiKey) } })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  const { id, email, apiKey } = req.user
  res.json({ id, email, hasApiKey: Boolean(apiKey) })
})

// Re-run migration for current user (idempotent — safe to call anytime)
app.post('/api/auth/remigrate', requireAuth, async (req, res) => {
  try {
    await migrateExistingData(req.user.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/auth/apikey', requireAuth, async (req, res) => {
  try {
    const { apiKey } = req.body
    if (typeof apiKey !== 'string') return res.status(400).json({ error: 'apiKey required' })
    await setApiKey(req.user.id, apiKey)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Parsers ───────────────────────────────────────────────────────────────────

function normalizeStatus(raw) {
  const s = (raw || '').replace(/\*\*/g, '').trim().toLowerCase()
  if (s.includes('interview') || s.includes('entrevista')) return 'Interview'
  if (s === 'offer' || (s.includes('oferta') && !s.includes('evaluated'))) return 'Offer'
  if (s.includes('responded') || s.includes('respondido')) return 'Responded'
  if (s.includes('applied') || s.includes('aplicado') || s === 'enviada' || s === 'aplicada' || s === 'sent') return 'Applied'
  if (s.includes('rejected') || s.includes('rechazado') || s === 'rechazada') return 'Rejected'
  if (s.includes('discarded') || s.includes('descartado') || s === 'descartada' || s === 'cerrada') return 'Discarded'
  if (s === 'skip' || s.includes('no aplicar') || s.includes('no_aplicar')) return 'SKIP'
  if (s.includes('evaluated') || s.includes('evaluada') || s === 'hold' || s === 'monitor' || s === 'evaluar') return 'Evaluated'
  return (raw || '').trim()
}

function parseApplicationsContent(content) {
  const apps = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    if (trimmed.startsWith('| #') || trimmed.startsWith('|---') || trimmed.startsWith('| ---')) continue

    const fields = trimmed.slice(1, -1).split('|').map(f => f.trim())
    if (fields.length < 8) continue
    if (fields[0] === '#' || fields[0] === '---') continue

    const scoreMatch  = fields[4]?.match(/(\d+\.?\d*)\/5/)
    const reportMatch = fields[7]?.match(/\[(\d+)\]\(([^)]+)\)/)

    apps.push({
      num: parseInt(fields[0]) || 0,
      date: fields[1] || '',
      company: fields[2] || '',
      role: fields[3] || '',
      score: scoreMatch ? parseFloat(scoreMatch[1]) : 0,
      scoreRaw: fields[4] || '',
      status: normalizeStatus(fields[5]),
      hasPDF: (fields[6] || '').includes('✅'),
      reportNumber: reportMatch?.[1] || null,
      reportPath: reportMatch?.[2] || null,
      notes: fields.slice(8).join('|').trim(),
    })
  }

  return apps
}

function computeMetrics(apps) {
  const byStatus = {}
  let totalScore = 0, scored = 0, withPDF = 0, actionable = 0, topScore = 0

  for (const app of apps) {
    byStatus[app.status] = (byStatus[app.status] || 0) + 1
    if (app.score > 0) { totalScore += app.score; scored++; if (app.score > topScore) topScore = app.score }
    if (app.hasPDF) withPDF++
    if (!['SKIP', 'Rejected', 'Discarded'].includes(app.status)) actionable++
  }

  return {
    total: apps.length, byStatus,
    avgScore: scored > 0 ? parseFloat((totalScore / scored).toFixed(1)) : 0,
    topScore: parseFloat(topScore.toFixed(1)),
    withPDF, actionable,
  }
}

function applyStatusUpdate(content, reportNumber, newStatus) {
  const lines = content.split('\n')
  let found = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`[${reportNumber}](`)) {
      const parts = lines[i].split('|')
      if (parts.length >= 9) { parts[6] = ` ${newStatus} `; lines[i] = parts.join('|'); found = true }
      break
    }
  }
  if (!found) throw new Error(`Application ${reportNumber} not found`)
  return lines.join('\n')
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/applications', requireAuth, async (req, res) => {
  try {
    const content = await getFile(req.user.id, 'data/applications.md')
    res.json(content ? parseApplicationsContent(content) : [])
  } catch { res.json([]) }
})

app.get('/api/metrics', requireAuth, async (req, res) => {
  try {
    const content = await getFile(req.user.id, 'data/applications.md')
    res.json(computeMetrics(content ? parseApplicationsContent(content) : []))
  } catch { res.json(computeMetrics([])) }
})

app.get('/api/report', requireAuth, async (req, res) => {
  const reportPath = req.query.path
  if (!reportPath || !/^reports\/[\w.-]+\.md$/.test(reportPath)) {
    return res.status(403).json({ error: 'Invalid path' })
  }
  try {
    const content = await getFile(req.user.id, reportPath)
    if (content !== null) return res.json({ content })
    res.status(404).json({ error: 'Report not found' })
  } catch (e) {
    res.status(404).json({ error: 'Report not found' })
  }
})

app.patch('/api/applications/:reportNumber/status', requireAuth, async (req, res) => {
  const { reportNumber } = req.params
  const { newStatus }    = req.body
  const VALID = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP']
  if (!VALID.includes(newStatus)) return res.status(400).json({ error: 'Invalid status' })
  try {
    const content = await getFile(req.user.id, 'data/applications.md')
    if (!content) return res.status(404).json({ error: 'Tracker not found' })
    const updated = applyStatusUpdate(content, reportNumber, newStatus)
    await saveFile(req.user.id, 'data/applications.md', updated)
    res.json({ ok: true })
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

function getProfileYml(user) {
  if (user.profileYml) return user.profileYml
  // fallback: read from workspace file (migration path)
  try { return fs.readFileSync(path.join(getWorkspace(user.id), 'config', 'profile.yml'), 'utf8') } catch { return '' }
}

function getPortalsYml(user) {
  if (user.portalsYml) return user.portalsYml
  // fallback: read from workspace file or root portals.yml
  try { return fs.readFileSync(path.join(getWorkspace(user.id), 'portals.yml'), 'utf8') } catch {}
  try { return fs.readFileSync(path.join(ROOT, 'portals.yml'), 'utf8') } catch { return '' }
}

app.get('/api/profile', requireAuth, (req, res) => {
  try {
    const content = getProfileYml(req.user)
    res.json(content ? yaml.load(content) : {})
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/profile/raw', requireAuth, (req, res) => {
  try { res.json({ content: getProfileYml(req.user) }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/profile', requireAuth, async (req, res) => {
  const { content } = req.body
  if (typeof content !== 'string') return res.status(400).json({ error: 'content is required' })
  try {
    yaml.load(content)
    await setProfileYml(req.user.id, content)
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

app.get('/api/portals', requireAuth, (req, res) => {
  try {
    const content = getPortalsYml(req.user)
    res.json(content ? yaml.load(content) : {})
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/portals', requireAuth, async (req, res) => {
  const { content } = req.body
  if (typeof content !== 'string') return res.status(400).json({ error: 'content is required' })
  try {
    yaml.load(content)
    await setPortalsYml(req.user.id, content)
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

const ALLOWED_SCRIPTS = ['merge-tracker', 'verify-pipeline', 'normalize-statuses', 'dedup-tracker']

app.post('/api/run/:script', requireAuth, (req, res) => {
  const { script } = req.params
  if (!ALLOWED_SCRIPTS.includes(script)) return res.status(400).json({ error: 'Unknown script' })
  execFile('node', [`${script}.mjs`], { cwd: ROOT }, (error, stdout, stderr) => {
    if (error) return res.status(500).json({ error: error.message, stderr })
    res.json({ output: stdout, stderr })
  })
})

// ── Claude SSE runner ─────────────────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[mGKHF]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

const activeJobs = new Map() // `${name}:${userId}` -> process

function makeJobEndpoints(name, buildPrompt) {
  const key = (userId) => `${name}:${userId}`

  const statusHandler = (req, res) => {
    res.json({ running: activeJobs.has(key(req.user.id)), available: Boolean(req.user.apiKey) })
  }

  const startHandler = async (req, res) => {
    const jobKey = key(req.user.id)
    if (!req.user.apiKey) {
      return res.status(503).json({ error: 'No API key set. Add it in Settings.' })
    }
    if (activeJobs.has(jobKey)) return res.status(409).json({ error: `${name} already running` })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = (type, text) => res.write(`data: ${JSON.stringify({ type, text })}\n\n`)
    const keepalive = setInterval(() => res.write(': ping\n\n'), 20000)

    send('status', `Starting ${name}…`)

    const ws = getWorkspace(req.user.id)

    // sync all user files from DB to workspace before claude runs
    await syncDbToWorkspace(req.user.id)

    const prompt = buildPrompt(ws)

    const job = spawn('claude', ['-p', '--dangerously-skip-permissions'], {
      cwd: ws,
      env: { ...process.env, ANTHROPIC_API_KEY: req.user.apiKey, NO_COLOR: '1', TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    activeJobs.set(jobKey, job)
    job.stdin.write(prompt)
    job.stdin.end()

    job.stdout.on('data', (chunk) => {
      const text = stripAnsi(chunk.toString())
      if (text.trim()) send('output', text)
    })
    job.stderr.on('data', (chunk) => {
      const text = stripAnsi(chunk.toString())
      if (text.trim()) send('error', text)
    })
    job.on('close', async (code) => {
      clearInterval(keepalive); activeJobs.delete(jobKey)
      // sync workspace files back to DB after claude finishes
      try { await syncWorkspaceToDb(req.user.id) } catch {}
      send('done', String(code ?? 0)); res.end()
    })
    job.on('error', (err) => {
      clearInterval(keepalive); activeJobs.delete(jobKey)
      send('error', `Failed to start: ${err.message}`); send('done', '1'); res.end()
    })
    req.on('close', () => {
      clearInterval(keepalive)
      const j = activeJobs.get(jobKey)
      if (j) { j.kill(); activeJobs.delete(jobKey) }
    })
  }

  const stopHandler = (req, res) => {
    const jobKey = key(req.user.id)
    const job    = activeJobs.get(jobKey)
    if (!job) return res.status(404).json({ error: `No ${name} running` })
    job.kill(); activeJobs.delete(jobKey)
    res.json({ ok: true })
  }

  return { statusHandler, startHandler, stopHandler }
}

// ── Scan ──────────────────────────────────────────────────────────────────────

function buildScanPrompt(ws) {
  const read  = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8') } catch { return '' } }
  const readW = (rel) => { try { return fs.readFileSync(path.join(ws, rel), 'utf8') }   catch { return '' } }
  const today = new Date().toISOString().split('T')[0]
  return [
    `Today's date: ${today}`,
    `Working directory: ${ws}`,
    '', '## Instructions',
    'You are running career-ops scan in pipe mode (no Playwright available).',
    'Read the files below, then execute the full scan workflow.',
    'Use WebSearch and WebFetch for discovery. Skip Playwright-only steps gracefully.',
    '', '---', read('modes/_shared.md'),
    '---', readW('modes/_profile.md'),
    '---', read('modes/scan.md'),
  ].join('\n')
}

const scan = makeJobEndpoints('scan', buildScanPrompt)
app.get('/api/scan/status', requireAuth, scan.statusHandler)
app.get('/api/scan',        requireAuth, scan.startHandler)
app.delete('/api/scan',     requireAuth, scan.stopHandler)

// ── Pipeline ──────────────────────────────────────────────────────────────────

function buildPipelinePrompt(ws) {
  const read  = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8') } catch { return '' } }
  const readW = (rel) => { try { return fs.readFileSync(path.join(ws, rel), 'utf8') }   catch { return '' } }
  const today = new Date().toISOString().split('T')[0]
  return [
    `Today's date: ${today}`,
    `Working directory: ${ws}`,
    '', '## Instructions',
    'You are running career-ops pipeline in pipe mode (no Playwright available).',
    'Read the files below, then execute the full pipeline workflow.',
    'Use WebSearch and WebFetch for discovery. Skip Playwright-only steps gracefully.',
    'Write TSV files to batch/tracker-additions/ for each evaluated offer.',
    'After all offers are processed, run: node merge-tracker.mjs',
    '', '---', read('modes/_shared.md'),
    '---', readW('modes/_profile.md'),
    '---', read('modes/pipeline.md'),
  ].join('\n')
}

const pipeline = makeJobEndpoints('pipeline', buildPipelinePrompt)
app.get('/api/pipeline/status', requireAuth, pipeline.statusHandler)
app.get('/api/pipeline',        requireAuth, pipeline.startHandler)
app.delete('/api/pipeline',     requireAuth, pipeline.stopHandler)

// ── SPA fallback ──────────────────────────────────────────────────────────────

if (isProd) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
  })
}

await initDb()
app.listen(PORT, () => {
  console.log(`career-ops web → http://localhost:${PORT}`)
})
