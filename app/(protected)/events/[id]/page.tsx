'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ChevronLeft, Search, Package, Minus, Plus, AlertTriangle,
  CalendarDays, MapPin, Building2, Lock, Play, CheckCircle2, X, Check,
  Package2, Clock, Receipt, Banknote, CreditCard, Smartphone, Wallet,
} from 'lucide-react'
import { useAllProducts } from '@/hooks/useProducts'
import { usePacks } from '@/hooks/usePacks'
import { useEventInventory } from '@/hooks/useEventInventory'
import { useSalesHistory } from '@/hooks/useSales'
import { useAppStore } from '@/store/appStore'
import { formatDate, formatCurrency, formatDateTime } from '@/lib/utils'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import PackCollage from '@/components/ui/PackCollage'
import SwipeableTabs from '@/components/ui/SwipeableTabs'
import type { Event, EventInventoryItem, Product, ProductVariant, Pack, Sale, PaymentMethod } from '@/types'

const SIZES_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Única']

export default function EventDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const eventId = params?.id
  const { user } = useAppStore()
  const { products, loading: loadingProducts } = useAllProducts()
  const { packs, loading: loadingPacks } = usePacks()
  const { inventory, loading: loadingInv, refetch: refetchInv, adjust } = useEventInventory(eventId ?? null)

  const [event, setEvent] = useState<Event | null>(null)
  const [tab, setTab] = useState<'products' | 'packs' | 'sales'>('products')
  const eventSales = useSalesHistory(eventId ? { event_id: eventId } : {})
  const [search, setSearch] = useState('')
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({})
  const [errorMap, setErrorMap] = useState<Record<string, string>>({})
  const [packSavingMap, setPackSavingMap] = useState<Record<string, boolean>>({})
  const [packErrorMap, setPackErrorMap] = useState<Record<string, string>>({})
  const [closeOpen, setCloseOpen] = useState(false)
  const [closeResult, setCloseResult] = useState<{ units_returned: number; units_sold: number; lines: number } | null>(null)
  const [closeLoading, setCloseLoading] = useState(false)
  const [closeError, setCloseError] = useState('')

  useEffect(() => {
    if (!eventId) return
    fetch('/api/events', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => setEvent((j.events ?? []).find((e: Event) => e.id === eventId) ?? null))
      .catch(() => {})
  }, [eventId])

  // Mapa rápido para buscar event_inventory por (product_id, variant_id)
  const invIndex = useMemo(() => {
    const map = new Map<string, EventInventoryItem>()
    for (const it of inventory) {
      map.set(`${it.product_id}::${it.variant_id ?? ''}`, it)
    }
    return map
  }, [inventory])

  const getInv = (productId: string, variantId: string | null) =>
    invIndex.get(`${productId}::${variantId ?? ''}`)

  const handleAdjust = async (productId: string, variantId: string | null, delta: number) => {
    const key = `${productId}::${variantId ?? ''}`
    setSavingMap(m => ({ ...m, [key]: true }))
    setErrorMap(m => ({ ...m, [key]: '' }))
    const res = await adjust(productId, variantId, delta)
    if (!res.success) {
      setErrorMap(m => ({ ...m, [key]: res.error ?? 'Error' }))
      setTimeout(() => setErrorMap(m => ({ ...m, [key]: '' })), 3000)
    }
    setSavingMap(m => ({ ...m, [key]: false }))
  }

  const filteredProducts = useMemo(() => {
    return products.filter(p => p.active).filter(p =>
      !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku ?? '').toLowerCase().includes(search.toLowerCase())
    )
  }, [products, search])

  // Resumen
  const summary = useMemo(() => {
    const totalAssigned = inventory.reduce((s, i) => s + i.quantity_assigned, 0)
    const totalSold = inventory.reduce((s, i) => s + i.quantity_sold, 0)
    const totalRemaining = inventory.reduce((s, i) => s + i.quantity_remaining, 0)
    return { totalAssigned, totalSold, totalRemaining }
  }, [inventory])

  const handleClose = async () => {
    if (!eventId) return
    setCloseLoading(true); setCloseError('')
    try {
      const res = await fetch(`/api/events/${eventId}/close`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error')
      setCloseResult(json.result)
      await refetchInv()
      setEvent(e => e ? { ...e, status: 'closed', closed_at: new Date().toISOString() } : e)
    } catch (err: unknown) {
      setCloseError(err instanceof Error ? err.message : String(err))
    } finally {
      setCloseLoading(false)
    }
  }

  const handleActivate = async () => {
    if (!eventId) return
    await fetch('/api/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: eventId, status: 'active' }),
    })
    setEvent(e => e ? { ...e, status: 'active' } : e)
  }

  // Calcular cuántos packs hay "asignados de hecho" al evento.
  // Aprox: para cada pack, asignados = min(quantity_assigned / qty) entre sus componentes no-textil.
  const packStatus = useMemo(() => {
    const map = new Map<string, { assigned: number; sold: number; hasTextil: boolean }>()
    for (const pack of packs) {
      const items = pack.items ?? []
      if (items.length === 0) { map.set(pack.id, { assigned: 0, sold: 0, hasTextil: false }); continue }
      const hasTextil = items.some(i => (i.product?.variants ?? []).length > 0)
      let assigned = Infinity
      let sold = Infinity
      for (const it of items) {
        const inv = invIndex.get(`${it.product_id}::`)
        const a = inv ? Math.floor(inv.quantity_assigned / it.quantity) : 0
        const s = inv ? Math.floor(inv.quantity_sold / it.quantity) : 0
        if (a < assigned) assigned = a
        if (s < sold) sold = s
      }
      if (!isFinite(assigned)) assigned = 0
      if (!isFinite(sold)) sold = 0
      map.set(pack.id, { assigned, sold, hasTextil })
    }
    return map
  }, [packs, invIndex])

  const handlePackAdjust = async (pack: Pack, delta: number) => {
    if (!eventId) return
    const key = pack.id
    setPackSavingMap(m => ({ ...m, [key]: true }))
    setPackErrorMap(m => ({ ...m, [key]: '' }))
    try {
      const res = await fetch(`/api/events/${eventId}/inventory/pack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack_id: pack.id, delta }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error')
      await refetchInv()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setPackErrorMap(m => ({ ...m, [key]: msg }))
      setTimeout(() => setPackErrorMap(m => ({ ...m, [key]: '' })), 4000)
    } finally {
      setPackSavingMap(m => ({ ...m, [key]: false }))
    }
  }

  if (!event) {
    return (
      <div className="h-full flex items-center justify-center">
        {loadingInv || loadingProducts
          ? <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          : <p className="text-zinc-500 text-sm">Evento no encontrado</p>}
      </div>
    )
  }

  const isClosed = event.status === 'closed' || event.status === 'cancelled'
  const isAdmin = user?.role === 'admin'

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <div className="bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800 px-3 py-3 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => router.push('/events')} className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800">
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold truncate">{event.name}</p>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-500 flex-wrap">
              <span className="flex items-center gap-0.5"><MapPin size={11} />{event.city}</span>
              <span className="flex items-center gap-0.5"><Building2 size={11} />{event.venue}</span>
              <span className="flex items-center gap-0.5"><CalendarDays size={11} />{formatDate(event.date)}</span>
              <StatusChip status={event.status} />
            </div>
          </div>
          {/* Guardar = volver al listado. Las asignaciones se guardan al instante con cada +/-, no hace falta confirmación. */}
          <button
            onClick={() => router.push('/events')}
            className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 text-black text-xs font-bold active:scale-95 transition-transform"
          >
            <Check size={14} strokeWidth={3} />Guardar
          </button>
        </div>

        {/* Resumen */}
        <div className="grid grid-cols-3 gap-2 mt-2">
          <SummaryCell label="Asignado" value={summary.totalAssigned} />
          <SummaryCell label="Vendido" value={summary.totalSold} accent="text-green-400" />
          <SummaryCell label="Restante" value={summary.totalRemaining} accent="text-amber-400" />
        </div>

        {/* Acciones */}
        {isAdmin && !isClosed && (
          <div className="flex gap-2 mt-3">
            {event.status === 'upcoming' && (
              <Button onClick={handleActivate} variant="outline" className="flex-1">
                <Play size={14} />Activar
              </Button>
            )}
            {event.status === 'active' && (
              <Button onClick={() => { setCloseError(''); setCloseResult(null); setCloseOpen(true) }} variant="outline" className="flex-1 text-amber-400 border-amber-900 hover:bg-amber-950/30">
                <Lock size={14} />Cerrar evento
              </Button>
            )}
          </div>
        )}
      </div>

      <SwipeableTabs
        activeKey={tab}
        onChange={k => setTab(k as 'products' | 'packs' | 'sales')}
        panelClassName="px-4 pb-4 space-y-2"
        tabs={[
          {
            key: 'products',
            label: <span className="flex items-center justify-center gap-1.5"><Package size={15} />Artículos</span>,
            content: (
              <>
                <div className="relative mt-3 mb-2">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text" placeholder="Buscar producto..."
                    value={search} onChange={e => setSearch(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-9 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 text-sm"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">
                      <X size={16} />
                    </button>
                  )}
                </div>
                {loadingProducts ? (
                  <div className="flex justify-center py-10"><div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : filteredProducts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
                    <Package size={36} /><p className="mt-2 text-sm">No hay productos</p>
                  </div>
                ) : (
                  filteredProducts.map(product => {
                    const hasVariants = (product.variants ?? []).length > 0
                    return hasVariants ? (
                      <VariantProductRow
                        key={product.id}
                        product={product}
                        getInv={getInv}
                        savingMap={savingMap}
                        errorMap={errorMap}
                        onAdjust={handleAdjust}
                        disabled={isClosed}
                      />
                    ) : (
                      <SimpleProductRow
                        key={product.id}
                        product={product}
                        inv={getInv(product.id, null)}
                        saving={!!savingMap[`${product.id}::`]}
                        error={errorMap[`${product.id}::`] ?? ''}
                        onAdjust={(delta) => handleAdjust(product.id, null, delta)}
                        disabled={isClosed}
                      />
                    )
                  })
                )}
              </>
            ),
          },
          {
            key: 'packs',
            label: <span className="flex items-center justify-center gap-1.5"><Package2 size={15} />Packs{packs.length > 0 && <span className="bg-white/10 text-white text-xs px-1.5 py-0.5 rounded-full">{packs.length}</span>}</span>,
            content: (
              <div className="mt-3">
                {loadingPacks ? (
                  <div className="flex justify-center py-10"><div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : packs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
                    <Package2 size={36} /><p className="mt-2 text-sm">No hay packs configurados</p>
                    <p className="mt-1 text-xs text-zinc-700 text-center">Crea packs en Configuración → Packs</p>
                  </div>
                ) : (
                  packs.map(pack => {
                    const st = packStatus.get(pack.id) ?? { assigned: 0, sold: 0, hasTextil: false }
                    return (
                      <PackEventRow
                        key={pack.id}
                        pack={pack}
                        assigned={st.assigned}
                        sold={st.sold}
                        hasTextil={st.hasTextil}
                        saving={!!packSavingMap[pack.id]}
                        error={packErrorMap[pack.id] ?? ''}
                        onAdjust={(delta) => handlePackAdjust(pack, delta)}
                        disabled={isClosed}
                      />
                    )
                  })
                )}
              </div>
            ),
          },
          {
            key: 'sales',
            label: <span className="flex items-center justify-center gap-1.5"><Receipt size={15} />Ventas{eventSales.total > 0 && <span className="bg-white/10 text-white text-xs px-1.5 py-0.5 rounded-full">{eventSales.total}</span>}</span>,
            content: <EventSalesPanel sales={eventSales.sales} loading={eventSales.loading} />,
          },
        ]}
      />

      {/* Modal cerrar evento */}
      <Modal open={closeOpen} onClose={() => setCloseOpen(false)} title="Cerrar evento" size="md">
        {closeResult ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-700 flex items-center justify-center">
                <CheckCircle2 size={28} className="text-green-500" />
              </div>
              <p className="text-white font-bold">Evento cerrado correctamente</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <SummaryCell label="Líneas" value={closeResult.lines} />
              <SummaryCell label="Vendidas" value={closeResult.units_sold} accent="text-green-400" />
              <SummaryCell label="Devueltas" value={closeResult.units_returned} accent="text-amber-400" />
            </div>
            <Button fullWidth onClick={() => { setCloseOpen(false); router.push('/events') }}>Volver al listado</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-2 bg-amber-950/40 border border-amber-900 rounded-xl p-3">
              <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-amber-300 text-sm">
                Al cerrar, las <span className="font-bold">{summary.totalRemaining}</span> unidades NO vendidas se devolverán automáticamente al stock global. Las ventas registradas quedan ligadas al evento para histórico.
              </p>
            </div>
            {closeError && <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2"><p className="text-red-400 text-sm">{closeError}</p></div>}
            <div className="flex gap-3">
              <Button variant="outline" fullWidth onClick={() => setCloseOpen(false)} disabled={closeLoading}>Cancelar</Button>
              <Button fullWidth onClick={handleClose} loading={closeLoading}>Confirmar cierre</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function StatusChip({ status }: { status: Event['status'] }) {
  if (status === 'active') return <Badge variant="success">Activo</Badge>
  if (status === 'closed') return <Badge variant="outline">Cerrado</Badge>
  if (status === 'cancelled') return <Badge variant="danger">Cancelado</Badge>
  return <Badge variant="warning">Próximo</Badge>
}

const paymentIconMap: Record<PaymentMethod, React.ElementType> = {
  efectivo: Banknote, bizum: Smartphone, tarjeta: CreditCard, paypal: Wallet, mixto: Wallet,
}

function EventSalesPanel({ sales, loading }: { sales: Sale[]; loading: boolean }) {
  const totalRevenue = sales.reduce((a, s) => a + s.total_amount, 0)
  const totalProfit = sales.reduce((a, s) => a + s.profit, 0)
  const totalItems = sales.reduce((a, s) => a + (s.items?.reduce((b, i) => b + i.quantity, 0) ?? 0), 0)

  if (loading) {
    return <div className="flex justify-center py-10 mt-3"><div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
  }
  if (sales.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-600 mt-3">
        <Clock size={36} /><p className="mt-2 text-sm">Sin ventas en este evento todavía</p>
      </div>
    )
  }
  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-2 py-1.5 text-center">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Ingresos</p>
          <p className="text-base font-black text-white leading-tight">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-2 py-1.5 text-center">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Beneficio</p>
          <p className={`text-base font-black leading-tight ${totalProfit < 0 ? 'text-red-400' : 'text-green-400'}`}>{formatCurrency(totalProfit)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-2 py-1.5 text-center">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Unidades</p>
          <p className="text-base font-black text-amber-400 leading-tight">{totalItems}</p>
        </div>
      </div>
      {sales.map(sale => {
        const Icon = paymentIconMap[sale.payment_method] ?? Banknote
        return (
          <Card key={sale.id} padding="none">
            <div className="flex items-center gap-3 p-3">
              <div className="w-9 h-9 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0">
                <Icon size={16} className="text-zinc-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-white font-semibold text-sm">{formatCurrency(sale.total_amount)}</p>
                  {sale.seller_name && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      sale.seller_type === 'tpv' ? 'bg-blue-950/60 text-blue-400' : 'bg-zinc-800 text-zinc-400'
                    }`}>{sale.seller_name}</span>
                  )}
                </div>
                <p className="text-zinc-500 text-[11px]">{formatDateTime(sale.created_at)}</p>
                {sale.items && sale.items.length > 0 && (
                  <p className="text-zinc-600 text-[11px] truncate mt-0.5">
                    {sale.items.map(i => `${i.quantity}× ${i.product?.name ?? i.pack?.name ?? '?'}`).join(', ')}
                  </p>
                )}
              </div>
              <p className={`text-xs font-bold shrink-0 ${sale.profit < 0 ? 'text-red-400' : 'text-green-400'}`}>
                {sale.profit < 0 ? '' : '+'}{formatCurrency(sale.profit)}
              </p>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function PackEventRow({
  pack, assigned, sold, hasTextil, saving, error, onAdjust, disabled,
}: {
  pack: Pack
  assigned: number
  sold: number
  hasTextil: boolean
  saving: boolean
  error: string
  onAdjust: (delta: number) => void
  disabled: boolean
}) {
  const remaining = assigned - sold
  const blockedByTextil = hasTextil
  const blocked = disabled || blockedByTextil

  return (
    <Card padding="none">
      <div className="flex items-center gap-3 p-3">
        <div className="relative w-14 h-14 rounded-xl bg-zinc-800 overflow-hidden shrink-0">
          <PackCollage items={pack.items ?? []} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold truncate">{pack.name}</p>
          {pack.items && pack.items.length > 0 && (
            <p className="text-zinc-500 text-[11px] mt-0.5 truncate">
              {pack.items.map(i => `${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.product?.name ?? '?'}`).join(' · ')}
            </p>
          )}
          {blockedByTextil ? (
            <p className="text-amber-400 text-[11px] mt-0.5">Contiene tallas — asígnalas por talla</p>
          ) : (
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Asignado: <span className="text-amber-400 font-semibold">{assigned}</span>
              {sold > 0 && <> · Vendido: <span className="text-green-400">{sold}</span></>}
              {assigned > 0 && <> · Restante: <span className="text-white font-semibold">{remaining}</span></>}
            </p>
          )}
          {error && <p className="text-red-400 text-[11px] mt-0.5">{error}</p>}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            disabled={blocked || saving || remaining <= 0}
            onClick={() => onAdjust(-1)}
            className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center disabled:opacity-30 active:scale-95"
          ><Minus size={14} /></button>
          <span className={`w-10 text-center font-black text-sm ${assigned > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>{assigned}</span>
          <button
            disabled={blocked || saving}
            onClick={() => onAdjust(1)}
            className="w-8 h-8 rounded-lg bg-amber-500 text-black flex items-center justify-center disabled:opacity-30 active:scale-95"
          ><Plus size={14} strokeWidth={2.5} /></button>
        </div>
      </div>
    </Card>
  )
}

function SummaryCell({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-2 py-1.5 text-center">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-black ${accent ?? 'text-white'}`}>{value}</p>
    </div>
  )
}

