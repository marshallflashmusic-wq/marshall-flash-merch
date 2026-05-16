'use client'
import { useState } from 'react'
import { CalendarDays, MapPin, Building2, Plus, Check, Edit2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useEvents } from '@/hooks/useEvents'
import { useAppStore } from '@/store/appStore'
import { formatDate } from '@/lib/utils'
import TopBar from '@/components/layout/TopBar'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'
import type { Event } from '@/types'

export default function EventsPage() {
  const { events, loading, refetch } = useEvents()
  const { activeEvent, setActiveEvent, user } = useAppStore()
  const [showModal, setShowModal] = useState(false)
  const [editEvent, setEditEvent] = useState<Event | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [form, setForm] = useState({ name: '', city: '', venue: '', date: '', notes: '' })

  const openNew = () => {
    setEditEvent(null)
    setForm({ name: '', city: '', venue: '', date: '', notes: '' })
    setSaveError('')
    setShowModal(true)
  }

  const openEdit = (event: Event) => {
    setEditEvent(event)
    setForm({
      name: event.name,
      city: event.city,
      venue: event.venue,
      date: event.date,
      notes: event.notes ?? '',
    })
    setShowModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaveError('')

    if (!form.name.trim()) { setSaveError('El nombre del evento es obligatorio'); return }
    if (!form.city.trim()) { setSaveError('La ciudad es obligatoria'); return }
    if (!form.venue.trim()) { setSaveError('La sala / venue es obligatoria'); return }
    if (!form.date) { setSaveError('La fecha es obligatoria'); return }

    setSaving(true)
    try {
      const supabase = createClient()
      if (editEvent) {
        const { error } = await supabase
          .from('events')
          .update({ name: form.name.trim(), city: form.city.trim(), venue: form.venue.trim(), date: form.date, notes: form.notes.trim() || null })
          .eq('id', editEvent.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('events')
          .insert({ name: form.name.trim(), city: form.city.trim(), venue: form.venue.trim(), date: form.date, notes: form.notes.trim() || null, active: true })
        if (error) throw error
      }
      setShowModal(false)
      await refetch()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('policy') || msg.includes('permission') || msg.includes('violates')) {
        setSaveError('Sin permisos de escritura. Ejecuta supabase/fix-admin.sql en el SQL Editor de Supabase.')
      } else {
        setSaveError(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleSetActive = (event: Event) => {
    if (activeEvent?.id === event.id) {
      setActiveEvent(null)
    } else {
      setActiveEvent(event)
    }
  }

  const handleToggle = async (event: Event) => {
    const supabase = createClient()
    await supabase.from('events').update({ active: !event.active }).eq('id', event.id)
    refetch()
  }

  return (
    <div className="h-full flex flex-col">
      <TopBar
        title="Eventos / Conciertos"
        subtitle={`${events.length} evento${events.length !== 1 ? 's' : ''}`}
        actions={
          user?.role === 'admin' && (
            <button
              onClick={openNew}
              className="p-2 rounded-xl bg-amber-500 text-black"
            >
              <Plus size={18} strokeWidth={2.5} />
            </button>
          )
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
            <CalendarDays size={40} />
            <p className="mt-3 text-sm">No hay eventos creados</p>
            <button onClick={openNew} className="mt-3 text-amber-500 text-sm">Crear primer evento</button>
          </div>
        ) : (
          events.map(event => {
            const isActive = activeEvent?.id === event.id
            return (
              <Card
                key={event.id}
                padding="none"
                className={isActive ? 'border-amber-500 bg-amber-500/5' : ''}
              >
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isActive ? 'bg-amber-500/20' : 'bg-zinc-800'}`}>
                      <CalendarDays size={20} className={isActive ? 'text-amber-500' : 'text-zinc-500'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-white">{event.name}</p>
                        {isActive && <Badge variant="success">Activo</Badge>}
                        {!event.active && <Badge variant="outline">Inactivo</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span className="flex items-center gap-1 text-xs text-zinc-500">
                          <MapPin size={12} />
                          {event.city}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-zinc-500">
                          <Building2 size={12} />
                          {event.venue}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-zinc-500">
                          <CalendarDays size={12} />
                          {formatDate(event.date)}
                        </span>
                      </div>
                      {event.notes && (
                        <p className="text-xs text-zinc-600 mt-1.5 italic">{event.notes}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex border-t border-zinc-800">
                  <button
                    onClick={() => handleSetActive(event)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                      isActive ? 'text-amber-400 hover:bg-amber-500/10' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'
                    }`}
                  >
                    <Check size={13} />
                    {isActive ? 'Evento activo' : 'Activar'}
                  </button>
                  {user?.role === 'admin' && (
                    <>
                      <button
                        onClick={() => openEdit(event)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors border-l border-zinc-800"
                      >
                        <Edit2 size={12} />
                        Editar
                      </button>
                      <button
                        onClick={() => handleToggle(event)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors border-l border-zinc-800"
                      >
                        <X size={12} />
                        {event.active ? 'Ocultar' : 'Mostrar'}
                      </button>
                    </>
                  )}
                </div>
              </Card>
            )
          })
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editEvent ? 'Editar evento' : 'Nuevo evento'} size="md">
        <form onSubmit={handleSave} className="space-y-4">
          <Input label="Nombre del evento *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Tour Relativa Sencillez - Madrid" required />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Ciudad *" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Madrid" required />
            <Input label="Sala / Venue *" value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))} placeholder="La Riviera" required />
          </div>
          <Input label="Fecha *" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-300">Notas</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Notas opcionales..."
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 resize-none text-sm"
            />
          </div>
          {saveError && (
            <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2">
              <p className="text-red-400 text-sm">{saveError}</p>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" fullWidth onClick={() => setShowModal(false)}>Cancelar</Button>
            <Button type="submit" fullWidth loading={saving}>{editEvent ? 'Guardar' : 'Crear evento'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
