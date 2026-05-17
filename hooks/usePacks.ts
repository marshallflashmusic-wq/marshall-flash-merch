'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Pack, PackItem } from '@/types'

export function calcAvailableStock(items: PackItem[]): number {
  if (!items || items.length === 0) return 0
  return Math.min(
    ...items.map(i => Math.floor((i.product?.stock ?? 0) / i.quantity))
  )
}

export function usePacks() {
  const [packs, setPacks] = useState<Pack[]>([])
  const [loading, setLoading] = useState(true)

  const loadPacks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/packs')
      if (!res.ok) return
      const { packs: data } = await res.json()
      const activePacks = (data ?? [])
        .filter((p: Pack) => p.active)
        .map((p: Pack) => ({
          ...p,
          available_stock: calcAvailableStock(p.items ?? []),
        }))
      setPacks(activePacks)
    } catch (e) {
      console.error('[usePacks]', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPacks()
    const supabase = createClient()
    const channel = supabase
      .channel('packs-products-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'products' }, () => loadPacks())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadPacks])

  return { packs, loading, refetch: loadPacks }
}
