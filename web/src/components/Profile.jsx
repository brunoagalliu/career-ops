import { useState, useEffect } from 'react'
import yaml from 'js-yaml'
import { authFetch } from '../api.js'

// ── Primitives ────────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">{title}</h2>
      {children}
    </section>
  )
}

function Label({ children }) {
  return <label className="block text-xs text-zinc-500 mb-1">{children}</label>
}

function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
    />
  )
}

function TextArea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
    />
  )
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
    >
      {options.map(o => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  )
}

function RemoveBtn({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-zinc-600 hover:text-rose-400 transition-colors text-lg leading-none flex-shrink-0"
    >
      ×
    </button>
  )
}

function AddBtn({ onClick, label = '+ Add' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-500 rounded px-3 py-1.5 transition-colors"
    >
      {label}
    </button>
  )
}

// ── String array field ────────────────────────────────────────────────────────

function StringList({ items = [], onChange, placeholder, addLabel }) {
  function update(i, val) {
    const next = [...items]
    next[i] = val
    onChange(next)
  }
  function remove(i) {
    onChange(items.filter((_, idx) => idx !== i))
  }
  function add() {
    onChange([...items, ''])
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <TextInput value={item} onChange={v => update(i, v)} placeholder={placeholder} />
          <RemoveBtn onClick={() => remove(i)} />
        </div>
      ))}
      <AddBtn onClick={add} label={addLabel} />
    </div>
  )
}

// ── Sections ──────────────────────────────────────────────────────────────────

function CandidateSection({ data = {}, onChange }) {
  const f = (key) => (val) => onChange({ ...data, [key]: val })
  return (
    <Section title="Candidate">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          ['full_name',  'Full name'],
          ['email',      'Email'],
          ['phone',      'Phone'],
          ['location',   'Location'],
          ['linkedin',   'LinkedIn'],
          ['github',     'GitHub'],
        ].map(([key, label]) => (
          <div key={key}>
            <Label>{label}</Label>
            <TextInput value={data[key]} onChange={f(key)} />
          </div>
        ))}
      </div>
    </Section>
  )
}

function TargetRolesSection({ data = {}, onChange }) {
  const LEVELS = ['Junior', 'Mid', 'Mid-Senior', 'Senior', 'Lead', 'Principal', 'Staff', 'Director', 'VP']
  const FITS   = ['primary', 'secondary', 'adjacent']

  function updatePrimary(list) {
    onChange({ ...data, primary: list })
  }

  function updateArchetype(i, key, val) {
    const next = (data.archetypes || []).map((a, idx) => idx === i ? { ...a, [key]: val } : a)
    onChange({ ...data, archetypes: next })
  }

  function removeArchetype(i) {
    onChange({ ...data, archetypes: (data.archetypes || []).filter((_, idx) => idx !== i) })
  }

  function addArchetype() {
    onChange({ ...data, archetypes: [...(data.archetypes || []), { name: '', level: 'Mid-Senior', fit: 'primary' }] })
  }

  return (
    <Section title="Target Roles">
      <div className="space-y-5">
        <div>
          <Label>Primary roles (plain list)</Label>
          <StringList
            items={data.primary || []}
            onChange={updatePrimary}
            placeholder="e.g. Paid Media Manager"
            addLabel="+ Add role"
          />
        </div>

        <div>
          <Label>Archetypes (used for scoring)</Label>
          <div className="space-y-2">
            {(data.archetypes || []).map((arch, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <TextInput
                    value={arch.name}
                    onChange={v => updateArchetype(i, 'name', v)}
                    placeholder="Role name"
                  />
                </div>
                <Select
                  value={arch.level}
                  onChange={v => updateArchetype(i, 'level', v)}
                  options={LEVELS}
                />
                <Select
                  value={arch.fit}
                  onChange={v => updateArchetype(i, 'fit', v)}
                  options={FITS}
                />
                <RemoveBtn onClick={() => removeArchetype(i)} />
              </div>
            ))}
            <AddBtn onClick={addArchetype} label="+ Add archetype" />
          </div>
        </div>
      </div>
    </Section>
  )
}

