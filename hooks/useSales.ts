'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { savePendingSale, getPendingSales, deleteSyncedSale } from '@/lib/offline/db'
import { generateId } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { createClient } from '@/lib/supabase/client'
import type { Sale, SaleFilters, CartItem, PaymentMethod, OfflineSale, SaleChannel } from '@/types'

export function useSales() {
  const [loading, setLoading] = useState(false)
  // Previene doble envío: ref no causa re-render innecesario
  const submittingRef = useRef(false)
  const { user, activeEvent, isOnline, setPendingSyncCount, tpvSession } = useAppStore()

  const createSale = useCallback(async (
    items: CartItem[],
    paymentMethod: PaymentMethod,
    eventId: string | null,
    notes?: string,
    options?: {
      eventInventoryResolver?: (productId: string, variantId: string | null) => string | undefined
      quickSaleWarehouseId?: string
      saleChannel?: SaleChannel
      shippingCost?: number
      shippingActualCost?: number
    }
  ): Promise<{ success: boolean; saleId?: string; error?: string }> => {
    // Protección doble envío: ignorar si ya hay una petición en vuelo
    if (submittingRef.current) return { success: false, error: 'Venta en proceso, espera un momento.' }
    submittingRef.current = true
    setLoading(true)

    try {
      const itemsTotal = items.reduce((acc, i) => acc + i.unit_price * i.quantity, 0)
      const shippingCost = Math.max(0, Number(options?.shippingCost ?? 0) || 0)
      const shippingActualCost = Math.max(0, Number(options?.shippingActualCost ?? 0) || 0)
      // Total facturado al cliente = artículos + envío pagado
      const total = itemsTotal + shippingCost
      // Coste real para la empresa = coste de artículos + envío real
      // La diferencia (shippingCost - shippingActualCost) se traduce en profit.
      const itemsCost = items.reduce((acc, i) => acc + i.unit_cost * i.quantity, 0)
      const cost = itemsCost + shippingActualCost
      const profit = total - cost

      const resolver = options?.eventInventoryResolver
      const quickWh = options?.quickSaleWarehouseId

      // Resolver warehouse de origen por sale_item. Para ventas de evento el
      // server lo deriva desde event_inventory.warehouse_id. Para ventas
      // rápidas usamos item.warehouse_id (almacén elegido en el carrito por
      // línea); si no hay, fallback a quickWh (compat).
      const resolveWarehouseForItem = (item: CartItem): string | null => {
        if (item.type === 'product' && item.product) {
          const einvId = resolver?.(item.product.id, item.variant_id ?? null)
          if (einvId) return null
          return item.warehouse_id ?? quickWh ?? null
        }
        if (item.type === 'pack' && item.pack?.items) {
          const anyEinv = item.pack.items.some(pi => {
            const sizeSel = item.packSizeSelections?.find(s => s.product_id === pi.product_id)
            return !!resolver?.(pi.product_id, sizeSel?.variant_id ?? null)
          })
          if (anyEinv) return null
          return item.warehouse_id ?? quickWh ?? null
        }
        return null
      }

      const saleItems = items.map(item => ({
        product_id: item.type === 'product' ? (item.product?.id ?? undefined) : undefined,
        pack_id:    item.type === 'pack'    ? (item.pack?.id    ?? undefined) : undefined,
        quantity:   item.quantity,
        unit_price: item.unit_price,
        unit_cost:  item.unit_cost,
        subtotal:   item.unit_price * item.quantity,
        profit:     (item.unit_price - item.unit_cost) * item.quantity,
        warehouse_id: resolveWarehouseForItem(item),
      }))
      const stockDecrements: {
        product_id: string
        quantity: number
        movement_type: string
        variant_id?: string
        event_inventory_id?: string
        warehouse_id?: string
      }[] = []
      for (const item of items) {
        // Almacén efectivo para esta línea: el elegido en el carrito si lo hay,
        // si no fallback al global de la venta rápida.
        const itemQuickWh = item.warehouse_id ?? quickWh
        if (item.type === 'product' && item.product) {
          const einvId = resolver?.(item.product.id, item.variant_id ?? null)
          stockDecrements.push({
            product_id: item.product.id,
            quantity: item.quantity,
            movement_type: 'sale',
            variant_id: item.variant_id,
            event_inventory_id: einvId,
            warehouse_id: !einvId && itemQuickWh ? itemQuickWh : undefined,
          })
        } else if (item.type === 'pack' && item.pack?.items) {
          for (const packItem of item.pack.items) {
            const sizeSelection = item.packSizeSelections?.find(s => s.product_id === packItem.product_id)
            const variantId = sizeSelection?.variant_id
            const einvId = resolver?.(packItem.product_id, variantId ?? null)
            stockDecrements.push({
              product_id: packItem.product_id,
              quantity: packItem.quantity * item.quantity,
              movement_type: 'pack_sale',
              variant_id: variantId,
              event_inventory_id: einvId,
              warehouse_id: !einvId && itemQuickWh ? itemQuickWh : undefined,
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
        sale_channel:        options?.saleChannel ?? 'pos',
        shipping_cost:       shippingCost,
        shipping_actual_cost: shippingActualCost,
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
    if (filters.amount_min != null) params.set('amount_min', String(filters.amount_min))
    if (filters.amount_max != null) params.set('amount_max', String(filters.amount_max))
    if (filters.sale_channel) params.set('sale_channel', filters.sale_channel)

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
  }, [filters.date_from, filters.date_to, filters.event_id, filters.user_id, filters.payment_method, filters.amount_min, filters.amount_max, filters.sale_channel])

  useEffect(() => { loadSales() }, [loadSales])

  // Realtime: cuando hay filtro por evento, actualizar al instante al crear/borrar ventas
  useEffect(() => {
    if (!filters.event_id) return
    const supabase = createClient()
    const channel = supabase
      .channel(`sales-event-rt-${filters.event_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `event_id=eq.${filters.event_id}` }, loadSales)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [filters.event_id, loadSales])

  return { sales, loading, total, refetch: loadSales }
}
