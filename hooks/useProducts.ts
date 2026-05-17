'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cacheProducts, getCachedProducts } from '@/lib/offline/db'
import type { Product } from '@/types'

// Siempre usa la API — garantiza el mismo sort_order en admin y TPV
export function useProducts() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      if (!navigator.onLine) {
        const cached = await getCachedProducts()
        setProducts(cached)
        return
      }

      const res = await fetch('/api/products', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: Product[] = await res.json()
      setProducts(data)
      if (data.length > 0) cacheProducts(data).catch(() => {})
    } catch {
      const cached = await getCachedProducts()
      if (cached.length) {
        setProducts(cached)
      } else {
        setError('No se pudieron cargar los productos')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Actualización optimista: descuenta stock localmente sin esperar red
  const patchStocks = useCallback((decrements: { product_id: string; qty: number }[]) => {
    setProducts(prev => prev.map(p => {
      const d = decrements.find(x => x.product_id === p.id)
      return d ? { ...p, stock: Math.max(0, p.stock - d.qty) } : p
    }))
  }, [])

  useEffect(() => {
    load()
    const supabase = createClient()
    const channel = supabase
      .channel('products-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'products' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const updateStock = async (id: string, delta: number) => {
    const supabase = createClient()
    const product = products.find(p => p.id === id)
    if (!product) return
    const newStock = Math.max(0, product.stock + delta)
    const { error: err } = await supabase
      .from('products')
      .update({ stock: newStock, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (!err) {
      setProducts(prev => prev.map(p => p.id === id ? { ...p, stock: newStock } : p))
    }
  }

  return { products, loading, error, refetch: load, updateStock, patchStocks }
}

export function useAllProducts() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('products')
      .select('*, category:categories(*), variants:product_variants(*)')
      .order('sort_order', { ascending: true, nullsFirst: true })
      .order('name')
    setProducts(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const supabase = createClient()
    const channel = supabase
      .channel('all-products-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'products' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  return { products, loading, refetch: load }
}