function NarrativeSection({ data = {}, onChange }) {
  const f = (key) => (val) => onChange({ ...data, [key]: val })

  function updateProofPoint(i, key, val) {
    const next = (data.proof_points || []).map((pp, idx) => idx === i ? { ...pp, [key]: val } : pp)
    onChange({ ...data, proof_points: next })
  }

  function removeProofPoint(i) {
    onChange({ ...data, proof_points: (data.proof_points || []).filter((_, idx) => idx !== i) })
  }

  function addProofPoint() {
    onChange({ ...data, proof_points: [...(data.proof_points || []), { name: '', hero_metric: '' }] })
  }

  return (
    <Section title="Narrative">
      <div className="space-y-4">
        <div>
          <Label>Headline</Label>
          <TextInput value={data.headline} onChange={f('headline')} placeholder="One-line professional headline" />
        </div>

        <div>
          <Label>Exit story</Label>
          <TextArea value={data.exit_story} onChange={f('exit_story')} placeholder="What makes you unique" rows={3} />
        </div>

        <div>
          <Label>Superpowers</Label>
          <StringList
            items={data.superpowers || []}
            onChange={f('superpowers')}
            placeholder="A specific strength or capability"
            addLabel="+ Add superpower"
          />
        </div>

        <div>
          <Label>Proof points</Label>
          <div className="space-y-2">
            {(data.proof_points || []).map((pp, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1 space-y-1.5">
                  <TextInput
                    value={pp.name}
                    onChange={v => updateProofPoint(i, 'name', v)}
                    placeholder="Project or achievement name"
                  />
                  <TextInput
                    value={pp.hero_metric}
                    onChange={v => updateProofPoint(i, 'hero_metric', v)}
                    placeholder="Hero metric (e.g. 40% increase in conversions)"
                  />
                </div>
                <RemoveBtn onClick={() => removeProofPoint(i)} />
              </div>
            ))}
            <AddBtn onClick={addProofPoint} label="+ Add proof point" />
          </div>
        </div>
      </div>
    </Section>
  )
}

function CompensationSection({ data = {}, onChange }) {
  const f = (key) => (val) => onChange({ ...data, [key]: val })
  return (
    <Section title="Compensation">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          ['target_range',         'Target range (USD)'],
          ['minimum',              'Minimum (USD)'],
          ['eu_target_range',      'EU target range'],
          ['eu_minimum',           'EU minimum'],
          ['location_flexibility', 'Location flexibility'],
        ].map(([key, label]) => (
          <div key={key} className={key === 'location_flexibility' ? 'sm:col-span-2' : ''}>
            <Label>{label}</Label>
            <TextInput value={data[key]} onChange={f(key)} />
          </div>
        ))}
      </div>
    </Section>
  )
}

