'use client'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShoppingCart, Plus, Minus, Trash2, Package, Check,
  Banknote, CreditCard, Smartphone, Wallet, ChevronRight,
  Package2, LogOut, Wifi, WifiOff, RefreshCw, X,
  Zap, CalendarDays, MapPin, Building2, RotateCcw, ChevronLeft,
  Bell,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getDeviceId } from '@/lib/deviceId'
import { useProducts } from '@/hooks/useProducts'
import { usePacks } from '@/hooks/usePacks'
import { useSales } from '@/hooks/useSales'
import { useEvents } from '@/hooks/useEvents'
import { useEventTpvCatalog } from '@/hooks/useEventTpvCatalog'
import { useCartStore } from '@/store/cartStore'
import { useAppStore } from '@/store/appStore'
import { formatCurrency } from '@/lib/utils'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Card from '@/components/ui/Card'
import PackCollage from '@/components/ui/PackCollage'
import SwipeableTabs from '@/components/ui/SwipeableTabs'
import { formatDate } from '@/lib/utils'
import type { PaymentMethod, Product, Pack, ProductVariant, PackSizeSelection, Event, CartItem } from '@/types'

const SIZES_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Única']

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: React.ElementType; color: string }[] = [
  { value: 'efectivo', label: 'Efectivo', icon: Banknote, color: 'text-green-400' },
  { value: 'bizum', label: 'Bizum', icon: Smartphone, color: 'text-blue-400' },
  { value: 'tarjeta', label: 'Tarjeta', icon: CreditCard, color: 'text-purple-400' },
  { value: 'paypal', label: 'PayPal', icon: Wallet, color: 'text-sky-400' },
  { value: 'mixto', label: 'Mixto', icon: Wallet, color: 'text-zinc-400' },
]

