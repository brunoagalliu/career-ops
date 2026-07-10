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
import treeKill from 'tree-kill'
import { chromium } from 'playwright'

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
    if (fs.existsSync(src)) await saveFile(userId, `data/${f}`, fs.readFileSync(src, 'utf8'))
  }
  // profile + portals
  const ps = path.join(ROOT, 'config', 'profile.yml')
  if (fs.existsSync(ps)) await setProfileYml(userId, fs.readFileSync(ps, 'utf8'))
  const portals = path.join(ROOT, 'portals.yml')
  if (fs.existsSync(portals)) await setPortalsYml(userId, fs.readFileSync(portals, 'utf8'))
  // modes/_profile.md
  const ms = path.join(ROOT, 'modes', '_profile.md')
  if (fs.existsSync(ms)) await saveFile(userId, 'modes/_profile.md', fs.readFileSync(ms, 'utf8'))
  // cv + article-digest
  for (const f of ['cv.md', 'article-digest.md']) {
    const src = path.join(ROOT, f)
    if (fs.existsSync(src)) await saveFile(userId, f, fs.readFileSync(src, 'utf8'))
  }
  // reports
  const rs = path.join(ROOT, 'reports')
  if (fs.existsSync(rs)) {
    for (const f of fs.readdirSync(rs)) {
      if (f.endsWith('.md')) await saveFile(userId, `reports/${f}`, fs.readFileSync(path.join(rs, f), 'utf8'))
    }
  }
  // interview-prep
  const ip = path.join(ROOT, 'interview-prep')
  if (fs.existsSync(ip)) {
    for (const f of fs.readdirSync(ip)) {
      if (f.endsWith('.md')) await saveFile(userId, `interview-prep/${f}`, fs.readFileSync(path.join(ip, f), 'utf8'))
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
  const TRACKED = [
    'data/applications.md', 'data/pipeline.md', 'data/scan-history.tsv',
    'cv.md', 'article-digest.md',
  ]
  for (const rel of TRACKED) {
    try { await saveFile(userId, rel, fs.readFileSync(path.join(ws, rel), 'utf8')) } catch {}
  }
  for (const dir of ['reports', path.join('batch', 'tracker-additions'), 'interview-prep']) {
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

app.get('/api/debug/claude-test', async (req, res) => {
  const r = await pool.query('SELECT * FROM users LIMIT 1')
  const user = toUser(r.rows[0])
  if (!user?.apiKey) return res.json({ error: 'no user or api key found' })
  ensureWorkspace(user.id)
  const ws = getWorkspace(user.id)
  const env = { ...process.env, ANTHROPIC_API_KEY: user.apiKey, NO_COLOR: '1', TERM: 'dumb', HOME: '/app' }
  const prompt = 'Say the word hello and nothing else.'

  // Test 1: execFile plain text
  execFile('claude', ['-p', prompt, '--model', 'claude-haiku-4-5-20251001'],
    { env, cwd: ws, timeout: 60000 },
    (err1, stdout1, stderr1) => {
      // Test 2: execFile stream-json
      execFile('claude', ['-p', prompt, '--model', 'claude-haiku-4-5-20251001', '--output-format', 'stream-json', '--verbose'],
        { env, cwd: ws, timeout: 60000 },
        (err2, stdout2, stderr2) => {
          res.json({
            apiKeyPrefix: user.apiKey?.slice(0, 8),
            plainText:   { exitCode: err1?.code ?? 0, stdoutBytes: stdout1?.length ?? 0, stdout: stdout1?.slice(0, 500), stderr: stderr1?.slice(0, 500), err: err1?.message },
            streamJson:  { exitCode: err2?.code ?? 0, stdoutBytes: stdout2?.length ?? 0, stdout: stdout2?.slice(0, 500), stderr: stderr2?.slice(0, 500), err: err2?.message },
          })
        }
      )
    }
  )
})

app.get('/api/debug/claude', (_req, res) => {
  execFile('which', ['claude'], (err, stdout) => {
    const whichResult = err ? `not found: ${err.message}` : stdout.trim()
    execFile('claude', ['--version'], (err2, stdout2, stderr2) => {
      res.json({
        which: whichResult,
        version: stdout2?.trim() || stderr2?.trim() || err2?.message || 'no output',
        path: process.env.PATH,
      })
    })
  })
})

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

app.post('/api/apply/:reportNum', requireAuth, async (req, res) => {
  const { reportNum } = req.params
  if (!/^\d+$/.test(reportNum)) return res.status(400).json({ error: 'Invalid report number' })

  try {
    const ws = getWorkspace(req.user.id)
    await syncDbToWorkspace(req.user.id)

    // Find the report file
    const reportsDir = path.join(ws, 'reports')
    const reportFile = fs.existsSync(reportsDir)
      ? fs.readdirSync(reportsDir).find(f => f.startsWith(reportNum.padStart(3, '0') + '-') && f.endsWith('.md'))
      : null
    const reportContent = reportFile
      ? fs.readFileSync(path.join(reportsDir, reportFile), 'utf8')
      : ''

    const cvContent      = fs.existsSync(path.join(ws, 'cv.md')) ? fs.readFileSync(path.join(ws, 'cv.md'), 'utf8') : ''
    const profileContent = getProfileYml(req.user)

    const prompt = `You are writing a cover letter for a job application.

## Job Report
${reportContent || 'No report available.'}

## Candidate CV (summary)
${cvContent.slice(0, 3000)}

## Candidate Profile
${profileContent.slice(0, 1500)}

## Task
Write a professional cover letter for this specific role. Use the job report to tailor it.
- 3 paragraphs: (1) hook + role match, (2) 2-3 specific proof points from the CV relevant to this role, (3) closing with enthusiasm and call to action
- Tone: confident, direct, no fluff
- No "Dear Hiring Manager" — start directly with the hook
- Do NOT include a subject line or date
- Length: ~250 words
- Output ONLY the cover letter text, nothing else`

    execFile('claude', ['-p', prompt, '--model', 'claude-haiku-4-5-20251001'],
      { env: { ...process.env, ANTHROPIC_API_KEY: req.user.apiKey, HOME: '/app', NO_COLOR: '1' }, timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) return res.status(500).json({ error: err.message || 'Generation failed' })
        const coverLetter = stdout.trim()
        res.json({ coverLetter })
      }
    )
  } catch (e) {
    res.status(500).json({ error: e.message })
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

app.get('/api/cv', requireAuth, async (req, res) => {
  try {
    const content = await getFile(req.user.id, 'cv.md')
    res.json({ content: content ?? '' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/cv', requireAuth, async (req, res) => {
  const { content } = req.body
  if (typeof content !== 'string') return res.status(400).json({ error: 'content is required' })
  try {
    await saveFile(req.user.id, 'cv.md', content)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
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

// activeJobs: jobKey → { job, buffer, done, exitCode, subscribers }
const activeJobs = new Map()

// ── Progress helpers ──────────────────────────────────────────────────────────

function pipelineProgressSnapshot(ws) {
  try {
    const pipelineMd = path.join(ws, 'data', 'pipeline.md')
    if (!fs.existsSync(pipelineMd)) return null
    const lines = fs.readFileSync(pipelineMd, 'utf8').split('\n')
    const pending   = lines.filter(l => /^\s*- \[ \]/.test(l)).length
    const processed = lines.filter(l => /^\s*- \[(?:x|!|X)\]/.test(l)).length
    // `total` is what's actually queued for this run, not all-time processed
    // history — otherwise the progress bar never shrinks even after the
    // queue is cleared, since old processed entries keep inflating it.
    return { done: processed, total: pending }
  } catch { return null }
}

function scanProgressSnapshot(ws) {
  try {
    const portalsFile = path.join(ws, 'portals.yml')
    const portals = fs.existsSync(portalsFile) ? yaml.load(fs.readFileSync(portalsFile, 'utf8')) : {}
    const total = [
      ...(portals.search_queries    || []).filter(q => q.enabled !== false),
      ...(portals.tracked_companies || []).filter(c => c.enabled !== false),
    ].length
    const histFile = path.join(ws, 'data', 'scan-history.tsv')
    const lines = fs.existsSync(histFile)
      ? fs.readFileSync(histFile, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('url\t'))
      : []
    return { done: lines.length, total }
  } catch { return null }
}

function makeJobEndpoints(name, buildPrompt, model = 'claude-sonnet-4-5', snapshotFn = null, afterClose = null) {
  const key = (userId) => `${name}:${userId}`

  const statusHandler = (req, res) => {
    const state = activeJobs.get(key(req.user.id))
    res.json({
      running:   Boolean(state && !state.done),
      available: Boolean(req.user.apiKey),
      hasResult: Boolean(state?.done),
    })
  }

  const startHandler = async (req, res) => {
    const jobKey = key(req.user.id)

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send     = (type, text) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type, text })}\n\n`) }
    const ping     = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n') }, 20000)
    const detach   = () => { clearInterval(ping) }

    // ── Reconnect to existing job (only if still running) ────────────────────
    const existing = activeJobs.get(jobKey)
    if (existing && !existing.done) {
      // Job in progress — replay buffer and subscribe for new output
      for (const msg of existing.buffer) send(msg.type, msg.text)
      existing.subscribers.add(send)
      req.on('close', () => { existing.subscribers.delete(send); detach() })
      return
    }
    // If job exists but is done, fall through to start a new one
    if (existing?.done) activeJobs.delete(jobKey)

    // ── Start new job ─────────────────────────────────────────────────────────
    if (!req.user.apiKey) {
      send('error', 'No API key set. Add it in Settings.')
      send('done', '1'); detach(); res.end(); return
    }

    const state = { job: null, buffer: [], done: false, exitCode: null, subscribers: new Set([send]) }
    activeJobs.set(jobKey, state)

    // broadcast to all current subscribers and buffer
    const broadcast = (type, text) => {
      state.buffer.push({ type, text })
      for (const sub of state.subscribers) sub(type, text)
    }

    // connection close: unsubscribe but keep job running
    req.on('close', () => { state.subscribers.delete(send); detach() })

    broadcast('status', `Starting ${name}…`)

    try {
      const ws = getWorkspace(req.user.id)
      await syncDbToWorkspace(req.user.id)
      const prompt = buildPrompt(ws, req)

      broadcast('status', `Workspace: ${ws}`)

      const job = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions', '--model', model, '--output-format', 'stream-json', '--verbose'], {
        cwd: ws,
        env: { ...process.env, ANTHROPIC_API_KEY: req.user.apiKey, NO_COLOR: '1', TERM: 'dumb', HOME: '/app' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      state.job = job
      broadcast('status', `claude pid ${job.pid ?? 'unknown'}`)

      // stream-json + --verbose: NDJSON events on stdout
      let lineBuf = ''

      function processJsonLine(raw) {
        if (!raw.trim()) return
        try {
          const ev = JSON.parse(raw)
          if (ev.type === 'assistant') {
            for (const block of (ev.message?.content || [])) {
              if (block.type === 'text' && block.text?.trim()) broadcast('output', block.text)
            }
          } else if (ev.type === 'result') {
            if (ev.result?.trim()) broadcast('output', ev.result)
            const cost = ev.total_cost_usd ?? ev.cost_usd
            if (cost != null) broadcast('status', `Cost: $${Number(cost).toFixed(4)}`)
          }
        } catch {
          if (raw.trim()) broadcast('output', raw)
        }
      }

      job.stdout.on('data', chunk => {
        lineBuf += stripAnsi(chunk.toString())
        const parts = lineBuf.split('\n')
        lineBuf = parts.pop() || ''
        for (const line of parts) processJsonLine(line)
      })
      job.stdout.on('end', () => { if (lineBuf.trim()) { processJsonLine(lineBuf); lineBuf = '' } })
      job.stderr.on('data', chunk => {
        const t = stripAnsi(chunk.toString())
        // suppress the stdin warning — it's harmless with -p argument mode
        if (t.trim() && !t.includes('no stdin data received')) broadcast('error', t)
      })

      // progress polling
      let progressTimer = null
      if (snapshotFn) {
        const baseline = snapshotFn(ws)
        if (baseline) {
          broadcast('progress', JSON.stringify({ current: 0, total: baseline.total }))
          progressTimer = setInterval(() => {
            const snap = snapshotFn(ws)
            if (!snap) return
            const current = Math.max(0, snap.done - baseline.done)
            broadcast('progress', JSON.stringify({ current, total: baseline.total }))
          }, 2000)
        }
      }

      job.on('close', async (code) => {
        if (progressTimer) clearInterval(progressTimer)
        broadcast('status', `claude exited with code ${code}`)
        if (afterClose) {
          try { await afterClose(ws, broadcast) } catch (e) { broadcast('error', `post-job: ${e.message}`) }
        }
        try { await syncWorkspaceToDb(req.user.id) } catch {}
        state.done = true; state.exitCode = code ?? 0
        broadcast('done', String(state.exitCode))
        setTimeout(() => { if (activeJobs.get(jobKey) === state) activeJobs.delete(jobKey) }, 10 * 60 * 1000)
      })
      job.on('error', (err) => {
        if (progressTimer) clearInterval(progressTimer)
        state.done = true; state.exitCode = 1
        broadcast('error', `Failed to start claude: ${err.message}`)
        broadcast('done', '1')
        setTimeout(() => { if (activeJobs.get(jobKey) === state) activeJobs.delete(jobKey) }, 10 * 60 * 1000)
      })
    } catch (err) {
      state.done = true; state.exitCode = 1
      broadcast('error', err.message); broadcast('done', '1')
      activeJobs.delete(jobKey)
    }
  }

  const stopHandler = (req, res) => {
    const state = activeJobs.get(key(req.user.id))
    if (!state || state.done) return res.status(404).json({ error: `No ${name} running` })
    if (state.job?.pid) {
      treeKill(state.job.pid, 'SIGTERM')
    } else {
      state.job?.kill()
    }
    res.json({ ok: true })
  }

  return { statusHandler, startHandler, stopHandler }
}

// ── Candidate profile (per-user, read from workspace after DB sync) ──────────

function loadProfile(ws) {
  try { return yaml.load(fs.readFileSync(path.join(ws, 'config', 'profile.yml'), 'utf8')) || {} }
  catch { return {} }
}

function loadPortals(ws) {
  try { return yaml.load(fs.readFileSync(path.join(ws, 'portals.yml'), 'utf8')) || {} }
  catch { return {} }
}

function loadProfileNotes(ws) {
  try {
    const raw = fs.readFileSync(path.join(ws, 'modes', '_profile.md'), 'utf8')
    // skip if it's still the untouched template
    if (/\{\{|<!--\s*template/i.test(raw)) return ''
    return raw.slice(0, 1500)
  } catch { return '' }
}

function candidateSummary(profile) {
  const c    = profile.candidate     || {}
  const loc  = profile.location      || {}
  const comp = profile.compensation  || {}
  const nar  = profile.narrative     || {}
  const roles = profile.target_roles || {}
  const archetypes = roles.archetypes || []

  const primary   = roles.primary?.length ? roles.primary : archetypes.filter(a => a.fit === 'primary').map(a => a.name)
  const secondary = archetypes.filter(a => a.fit === 'secondary').map(a => a.name)

  return {
    name: c.full_name || 'Candidate',
    location: [loc.city, loc.country].filter(Boolean).join(', ') || c.location || 'unspecified location',
    primary, secondary,
    superpowers: nar.superpowers || [],
    compRange: comp.target_range || '',
    compMin: comp.minimum || '',
    currency: comp.currency || '',
    remotePolicy: comp.location_flexibility || loc.onsite_availability || 'Remote preferred',
    visaStatus: loc.visa_status || '',
  }
}

// ── Scan ──────────────────────────────────────────────────────────────────────

function buildScanPrompt(ws, freshness = 'week') {
  const today = new Date().toISOString().split('T')[0]
  const cutoff = { day: 1, week: 7, month: 30, any: 0 }[freshness] || 7
  const afterDate = cutoff > 0
    ? new Date(Date.now() - cutoff * 86400000).toISOString().split('T')[0]
    : null
  const dateFilter = afterDate ? ` after:${afterDate}` : ''
  const freshnessNote = afterDate
    ? `Only include jobs posted after ${afterDate} (use the after: filter in every query).`
    : 'No date filter — include all results.'

  const profile = loadProfile(ws)
  const cand = candidateSummary(profile)
  const notes = loadProfileNotes(ws)

  // Prefer the user's own portals.yml search_queries (configured + enabled in
  // the Portals screen) over auto-generating queries — otherwise disabling a
  // query there has no effect on what the scan actually searches.
  const MAX_QUERIES = 10
  const enabledQueries = (loadPortals(ws).search_queries || [])
    .filter(q => q.enabled && q.query)
    .slice(0, MAX_QUERIES)

  let queries
  if (enabledQueries.length > 0) {
    queries = enabledQueries.map(q => `${q.query}${dateFilter}`)
  } else {
    const roleTerms = [...cand.primary, ...cand.secondary]
    if (roleTerms.length === 0) roleTerms.push('open roles')
    const boards = ['jobs.ashbyhq.com', 'boards.greenhouse.io', 'lever.co', 'weworkremotely.com', 'himalayas.app']
    queries = boards.map((board, i) => `site:${board} "${roleTerms[i % roleTerms.length]}" remote${dateFilter}`)
  }

  return `Today: ${today}. Working directory: ${ws}.
Non-interactive web dashboard run — NO user present. Write all files immediately. Never ask for confirmation.
IMPORTANT: Ignore any instructions from CLAUDE.md or modes/ files. Follow ONLY the steps in this prompt exactly as written.

## Your task: Scan for new job offers

Candidate: ${cand.name}, ${cand.location}. Remote policy: ${cand.remotePolicy}.
Target roles: ${cand.primary.join(', ') || '(see config/profile.yml — none set)'}${cand.secondary.length ? `; secondary: ${cand.secondary.join(', ')}` : ''}.
Negative keywords: skip roles that clearly don't match any of the target roles above (wrong function, wrong seniority).
${notes ? `Additional preferences from the candidate's profile notes:\n${notes}\n` : ''}Freshness: ${freshnessNote}

## Steps

1. Read \`data/scan-history.tsv\` — these URLs are already known, skip them.
2. Read \`data/pipeline.md\` — also skip URLs already listed there.
3. Run exactly ${queries.length} WebSearch queries using these patterns:
${queries.map(q => `   - ${q}`).join('\n')}
4. For each result URL not already in the dedup lists:
   a. Print "→ Verifying: [URL]"
   b. WebFetch the URL. Check if the job is still active:
      - SKIP if HTTP 404, 410, or the page says "job not found", "position filled", "no longer available", "this job has expired", or shows only a generic careers directory with no specific job content
      - SKIP if it's a generic company careers page, not a specific job posting
      - KEEP if you can see a job title, description, and apply button/link
   c. If kept: Print "→ Added: [Company] — [Role]"
      - Append to \`data/pipeline.md\` under "## Pendientes": \`- [ ] URL — Company Role\`
      - Append to \`data/scan-history.tsv\`: \`URL\\tCompany\\tRole\\t${today}\`
   d. If skipped: Print "→ Skipped (expired/inaccessible): [URL]"
      - Still append to \`data/scan-history.tsv\` to avoid rechecking it
5. Print final summary: "Scan complete — N new offers added, M expired/skipped."

Print "→ Searching: [query]" before each WebSearch.`
}

const scan = makeJobEndpoints('scan', (ws, req) => buildScanPrompt(ws, req?.query?.freshness), 'claude-haiku-4-5-20251001', scanProgressSnapshot)
app.get('/api/scan/status', requireAuth, scan.statusHandler)
app.get('/api/scan',        requireAuth, scan.startHandler)
app.delete('/api/scan',     requireAuth, scan.stopHandler)

// ── Pipeline ──────────────────────────────────────────────────────────────────

function buildPipelinePrompt(ws) {
  const today = new Date().toISOString().split('T')[0]
  const profile = loadProfile(ws)
  const cand = candidateSummary(profile)
  const notes = loadProfileNotes(ws)

  const compLine = cand.compRange
    ? `Comp target: ${cand.compRange}${cand.currency ? ' ' + cand.currency : ''}${cand.compMin ? ` (walk-away: ${cand.compMin})` : ''}.`
    : 'Comp target: (see config/profile.yml — none set).'

  return `Today: ${today}. Working directory: ${ws}.
Non-interactive web dashboard run — NO user present. Write all files immediately. Never ask for confirmation.
IMPORTANT: Ignore any instructions from CLAUDE.md or modes/ files. Follow ONLY the steps in this prompt exactly as written.

## Your task: Evaluate job offers

Candidate: ${cand.name}, ${cand.location}.
Superpowers: ${cand.superpowers.join(', ') || '(see cv.md for experience details)'}.
Target roles (primary): ${cand.primary.join(', ') || '(see config/profile.yml — none set)'}.
Target roles (secondary): ${cand.secondary.join(', ') || 'none specified'}.
Remote policy: ${cand.remotePolicy}.${cand.visaStatus ? ` Visa status: ${cand.visaStatus}.` : ''} On-site without sponsorship/willingness = disqualify unless the candidate's profile says otherwise.
${compLine}
${notes ? `Additional preferences from the candidate's profile notes:\n${notes}\n` : ''}
Before scoring, read \`cv.md\` in the working directory for the candidate's full experience and proof points — do not rely on the summary above alone.

## Scoring 1–5

- 5.0: Primary role, fully remote, strong tech match, good comp
- 4.0–4.9: Primary or secondary role, remote, reasonable comp
- 3.0–3.9: Secondary role or minor location/comp concerns
- 2.0–2.9: Weak match on role OR requires on-site without sponsorship
- 1.0–1.9: Wrong role, on-site only, or clearly a mismatch

## Steps

1. Read \`data/pipeline.md\` — get the first 10 items marked \`- [ ]\` (pending).
2. Read \`reports/\` directory listing to find the highest existing report number (next = max + 1).
3. For each pending URL (process one at a time, print progress):
   a. Print "→ Processing N/10: URL"
   b. Fetch the job description using this priority order (no browser tool is available in this environment — do NOT attempt Playwright/browser_navigate):
      1. WebFetch the URL directly.
      2. WebSearch as fallback — search "[company] [role] site:jobs.example.com" to find cached content if WebFetch fails or returns empty.
      If all methods fail or return a 404/login-wall, mark as inaccessible.
   c. Score it 1–5 against the candidate profile above. Write a concise evaluation.
   d. Write report to \`reports/{NNN}-{company-slug}-${today}.md\`:
      \`\`\`
      # {Role} — {Company}
      **Score:** {X.X}/5
      **URL:** {url}
      **Verification:** unconfirmed (batch mode)
      **PDF:** ❌
      **Date:** ${today}

      ## Fit Summary
      {2-3 sentences: role match, remote policy, comp estimate, key signals}

      ## Recommendation
      {Apply / Skip / Watch} — {one sentence reason}
      \`\`\`
   e. Write TSV to \`batch/tracker-additions/{NNN}-{company-slug}.tsv\` (single line, tab-separated):
      {NNN}\\t${today}\\t{Company}\\t{Role}\\tEvaluated\\t{X.X}/5\\t❌\\t[{NNN}](reports/{NNN}-{slug}-${today}.md)\\t{one-line note}
   f. In \`data/pipeline.md\`, change \`- [ ] URL\` to \`- [x] #{NNN} | URL | Company | Role | {X.X}/5 | PDF ❌\`
4. Print summary table: | # | Company | Role | Score | Recommendation |

Print "→ Processing N/10: Company — Role (X.X/5)" after scoring each offer.`
}

async function runMergeTracker(ws, broadcast) {
  broadcast('status', 'Merging tracker additions…')
  await new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      CAREER_OPS_TRACKER: path.join(ws, 'data', 'applications.md'),
      CAREER_OPS_ADDITIONS: path.join(ws, 'batch', 'tracker-additions'),
    }
    execFile('node', [path.join(ROOT, 'merge-tracker.mjs')], { cwd: ws, env, timeout: 30000 }, (err, stdout, stderr) => {
      if (stdout?.trim()) broadcast('status', stdout.trim().split('\n').pop())
      if (err) { broadcast('error', `merge-tracker: ${err.message}`); reject(err) } else resolve()
    })
  })
}

const pipeline = makeJobEndpoints('pipeline', buildPipelinePrompt, 'claude-haiku-4-5-20251001', pipelineProgressSnapshot, runMergeTracker)
app.get('/api/pipeline/status', requireAuth, pipeline.statusHandler)
app.get('/api/pipeline',        requireAuth, pipeline.startHandler)
app.delete('/api/pipeline',     requireAuth, pipeline.stopHandler)

app.delete('/api/pipeline/queue', requireAuth, async (req, res) => {
  try {
    const ws  = getWorkspace(req.user.id)
    await syncDbToWorkspace(req.user.id)
    const file = path.join(ws, 'data', 'pipeline.md')
    if (!fs.existsSync(file)) return res.json({ cleared: 0 })
    const lines   = fs.readFileSync(file, 'utf8').split('\n')
    const pending = lines.filter(l => /^\s*- \[ \]/.test(l)).length
    const kept    = lines.filter(l => !/^\s*- \[ \]/.test(l)).join('\n')
    fs.writeFileSync(file, kept, 'utf8')
    await saveFile(req.user.id, 'data/pipeline.md', kept)
    res.json({ cleared: pending })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── CV PDF generation (no tokens) ─────────────────────────────────────────────

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inlineMd(text) {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, (_, t) => `<strong>${t}</strong>`)
}

function parseCvMd(md) {
  const lines   = md.split('\n')

  // Name: first # heading
  const nameIdx = lines.findIndex(l => l.startsWith('# '))
  const name    = nameIdx >= 0 ? lines[nameIdx].slice(2).trim() : ''

  // Contact line: contains @ and |
  const contactLine = lines.find(l => l.includes('@') && l.includes('|')) || ''
  const cParts      = contactLine.split('|').map(p => p.trim()).filter(Boolean)
  const email       = cParts.find(p => p.includes('@')) || ''
  const linkedinRaw = cParts.find(p => p.toLowerCase().includes('linkedin')) || ''
  const linkedinUrl = linkedinRaw ? (linkedinRaw.startsWith('http') ? linkedinRaw : `https://${linkedinRaw}`) : ''
  const portfolioRaw = cParts.find(p =>
    !p.includes('@') && !p.toLowerCase().includes('linkedin') &&
    !p.startsWith('+') &&
    (p.includes('.io') || p.includes('.dev') || (p.includes('.com') && !p.includes(',')))
  ) || ''
  const portfolioUrl = portfolioRaw ? (portfolioRaw.startsWith('http') ? portfolioRaw : `https://${portfolioRaw}`) : ''
  const location = cParts.find(p =>
    !p.includes('@') && !p.toLowerCase().includes('linkedin') &&
    !p.startsWith('+') && !p.includes('.io') && !p.includes('.dev') &&
    !(p.includes('.com') && !p.includes(','))
  ) || ''

  // Split into ## sections
  const secs = {}
  let cur = '', secLines = []
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (cur) secs[cur.toLowerCase()] = secLines.join('\n').trim()
      cur      = line.slice(3).trim()
      secLines = []
    } else {
      secLines.push(line)
    }
  }
  if (cur) secs[cur.toLowerCase()] = secLines.join('\n').trim()

  return { name, email, linkedinUrl, linkedinDisplay: linkedinRaw.replace(/^https?:\/\//, ''),
           portfolioUrl, portfolioDisplay: portfolioRaw.replace(/^https?:\/\//, ''), location, secs }
}

function buildContactRow({ email, linkedinUrl, linkedinDisplay, portfolioUrl, portfolioDisplay, location }) {
  const items = []
  if (email)            items.push(`<span>${escHtml(email)}</span>`)
  if (linkedinDisplay)  items.push(`<a href="${escHtml(linkedinUrl)}">${escHtml(linkedinDisplay)}</a>`)
  if (portfolioDisplay) items.push(`<a href="${escHtml(portfolioUrl)}">${escHtml(portfolioDisplay)}</a>`)
  if (location)         items.push(`<span>${escHtml(location)}</span>`)
  return items.join('<span class="separator">|</span>')
}

function buildExperienceHtml(content) {
  return content.split(/(?=^### )/m).filter(s => s.trim()).map(block => {
    const bLines   = block.split('\n')
    const header   = (bLines.find(l => l.startsWith('### ')) || '').slice(4).trim()
    const parts    = header.split(/\s*[—–-]\s*/)
    const jobTitle = parts[0]?.trim() || ''
    const company  = parts.slice(1).join(' – ').trim() || ''
    const dateLine = bLines.find(l => {
      const t = l.trim(); return t.startsWith('**') && t.endsWith('**') && /\d{4}|Present/.test(t)
    })
    const date    = (dateLine || '').replace(/\*\*/g, '').trim()
    const bullets = bLines.filter(l => l.trim().startsWith('- '))
      .map(l => `<li>${inlineMd(l.slice(l.indexOf('- ') + 2))}</li>`).join('')
    return `<div class="job avoid-break">
  <div class="job-header">
    <span class="job-company">${escHtml(company)}</span>
    <span class="job-period">${escHtml(date)}</span>
  </div>
  <div class="job-role">${escHtml(jobTitle)}</div>
  ${bullets ? `<ul>${bullets}</ul>` : ''}
</div>`
  }).join('\n')
}

function buildEducationHtml(content) {
  return content.split('\n').filter(l => l.trim().startsWith('**') && l.includes('—')).map(l => {
    const clean   = l.replace(/\*\*/g, '')
    const [lhs, dateStr] = clean.split(/\s*\|\s*/)
    const [degree, ...orgParts] = lhs.split(/\s*—\s*/)
    const org = orgParts.join(' — ').trim()
    return `<div class="edu-item">
  <div class="edu-header">
    <div><span class="edu-title">${escHtml(degree.trim())}</span>${org ? ` <span class="edu-org">· ${escHtml(org)}</span>` : ''}</div>
    ${dateStr ? `<span class="edu-year">${escHtml(dateStr.trim())}</span>` : ''}
  </div>
</div>`
  }).join('\n')
}

function buildSkillsHtml(content) {
  return content.split('\n').filter(l => l.trim().startsWith('**') && l.includes(':')).map(l => {
    const clean  = l.replace(/\*\*/g, '')
    const colon  = clean.indexOf(':')
    const cat    = clean.slice(0, colon).trim()
    const items  = clean.slice(colon + 1).trim()
    return `<div class="skill-item"><span class="skill-category">${escHtml(cat)}:</span> ${escHtml(items)}</div>`
  }).join('\n')
}

function buildCompetenciesHtml(skillsContent) {
  return skillsContent.split('\n').filter(l => l.trim().startsWith('**') && l.includes(':'))
    .map(l => l.replace(/\*\*([^*]+)\*\*:.*/s, '$1').trim()).filter(Boolean)
    .map(c => `<span class="competency-tag">${escHtml(c)}</span>`).join('\n')
}

function buildCvHtml(parsed) {
  const fontsDir = path.join(ROOT, 'fonts')
  let css = (fs.readFileSync(path.join(ROOT, 'templates', 'cv-template.html'), 'utf8')
    .match(/<style>([\s\S]*?)<\/style>/)?.[1] || '')
    .replace('{{PAGE_WIDTH}}', '780px')
    .replace(/url\(['"]?\.\/fonts\//g, `url('file://${fontsDir}/`)

  const { name, secs } = parsed
  const summaryText     = secs['summary'] || ''
  const experienceHtml  = secs['work experience'] ? buildExperienceHtml(secs['work experience']) : ''
  const educationHtml   = secs['education']       ? buildEducationHtml(secs['education'])        : ''
  const skillsContent   = secs['skills'] || ''
  const skillsHtml      = buildSkillsHtml(skillsContent)
  const competHtml      = buildCompetenciesHtml(skillsContent)

  const section = (title, content, extra = '') =>
    content ? `<div class="section${extra} avoid-break">
  <div class="section-title">${escHtml(title)}</div>
  ${content}
</div>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${escHtml(name)} — CV</title>
<style>${css}</style>
</head>
<body>
<div class="page">
  <div class="header avoid-break">
    <h1>${escHtml(name)}</h1>
    <div class="header-gradient"></div>
    <div class="contact-row">${buildContactRow(parsed)}</div>
  </div>
  ${section('Professional Summary', summaryText ? `<div class="summary-text">${escHtml(summaryText)}</div>` : '')}
  ${competHtml ? `<div class="section"><div class="section-title">Core Competencies</div><div class="competencies-grid">${competHtml}</div></div>` : ''}
  ${experienceHtml ? `<div class="section"><div class="section-title">Work Experience</div>${experienceHtml}</div>` : ''}
  ${section('Education', educationHtml)}
  ${skillsHtml ? `<div class="section avoid-break"><div class="section-title">Skills</div><div class="skills-grid">${skillsHtml}</div></div>` : ''}
</div>
</body>
</html>`
}

async function htmlToPdf(html) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    return await page.pdf({
      format: 'a4', printBackground: true,
      margin: { top: '0.6in', right: '0.6in', bottom: '0.6in', left: '0.6in' },
    })
  } finally {
    await browser.close()
  }
}

app.get('/api/cv/pdf', requireAuth, async (req, res) => {
  try {
    const content = await getFile(req.user.id, 'cv.md')
    if (!content) return res.status(404).json({ error: 'cv.md not found. Add your CV in the Profile tab first.' })
    const parsed  = parseCvMd(content)
    const html    = buildCvHtml(parsed)
    const pdfBuf  = await htmlToPdf(html)
    const slug    = (parsed.name || 'cv').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="cv-${slug}.pdf"`)
    res.setHeader('Content-Length', pdfBuf.length)
    res.send(pdfBuf)
  } catch (e) {
    console.error('CV PDF error:', e)
    res.status(500).json({ error: e.message })
  }
})

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
