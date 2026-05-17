'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { savePendingSale, getPendingSales, deleteSyncedSale } from '@/lib/offline/db'
import { generateId } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import type { Sale, SaleFilters, CartItem, PaymentMethod, OfflineSale } from '@/types'

export function useSales() {
  const [loading, setLoading] = useState(false)
  // Previene doble envío: ref no causa re-render innecesario
  const submittingRef = useRef(false)
  const { user, activeEvent, isOnline, setPendingSyncCount, tpvSession } = useAppStore()

  const createSale = useCallback(async (
    items: CartItem[],
    paymentMethod: PaymentMethod,
    eventId: string | null,
    notes?: string
  ): Promise<{ success: boolean; saleId?: string; error?: string }> => {
    // Protección doble envío: ignorar si ya hay una petición en vuelo
    if (submittingRef.current) return { success: false, error: 'Venta en proceso, espera un momento.' }
    submittingRef.current = true
    setLoading(true)

    try {
      const total  = items.reduce((acc, i) => acc + i.unit_price * i.quantity, 0)
      const cost   = items.reduce((acc, i) => acc + i.unit_cost  * i.quantity, 0)
      const profit = total - cost

      const saleItems = items.map(item => ({
        product_id: item.type === 'product' ? (item.product?.id ?? undefined) : undefined,
        pack_id:    item.type === 'pack'    ? (item.pack?.id    ?? undefined) : undefined,
        quantity:   item.quantity,
        unit_price: item.unit_price,
        unit_cost:  item.unit_cost,
        subtotal:   item.unit_price * item.quantity,
        profit:     (item.unit_price - item.unit_cost) * item.quantity,
      }))

      const stockDecrements: { product_id: string; quantity: number; movement_type: string }[] = []
      for (const item of items) {
        if (item.type === 'product' && item.product) {
          stockDecrements.push({ product_id: item.product.id, quantity: item.quantity, movement_type: 'sale' })
        } else if (item.type === 'pack' && item.pack?.items) {
          for (const packItem of item.pack.items) {
            stockDecrements.push({
              product_id: packItem.product_id,
              quantity: packItem.quantity * item.quantity,
              movement_type: 'pack_sale',
            })
          }
        }
      }

      const sellerName = tpvSession?.sellerName ?? user?.name ?? null
      const sellerType: 'admin' | 'tpv' = tpvSession ? 'tpv' : 'admin'

      const saleData = {
        event_id:       eventId ?? activeEvent?.id ?? undefined,
        user_id:        user?.id ?? null,
        payment_method: paymentMethod,
        total_amount:   total,
        total_cost:     cost,
        profit,
        notes:          notes || null,
        seller_name:    sellerName,
        seller_type:    sellerType,
      }

      if (!isOnline) {
        // En offline el id del OfflineSale sirve como idempotency_key al sincronizar
        const offlineId = generateId()
        const offlineSale: OfflineSale = {
          id: offlineId,
          data: { ...saleData, synced: false },
          items: saleItems,
          stockDecrements,
          created_at: new Date().toISOString(),
          pending_sync: true,
        }
        await savePendingSale(offlineSale)
        const pending = await getPendingSales()
        setPendingSyncCount(pending.length)
        return { success: true, saleId: offlineId }
      }

      // Generar idempotency key único por intento de venta.
      // Si hay pérdida de conexión y se reintenta, el servidor detecta el duplicado y devuelve la venta original.
      const idempotencyKey = generateId()

      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleData, items: saleItems, stockDecrements, idempotencyKey }),
      })

      const contentType = res.headers.get('content-type') ?? ''
      const isJson = contentType.includes('application/json')

      if (!res.ok) {
        const err = isJson ? await res.json().catch(() => ({})) : {}
        const msg = (err as Record<string, string>).error ?? `Error HTTP ${res.status}`
        console.error('[useSales] Error creando venta:', msg)
        return { success: false, error: msg }
      }

      if (!isJson) {
        console.error('[useSales] API devolvió HTML en lugar de JSON (status', res.status, ')')
        return { success: false, error: 'Error del servidor. Verifica la configuración de Supabase.' }
      }

      const { sale } = await res.json()
      return { success: true, saleId: sale.id }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      console.error('[useSales] Excepción creando venta:', msg)
      return { success: false, error: msg }
    } finally {
      setLoading(false)
      submittingRef.current = false
    }
  }, [user, activeEvent, isOnline, setPendingSyncCount, tpvSession])

  const syncPendingSales = useCallback(async () => {
    const pending = await getPendingSales()
    if (pending.length === 0) return
    for (const offlineSale of pending) {
      try {
        // El id del OfflineSale actúa como idempotency_key:
        // si esta venta ya fue sincronizada (respuesta perdida), el servidor la detecta y no duplica.
        const res = await fetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            saleData:        { ...offlineSale.data, synced: true },
            items:           offlineSale.items,
            stockDecrements: offlineSale.stockDecrements ?? [],
            idempotencyKey:  offlineSale.id,
          }),
        })
        if (!res.ok) {
          console.warn('[useSales] Sync fallo para venta offline', offlineSale.id)
          continue
        }
        await deleteSyncedSale(offlineSale.id)
      } catch {
        // Mantener en pending; se reintentará en la próxima reconexión
      }
    }
    const remaining = await getPendingSales()
    setPendingSyncCount(remaining.length)
  }, [setPendingSyncCount])

  return { createSale, syncPendingSales, loading }
}

export function useSalesHistory(filters: SaleFilters = {}) {
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)

  const loadSales = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filters.date_from) params.set('date_from', filters.date_from)
    if (filters.date_to) params.set('date_to', filters.date_to)
    if (filters.event_id) params.set('event_id', filters.event_id)
    if (filters.user_id) params.set('user_id', filters.user_id)
    if (filters.payment_method) params.set('payment_method', filters.payment_method)

    try {
      const res = await fetch(`/api/sales?${params.toString()}`)
      if (res.ok) {
        const { sales: data, total: count } = await res.json()
        setSales(data ?? [])
        setTotal(count ?? 0)
      }
    } catch (e) {
      console.error('[useSales] Error cargando historial:', e)
    }
    setLoading(false)
  }, [filters.date_from, filters.date_to, filters.event_id, filters.user_id, filters.payment_method])

  useEffect(() => { loadSales() }, [loadSales])

  return { sales, loading, total, refetch: loadSales }
}