export default function NewSalePage() {
  const router = useRouter()
  const globalProducts = useProducts()
  const globalPacks = usePacks()
  const { events: allEvents } = useEvents()
  const activeEvents = useMemo(() => allEvents.filter(e => e.status === 'active'), [allEvents])
  const { createSale, loading: creating } = useSales()
  const cart = useCartStore()
  const {
    isSaleMode, isOnline, pendingSyncCount, setSaleMode, tpvSession,
    tpvFlow, setTpvFlow, activeEvent, setActiveEvent,
  } = useAppStore()

  const isEventMode = tpvFlow === 'event' && !!activeEvent
  const eventCatalog = useEventTpvCatalog(isEventMode ? activeEvent!.id : null)

  // Catálogo efectivo según modo
  const products = isEventMode ? eventCatalog.products : globalProducts.products
  const packs = isEventMode ? eventCatalog.packs : globalPacks.packs
  const loadingProducts = isEventMode ? eventCatalog.loading : globalProducts.loading
  const loadingPacks = isEventMode ? eventCatalog.loading : globalPacks.loading

  const refetchProducts = () => { isEventMode ? eventCatalog.refetch() : globalProducts.refetch() }
  const refetchPacks    = () => { isEventMode ? eventCatalog.refetch() : globalPacks.refetch() }
  const patchStocks = (decrements: { product_id: string; variant_id?: string; qty: number }[]) => {
    if (isEventMode) eventCatalog.patchStocks(decrements)
    else globalProducts.patchStocks(decrements.map(d => ({ product_id: d.product_id, qty: d.qty })))
  }

  const [tab, setTab] = useState<'products' | 'packs'>('products')
  const [showCart, setShowCart] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [saleNotes, setSaleNotes] = useState('')
  const [saleError, setSaleError] = useState('')
  const [sizePickerProduct, setSizePickerProduct] = useState<Product | null>(null)
  const [packSizePicker, setPackSizePicker] = useState<Pack | null>(null)
  const [warehouses, setWarehouses] = useState<{ id: string; name: string; color: string | null; totalUnits: number }[]>([])
  const [warehouseStock, setWarehouseStock] = useState<{ warehouse_id: string; product_id: string; variant_id: string | null; quantity: number }[]>([])
  const [quickWarehouseId, setQuickWarehouseId] = useState('')

  // Desglose de stock por almacén para cada producto (suma de todas las variantes).
  // Solo se usa en venta rápida para mostrar chips con el nombre del almacén.
  const warehouseStockByProduct = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color: string | null; quantity: number }[]>()
    const whById = new Map(warehouses.map(w => [w.id, w] as const))
    for (const s of warehouseStock) {
      if (s.quantity <= 0) continue
      const wh = whById.get(s.warehouse_id)
      if (!wh) continue
      const list = m.get(s.product_id) ?? []
      const existing = list.find(e => e.id === wh.id)
      if (existing) existing.quantity += s.quantity
      else list.push({ id: wh.id, name: wh.name, color: wh.color, quantity: s.quantity })
      m.set(s.product_id, list)
    }
    // Ordenar cada lista por cantidad descendente
    for (const list of m.values()) list.sort((a, b) => b.quantity - a.quantity)
    return m
  }, [warehouseStock, warehouses])

  const loadWarehouseData = useCallback(() => {
    fetch('/api/warehouses/overview', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        const whs: { id: string; name: string; color: string | null }[] = j.warehouses ?? []
        const stockRows: { warehouse_id: string; product_id: string; variant_id: string | null; quantity: number }[] = j.stock ?? []
        const withTotals = whs.map(wh => ({
          ...wh,
          totalUnits: stockRows
            .filter(s => s.warehouse_id === wh.id)
            .reduce((sum, s) => sum + s.quantity, 0),
        }))
        setWarehouses(withTotals)
        setWarehouseStock(stockRows)
        if (withTotals.length === 1) setQuickWarehouseId(withTotals[0].id)
      })
      .catch(() => {})
  }, [])

  useEffect(() => { loadWarehouseData() }, [loadWarehouseData])

  // Total de unidades en carrito para un producto (suma todas las tallas)
  const productQty = (productId: string) =>
    cart.items.filter(i => i.type === 'product' && i.product?.id === productId)
      .reduce((sum, i) => sum + i.quantity, 0)

  // Total de unidades en carrito para un pack (puede haber varias líneas con tallas distintas)
  const packQty = (packId: string) =>
    cart.items.filter(i => i.type === 'pack' && i.pack?.id === packId)
      .reduce((sum, i) => sum + i.quantity, 0)

  const handleConfirmSale = async () => {
    if (cart.items.length === 0) return
    setSaleError('')

    const soldItems = cart.items

    const eventIdToSend = isEventMode ? activeEvent!.id : null
    const result = await createSale(soldItems, cart.paymentMethod, eventIdToSend, saleNotes || undefined, {
      eventInventoryResolver: isEventMode
        ? (productId, variantId) => eventCatalog.getEventInventoryId(productId, variantId)
        : undefined,
      quickSaleWarehouseId: !isEventMode ? quickWarehouseId || undefined : undefined,
    })
    if (result.success) {
      // Actualización optimista
      const decrements = soldItems.flatMap(item => {
        if (item.type === 'product' && item.product) {
          return [{ product_id: item.product.id, variant_id: item.variant_id, qty: item.quantity }]
        }
        if (item.type === 'pack' && item.pack?.items) {
          return item.pack.items.map(pi => {
            const sizeSel = item.packSizeSelections?.find(s => s.product_id === pi.product_id)
            return {
              product_id: pi.product_id,
              variant_id: sizeSel?.variant_id,
              qty: pi.quantity * item.quantity,
            }
          })
        }
        return []
      })
      patchStocks(decrements)

      setShowConfirm(false)
      setShowSuccess(true)
      cart.clearCart()
      setSaleNotes('')
      // Refetch en segundo plano para confirmar datos reales de BD
      refetchProducts()
      refetchPacks()
      setTimeout(() => setShowSuccess(false), 2200)
    } else {
      setSaleError(result.error ?? 'No se pudo registrar la venta')
    }
  }

  const handleExitSaleMode = async () => {
    if (tpvSession?.id) {
      try {
        await fetch('/api/tpv-sessions/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: tpvSession.id, deviceId: getDeviceId() }),
        })
      } catch { /* no crítico */ }
    }
    const supabase = createClient()
    await supabase.auth.signOut()
    setSaleMode(false)
    setTpvFlow(null)
    setActiveEvent(null)
    router.push('/login')
  }

  // Admin: al entrar a /sales/new siempre muestra el selector de modo.
  // TPV: preserva el flujo actual al cambiar de pestaña (no resetea).
  useEffect(() => {
    if (!isSaleMode) {
      setTpvFlow(null)
      setActiveEvent(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Admin: pulsa "Vender en evento" en el banner → abre selector de eventos
  const handleSwitchToEvent = () => {
    cart.clearCart()
    setActiveEvent(null)
    setTpvFlow('event')
  }

  // Admin: pulsa "Volver a venta rápida" en el banner
  const handleSwitchToQuick = () => {
    cart.clearCart()
    setActiveEvent(null)
    setTpvFlow('quick')
  }

  // TPV (PIN): volver al selector de modo
  const handleChangeMode = () => {
    cart.clearCart()
    setTpvFlow(null)
    setActiveEvent(null)
  }

  const handleBackToDashboard = () => {
    router.push('/dashboard')
  }

  const cartCount = cart.itemCount()

  // ── Renders condicionales: selector de modo / selector de evento ──────────
  // Solo se muestra el selector inicial al TPV. El admin entra directo a quick.
  if (!tpvFlow) {
    return (
      <TpvModeSelector
        onPickQuick={() => setTpvFlow('quick')}
        onPickEvent={() => {
          // Si hay UN solo concierto activo, ir directo a él.
          // Si hay varios, mostrar el EventPicker.
          // Si hay 0, este botón no debería estar visible (lo oculta el selector).
          if (activeEvents.length === 1) {
            setActiveEvent(activeEvents[0])
            setTpvFlow('event')
          } else {
            setTpvFlow('event')
          }
        }}
        onBack={isSaleMode ? undefined : handleBackToDashboard}
        onExit={isSaleMode ? handleExitSaleMode : undefined}
        hasActiveEvent={activeEvents.length > 0}
      />
    )
  }

  if (tpvFlow === 'event' && !activeEvent) {
    return (
      <EventPicker
        onPick={(ev) => setActiveEvent(ev)}
        onBack={isSaleMode ? () => setTpvFlow(null) : handleSwitchToQuick}
        onExit={isSaleMode ? handleExitSaleMode : undefined}
        backLabel={isSaleMode ? 'Atrás' : 'Venta rápida'}
      />
    )
  }

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">

      {/* Header ultra compacto */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800 shrink-0">

        {/* Nombre del vendedor con badge de staff */}
        {isSaleMode && tpvSession?.sellerName ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="bg-blue-600 text-white text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0">
              STAFF
            </span>
            <span className="text-white text-sm font-semibold truncate">{tpvSession.sellerName}</span>
          </div>
        ) : (
          <div />
        )}

        {/* Controles derecha */}
        <div className="flex items-center gap-1.5 shrink-0">
          {pendingSyncCount > 0 && (
            <div className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-full px-2 py-0.5">
              <RefreshCw size={10} className="text-white animate-spin" />
              <span className="text-white text-[10px] font-bold">{pendingSyncCount}</span>
            </div>
          )}
          <div className={isOnline ? 'text-green-500' : 'text-red-500'}>
            {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
          </div>

          {cartCount > 0 && (
            <button
              onClick={() => setShowCart(true)}
              className="relative p-2 rounded-xl bg-white text-black tap-scale shrink-0"
            >
              <ShoppingCart size={18} strokeWidth={2.5} />
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-white text-xs font-black flex items-center justify-center">
                {cartCount}
              </span>
            </button>
          )}

          {isSaleMode && (
            <HelpSosButton
              sellerName={tpvSession?.sellerName ?? null}
              tpvSessionId={tpvSession?.id ?? null}
              eventId={isEventMode ? activeEvent!.id : null}
            />
          )}

          {isSaleMode && (
            <button
              onClick={handleExitSaleMode}
              className="p-2 rounded-xl bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Banner de modo / evento activo */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b shrink-0 ${isEventMode ? 'bg-amber-500/10 border-amber-900/50' : 'bg-zinc-900 border-zinc-800'}`}>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isEventMode ? 'bg-amber-500 text-black' : 'bg-white text-black'}`}>
          {isEventMode ? <CalendarDays size={15} strokeWidth={2.5} /> : <Zap size={15} strokeWidth={2.5} fill="currentColor" />}
        </div>
        <div className="flex-1 min-w-0">
          {isEventMode ? (
            <>
              <p className="text-white text-xs font-bold truncate leading-tight">{activeEvent!.name}</p>
              <p className="text-amber-400 text-[10px] leading-tight">{activeEvent!.city} · {activeEvent!.venue}</p>
            </>
          ) : (
            <p className="text-white text-xs font-bold leading-tight">Venta rápida (fuera de concierto)</p>
          )}
        </div>
        {isSaleMode ? (
          /* TPV en concierto: sin botón de cambio de modo */
          isEventMode ? null : (
            <button
              onClick={handleChangeMode}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white text-[10px] font-medium shrink-0"
            >
              <RotateCcw size={11} />Cambiar
            </button>
          )
        ) : isEventMode ? null : (
          <button
            onClick={handleSwitchToEvent}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 text-black text-[10px] font-bold shrink-0"
          >
            <CalendarDays size={11} />Vender en concierto
          </button>
        )}
      </div>

      {/* ── Tabs deslizables ── */}
      <SwipeableTabs
        activeKey={tab}
        onChange={k => setTab(k as 'products' | 'packs')}
        panelClassName="p-3"
        tabs={[
          {
            key: 'products',
            label: (
              <span className="flex items-center justify-center gap-1.5">
                <Package size={15} />
                Artículos
                {products.length > 0 && <span className="bg-white/10 text-white text-xs px-1.5 py-0.5 rounded-full">{products.length}</span>}
              </span>
            ),
            content: loadingProducts ? <LoadingSpinner /> : products.length === 0 ? (
              <EmptyState
                icon={<Package size={40} />}
                text={isEventMode ? 'Este concierto no tiene productos asignados todavía' : 'No hay productos activos'}
                hint={isEventMode ? 'El admin debe asignar stock al concierto desde Conciertos → Stock concierto' : undefined}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 auto-rows-min">
                {products.map(product => {
                  const isTextile = product.category?.name === 'Textil'
                  return (
                    <ProductCard
                      key={product.id}
                      product={product}
                      quantity={productQty(product.id)}
                      hasVariants={isTextile}
                      showStockAlways={isEventMode}
                      warehouseBreakdown={isEventMode ? undefined : warehouseStockByProduct.get(product.id)}
                      onAdd={() => {
                        if (isTextile) setSizePickerProduct(product)
                        else cart.addProduct(product)
                      }}
                      onDecrease={() => {
                        if (isTextile) return
                        const item = cart.items.find(i => i.type === 'product' && i.product?.id === product.id)
                        if (item) cart.updateQuantity(item.id, item.quantity - 1)
                      }}
                    />
                  )
                })}
              </div>
            ),
          },
          {
            key: 'packs',
            label: (
              <span className="flex items-center justify-center gap-1.5">
                <Package2 size={15} />
                Packs
                {packs.length > 0 && <span className="bg-white/10 text-white text-xs px-1.5 py-0.5 rounded-full">{packs.length}</span>}
              </span>
            ),
            content: loadingPacks ? <LoadingSpinner /> : packs.length === 0 ? (
              <EmptyState icon={<Package2 size={40} />} text="No hay packs configurados" hint="Crea packs en Configuración → Packs" />
            ) : (
              <div className="flex flex-col gap-3">
                {packs.map(pack => {
                  const textilPackItems = pack.items?.filter(i => i.product?.category?.name === 'Textil') ?? []
                  return (
                    <PackCard
                      key={pack.id}
                      pack={pack}
                      quantity={packQty(pack.id)}
                      onAdd={() => {
                        if (textilPackItems.length > 0) setPackSizePicker(pack)
                        else cart.addPack(pack)
                      }}
                      onDecrease={() => {
                        if (textilPackItems.length > 0) return
                        const item = cart.items.find(i => i.type === 'pack' && i.pack?.id === pack.id)
                        if (item) cart.updateQuantity(item.id, item.quantity - 1)
                      }}
                    />
                  )
                })}
              </div>
            ),
          },
        ]}
      />

      {/* Barra inferior con total */}
      {cartCount > 0 && (
        <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-3 safe-bottom shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-zinc-500 text-xs">{cartCount} artículo{cartCount !== 1 ? 's' : ''}</p>
              <p className="text-white font-black text-xl">{formatCurrency(cart.total())}</p>
            </div>
            <Button size="lg" onClick={() => setShowCart(true)} className="px-6">
              Cobrar
              <ChevronRight size={18} />
            </Button>
          </div>
        </div>
      )}

      {/* Modal carrito */}
      <CartModal
        open={showCart}
        onClose={() => setShowCart(false)}
        notes={saleNotes}
        onNotesChange={setSaleNotes}
        onConfirm={() => { setShowCart(false); setShowConfirm(true) }}
        warehouses={warehouses}
        warehouseStock={warehouseStock}
        isEventMode={isEventMode}
      />

      {/* Modal confirmación */}
      <ConfirmModal
        open={showConfirm}
        onBack={() => { setShowConfirm(false); setShowCart(true) }}
        onConfirm={handleConfirmSale}
        loading={creating}
        error={saleError}
      />

      {/* Modal éxito */}
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 slide-up">
            <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center shadow-2xl shadow-green-500/50">
              <Check size={48} className="text-white" strokeWidth={3} />
            </div>
            <p className="text-white text-2xl font-black">¡Vendido!</p>
          </div>
        </div>
      )}

      {/* Modal selector de talla — artículo individual */}
      <SizePickerModal
        open={!!sizePickerProduct}
        product={sizePickerProduct}
        onClose={() => setSizePickerProduct(null)}
        onSelect={(size, variant) => {
          if (sizePickerProduct) cart.addProduct(sizePickerProduct, size, variant)
        }}
      />

      {/* Modal selector de tallas — pack con artículos textiles */}
      <PackSizePickerModal
        open={!!packSizePicker}
        pack={packSizePicker}
        onClose={() => setPackSizePicker(null)}
        onConfirm={selections => {
          if (packSizePicker) cart.addPack(packSizePicker, selections)
        }}
      />
    </div>
  )
}

// ─── Tarjeta de producto ────────────────────────────────────────────────────

function ProductCard({
  product, quantity, hasVariants, showStockAlways, warehouseBreakdown, onAdd, onDecrease,
}: {
  product: Product
  quantity: number
  hasVariants: boolean
  showStockAlways?: boolean
  warehouseBreakdown?: { id: string; name: string; color: string | null; quantity: number }[]
  onAdd: () => void
  onDecrease: () => void
}) {
  const isOutOfStock = product.stock === 0
  const isLowStock = product.stock > 0 && product.stock <= product.min_stock

  return (
    <div className={`relative flex flex-col bg-zinc-900 border rounded-2xl overflow-hidden transition-all ${
      quantity > 0 ? 'border-white shadow-lg shadow-white/10' : isOutOfStock ? 'border-zinc-800 opacity-40' : 'border-zinc-800'
    }`}>
      <button
        onClick={onAdd}
        disabled={isOutOfStock}
        className="relative w-full aspect-square bg-zinc-800 active:scale-95 transition-transform"
      >
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_url} alt={product.name} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package size={36} className="text-zinc-600" />
          </div>
        )}

        {quantity > 0 && (
          <div className="absolute top-2 right-2 w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-lg z-10">
            <span className="text-black text-sm font-black">{quantity}</span>
          </div>
        )}

        {/* Badge superior izq: stock bajo (siempre) o stock total (solo en modo concierto) */}
        {isLowStock ? (
          <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-0.5">
            <span className="bg-orange-500 text-white text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-md leading-none shadow-lg shadow-orange-500/40">
              Stock bajo
            </span>
            <span className="bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md leading-none shadow-lg shadow-red-600/40">
              {product.stock} ud{product.stock !== 1 ? 's' : ''}
            </span>
          </div>
        ) : showStockAlways && !isOutOfStock ? (
          <div className="absolute top-2 left-2 z-10">
            <span className="bg-black/75 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md leading-none shadow-lg backdrop-blur-sm">
              {product.stock} ud{product.stock !== 1 ? 's' : ''}
            </span>
          </div>
        ) : null}
      </button>

      <div className="p-2.5">
        <p className="text-white text-sm font-semibold leading-tight line-clamp-1">{product.name}</p>

        {/* Chips por almacén (solo en venta rápida) */}
        {warehouseBreakdown && warehouseBreakdown.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {warehouseBreakdown.map(w => {
              const color = w.color ?? '#71717a'
              return (
                <span
                  key={w.id}
                  className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5"
                  style={{ borderColor: color + '99', backgroundColor: color + '14' }}
                  title={`${w.name}: ${w.quantity} ud`}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-[10px] font-semibold truncate max-w-[60px]" style={{ color }}>{w.name}</span>
                  <span className="text-[10px] text-zinc-400">·{w.quantity}</span>
                </span>
              )
            })}
          </div>
        )}
        {warehouseBreakdown && warehouseBreakdown.length === 0 && !product.stock && (
          <p className="text-[10px] text-zinc-600 mt-1.5">Sin stock en almacenes</p>
        )}

        <div className="flex items-center justify-between mt-1.5">
          <p className="text-white font-black text-base">{formatCurrency(product.sale_price)}</p>

          {quantity > 0 && (
            <div className="flex items-center gap-1.5">
              {!hasVariants && (
                <button
                  onClick={onDecrease}
                  className="w-6 h-6 rounded-lg bg-zinc-800 flex items-center justify-center active:scale-90"
                >
                  <Minus size={11} />
                </button>
              )}
              <button
                onClick={onAdd}
                className="w-6 h-6 rounded-lg bg-white flex items-center justify-center active:scale-90"
              >
                <Plus size={11} className="text-black" strokeWidth={3} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tarjeta de pack (horizontal, ancho completo) ────────────────────────

function PackCard({
  pack, quantity, onAdd, onDecrease,
}: {
  pack: Pack
  quantity: number
  onAdd: () => void
  onDecrease: () => void
}) {
  const availableStock = pack.available_stock ?? 0
  const isOutOfStock = availableStock === 0
  const atMax = quantity >= availableStock && !isOutOfStock

  const normalTotal = pack.items?.reduce((acc, i) => acc + (i.product?.sale_price ?? 0) * i.quantity, 0) ?? 0
  const savings = normalTotal > 0 ? normalTotal - pack.sale_price : 0

  return (
    <div className={`relative flex bg-zinc-900 border rounded-2xl overflow-hidden transition-all ${
      quantity > 0 ? 'border-white shadow-lg shadow-white/10' : isOutOfStock ? 'border-zinc-800 opacity-40' : 'border-zinc-800'
    }`}>
      {/* Collage cuadrado fijo */}
      <button
        onClick={onAdd}
        disabled={isOutOfStock || atMax}
        className="relative w-28 h-28 shrink-0 bg-zinc-800 active:scale-95 transition-transform disabled:active:scale-100"
      >
        <PackCollage items={pack.items ?? []} />
        {isOutOfStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
            <span className="bg-red-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide">
              AGOTADO
            </span>
          </div>
        )}
      </button>

      {/* Info — div con role button para evitar button-dentro-de-button */}
      <div
        role="button"
        tabIndex={isOutOfStock || atMax ? -1 : 0}
        onClick={!isOutOfStock && !atMax ? onAdd : undefined}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !isOutOfStock && !atMax) onAdd() }}
        className={`flex-1 min-w-0 p-3 flex flex-col justify-between text-left transition-colors ${
          isOutOfStock || atMax ? 'cursor-default' : 'active:bg-white/5 cursor-pointer'
        }`}
      >
        <div className="min-w-0">
          <p className="text-white text-base font-bold leading-tight line-clamp-2">{pack.name}</p>
          {pack.items && pack.items.length > 0 && (
            <p className="text-zinc-500 text-xs mt-1 line-clamp-2 leading-relaxed">
              {pack.items.map(i =>
                `${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.product?.name ?? '?'}`
              ).join(' · ')}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between mt-2">
          <div className="flex flex-col">
            <span className="text-white font-black text-xl leading-none">{formatCurrency(pack.sale_price)}</span>
            {savings > 0.01 && !isOutOfStock && (
              <span className="text-green-400 text-[10px] font-bold mt-0.5">-{formatCurrency(savings)} vs. separado</span>
            )}
            {!isOutOfStock && (
              <span className="text-zinc-600 text-[10px] mt-0.5">{availableStock} disponible{availableStock !== 1 ? 's' : ''}</span>
            )}
          </div>

          {quantity > 0 ? (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={e => { e.stopPropagation(); onDecrease() }}
                className="w-8 h-8 rounded-xl bg-zinc-800 flex items-center justify-center active:scale-90"
              >
                <Minus size={13} />
              </button>
              <span className="text-white font-black text-base w-5 text-center">{quantity}</span>
              <button
                onClick={e => { e.stopPropagation(); onAdd() }}
                disabled={atMax}
                className="w-8 h-8 rounded-xl bg-white flex items-center justify-center active:scale-90 disabled:opacity-30"
              >
                <Plus size={13} className="text-black" strokeWidth={3} />
              </button>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
              <Plus size={15} className="text-white" strokeWidth={2.5} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal selector de talla ─────────────────────────────────────────────────

function SizePickerModal({
  open, product, onClose, onSelect,
}: {
  open: boolean
  product: Product | null
  onClose: () => void
  onSelect: (size: string, variant?: ProductVariant) => void
}) {
  const sortedVariants = (product?.variants ?? [])
    .slice()
    .sort((a, b) => SIZES_ORDER.indexOf(a.size) - SIZES_ORDER.indexOf(b.size))

  const hasConfiguredVariants = sortedVariants.length > 0

  return (
    <Modal open={open} onClose={onClose} title="Elige la talla" size="sm">
      <div className="space-y-3">
        <p className="text-zinc-400 text-sm font-medium truncate">{product?.name}</p>
        <div className="space-y-2">
          {hasConfiguredVariants
            ? sortedVariants.map(v => {
                const outOfStock = v.stock === 0
                const lowStock = v.stock > 0 && v.stock <= 2
                return (
                  <button
                    key={v.id}
                    disabled={outOfStock}
                    onClick={() => { onSelect(v.size, v); onClose() }}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                      outOfStock
                        ? 'border-zinc-800 opacity-40 cursor-not-allowed'
                        : 'border-zinc-700 hover:border-white active:bg-white/5'
                    }`}
                  >
                    <span className="text-white font-bold text-xl">{v.size}</span>
                    <span className={`text-sm font-semibold ${
                      outOfStock ? 'text-red-500' : lowStock ? 'text-amber-400' : 'text-zinc-400'
                    }`}>
                      {outOfStock ? 'Agotado' : `${v.stock} ud${v.stock !== 1 ? 's' : ''}`}
                    </span>
                  </button>
                )
              })
            : SIZES_ORDER.map(size => (
                <button
                  key={size}
                  onClick={() => { onSelect(size); onClose() }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-700 hover:border-white active:bg-white/5 transition-all"
                >
                  <span className="text-white font-bold text-xl">{size}</span>
                </button>
              ))
          }
        </div>
        <Button variant="outline" fullWidth onClick={onClose}>Cancelar</Button>
      </div>
    </Modal>
  )
}

// ─── Modal selector de tallas para packs ─────────────────────────────────────

function PackSizePickerModal({
  open, pack, onClose, onConfirm,
}: {
  open: boolean
  pack: Pack | null
  onClose: () => void
  onConfirm: (selections: PackSizeSelection[]) => void
}) {
  const [selections, setSelections] = useState<Record<string, { variant_id: string; size: string }>>({})

  const textilItems = pack?.items?.filter(i => i.product?.category?.name === 'Textil') ?? []

  useMemo(() => { setSelections({}) }, [open])

  const allSelected = textilItems.every(i => selections[i.product_id])

  const handleConfirm = () => {
    const sizeSelections: PackSizeSelection[] = Object.entries(selections).map(([product_id, sel]) => ({
      product_id,
      variant_id: sel.variant_id,
      size: sel.size,
    }))
    onConfirm(sizeSelections)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Elige las tallas del pack" size="sm">
      <div className="space-y-4">
        {textilItems.map(item => {
          const sortedVariants = (item.product?.variants ?? [])
            .slice()
            .sort((a, b) => SIZES_ORDER.indexOf(a.size) - SIZES_ORDER.indexOf(b.size))
          const hasConfiguredVariants = sortedVariants.length > 0
          const sizesToShow = hasConfiguredVariants
            ? sortedVariants.map(v => ({ id: v.id, size: v.size, stock: v.stock }))
            : SIZES_ORDER.map(size => ({ id: '', size, stock: -1 }))

          return (
            <div key={item.product_id}>
              <p className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-2">
                {item.product?.name}
                {item.quantity > 1 && <span className="text-zinc-600 normal-case"> (×{item.quantity})</span>}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {sizesToShow.map(opt => {
                  const selected = selections[item.product_id]?.size === opt.size
                  const outOfStock = opt.stock === 0
                  return (
                    <button
                      key={opt.size}
                      disabled={outOfStock}
                      onClick={() => setSelections(prev => ({
                        ...prev,
                        [item.product_id]: { variant_id: opt.id, size: opt.size },
                      }))}
                      className={`py-2.5 rounded-xl border text-center transition-all ${
                        selected
                          ? 'border-white bg-white text-black'
                          : outOfStock
                            ? 'border-zinc-800 text-zinc-700 cursor-not-allowed'
                            : 'border-zinc-700 text-zinc-300 hover:border-zinc-400'
                      }`}
                    >
                      <span className="block font-bold text-sm">{opt.size}</span>
                      {opt.stock >= 0 && (
                        <span className={`block text-[10px] mt-0.5 ${
                          selected ? 'text-zinc-600' : outOfStock ? 'text-zinc-700' : opt.stock <= 2 ? 'text-amber-400' : 'text-zinc-500'
                        }`}>
                          {outOfStock ? 'Agotado' : `${opt.stock} uds`}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div className="flex gap-3 pt-1">
          <Button variant="outline" fullWidth onClick={onClose}>Cancelar</Button>
          <Button fullWidth disabled={!allSelected} onClick={handleConfirm}>
            Añadir al carrito
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal carrito ──────────────────────────────────────────────────────────

function CartModal({ open, onClose, notes, onNotesChange, onConfirm, warehouses, warehouseStock, isEventMode }: {
  open: boolean
  onClose: () => void
  notes: string
  onNotesChange: (v: string) => void
  onConfirm: () => void
  warehouses: { id: string; name: string; color: string | null; totalUnits: number }[]
  warehouseStock: { warehouse_id: string; product_id: string; variant_id: string | null; quantity: number }[]
  isEventMode: boolean
}) {
  const cart = useCartStore()

  // Stock disponible por almacén para un (product, variant)
  const stockByWh = useMemo(() => {
    const m = new Map<string, Map<string, number>>() // key product::variant → wh → qty
    for (const s of warehouseStock) {
      const k = `${s.product_id}::${s.variant_id ?? ''}`
      let inner = m.get(k)
      if (!inner) { inner = new Map(); m.set(k, inner) }
      inner.set(s.warehouse_id, (inner.get(s.warehouse_id) ?? 0) + s.quantity)
    }
    return m
  }, [warehouseStock])

  // Almacenes que tienen stock para un item del carrito.
  // Para packs: intersección de los almacenes que tienen TODOS los componentes.
  const warehousesForItem = useCallback((item: CartItem): { id: string; name: string; color: string | null; available: number }[] => {
    if (item.type === 'product' && item.product) {
      const k = `${item.product.id}::${item.variant_id ?? ''}`
      const inner = stockByWh.get(k) ?? new Map<string, number>()
      return warehouses
        .map(w => ({ id: w.id, name: w.name, color: w.color, available: inner.get(w.id) ?? 0 }))
        .filter(w => w.available > 0)
    }
    if (item.type === 'pack' && item.pack?.items) {
      // Para cada wh, disponibilidad del pack = min(disponible / qty necesaria por componente)
      const perWh = new Map<string, number>()
      for (const wh of warehouses) {
        let minPossible = Infinity
        for (const pi of item.pack.items) {
          const sizeSel = item.packSizeSelections?.find((s: PackSizeSelection) => s.product_id === pi.product_id)
          const k = `${pi.product_id}::${sizeSel?.variant_id ?? ''}`
          const avail = stockByWh.get(k)?.get(wh.id) ?? 0
          minPossible = Math.min(minPossible, Math.floor(avail / pi.quantity))
        }
        if (minPossible > 0 && minPossible !== Infinity) perWh.set(wh.id, minPossible)
      }
      return warehouses
        .map(w => ({ id: w.id, name: w.name, color: w.color, available: perWh.get(w.id) ?? 0 }))
        .filter(w => w.available > 0)
    }
    return []
  }, [warehouses, stockByWh])

  // Auto-asignar warehouse a items sin uno cuando se abre el modal o cambia el carrito
  useEffect(() => {
    if (!open || isEventMode || warehouses.length === 0) return
    for (const item of cart.items) {
      if (item.warehouse_id) continue
      const opts = warehousesForItem(item)
      if (opts.length > 0) cart.setItemWarehouse(item.id, opts[0].id)
    }
  }, [open, isEventMode, warehouses.length, cart, warehousesForItem])

  return (
    <Modal open={open} onClose={onClose} title="Resumen de venta" size="lg">
      <div className="space-y-4">
        {cart.items.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-zinc-600">
            <ShoppingCart size={32} />
            <p className="mt-2 text-sm">Carrito vacío</p>
          </div>
        ) : (
          <div className="space-y-2">
            {cart.items.map(item => {
              const whOpts = !isEventMode ? warehousesForItem(item) : []
              const showWhPicker = !isEventMode && warehouses.length > 0
              return (
                <div key={item.id} className="bg-zinc-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">
                        {item.type === 'product'
                          ? `${item.product?.name}${item.size ? ` · ${item.size}` : ''}`
                          : item.pack?.name}
                      </p>
                      {item.packSizeSelections && item.packSizeSelections.length > 0 && (
                        <p className="text-zinc-500 text-xs mt-0.5">
                          {item.packSizeSelections.map(s => s.size).join(' · ')}
                        </p>
                      )}
                      <p className="text-zinc-500 text-xs">{formatCurrency(item.unit_price)} c/u</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => cart.updateQuantity(item.id, item.quantity - 1)} className="w-8 h-8 rounded-xl bg-zinc-700 flex items-center justify-center active:scale-90">
                        <Minus size={13} />
                      </button>
                      <span className="text-white font-bold w-5 text-center">{item.quantity}</span>
                      <button onClick={() => cart.updateQuantity(item.id, item.quantity + 1)} className="w-8 h-8 rounded-xl bg-zinc-700 flex items-center justify-center active:scale-90">
                        <Plus size={13} />
                      </button>
                      <button onClick={() => cart.removeItem(item.id)} className="w-8 h-8 rounded-xl bg-red-900/50 text-red-400 flex items-center justify-center active:scale-90">
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <span className="text-white font-bold text-sm w-14 text-right shrink-0">
                      {formatCurrency(item.unit_price * item.quantity)}
                    </span>
                  </div>

                  {/* Selector de almacén por artículo */}
                  {showWhPicker && (
                    <div className="flex items-center gap-2">
                      <Building2 size={11} className="text-zinc-500 shrink-0" />
                      {whOpts.length === 0 ? (
                        <span className="text-red-400 text-[11px]">Sin stock en almacenes</span>
                      ) : whOpts.length === 1 ? (
                        <span className="text-zinc-400 text-[11px] truncate">
                          {whOpts[0].name} · {whOpts[0].available} disp.
                        </span>
                      ) : (
                        <select
                          value={item.warehouse_id ?? ''}
                          onChange={e => cart.setItemWarehouse(item.id, e.target.value || null)}
                          className={`flex-1 bg-zinc-900 border rounded-lg py-1 px-2 text-[11px] focus:outline-none focus:border-white ${
                            item.quantity > (whOpts.find(o => o.id === item.warehouse_id)?.available ?? 0)
                              ? 'border-red-700 text-red-300'
                              : 'border-zinc-700 text-zinc-200'
                          }`}
                        >
                          {whOpts.map(w => (
                            <option key={w.id} value={w.id}>
                              {w.name} · {w.available} disp.
                            </option>
                          ))}
                        </select>
                      )}
                      {item.warehouse_id && whOpts.find(o => o.id === item.warehouse_id) &&
                        item.quantity > (whOpts.find(o => o.id === item.warehouse_id)!.available) && (
                        <span className="text-red-400 text-[10px] shrink-0">¡Excede!</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Método de pago */}
        <div>
          <p className="text-sm font-medium text-zinc-400 mb-2">Método de pago</p>
          <div className="grid grid-cols-5 gap-2">
            {PAYMENT_METHODS.map(({ value, label, icon: Icon, color }) => (
              <button
                key={value}
                onClick={() => cart.setPaymentMethod(value)}
                className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border transition-all ${
                  cart.paymentMethod === value
                    ? 'border-white bg-white/10'
                    : 'border-zinc-800 bg-zinc-800/50'
                }`}
              >
                <Icon size={20} className={cart.paymentMethod === value ? 'text-white' : color} />
                <span className={`text-[10px] font-medium leading-tight text-center ${cart.paymentMethod === value ? 'text-white' : 'text-zinc-500'}`}>
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Notas */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-400">Notas de la venta</label>
          <textarea
            value={notes}
            onChange={e => onNotesChange(e.target.value)}
            placeholder="Ej: debe 3€, enviar por correo, recogida pendiente..."
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-white resize-none text-sm"
          />
        </div>

        {/* Total */}
        <div className="border-t border-zinc-800 pt-4 space-y-1">
          <div className="flex justify-between text-sm text-zinc-500">
            <span>{cart.itemCount()} artículos</span>
            <span>{formatCurrency(cart.total())}</span>
          </div>
          <div className="flex justify-between font-black text-xl text-white">
            <span>TOTAL</span>
            <span>{formatCurrency(cart.total())}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="lg" onClick={onClose} className="px-4">
            ← Atrás
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => cart.clearCart()}
            disabled={cart.items.length === 0}
            className="px-4 text-red-400 border-red-900 hover:bg-red-900/20"
          >
            <Trash2 size={16} />
          </Button>
          <Button size="lg" fullWidth onClick={onConfirm} disabled={cart.items.length === 0}>
            Cobrar · {formatCurrency(cart.total())}
            <ChevronRight size={18} />
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal de confirmación de cobro ────────────────────────────────────────

function ConfirmModal({ open, onBack, onConfirm, loading, error }: {
  open: boolean
  onBack: () => void
  onConfirm: () => void
  loading: boolean
  error?: string
}) {
  const cart = useCartStore()
  const selectedPayment = PAYMENT_METHODS.find(p => p.value === cart.paymentMethod)
  const Icon = selectedPayment?.icon ?? Banknote

  return (
    <Modal open={open} onClose={onBack} size="sm" showClose={false}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-14 h-14 bg-white/10 border-2 border-white/20 rounded-full flex items-center justify-center">
          <Icon size={26} className="text-white" />
        </div>
        <div className="text-center">
          <p className="text-zinc-400 text-sm mb-1">{selectedPayment?.label}</p>
          <p className="text-white text-4xl font-black">{formatCurrency(cart.total())}</p>
          <p className="text-zinc-500 text-sm mt-1">{cart.itemCount()} artículo{cart.itemCount() !== 1 ? 's' : ''}</p>
        </div>
        {error && (
          <div className="w-full bg-red-950/50 border border-red-900 rounded-xl px-3 py-2">
            <p className="text-red-400 text-xs text-center">{error}</p>
          </div>
        )}
        <div className="flex gap-3 w-full">
          <Button variant="outline" size="lg" onClick={onBack} disabled={loading} className="px-5 shrink-0">
            ← Atrás
          </Button>
          <Button fullWidth size="lg" onClick={onConfirm} loading={loading}>
            {loading ? 'Procesando...' : 'COBRAR'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Utilidades ─────────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function EmptyState({ icon, text, hint }: { icon: React.ReactNode; text: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
      {icon}
      <p className="mt-3 text-sm">{text}</p>
      {hint && <p className="mt-1 text-xs text-zinc-700">{hint}</p>}
    </div>
  )
}

// ─── Selector de modo: Evento vs Venta rápida ───────────────────────────────
function TpvModeSelector({ onPickQuick, onPickEvent, onBack, onExit, hasActiveEvent }: {
  onPickQuick: () => void
  onPickEvent: () => void
  onBack?: () => void
  onExit?: () => void
  hasActiveEvent: boolean
}) {
  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800 shrink-0">
        {onBack ? (
          <button onClick={onBack} className="p-2 rounded-xl text-zinc-400 hover:bg-zinc-800 -ml-2">
            <ChevronLeft size={20} />
          </button>
        ) : <div className="w-2" />}
        <p className="text-white font-bold text-lg flex-1 text-center">¿Qué tipo de venta?</p>
        {onExit ? (
          <button onClick={onExit} className="p-2 rounded-xl bg-zinc-800 text-zinc-500"><LogOut size={16} /></button>
        ) : <div className="w-9" />}
      </div>
      <div className="flex-1 flex flex-col gap-4 p-5 justify-center max-w-md mx-auto w-full">
        {hasActiveEvent && (
          <button
            onClick={onPickEvent}
            className="bg-amber-500 hover:bg-amber-400 rounded-3xl p-7 flex flex-col items-center gap-3 active:scale-[0.98] transition-transform shadow-2xl shadow-amber-500/20"
          >
            <CalendarDays size={44} className="text-black" strokeWidth={2.5} />
            <div className="text-center">
              <p className="text-black text-2xl font-black leading-none">CONCIERTO</p>
              <p className="text-black/70 text-sm font-medium mt-1">Vender el stock asignado a un concierto</p>
            </div>
          </button>
        )}
        <button
          onClick={onPickQuick}
          className="bg-white hover:bg-zinc-100 rounded-3xl p-7 flex flex-col items-center gap-3 active:scale-[0.98] transition-transform shadow-2xl shadow-white/10"
        >
          <Zap size={44} className="text-black" strokeWidth={2.5} fill="currentColor" />
          <div className="text-center">
            <p className="text-black text-2xl font-black leading-none">VENTA RÁPIDA</p>
            <p className="text-black/60 text-sm font-medium mt-1">Stock global · backstage, ensayos, ventas sueltas</p>
          </div>
        </button>
        <p className="text-zinc-600 text-xs text-center mt-2">
          {hasActiveEvent ? (
            <>Modo concierto: descuenta del stock reservado para el concierto y del global.<br />Venta rápida: descuenta del inventario general.</>
          ) : (
            <>No hay conciertos activos. Activa uno desde Conciertos para vender en modo concierto.</>
          )}
        </p>
      </div>
    </div>
  )
}

// ─── Selector de evento activo para el modo Evento ──────────────────────────
function EventPicker({ onPick, onBack, onExit, backLabel = 'Atrás' }: {
  onPick: (event: Event) => void
  onBack: () => void
  onExit?: () => void
  backLabel?: string
}) {
  const { events, loading } = useEvents()
  const { isSaleMode } = useAppStore()
  const activeEvents = events.filter(e => e.status === 'active')
  const autoPickedRef = useRef(false)

  // TPV: si hay exactamente 1 evento activo, seleccionarlo automáticamente.
  useEffect(() => {
    if (loading || autoPickedRef.current || !isSaleMode || activeEvents.length !== 1) return
    autoPickedRef.current = true
    onPick(activeEvents[0])
  }, [loading, isSaleMode, activeEvents, onPick])

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-zinc-800 shrink-0">
        <button onClick={onBack} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800 text-xs font-medium">
          <ChevronLeft size={16} />{backLabel}
        </button>
        <p className="flex-1 text-white font-bold text-center">Selecciona concierto</p>
        {onExit ? (
          <button onClick={onExit} className="p-2 rounded-xl bg-zinc-800 text-zinc-500"><LogOut size={16} /></button>
        ) : <div className="w-9" />}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : activeEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
            <CalendarDays size={40} />
            <p className="mt-3 text-sm font-medium">No hay conciertos activos</p>
            <p className="mt-1 text-xs text-zinc-700 text-center px-4">El admin debe activar un concierto desde la pestaña Conciertos antes de vender en modo concierto.</p>
          </div>
        ) : (
          activeEvents.map(ev => (
            <button key={ev.id} onClick={() => onPick(ev)} className="w-full text-left active:scale-[0.99] transition-transform">
              <Card padding="none" className="border-amber-500/30 hover:border-amber-500">
                <div className="p-4 flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                    <CalendarDays size={22} className="text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold truncate">{ev.name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="flex items-center gap-1 text-[11px] text-zinc-500"><MapPin size={11} />{ev.city}</span>
                      <span className="flex items-center gap-1 text-[11px] text-zinc-500"><Building2 size={11} />{ev.venue}</span>
                      <span className="flex items-center gap-1 text-[11px] text-zinc-500"><CalendarDays size={11} />{formatDate(ev.date)}</span>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-zinc-600" />
                </div>
              </Card>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// Plantillas rápidas para el aviso del TPV al admin
const SOS_TEMPLATES = [
  'Necesito ayuda en el puesto',
  'No hay cambio',
  'Hay que firmar un disco',
  'Falta stock',
  'Cliente pregunta por talla',
  'Problema con el pago',
]

// Campana SOS: abre un modal para elegir plantilla o escribir mensaje libre y
// enviarlo al admin.
function HelpSosButton({ sellerName, tpvSessionId, eventId }: {
  sellerName: string | null
  tpvSessionId: string | null
  eventId: string | null
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const send = async (template?: string) => {
    if (sending || !sellerName) return
    const msg = (template ?? custom).trim()
    if (!msg) return
    setError('')
    setSending(true)
    try {
      const res = await fetch('/api/help-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seller_name: sellerName,
          tpv_session_id: tpvSessionId,
          event_id: eventId,
          message: msg,
          from_role: 'tpv',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? 'Error')
      }
      setSent(true)
      setCustom('')
      setTimeout(() => { setSent(false); setOpen(false) }, 1100)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red')
      setTimeout(() => setError(''), 3000)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button
        onClick={() => { setError(''); setSent(false); setOpen(true) }}
        disabled={!sellerName}
        title="Avisar al admin"
        className={`relative p-2 rounded-xl transition-colors shrink-0 ${
          sent
            ? 'bg-green-500 text-black'
            : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
        }`}
      >
        {sent ? <Check size={16} strokeWidth={3} /> : <Bell size={16} strokeWidth={2.5} />}
      </button>

      <Modal open={open} onClose={() => !sending && setOpen(false)} title="Avisar al admin" size="md">
        <div className="space-y-4">
          {sent ? (
            <div className="flex flex-col items-center py-6 gap-2">
              <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center">
                <Check size={22} className="text-black" strokeWidth={3} />
              </div>
              <p className="text-white font-bold text-sm">Aviso enviado</p>
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Avisos rápidos
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {SOS_TEMPLATES.map(t => (
                    <button
                      key={t}
                      onClick={() => send(t)}
                      disabled={sending}
                      className="flex items-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 rounded-xl px-3 py-2.5 text-left text-sm text-amber-200 font-medium active:scale-[0.98] transition-transform disabled:opacity-40"
                    >
                      <Bell size={14} className="text-amber-400 shrink-0" />
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  O escribe un mensaje
                </p>
                <textarea
                  value={custom}
                  onChange={e => setCustom(e.target.value)}
                  placeholder="Ej: Tengo que ir un momento, ¿puedes cubrirme?"
                  rows={3}
                  disabled={sending}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 resize-none text-sm"
                />
              </div>

              {error && (
                <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2">
                  <p className="text-red-400 text-xs">{error}</p>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" fullWidth onClick={() => setOpen(false)} disabled={sending}>
                  Cancelar
                </Button>
                <Button
                  fullWidth
                  onClick={() => send()}
                  loading={sending}
                  disabled={!custom.trim()}
                  className="bg-amber-500 hover:bg-amber-400 text-black"
                >
                  Enviar
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
