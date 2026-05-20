'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { calcAvailableStock } from '@/hooks/usePacks'
import type { Product, Pack, EventInventoryItem, ProductVariant } from '@/types'

// Devuelve productos y packs adaptados a un evento: product.stock y variant.stock
// reflejan únicamente el stock disponible para vender DENTRO del evento.
// Además expone un índice (product_id::variant_id) → event_inventory_id para que
// la venta envíe ese id al backend y descuente de event_inventory en vez de stock global.
export function useEventTpvCatalog(eventId: string | null) {
  const [rawProducts, setRawProducts] = useState<Product[]>([])
  const [rawPacks, setRawPacks] = useState<Pack[]>([])
  const [inventory, setInventory] = useState<EventInventoryItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!eventId) {
      setRawProducts([]); setRawPacks([]); setInventory([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // Usamos las APIs (service role) para evitar RLS en modo TPV anónimo.
      const [prodsRes, packsRes, invRes] = await Promise.all([
        fetch('/api/products', { cache: 'no-store' }).then(r => r.json()).catch(() => [] as Product[]),
        fetch('/api/packs', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ packs: [] })),
        fetch(`/api/events/${eventId}/inventory`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ inventory: [] })),
      ])

      // /api/products devuelve un array directo
      setRawProducts(Array.isArray(prodsRes) ? prodsRes : [])
      setRawPacks((packsRes?.packs ?? []).filter((p: Pack) => p.active))
      setInventory(invRes?.inventory ?? [])
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    load()
    if (!eventId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`event-tpv-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_inventory', filter: `event_id=eq.${eventId}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [eventId, load])

  // Mapas para acceso rápido
  const invByKey = useMemo(() => {
    const m = new Map<string, EventInventoryItem>()
    for (const it of inventory) m.set(`${it.product_id}::${it.variant_id ?? ''}`, it)
    return m
  }, [inventory])

  // Productos con stock patcheado al evento
  const products = useMemo<Product[]>(() => {
    const result: Product[] = []
    for (const p of rawProducts) {
      if (!p.active) continue
      const hasVariants = (p.variants ?? []).length > 0
      if (hasVariants) {
        // Cada variant.stock = quantity_remaining si hay fila; si no, 0
        const patchedVariants: ProductVariant[] = (p.variants ?? []).map(v => {
          const inv = invByKey.get(`${p.id}::${v.id}`)
          const remaining = inv ? Math.max(0, inv.quantity_remaining ?? (inv.quantity_assigned - inv.quantity_sold)) : 0
          return { ...v, stock: remaining }
        })
        const totalStock = patchedVariants.reduce((s, v) => s + v.stock, 0)
        // Mostramos el producto solo si tiene al menos algo asignado en alguna variant (en el evento)
        const hasAnyAssigned = (p.variants ?? []).some(v => invByKey.has(`${p.id}::${v.id}`))
        if (hasAnyAssigned) {
          result.push({ ...p, stock: totalStock, variants: patchedVariants })
        }
      } else {
        const inv = invByKey.get(`${p.id}::`)
        if (inv) {
          const remaining = Math.max(0, inv.quantity_remaining ?? (inv.quantity_assigned - inv.quantity_sold))
          result.push({ ...p, stock: remaining })
        }
      }
    }
    return result
  }, [rawProducts, invByKey])

  // Packs con available_stock recalculado contra el catálogo del evento
  const packs = useMemo<Pack[]>(() => {
    // Index productos del evento por id
    const productsById = new Map<string, Product>()
    for (const p of products) productsById.set(p.id, p)

    return rawPacks.map(pack => {
      const itemsAdapted = (pack.items ?? []).map(it => ({
        ...it,
        product: it.product ? productsById.get(it.product.id) ?? { ...it.product, stock: 0 } : it.product,
      }))
      return { ...pack, items: itemsAdapted, available_stock: calcAvailableStock(itemsAdapted) }
    }).filter(p => {
      // Solo mostrar packs cuyos componentes están todos asignados en el evento
      return (p.items ?? []).every(it => {
        if (!it.product) return false
        const hasVariants = (it.product.variants ?? []).length > 0
        if (hasVariants) {
          // textil: alguno asignado en cualquier talla
          return (it.product.variants ?? []).some(v => invByKey.has(`${it.product!.id}::${v.id}`))
        }
        return invByKey.has(`${it.product.id}::`)
      })
    })
  }, [rawPacks, products, invByKey])

  // Helper: obtener event_inventory_id por (product_id, variant_id)
  const getEventInventoryId = useCallback((productId: string, variantId: string | null): string | undefined => {
    return invByKey.get(`${productId}::${variantId ?? ''}`)?.id
  }, [invByKey])

  // Patch optimista local del stock vendido (reduce variants y stock total)
  const patchStocks = useCallback((decrements: { product_id: string; variant_id?: string; qty: number }[]) => {
    setInventory(prev => prev.map(it => {
      const match = decrements.find(d => d.product_id === it.product_id && (d.variant_id ?? null) === (it.variant_id ?? null))
      if (!match) return it
      const newSold = it.quantity_sold + match.qty
      return { ...it, quantity_sold: newSold, quantity_remaining: it.quantity_assigned - newSold }
    }))
  }, [])

  return { products, packs, loading, refetch: load, getEventInventoryId, patchStocks }
}
