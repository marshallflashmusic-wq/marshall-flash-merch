'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Pack } from '@/types'

export function usePacks() {
  const [packs, setPacks] = useState<Pack[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('packs')
      .select(`
        *,
        items:pack_items(
          *,
          product:products(*)
        )
      `)
      .eq('active', true)
      .order('name')
    setPacks(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { packs, loading, refetch: fetch }
}
