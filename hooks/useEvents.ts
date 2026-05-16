'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cacheEvents, getCachedEvents } from '@/lib/offline/db'
import type { Event } from '@/types'

export function useEvents() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      if (!navigator.onLine) {
        const cached = await getCachedEvents()
        setEvents(cached as Event[])
        setLoading(false)
        return
      }
      const supabase = createClient()
      const { data } = await supabase
        .from('events')
        .select('*')
        .order('date', { ascending: false })
      setEvents(data ?? [])
      if (data) cacheEvents(data).catch(() => {})
    } catch {
      const cached = await getCachedEvents()
      setEvents(cached as Event[])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { events, loading, refetch: fetch }
}
