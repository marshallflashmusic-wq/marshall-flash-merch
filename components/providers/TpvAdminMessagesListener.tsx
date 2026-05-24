'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Bell, X, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAppStore } from '@/store/appStore'

interface AdminMessage {
  id: string
  seller_name: string
  message: string | null
  from_role?: 'tpv' | 'admin'
  target_session_id: string | null
  target_user_id?: string | null
  created_at: string
}

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

async function playPing() {
  const ctx = sharedAudioCtx ?? ensureAudioCtx()
  if (!ctx) return
  try {
    if (ctx.state !== 'running') await ctx.resume()
  } catch { return }
  try {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'triangle'
    o.frequency.setValueAtTime(660, ctx.currentTime)
    o.frequency.setValueAtTime(880, ctx.currentTime + 0.12)
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.55)
  } catch { /* silencioso */ }
}

export default function TpvAdminMessagesListener() {
  const { isSaleMode, tpvSession } = useAppStore()
  const sessionId = tpvSession?.id ?? null
  const [toasts, setToasts] = useState<AdminMessage[]>([])
  const [confirming, setConfirming] = useState<Set<string>>(new Set())
  const seenIds = useRef<Set<string>>(new Set())

  // Desbloqueo de audio: persistente (no once) para que cada toque reactive el contexto.
  // Visibilitychange para cuando el usuario vuelve desde otra app.
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
    setConfirming(prev => { const s = new Set(prev); s.delete(id); return s })
  }, [])

  const resolve = useCallback(async (id: string) => {
    setConfirming(prev => new Set([...prev, id]))
    try {
      await fetch('/api/help-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'resolved' }),
      })
    } catch { /* silencioso */ }
    setTimeout(() => dismiss(id), 600)
  }, [dismiss])

  // Carga inicial
  useEffect(() => {
    if (!isSaleMode || !sessionId) return
    let cancelled = false
    fetch(`/api/help-requests?status=pending&from_role=admin&for_session=${sessionId}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        const reqs: AdminMessage[] = j.requests ?? []
        if (reqs.length > 0) {
          reqs.forEach(r => seenIds.current.add(r.id))
          setToasts(reqs.slice(0, 5))
        }
      }).catch(() => {})
    return () => { cancelled = true }
  }, [isSaleMode, sessionId])

  // Realtime: nuevos mensajes del admin → este TPV
  useEffect(() => {
    if (!isSaleMode || !sessionId) return
    const supabase = createClient()
    const channel = supabase
      .channel('admin_to_tpv_' + sessionId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'help_requests' },
        (payload) => {
          const row = payload.new as AdminMessage
          if (row.from_role !== 'admin') return
          // Si el mensaje va dirigido a un usuario admin/boss, no es para este TPV
          if (row.target_user_id) return
          if (row.target_session_id && row.target_session_id !== sessionId) return
          if (seenIds.current.has(row.id)) return
          seenIds.current.add(row.id)
          setToasts(prev => [row, ...prev].slice(0, 5))
          playPing()
          if (navigator.vibrate) navigator.vibrate([120, 60, 120])
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [isSaleMode, sessionId])

  if (!isSaleMode || toasts.length === 0) return null

  return (
    <div className="fixed top-4 left-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => {
        const isConfirming = confirming.has(t.id)
        return (
          <div
            key={t.id}
            className="pointer-events-auto bg-blue-500 text-white rounded-2xl shadow-2xl border-2 border-blue-300 px-3 py-3 flex flex-col gap-2"
            style={{ boxShadow: '0 10px 40px -5px rgba(59, 130, 246, 0.5)' }}
          >
            {/* Header row */}
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-black/20 flex items-center justify-center shrink-0">
                <Bell size={18} strokeWidth={2.5} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm leading-tight">Aviso del admin</p>
                <p className="text-sm leading-snug mt-0.5">{t.message ?? '...'}</p>
              </div>
              <button onClick={() => dismiss(t.id)} className="shrink-0 p-1 -mt-1 -mr-1">
                <X size={14} />
              </button>
            </div>
            {/* Recibido button centrado */}
            <div className="flex justify-center">
              <button
                onClick={() => resolve(t.id)}
                className={`flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-black active:scale-95 transition-all ${
                  isConfirming
                    ? 'bg-white text-blue-600'
                    : 'bg-black/80 text-white'
                }`}
              >
                <Check size={14} strokeWidth={3} />
                Recibido
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