function SimpleProductRow({
  product, inv, saving, error, onAdjust, disabled,
}: {
  product: Product
  inv?: EventInventoryItem
  saving: boolean
  error: string
  onAdjust: (delta: number) => void
  disabled: boolean
}) {
  const assigned = inv?.quantity_assigned ?? 0
  const sold = inv?.quantity_sold ?? 0
  const remaining = assigned - sold
  const globalLeft = product.stock

  return (
    <Card padding="none">
      <div className="flex items-center gap-3 p-3">
        <div className="relative w-12 h-12 rounded-xl bg-zinc-800 overflow-hidden shrink-0">
          {product.image_url
            ? <img src={product.image_url} alt={product.name} className="absolute inset-0 w-full h-full object-cover block" width={48} height={48} loading="lazy" />
            : <div className="w-full h-full flex items-center justify-center"><Package size={18} className="text-zinc-600" /></div>}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold truncate">{product.name}</p>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Global: <span className="text-white font-semibold">{globalLeft}</span>
            {sold > 0 && <> · Vendido: <span className="text-green-400">{sold}</span></>}
          </p>
          {error && <p className="text-red-400 text-[11px] mt-0.5">{error}</p>}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            disabled={disabled || saving || remaining <= 0}
            onClick={() => onAdjust(-1)}
            className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center disabled:opacity-30 active:scale-95"
          ><Minus size={14} /></button>
          <span className={`w-10 text-center font-black text-sm ${assigned > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>{assigned}</span>
          <button
            disabled={disabled || saving || globalLeft <= 0}
            onClick={() => onAdjust(1)}
            className="w-8 h-8 rounded-lg bg-amber-500 text-black flex items-center justify-center disabled:opacity-30 active:scale-95"
          ><Plus size={14} strokeWidth={2.5} /></button>
        </div>
      </div>
    </Card>
  )
}

function VariantProductRow({
  product, getInv, savingMap, errorMap, onAdjust, disabled,
}: {
  product: Product
  getInv: (productId: string, variantId: string | null) => EventInventoryItem | undefined
  savingMap: Record<string, boolean>
  errorMap: Record<string, string>
  onAdjust: (productId: string, variantId: string | null, delta: number) => void
  disabled: boolean
}) {
  const variants: ProductVariant[] = (product.variants ?? [])
    .slice()
    .sort((a, b) => SIZES_ORDER.indexOf(a.size) - SIZES_ORDER.indexOf(b.size))

  const totalAssigned = variants.reduce((s, v) => s + (getInv(product.id, v.id)?.quantity_assigned ?? 0), 0)

  return (
    <Card padding="none">
      <div className="p-3">
        <div className="flex items-center gap-3 mb-2.5">
          <div className="w-12 h-12 rounded-xl bg-zinc-800 overflow-hidden shrink-0">
            {product.image_url
              ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center"><Package size={18} className="text-zinc-600" /></div>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold truncate">{product.name}</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">Tallas · Total asignado: <span className="text-amber-400 font-bold">{totalAssigned}</span></p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {variants.map(v => {
            const inv = getInv(product.id, v.id)
            const assigned = inv?.quantity_assigned ?? 0
            const sold = inv?.quantity_sold ?? 0
            const remaining = assigned - sold
            const key = `${product.id}::${v.id}`
            const saving = !!savingMap[key]
            const error = errorMap[key] ?? ''
            return (
              <div key={v.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white font-bold text-sm">{v.size}</span>
                  <span className="text-[10px] text-zinc-500">Global: <span className="text-white font-semibold">{v.stock}</span></span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <button
                    disabled={disabled || saving || remaining <= 0}
                    onClick={() => onAdjust(product.id, v.id, -1)}
                    className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center disabled:opacity-30 active:scale-95"
                  ><Minus size={12} /></button>
                  <span className={`flex-1 text-center font-black text-base ${assigned > 0 ? 'text-amber-400' : 'text-zinc-600'}`}>{assigned}</span>
                  <button
                    disabled={disabled || saving || v.stock <= 0}
                    onClick={() => onAdjust(product.id, v.id, 1)}
                    className="w-7 h-7 rounded-lg bg-amber-500 text-black flex items-center justify-center disabled:opacity-30 active:scale-95"
                  ><Plus size={12} strokeWidth={2.5} /></button>
                </div>
                {sold > 0 && <p className="text-[10px] text-green-400 text-center mt-1">{sold} vendido{sold !== 1 ? 's' : ''}</p>}
                {error && <p className="text-[10px] text-red-400 text-center mt-1">{error}</p>}
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
