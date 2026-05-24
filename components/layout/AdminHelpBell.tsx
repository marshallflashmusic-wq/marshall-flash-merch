'use client'
import { useEffect, useState, useCallback } from 'react'
import { Bell, Check, CalendarDays, Clock, Send, X, MessageSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAppStore } from '@/store/appStore'
import { formatDateTime } from '@/lib/utils'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'

interface HelpRequest {
  id: string
  seller_name: string
  message: string | null
  event_id: string | null
  status: 'pending' | 'resolved'
  from_role: 'tpv' | 'admin'
  from_user_id: string | null
  target_session_id: string | null
  target_session_name: string | null
  target_user_id: string | null
  target_user_name: string | null
  created_at: string
  event?: { id: string; name: string } | null
}

interface TpvSession {
  id: string
  pin_code: string
  seller_name: string | null
  expires_at: string
  active: boolean
}

interface StaffUser {
  id: string
  name: string
  role: 'admin' | 'boss' | 'staff'
  active: boolean
}

const QUICK_MESSAGES = [
  'Cierra caja, voy ya.',
  'Cobra solo en efectivo.',
  'Pasa por backstage cuando puedas.',
  'Avísame al terminar.',
]

export default function AdminHelpBell() {
  const { user, isSaleMode } = useAppStore()
  const isAdmin = !isSaleMode && (user?.role === 'admin' || user?.role === 'boss')

  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'inbox' | 'send'>('inbox')
  const [requests, setRequests] = useState<HelpRequest[]>([])
  const [sessions, setSessions] = useState<TpvSession[]>([])
  const [staff, setStaff] = useState<StaffUser[]>([])
  // Destinatario codificado: 'tpv:<id>' | 'tpv:all' | 'user:<id>'
  const [selectedTarget, setSelectedTarget] = useState<string>('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendOk, setSendOk] = useState(false)
  const [sendErr, setSendErr] = useState('')

  const loadRequests = useCallback(async () => {
    if (!user?.id) return
    try {
      // Inbox: avisos del TPV (para cualquier admin/boss) + mensajes dirigidos a este user
      const res = await fetch(`/api/help-requests?status=pending&inbox_user=${user.id}`, { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json()
      setRequests(j.requests ?? [])
    } catch { /* silencioso */ }
  }, [user?.id])

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/tpv-sessions', { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json()
      const now = Date.now()
      const active = (j.sessions ?? []).filter((s: TpvSession) =>
        s.active && new Date(s.expires_at).getTime() > now
      )
      setSessions(active)
    } catch { /* silencioso */ }
  }, [])

  const loadStaff = useCallback(async () => {
    if (!user?.id) return
    try {
      const res = await fetch('/api/users', { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json()
      const list = (j.users ?? []) as StaffUser[]
      // Solo admin/boss activos, excluyendo el propio user
      setStaff(list.filter(u => u.id !== user.id && u.active !== false && (u.role === 'admin' || u.role === 'boss')))
    } catch { /* silencioso */ }
  }, [user?.id])

  // Carga inicial + polling de respaldo cada 30s
  useEffect(() => {
    if (!isAdmin) return
    loadRequests()
    const i = setInterval(loadRequests, 30_000)
    return () => clearInterval(i)
  }, [isAdmin, loadRequests])

  // Realtime: refresca al INSERT/UPDATE para mantener el contador al día
  useEffect(() => {
    if (!isAdmin) return
    const supabase = createClient()
    const channel = supabase
      .channel('help_requests_bell')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'help_requests' }, () => {
        loadRequests()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [isAdmin, loadRequests])

  // Cargar sesiones y staff al abrir el modal o cambiar a la tab Enviar
  useEffect(() => {
    if (open && tab === 'send') {
      loadSessions()
      loadStaff()
    }
  }, [open, tab, loadSessions, loadStaff])

  // Selección por defecto cuando llegan datos: primer admin/boss > primer TPV > broadcast
  useEffect(() => {
    if (selectedTarget) return
    if (staff[0]) setSelectedTarget(`user:${staff[0].id}`)
    else if (sessions[0]) setSelectedTarget(`tpv:${sessions[0].id}`)
    else setSelectedTarget('tpv:all')
  }, [staff, sessions, selectedTarget])

  const resolve = async (id: string) => {
    await fetch('/api/help-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'resolved' }),
    }).catch(() => {})
    loadRequests()
  }

  const sendMessage = async () => {
    if (!message.trim()) return
    setSending(true)
    setSendErr('')
    try {
      const baseBody = {
        seller_name: user?.name ?? 'Admin',
        message: message.trim(),
        from_role: 'admin' as const,
        from_user_id: user?.id ?? null,
      }
      let body: Record<string, unknown> = baseBody
      if (selectedTarget.startsWith('user:')) {
        const uid = selectedTarget.slice(5)
        const target = staff.find(s => s.id === uid)
        body = {
          ...baseBody,
          target_user_id: uid,
          target_user_name: target?.name ?? null,
        }
      } else if (selectedTarget.startsWith('tpv:') && selectedTarget !== 'tpv:all') {
        const sid = selectedTarget.slice(4)
        const target = sessions.find(s => s.id === sid)
        body = {
          ...baseBody,
          target_session_id: sid,
          target_session_name: target?.seller_name ?? null,
        }
      }
      // 'tpv:all' o vacío → broadcast a todos los TPV
      const res = await fetch('/api/help-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? 'Error')
      }
      setSendOk(true)
      setMessage('')
      setTimeout(() => setSendOk(false), 2000)
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : 'Error de red')
      setTimeout(() => setSendErr(''), 3000)
    } finally {
      setSending(false)
    }
  }

  if (!isAdmin) return null

  const pendingCount = requests.length

  return (
    <>
      <button
        onClick={() => { setOpen(true); setTab(pendingCount > 0 ? 'inbox' : 'send') }}
        className={`relative p-2 rounded-xl transition-colors ${
          pendingCount > 0
            ? 'bg-amber-500 text-black animate-pulse'
            : 'bg-zinc-800 text-zinc-400 hover:text-white'
        }`}
        aria-label="Avisos TPV"
      >
        <Bell size={16} strokeWidth={2.5} />
        {pendingCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 rounded-full text-white text-[10px] font-black flex items-center justify-center border-2 border-zinc-950">
            {pendingCount}
          </span>
        )}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Mensajes" size="md">
        {/* Tabs */}
        <div className="flex bg-zinc-800 rounded-xl p-1 gap-1 mb-4">
          <button
            onClick={() => setTab('inbox')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              tab === 'inbox' ? 'bg-white text-black' : 'text-zinc-400'
            }`}
          >
            Recibidos {pendingCount > 0 && <span className="ml-1">({pendingCount})</span>}
          </button>
          <button
            onClick={() => setTab('send')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              tab === 'send' ? 'bg-white text-black' : 'text-zinc-400'
            }`}
          >
            Enviar mensaje
          </button>
        </div>

        {tab === 'inbox' ? (
          requests.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-zinc-600">
              <Bell size={32} />
              <p className="mt-2 text-sm">Sin mensajes pendientes</p>
            </div>
          ) : (
            <div className="space-y-2">
              {requests.map(r => {
                const fromTpv = r.from_role === 'tpv'
                const colorClass = fromTpv
                  ? 'bg-amber-500/5 border-amber-500/40'
                  : 'bg-blue-500/5 border-blue-500/40'
                const iconClass = fromTpv
                  ? 'bg-amber-500 text-black'
                  : 'bg-blue-500 text-white'
                return (
                  <div key={r.id} className={`border rounded-xl p-3 flex items-start gap-2 ${colorClass}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconClass}`}>
                      <Bell size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-white font-bold text-sm">{r.seller_name}</p>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
                          fromTpv ? 'bg-amber-500/20 text-amber-300' : 'bg-blue-500/20 text-blue-300'
                        }`}>
                          {fromTpv ? 'TPV' : 'Equipo'}
                        </span>
                      </div>
                      <p className="text-zinc-300 text-xs mt-0.5">{r.message ?? 'Necesita ayuda'}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
                          <Clock size={10} />{formatDateTime(r.created_at)}
                        </span>
                        {r.event && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
                            <CalendarDays size={10} />{r.event.name}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => resolve(r.id)}
                      className="px-2 py-1 rounded-lg bg-green-500 text-black text-[10px] font-bold flex items-center gap-1 shrink-0"
                    >
                      <Check size={11} strokeWidth={3} />
                      Atendido
                    </button>
                  </div>
                )
              })}
            </div>
          )
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400">Destinatario</label>
              {staff.length === 0 && sessions.length === 0 ? (
                <div className="text-zinc-500 text-xs bg-zinc-800 rounded-xl px-3 py-2.5">
                  No hay nadie a quien enviar mensajes ahora mismo.
                </div>
              ) : (
                <select
                  value={selectedTarget}
                  onChange={e => setSelectedTarget(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:border-white"
                >
                  {staff.length > 0 && (
                    <optgroup label="Equipo (admin / boss)">
                      {staff.map(u => (
                        <option key={u.id} value={`user:${u.id}`}>
                          {u.name} · {u.role === 'boss' ? 'Boss' : 'Admin'}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {sessions.length > 0 && (
                    <optgroup label="TPV activos">
                      <option value="tpv:all">Todos los TPV (broadcast)</option>
                      {sessions.map(s => (
                        <option key={s.id} value={`tpv:${s.id}`}>
                          {(s.seller_name ?? '(sin nombre)') + ' · PIN ' + s.pin_code}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400">Mensaje</label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Escribe un mensaje..."
                rows={3}
                className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-white resize-none text-sm"
              />
              <div className="flex flex-wrap gap-1.5">
                {QUICK_MESSAGES.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMessage(m)}
                    className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] flex items-center gap-1"
                  >
                    <MessageSquare size={10} />{m}
                  </button>
                ))}
              </div>
            </div>

            {sendErr && (
              <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2">
                <p className="text-red-400 text-xs">{sendErr}</p>
              </div>
            )}

            <Button
              onClick={sendMessage}
              loading={sending}
              disabled={!message.trim() || !selectedTarget}
              fullWidth
              className={sendOk ? 'bg-green-500 hover:bg-green-500 text-black' : ''}
            >
              {sendOk ? (
                <><Check size={14} strokeWidth={3} />Enviado</>
              ) : (
                <><Send size={14} />Enviar mensaje</>
              )}
            </Button>
          </div>
        )}
      </Modal>
    </>
  )
}
