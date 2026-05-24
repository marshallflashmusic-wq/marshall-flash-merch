'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Bell, X, Check, CalendarDays } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAppStore } from '@/store/appStore'

interface HelpRequest {
  id: string
  seller_name: string
  message: string | null
  event_id: string | null
  status: 'pending' | 'resolved'
  from_role?: 'tpv' | 'admin'
  from_user_id?: string | null
  target_session_id?: string | null
  target_user_id?: string | null
  created_at: string
  event?: { id: string; name: string } | null
}

// AudioContext compartido; se inicializa en la primera interacción del usuario,
// porque los navegadores móviles (iOS especialmente) bloquean reproducir
// audio antes de un gesto.
let sharedAudioCtx: AudioContext | null = null
function ensureAudioCtx() {
  if (typeof window === 'undefined') return null
  if (sharedAudioCtx) return sharedAudioCtx
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    sharedAudioCtx = new AC()
    return sharedAudioCtx
  } catch { return null }
}

async function playBeep() {
  const ctx = sharedAudioCtx ?? ensureAudioCtx()
  if (!ctx) return
  try {
    if (ctx.state !== 'running') await ctx.resume()
  } catch { return }
  try {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(880, ctx.currentTime)
    o.frequency.setValueAtTime(660, ctx.currentTime + 0.18)
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.55)
  } catch { /* silencioso */ }
}

export default function HelpRequestsListener() {
  const { user, isSaleMode } = useAppStore()
  const isAdmin = !isSaleMode && (user?.role === 'admin' || user?.role === 'boss')
  const [toasts, setToasts] = useState<HelpRequest[]>([])
  const seenIds = useRef<Set<string>>(new Set())

  // Desbloquea audio en cada interacción (persistente) y al volver al primer plano.
  // iOS suspende el AudioContext al ir a background; visibilitychange lo reanuda.
  useEffect(() => {
    const unlock = () => {
      const ctx = ensureAudioCtx()
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') unlock()
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('touchstart', unlock)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchstart', unlock)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const resolve = useCallback(async (id: string) => {
    try {
      await fetch('/api/help-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'resolved' }),
      })
    } catch { /* silencioso */ }
    dismiss(id)
  }, [dismiss])

  // Carga inicial: avisos pendientes del TPV (todos) + mensajes dirigidos a este admin/boss
  useEffect(() => {
    if (!isAdmin || !user?.id) return
    let cancelled = false
    fetch(`/api/help-requests?status=pending&inbox_user=${user.id}`).then(r => r.json()).then(j => {
      if (cancelled) return
      const reqs: HelpRequest[] = j.requests ?? []
      if (reqs.length > 0) {
        reqs.forEach(r => seenIds.current.add(r.id))
        setToasts(reqs.slice(0, 5))
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [isAdmin, user?.id])

  // Realtime: TPV → admin/boss + mensajes de otros admin/boss dirigidos a este user
  useEffect(() => {
    if (!isAdmin || !user?.id) return
    const supabase = createClient()
    const channel = supabase
      .channel('help_requests_admin_toast_' + user.id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'help_requests' },
        (payload) => {
          const row = payload.new as HelpRequest
          // Ignorar lo que envió el propio user
          if (row.from_user_id && row.from_user_id === user.id) return
          // TPV → admin/boss: siempre nos interesa (a no ser que sea dirigido a otro user)
          if (row.from_role === 'tpv') {
            if (row.target_user_id && row.target_user_id !== user.id) return
          } else {
            // admin/boss → ?: solo si va dirigido a este user
            if (row.target_user_id !== user.id) return
          }
          if (seenIds.current.has(row.id)) return
          seenIds.current.add(row.id)
          setToasts(prev => [row, ...prev].slice(0, 5))
          playBeep()
          if (navigator.vibrate) navigator.vibrate([180, 80, 180])
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [isAdmin, user?.id])

  if (!isAdmin || toasts.length === 0) return null

  return (
    <div className="fixed top-4 left-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="pointer-events-auto bg-amber-500 text-black rounded-2xl shadow-2xl border-2 border-amber-300 px-3 py-3 flex items-start gap-3"
          style={{ boxShadow: '0 10px 40px -5px rgba(245, 158, 11, 0.5)' }}
        >
          <div className="w-9 h-9 rounded-xl bg-black/15 flex items-center justify-center shrink-0">
            <Bell size={18} strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm leading-tight">
              {t.seller_name} necesita ayuda
            </p>
            <p className="text-xs leading-snug mt-0.5">
              {t.message ?? 'Acude al puesto de merchan'}
            </p>
            {t.event && (
              <div className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold bg-black/15 px-1.5 py-0.5 rounded-full">
                <CalendarDays size={9} />{t.event.name}
              </div>
            )}
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => resolve(t.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/85 text-amber-300 text-xs font-bold active:scale-95 transition-transform"
              >
                <Check size={12} strokeWidth={3} />
                Atendido
              </button>
              <Link
                href="/help-requests"
                onClick={() => dismiss(t.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/10 text-black text-xs font-semibold active:scale-95 transition-transform"
              >
                Ver todos
              </Link>
            </div>
          </div>
          <button onClick={() => dismiss(t.id)} className="shrink-0 p-1 -mt-1 -mr-1">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
