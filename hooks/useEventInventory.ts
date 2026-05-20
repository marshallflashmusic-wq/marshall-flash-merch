'use client'
import { useState, useEffect, useCallback } from 'react'
import type { EventInventoryItem } from '@/types'

export function useEventInventory(eventId: string | null) {
  const [inventory, setInventory] = useState<EventInventoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchInv = useCallback(async () => {
    if (!eventId) {
      setInventory([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/events/${eventId}/inventory`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { inventory: data } = await res.json()
      setInventory(data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => { fetchInv() }, [fetchInv])

  const adjust = useCallback(async (productId: string, variantId: string | null, delta: number) => {
    if (!eventId) return { success: false, error: 'No event' }
    try {
      const res = await fetch(`/api/events/${eventId}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, variant_id: variantId, delta }),
      })
      const json = await res.json()
      if (!res.ok) return { success: false, error: json.error ?? 'Error' }
      await fetchInv()
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }, [eventId, fetchInv])

  return { inventory, loading, error, refetch: fetchInv, adjust }
}
