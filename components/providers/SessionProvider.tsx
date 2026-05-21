'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAppStore } from '@/store/appStore'
import { getPendingSales, deleteSyncedSale } from '@/lib/offline/db'
import type { User } from '@/types'

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { setUser, setIsOnline, setPendingSyncCount, tpvSession, setTpvSession, setSaleMode } = useAppStore()

  // Comprobar sesión TPV cada 15s: si el admin la revoca o expira → logout inmediato.
  // Dep: tpvSession?.id — se re-ejecuta cuando Zustand hidrata desde localStorage
  // (evita el race condition donde el efecto corría antes de que el estado estuviera listo).
  useEffect(() => {
    if (!tpvSession?.id) return

    const logout = () => {
      setTpvSession(null)
      setSaleMode(false)
      window.location.href = '/login'  // redirección dura, bypasea el router de Next.js
    }

    const checkSession = async () => {
      if (new Date(tpvSession.expiresAt) < new Date()) {
        logout()
        return
      }
      try {
        const res = await fetch(`/api/tpv-sessions/check?id=${tpvSession.id}`)
        if (!res.ok) return
        const { valid } = await res.json()
        if (!valid) logout()
      } catch {
        // Sin conexión: mantener sesión hasta que vuelva internet
      }
    }

    checkSession()
    const interval = setInterval(checkSession, 15_000)
    return () => clearInterval(interval)
  }, [tpvSession?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const supabase = createClient()

    const loadProfile = async () => {
      setSaleMode(false)
      setTpvSession(null)
      try {
        const res = await fetch('/api/me')
        if (!res.ok) return
        const { profile } = await res.json()
        if (profile) setUser(profile as User)
      } catch {
        // Sin conexión: mantener estado actual
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && !session.user.is_anonymous) {
        loadProfile()
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user && !session.user.is_anonymous) {
        loadProfile()
      } else if (!session?.user) {
        setUser(null)
      }
    })

    const handleOnline = async () => {
      setIsOnline(true)
      const pending = await getPendingSales()
      for (const offlineSale of pending) {
        try {
          const res = await fetch('/api/sales', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              saleData: { ...offlineSale.data, synced: true },
              items: offlineSale.items,
              stockDecrements: offlineSale.stockDecrements ?? [],
            }),
          })
          if (!res.ok) continue
          await deleteSyncedSale(offlineSale.id)
        } catch {
          // Venta permanece en pending para el siguiente intento
        }
      }
      const remaining = await getPendingSales()
      setPendingSyncCount(remaining.length)
    }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    setIsOnline(navigator.onLine)

    return () => {
      subscription.unsubscribe()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [setUser, setIsOnline, setPendingSyncCount, setSaleMode, setTpvSession])

  return <>{children}</>
}
