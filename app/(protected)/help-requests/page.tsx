'use client'
import { useEffect, useState, useCallback } from 'react'
import { Bell, Check, CalendarDays, Clock } from 'lucide-react'
import TopBar from '@/components/layout/TopBar'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { formatDateTime } from '@/lib/utils'

interface HelpRequest {
  id: string
  seller_name: string
  message: string | null
  event_id: string | null
  status: 'pending' | 'resolved'
  created_at: string
  resolved_at: string | null
  event?: { id: string; name: string } | null
}

export default function HelpRequestsPage() {
  const [requests, setRequests] = useState<HelpRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = filter === 'pending' ? '/api/help-requests?status=pending' : '/api/help-requests'
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json()
      setRequests(j.requests ?? [])
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  const resolve = async (id: string) => {
    await fetch('/api/help-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'resolved' }),
    })
    load()
  }

  const pendingCount = requests.filter(r => r.status === 'pending').length

  return (
    <div className="h-full flex flex-col">
      <TopBar title="Avisos del TPV" subtitle={`${pendingCount} pendiente${pendingCount !== 1 ? 's' : ''}`} />

      <div className="px-4 pt-3 pb-1 shrink-0">
        <div className="flex bg-zinc-900 border border-zinc-800 rounded-xl p-1 gap-1">
          {([
            { key: 'pending', label: 'Pendientes' },
            { key: 'all', label: 'Todos' },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                filter === t.key ? 'bg-white text-black' : 'text-zinc-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
            <Bell size={36} />
            <p className="mt-3 text-sm">Sin avisos {filter === 'pending' ? 'pendientes' : 'registrados'}</p>
          </div>
        ) : (
          requests.map(r => {
            const isPending = r.status === 'pending'
            return (
              <Card key={r.id} padding="md" className={isPending ? 'border-amber-500/60 bg-amber-500/5' : ''}>
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isPending ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-500'}`}>
                    <Bell size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white font-bold text-sm">{r.seller_name}</p>
                      {isPending
                        ? <Badge variant="warning">Pendiente</Badge>
                        : <Badge variant="outline">Atendido</Badge>}
                    </div>
                    <p className="text-zinc-300 text-sm mt-0.5">{r.message ?? 'Necesita ayuda'}</p>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                        <Clock size={11} />{formatDateTime(r.created_at)}
                      </span>
                      {r.event && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
                          <CalendarDays size={11} />{r.event.name}
                        </span>
                      )}
                    </div>
                  </div>
                  {isPending && (
                    <button
                      onClick={() => resolve(r.id)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-500 text-black text-xs font-bold active:scale-95 transition-transform shrink-0"
                    >
                      <Check size={12} strokeWidth={3} />
                      Atendido
                    </button>
                  )}
                </div>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
