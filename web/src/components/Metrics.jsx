export default function Metrics({ metrics }) {
  const scoreColor =
    metrics.avgScore >= 4 ? 'text-emerald-400' :
    metrics.avgScore >= 3 ? 'text-amber-400' :
    'text-rose-400'

  const cards = [
    { label: 'Total',      value: metrics.total,                    color: 'text-zinc-100' },
    { label: 'Actionable', value: metrics.actionable,               color: 'text-violet-400' },
    { label: 'Applied',    value: metrics.byStatus?.Applied || 0,   color: 'text-blue-400' },
    { label: 'Interview',  value: metrics.byStatus?.Interview || 0, color: 'text-emerald-400' },
    { label: 'Offer',      value: metrics.byStatus?.Offer || 0,     color: 'text-emerald-300' },
    { label: 'Avg Score',  value: `${metrics.avgScore}/5`,          color: scoreColor },
  ]

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
      {cards.map(card => (
        <div
          key={card.label}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-3 text-center"
        >
          <div className={`text-2xl font-bold font-mono tabular-nums ${card.color}`}>
            {card.value}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">{card.label}</div>
        </div>
      ))}
    </div>
  )
}
