'use client'
import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAppStore } from '@/store/appStore'
import { getPendingSales, deleteSyncedSale } from '@/lib/offline/db'
import type { User } from '@/types'

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setIsOnline, setPendingSyncCount } = useAppStore()

  useEffect(() => {
    const supabase = createClient()

    const loadProfile = async (userId: string, email?: string) => {
      const name = email ? email.split('@')[0] : 'Admin'

      // El acceso con contraseña ES el acceso admin — forzar role admin en estado local
      const buildAdmin = (base?: Partial<User>): User => ({
        id: userId,
        email: email ?? '',
        name,
        role: 'admin',
        active: true,
        created_at: new Date().toISOString(),
        ...base,
      })

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (data) {
        // Siempre admin en local; si en DB no lo es, intentar actualizar
        setUser(buildAdmin(data as Partial<User>))
        if ((data as User).role !== 'admin') {
          await supabase.from('profiles').update({ role: 'admin' }).eq('id', userId)
        }
        return
      }

      if (error?.code === 'PGRST116') {
        // No existe perfil — intentar crearlo
        const { data: created } = await supabase
          .from('profiles')
          .upsert({ id: userId, email: email ?? '', name, role: 'admin', active: true })
          .select('*')
          .single()
        setUser(created ? buildAdmin(created as Partial<User>) : buildAdmin())
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
  }, [setUser, setIsOnline, setPendingSyncCount])

  return <>{children}</>
}
