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

    const loadProfile = async (userId: string, email?: string) => {
      const name = email ? email.split('@')[0] : 'Admin'

      const buildAdmin = (base?: Partial<User>): User => ({
        id: userId,
        email: email ?? '',
        name,
        active: true,
        created_at: new Date().toISOString(),
        ...base,
        role: 'admin', // siempre admin, después del spread
      })

      // Admin logueado con Supabase → nunca en modo venta
      setSaleMode(false)
      setTpvSession(null)

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (data) {
        setUser(buildAdmin(data as Partial<User>))
        if ((data as User).role !== 'admin') {
          await supabase.from('profiles').update({ role: 'admin' }).eq('id', userId)
        }
        return
      }

      if (error?.code === 'PGRST116') {
        const { data: created } = await supabase
          .from('profiles')
          .upsert({ id: userId, email: email ?? '', name, role: 'admin', active: true })
          .select('*')
          .single()
        setUser(created ? buildAdmin(created as Partial<User>) : buildAdmin())
      } else {
        // Cualquier otro error — construir usuario mínimo con rol admin
        setUser(buildAdmin())
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && !session.user.is_anonymous) {
        loadProfile(session.user.id, session.user.email ?? '')
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user && !session.user.is_anonymous) {
        loadProfile(session.user.id, session.user.email ?? '')
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
