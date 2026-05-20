'use client'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarDays, MapPin, Building2, Plus, Edit2, X, Play, Lock,
  PackageCheck, Trash2, Ban, ChevronRight,
} from 'lucide-react'
import { useEvents } from '@/hooks/useEvents'
import { useAppStore } from '@/store/appStore'
import { formatDate } from '@/lib/utils'
import TopBar from '@/components/layout/TopBar'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'
import SwipeableTabs from '@/components/ui/SwipeableTabs'
import type { Event, EventStatus } from '@/types'

type FilterKey = 'active' | 'upcoming' | 'closed'

export default function EventsPage() {
  const router = useRouter()
  const { events, loading, refetch } = useEvents()
  const { user } = useAppStore()
  const [filter, setFilter] = useState<FilterKey>('active')
  const [showModal, setShowModal] = useState(false)
  const [editEvent, setEditEvent] = useState<Event | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [form, setForm] = useState({ name: '', city: '', venue: '', date: '', notes: '' })
  const [actionEvent, setActionEvent] = useState<{ event: Event; action: 'close' | 'cancel' | 'delete' } | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [deleteRestoreStock, setDeleteRestoreStock] = useState(true)
  const [deleteSales, setDeleteSales] = useState(true)

  const openNew = () => {
    setEditEvent(null)
    setForm({ name: '', city: '', venue: '', date: '', notes: '' })
    setSaveError('')
    setShowModal(true)
  }

  const openEdit = (event: Event) => {
    setEditEvent(event)
    setForm({
      name: event.name, city: event.city, venue: event.venue,
      date: event.date, notes: event.notes ?? '',
    })
    setSaveError('')
    setShowModal(true)
  }

  // mode = 'create' → solo crear y volver al listado.
  // mode = 'create-and-open' → crear y abrir el editor de stock /events/[id].
  const handleSave = async (e: React.FormEvent, mode: 'create' | 'create-and-open' = 'create') => {
    e.preventDefault()
    setSaveError('')
    if (!form.name.trim() || !form.city.trim() || !form.venue.trim() || !form.date) {
      setSaveError('Rellena los campos obligatorios.'); return
    }
    setSaving(true)
    try {
      const url = '/api/events'
      const method = editEvent ? 'PATCH' : 'POST'
      const body = editEvent ? { id: editEvent.id, ...form } : form
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error')
      setShowModal(false)
      await refetch()
      // Si se eligió "Crear y Guardar", abrimos el editor de stock del evento nuevo
      if (!editEvent && mode === 'create-and-open' && json.event?.id) {
        router.push(`/events/${json.event.id}`)
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleActivate = async (event: Event) => {
    await fetch('/api/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: event.id, status: 'active' }),
    })
    refetch()
  }

  const handleReopen = async (event: Event) => {
    await fetch('/api/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: event.id, status: 'upcoming' }),
    })
    refetch()
  }

  const runAction = async () => {
    if (!actionEvent) return
    setActionLoading(true)
    setActionError('')
    try {
      const { event, action } = actionEvent
      let endpoint: string
      let method: 'POST' | 'DELETE' = 'POST'
      if (action === 'close') endpoint = `/api/events/${event.id}/close`
      else if (action === 'cancel') endpoint = `/api/events/${event.id}/cancel`
      else {
        method = 'DELETE'
        const qs = new URLSearchParams({
          id: event.id,
          restoreStock: String(deleteRestoreStock),
          deleteSales: String(deleteSales),
        })
        endpoint = `/api/events?${qs.toString()}`
      }
      const res = await fetch(endpoint, { method })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Error')
      setActionEvent(null)
      refetch()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading(false)
    }
  }

  const openAction = (event: Event, action: 'close' | 'cancel' | 'delete') => {
    setActionError('')
    setDeleteRestoreStock(true)
    setDeleteSales(true)
    setActionEvent({ event, action })
  }

  const filtered = useMemo(() => {
    return events.filter(e => {
      const s = e.status ?? 'upcoming'
      if (filter === 'upcoming') return s === 'upcoming'
      if (filter === 'active') return s === 'active'
      if (filter === 'closed') return s === 'closed' || s === 'cancelled'
      return true
    })
  }, [events, filter])

  const counts = useMemo(() => ({
    upcoming: events.filter(e => (e.status ?? 'upcoming') === 'upcoming').length,
    active: events.filter(e => e.status === 'active').length,
    closed: events.filter(e => e.status === 'closed' || e.status === 'cancelled').length,
  }), [events])

  return (
    <div className="h-full flex flex-col">
      <TopBar
        title="Eventos / Conciertos"
        subtitle={`${events.length} evento${events.length !== 1 ? 's' : ''}`}
        actions={user?.role === 'admin' && (
          <button onClick={openNew} className="p-2 rounded-xl bg-amber-500 text-black">
            <Plus size={18} strokeWidth={2.5} />
          </button>
        )}
      />

      <SwipeableTabs
        activeKey={filter}
        onChange={k => setFilter(k as FilterKey)}
        panelClassName="px-4 py-4 space-y-3"
        tabs={[
          { key: 'active', label: <FilterLabel text="Activos" count={counts.active} />, content: <EventList loading={loading} events={filtered} onEdit={openEdit} onActivate={handleActivate} onReopen={handleReopen} onPrepare={(e) => router.push(`/events/${e.id}`)} onAskAction={openAction} onCreate={openNew} /> },
          { key: 'upcoming', label: <FilterLabel text="Próximos" count={counts.upcoming} />, content: <EventList loading={loading} events={filtered} onEdit={openEdit} onActivate={handleActivate} onReopen={handleReopen} onPrepare={(e) => router.push(`/events/${e.id}`)} onAskAction={openAction} onCreate={openNew} /> },
          { key: 'closed', label: <FilterLabel text="Cerrados" count={counts.closed} />, content: <EventList loading={loading} events={filtered} onEdit={openEdit} onActivate={handleActivate} onReopen={handleReopen} onPrepare={(e) => router.push(`/events/${e.id}`)} onAskAction={openAction} onCreate={openNew} /> },
        ]}
      />

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editEvent ? 'Editar evento' : 'Nuevo evento'} size="md">
        <form onSubmit={e => handleSave(e, 'create')} className="space-y-4">
          <Input label="Nombre del evento *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Ciudad *" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} required />
            <Input label="Sala / Venue *" value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))} required />
          </div>
          <Input label="Fecha *" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-300">Notas</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 resize-none text-sm" />
          </div>
          {saveError && <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2"><p className="text-red-400 text-sm">{saveError}</p></div>}
          {editEvent ? (
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" fullWidth onClick={() => setShowModal(false)}>Cancelar</Button>
              <Button type="submit" fullWidth loading={saving}>Guardar</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex gap-2">
                <Button type="button" variant="outline" fullWidth onClick={() => setShowModal(false)} disabled={saving}>Cancelar</Button>
                <Button type="submit" fullWidth loading={saving}>Crear evento</Button>
              </div>
              <Button
                type="button"
                fullWidth
                loading={saving}
                onClick={e => handleSave(e as unknown as React.FormEvent, 'create-and-open')}
                className="bg-amber-500 hover:bg-amber-400 text-black"
              >
                Crear y Guardar stock
              </Button>
            </div>
          )}
        </form>
      </Modal>

      <Modal open={!!actionEvent} onClose={() => setActionEvent(null)} title={
        actionEvent?.action === 'close' ? 'Cerrar evento'
        : actionEvent?.action === 'cancel' ? 'Cancelar evento'
        : 'Eliminar evento'
      } size="sm">
        <div className="space-y-4">
          {actionEvent?.action !== 'delete' && (
            <p className="text-zinc-400 text-sm">
              {actionEvent?.action === 'close' && 'Al cerrar el evento, las unidades NO vendidas se devolverán automáticamente al stock global. Las ventas registradas se mantienen ligadas al evento.'}
              {actionEvent?.action === 'cancel' && 'Al cancelar, las unidades restantes vuelven al stock global. Las ventas registradas se mantienen pero el evento queda marcado como cancelado.'}
            </p>
          )}
          {actionEvent?.action === 'delete' && (
            <>
              <p className="text-zinc-400 text-sm">
                Vas a eliminar <span className="text-white font-semibold">{actionEvent.event.name}</span>. Esta acción no se puede deshacer.
              </p>
              <CheckOption
                checked={deleteRestoreStock}
                onToggle={() => setDeleteRestoreStock(v => !v)}
                title="Restablecer stock"
                description="Devuelve al inventario global el stock asignado y el de las ventas borradas."
              />
              <CheckOption
                checked={deleteSales}
                onToggle={() => setDeleteSales(v => !v)}
                title="Eliminar ventas del evento"
                description="Borra del historial las ventas registradas en este evento. Si no marcas esto no se podrá eliminar el evento mientras tenga ventas."
              />
            </>
          )}
          {actionError && <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2"><p className="text-red-400 text-sm">{actionError}</p></div>}
          <div className="flex gap-3">
            <Button variant="outline" fullWidth onClick={() => setActionEvent(null)} disabled={actionLoading}>Cancelar</Button>
            <Button fullWidth onClick={runAction} loading={actionLoading}>{actionEvent?.action === 'delete' ? 'Eliminar' : 'Confirmar'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function FilterLabel({ text, count }: { text: string; count: number }) {
  return (
    <span className="flex items-center justify-center gap-1.5">
      {text}
      {count > 0 && <span className="bg-white/10 text-white text-xs px-1.5 py-0.5 rounded-full">{count}</span>}
    </span>
  )
}

function EventList({
  loading, events, onEdit, onActivate, onReopen, onPrepare, onAskAction, onCreate,
}: {
  loading: boolean
  events: Event[]
  onEdit: (e: Event) => void
  onActivate: (e: Event) => void
  onReopen: (e: Event) => void
  onPrepare: (e: Event) => void
  onAskAction: (e: Event, action: 'close' | 'cancel' | 'delete') => void
  onCreate: () => void
}) {
  const { user } = useAppStore()
  if (loading) {
    return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
  }
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
        <CalendarDays size={40} />
        <p className="mt-3 text-sm">Sin eventos en esta categoría</p>
        <button onClick={onCreate} className="mt-3 text-amber-500 text-sm">Crear evento</button>
      </div>
    )
  }
  return (
    <>
      {events.map(event => (
        <EventCard key={event.id} event={event}
          isAdmin={user?.role === 'admin'}
          onEdit={() => onEdit(event)}
          onActivate={() => onActivate(event)}
          onReopen={() => onReopen(event)}
          onPrepare={() => onPrepare(event)}
          onAskAction={(action) => onAskAction(event, action)} />
      ))}
    </>
  )
}

function EventCard({
  event, isAdmin, onEdit, onActivate, onReopen, onPrepare, onAskAction,
}: {
  event: Event
  isAdmin: boolean
  onEdit: () => void
  onActivate: () => void
  onReopen: () => void
  onPrepare: () => void
  onAskAction: (action: 'close' | 'cancel' | 'delete') => void
}) {
  const status: EventStatus = event.status ?? 'upcoming'

  return (
    <Card padding="none" className={status === 'active' ? 'border-amber-500 bg-amber-500/5' : ''}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${status === 'active' ? 'bg-amber-500/20' : 'bg-zinc-800'}`}>
            <CalendarDays size={20} className={status === 'active' ? 'text-amber-500' : 'text-zinc-500'} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-white">{event.name}</p>
              <StatusBadge status={status} />
            </div>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="flex items-center gap-1 text-xs text-zinc-500"><MapPin size={12} />{event.city}</span>
              <span className="flex items-center gap-1 text-xs text-zinc-500"><Building2 size={12} />{event.venue}</span>
              <span className="flex items-center gap-1 text-xs text-zinc-500"><CalendarDays size={12} />{formatDate(event.date)}</span>
            </div>
            {event.notes && <p className="text-xs text-zinc-600 mt-1.5 italic">{event.notes}</p>}
          </div>
        </div>
      </div>

      <div className="flex border-t border-zinc-800">
        {(status === 'upcoming' || status === 'active') && (
          <button onClick={onPrepare} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-amber-400 hover:bg-amber-500/10 transition-colors">
            <PackageCheck size={13} />Stock evento
            <ChevronRight size={13} />
          </button>
        )}
        {isAdmin && status === 'upcoming' && (
          <button onClick={onActivate} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors border-l border-zinc-800">
            <Play size={12} />Activar
          </button>
        )}
        {isAdmin && status === 'active' && (
          <button onClick={() => onAskAction('close')} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors border-l border-zinc-800">
            <Lock size={12} />Cerrar
          </button>
        )}
        {isAdmin && status === 'cancelled' && (
          <button onClick={onReopen} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors">
            <Play size={12} />Reabrir
          </button>
        )}
        {isAdmin && (status === 'upcoming' || status === 'active') && (
          <button onClick={onEdit} className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors border-l border-zinc-800">
            <Edit2 size={12} />
          </button>
        )}
        {isAdmin && status === 'active' && (
          <button onClick={() => onAskAction('cancel')} className="flex items-center justify-center px-3 py-2.5 text-xs text-red-500 hover:bg-red-950/40 transition-colors border-l border-zinc-800">
            <Ban size={12} />
          </button>
        )}
        {isAdmin && (
          <button onClick={() => onAskAction('delete')} className="flex items-center justify-center px-3 py-2.5 text-xs text-red-500 hover:bg-red-950/40 transition-colors border-l border-zinc-800" aria-label="Eliminar evento">
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </Card>
  )
}

function CheckOption({ checked, onToggle, title, description }: {
  checked: boolean
  onToggle: () => void
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-start gap-3 bg-zinc-800 hover:bg-zinc-700/70 border border-zinc-700 rounded-xl p-3 transition-colors text-left"
    >
      <div className={`mt-0.5 w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center transition-colors ${checked ? 'bg-amber-500 border-amber-500' : 'border-zinc-500'}`}>
        {checked && (
          <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 fill-current text-black">
            <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <div>
        <p className="text-white text-sm font-medium">{title}</p>
        <p className="text-zinc-500 text-xs mt-0.5">{description}</p>
      </div>
    </button>
  )
}

function StatusBadge({ status }: { status: EventStatus }) {
  if (status === 'active') return <Badge variant="success">Activo</Badge>
  if (status === 'closed') return <Badge variant="outline">Cerrado</Badge>
  if (status === 'cancelled') return <Badge variant="danger">Cancelado</Badge>
  return <Badge variant="warning">Próximo</Badge>
}