function LocationSection({ data = {}, onChange }) {
  const f = (key) => (val) => onChange({ ...data, [key]: val })
  return (
    <Section title="Location">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          ['country',             'Country'],
          ['city',                'City'],
          ['timezone',            'Timezone'],
          ['visa_status',         'Visa status'],
          ['onsite_availability', 'On-site availability'],
        ].map(([key, label]) => (
          <div key={key} className={['visa_status', 'onsite_availability'].includes(key) ? 'sm:col-span-2' : ''}>
            <Label>{label}</Label>
            <TextInput value={data[key]} onChange={f(key)} />
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Portals section (self-contained load/save) ───────────────────────────────

function PortalsSection() {
  const [portals, setPortals]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const [saved, setSaved]       = useState(false)

  useEffect(() => {
    authFetch('/api/portals')
      .then(r => r.json())
      .then(data => { setPortals(data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const content = yaml.dump(portals, { lineWidth: 120, quotingType: '"' })
      const res = await authFetch('/api/portals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function updateFilter(key, list) {
    setPortals(p => ({ ...p, title_filter: { ...p.title_filter, [key]: list } }))
  }

  function updateQuery(i, field, val) {
    setPortals(p => ({
      ...p,
      search_queries: p.search_queries.map((q, idx) => idx === i ? { ...q, [field]: val } : q),
    }))
  }

  function removeQuery(i) {
    setPortals(p => ({ ...p, search_queries: p.search_queries.filter((_, idx) => idx !== i) }))
  }

  function addQuery() {
    setPortals(p => ({
      ...p,
      search_queries: [...(p.search_queries || []), { name: '', query: '', enabled: true }],
    }))
  }

  function updateCompany(i, field, val) {
    setPortals(p => ({
      ...p,
      tracked_companies: p.tracked_companies.map((c, idx) => idx === i ? { ...c, [field]: val } : c),
    }))
  }

  function removeCompany(i) {
    setPortals(p => ({ ...p, tracked_companies: p.tracked_companies.filter((_, idx) => idx !== i) }))
  }

  function addCompany() {
    setPortals(p => ({
      ...p,
      tracked_companies: [...(p.tracked_companies || []), { name: '', careers_url: '', enabled: true }],
    }))
  }

  if (loading) return <Section title="Portals"><div className="text-zinc-600 text-sm">Loading…</div></Section>
  if (!portals) return null

  const tf = portals.title_filter || {}

  return (
    <Section title="Portals">
      {/* Save bar */}
      <div className="flex items-center justify-between mb-5">
        <span className="text-xs text-zinc-600">Search queries · {(portals.search_queries || []).filter(q => q.enabled).length} enabled &nbsp;|&nbsp; Companies · {(portals.tracked_companies || []).filter(c => c.enabled).length} enabled</span>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-rose-400 max-w-xs truncate">{error}</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded border border-emerald-500/40 text-emerald-400 hover:text-emerald-300 hover:border-emerald-400/60 bg-emerald-500/10 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save portals'}
          </button>
        </div>
      </div>

      {/* Title filter */}
      <div className="space-y-4 mb-6">
        <p className="text-xs font-medium text-zinc-400">Title filters</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Include keywords</Label>
            <StringList items={tf.positive || []} onChange={v => updateFilter('positive', v)} placeholder="e.g. Paid Media" addLabel="+ Add keyword" />
          </div>
          <div>
            <Label>Exclude keywords</Label>
            <StringList items={tf.negative || []} onChange={v => updateFilter('negative', v)} placeholder="e.g. Intern" addLabel="+ Add keyword" />
          </div>
        </div>
      </div>

      {/* Search queries */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-zinc-400">Search queries</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-600">
              {(portals.search_queries || []).every(q => !q.enabled) ? 'all off' : (portals.search_queries || []).every(q => q.enabled) ? 'all on' : `${(portals.search_queries || []).filter(q => q.enabled).length} on`}
            </span>
            <button
              type="button"
              onClick={() => {
                const allOn = (portals.search_queries || []).every(q => q.enabled)
                setPortals(p => ({ ...p, search_queries: (p.search_queries || []).map(q => ({ ...q, enabled: !allOn })) }))
              }}
              className={`flex-shrink-0 w-8 h-4 rounded-full transition-colors relative ${(portals.search_queries || []).some(q => q.enabled) ? 'bg-emerald-500' : 'bg-zinc-700'}`}
              title="Toggle all search queries on/off"
            >
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${(portals.search_queries || []).some(q => q.enabled) ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {(portals.search_queries || []).map((q, i) => (
            <div key={i} className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => updateQuery(i, 'enabled', !q.enabled)}
                className={`mt-1.5 flex-shrink-0 w-8 h-4 rounded-full transition-colors relative ${q.enabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                title={q.enabled ? 'Enabled' : 'Disabled'}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${q.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <div className="flex-1 min-w-0 space-y-1">
                <TextInput value={q.name} onChange={v => updateQuery(i, 'name', v)} placeholder="Query name" />
                <TextInput value={q.query} onChange={v => updateQuery(i, 'query', v)} placeholder='site:linkedin.com/jobs "paid media" remote' />
              </div>
              <RemoveBtn onClick={() => removeQuery(i)} />
            </div>
          ))}
          <AddBtn onClick={addQuery} label="+ Add search query" />
        </div>
      </div>

      {/* Tracked companies */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-zinc-400">Tracked companies</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-600">
              {(portals.tracked_companies || []).every(c => !c.enabled) ? 'all off' : (portals.tracked_companies || []).every(c => c.enabled) ? 'all on' : `${(portals.tracked_companies || []).filter(c => c.enabled).length} on`}
            </span>
            <button
              type="button"
              onClick={() => {
                const allOn = (portals.tracked_companies || []).every(c => c.enabled)
                setPortals(p => ({ ...p, tracked_companies: (p.tracked_companies || []).map(c => ({ ...c, enabled: !allOn })) }))
              }}
              className={`flex-shrink-0 w-8 h-4 rounded-full transition-colors relative ${(portals.tracked_companies || []).some(c => c.enabled) ? 'bg-emerald-500' : 'bg-zinc-700'}`}
              title="Toggle all companies on/off"
            >
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${(portals.tracked_companies || []).some(c => c.enabled) ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {(portals.tracked_companies || []).map((c, i) => (
            <div key={i} className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => updateCompany(i, 'enabled', !c.enabled)}
                className={`mt-1.5 flex-shrink-0 w-8 h-4 rounded-full transition-colors relative ${c.enabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                title={c.enabled ? 'Enabled' : 'Disabled'}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${c.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex gap-2">
                  <TextInput value={c.name} onChange={v => updateCompany(i, 'name', v)} placeholder="Company name" />
                  <TextInput value={c.careers_url} onChange={v => updateCompany(i, 'careers_url', v)} placeholder="https://jobs.ashbyhq.com/…" />
                </div>
                {c.notes !== undefined && (
                  <TextInput value={c.notes} onChange={v => updateCompany(i, 'notes', v)} placeholder="Notes (optional)" />
                )}
              </div>
              <RemoveBtn onClick={() => removeCompany(i)} />
            </div>
          ))}
          <AddBtn onClick={addCompany} label="+ Add company" />
        </div>
      </div>
    </Section>
  )
}

// ── Read-only view ────────────────────────────────────────────────────────────

function Field({ label, value }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-xs text-zinc-600">{label}</dt>
      <dd className="text-sm text-zinc-200 mt-0.5">{value}</dd>
    </div>
  )
}

function ProfileView({ profile, onEdit }) {
  const { candidate, target_roles, compensation, narrative, location } = profile
  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex justify-end">
        <button
          onClick={onEdit}
          className="text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
        >
          Edit profile
        </button>
      </div>

      {candidate && (
        <Section title="Candidate">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name"     value={candidate.full_name} />
            <Field label="Email"    value={candidate.email} />
            <Field label="Phone"    value={candidate.phone} />
            <Field label="Location" value={candidate.location} />
            <Field label="LinkedIn" value={candidate.linkedin} />
            <Field label="GitHub"   value={candidate.github} />
          </dl>
        </Section>
      )}

      {target_roles?.archetypes && (
        <Section title="Target Roles">
          <div className="space-y-1.5">
            {target_roles.archetypes.map(arch => (
              <div key={arch.name} className="flex items-center justify-between py-2 border-b border-zinc-800/70 last:border-0">
                <span className="text-sm text-zinc-200">{arch.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">{arch.level}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    arch.fit === 'primary'   ? 'bg-violet-500/20 text-violet-400' :
                    arch.fit === 'secondary' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-zinc-700/50 text-zinc-400'
                  }`}>{arch.fit}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {compensation && (
        <Section title="Compensation">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Target (USD)"  value={compensation.target_range} />
            <Field label="Minimum (USD)" value={compensation.minimum} />
            <Field label="EU Target"     value={compensation.eu_target_range} />
            <Field label="EU Minimum"    value={compensation.eu_minimum} />
            <Field label="Flexibility"   value={compensation.location_flexibility} />
          </dl>
        </Section>
      )}

      {narrative?.headline && (
        <Section title="Narrative">
          <p className="text-sm text-zinc-300 mb-3 italic">"{narrative.headline}"</p>
          {narrative.superpowers && (
            <ul className="space-y-2">
              {narrative.superpowers.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm text-zinc-300">
                  <span className="text-violet-500 flex-shrink-0 mt-0.5">◆</span>
                  {s}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {narrative?.proof_points && (
        <Section title="Proof Points">
          <div className="space-y-3">
            {narrative.proof_points.map((pp, i) => (
              <div key={i} className="border-l-2 border-zinc-700 pl-3">
                <div className="text-sm font-medium text-zinc-200">{pp.name}</div>
                <div className="text-xs text-emerald-400 mt-0.5">{pp.hero_metric}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {location && (
        <Section title="Location">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Country"     value={location.country} />
            <Field label="City"        value={location.city} />
            <Field label="Timezone"    value={location.timezone} />
            <Field label="Visa Status" value={location.visa_status} />
          </dl>
        </Section>
      )}

      <PortalsSection />
    </div>
  )
}

// ── Edit form ─────────────────────────────────────────────────────────────────

function ProfileForm({ initial, onSave, onCancel }) {
  const [draft, setDraft]   = useState(structuredClone(initial))
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const update = (key) => (val) => setDraft(prev => ({ ...prev, [key]: val }))

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const content = yaml.dump(draft, { lineWidth: 120, quotingType: '"' })
      const res = await authFetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSave(draft)
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">Editing profile</span>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-xs text-rose-400 font-mono max-w-xs truncate">{error}</span>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded border border-emerald-500/40 text-emerald-400 hover:text-emerald-300 hover:border-emerald-400/60 bg-emerald-500/10 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <CandidateSection    data={draft.candidate}    onChange={update('candidate')} />
      <TargetRolesSection  data={draft.target_roles} onChange={update('target_roles')} />
      <NarrativeSection    data={draft.narrative}    onChange={update('narrative')} />
      <CompensationSection data={draft.compensation} onChange={update('compensation')} />
      <LocationSection     data={draft.location}     onChange={update('location')} />
      <PortalsSection />
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function Profile() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    authFetch('/api/profile')
      .then(r => r.json())
      .then(data => { setProfile(data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div className="text-zinc-600 text-sm py-12 text-center">Loading…</div>
  if (error)   return <div className="text-rose-500 text-sm py-12 text-center">{error}</div>
  if (!profile) return null

  if (editing) {
    return (
      <ProfileForm
        initial={profile}
        onSave={(updated) => { setProfile(updated); setEditing(false) }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return <ProfileView profile={profile} onEdit={() => setEditing(true)} />
}
