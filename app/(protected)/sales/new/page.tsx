'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShoppingCart, Plus, Minus, Trash2, Package, Check,
  Banknote, CreditCard, Smartphone, Wallet, ChevronRight,
  Package2, LogOut, Wifi, WifiOff, RefreshCw, X, Tag,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useProducts } from '@/hooks/useProducts'
import { usePacks } from '@/hooks/usePacks'
import { useSales } from '@/hooks/useSales'
import { useCartStore } from '@/store/cartStore'
import { useAppStore } from '@/store/appStore'
import { formatCurrency } from '@/lib/utils'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import PackCollage from '@/components/ui/PackCollage'
import SwipeableTabs from '@/components/ui/SwipeableTabs'
import type { PaymentMethod, Product, Pack, ProductVariant, PackSizeSelection } from '@/types'

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
  const { products, loading: loadingProducts, refetch: refetchProducts, patchStocks } = useProducts()
  const { packs, loading: loadingPacks, refetch: refetchPacks } = usePacks()
  const { createSale, loading: creating } = useSales()
  const cart = useCartStore()
  const { isSaleMode, isOnline, pendingSyncCount, setSaleMode } = useAppStore()

  const [tab, setTab] = useState<'products' | 'packs'>('products')
  const [showCart, setShowCart] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [saleNotes, setSaleNotes] = useState('')
  const [saleError, setSaleError] = useState('')
  const [sizePickerProduct, setSizePickerProduct] = useState<Product | null>(null)
  const [packSizePicker, setPackSizePicker] = useState<Pack | null>(null)

  // Total de unidades en carrito para un producto (suma todas las tallas)
  const productQty = (productId: string) =>
    cart.items.filter(i => i.type === 'product' && i.product?.id === productId)
      .reduce((sum, i) => sum + i.quantity, 0)

  // Total de unidades en carrito para un pack (puede haber varias líneas con tallas distintas)
  const packQty = (packId: string) =>
    cart.items.filter(i => i.type === 'pack' && i.pack?.id === packId)
      .reduce((sum, i) => sum + i.quantity, 0)

  const refetchAll = useCallback(() => {
    refetchProducts()
    refetchPacks()
  }, [refetchProducts, refetchPacks])


  const handleConfirmSale = async () => {
    if (cart.items.length === 0) return
    setSaleError('')

    // Capturar los ítems antes de limpiar el carrito
    const soldItems = cart.items

    const result = await createSale(soldItems, cart.paymentMethod, null, saleNotes || undefined)
    if (result.success) {
      // Actualización optimista: reflejar el stock vendido al instante, sin esperar red
      const decrements = soldItems.flatMap(item => {
        if (item.type === 'product' && item.product) {
          return [{ product_id: item.product.id, qty: item.quantity }]
        }
        if (item.type === 'pack' && item.pack?.items) {
          return item.pack.items.map(pi => ({
            product_id: pi.product_id,
            qty: pi.quantity * item.quantity,
          }))
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
    const supabase = createClient()
    await supabase.auth.signOut()
    setSaleMode(false)
    router.push('/login')
  }

  const cartCount = cart.itemCount()

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">

      {/* Header ultra compacto */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-1.5">
          {pendingSyncCount > 0 && (
            <div className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-full px-2 py-0.5">
              <RefreshCw size={10} className="text-white animate-spin" />
              <span className="text-white text-[10px] font-bold">{pendingSyncCount}</span>
            </div>
          )}
          <div className={isOnline ? 'text-green-500' : 'text-red-500'}>
            {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
          </div>
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
          <button
            onClick={handleExitSaleMode}
            className="p-2 rounded-xl bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
          >
            <LogOut size={16} />
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
              <EmptyState icon={<Package size={40} />} text="No hay productos activos" />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {products.map(product => {
                  const isTextile = product.category?.name === 'Textil'
                  return (
                    <ProductCard
                      key={product.id}
                      product={product}
                      quantity={productQty(product.id)}
                      hasVariants={isTextile}
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
  product, quantity, hasVariants, onAdd, onDecrease,
}: {
  product: Product
  quantity: number
  hasVariants: boolean
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

        {isLowStock && (
          <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-0.5">
            <span className="bg-orange-500 text-white text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-md leading-none shadow-lg shadow-orange-500/40">
              Stock bajo
            </span>
            <span className="bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md leading-none shadow-lg shadow-red-600/40">
              {product.stock} ud{product.stock !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </button>

      <div className="p-2.5">
        <p className="text-white text-sm font-semibold leading-tight line-clamp-1">{product.name}</p>
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

function CartModal({ open, onClose, notes, onNotesChange, onConfirm }: {
  open: boolean
  onClose: () => void
  notes: string
  onNotesChange: (v: string) => void
  onConfirm: () => void
}) {
  const cart = useCartStore()

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
            {cart.items.map(item => (
              <div key={item.id} className="flex items-center gap-3 bg-zinc-800 rounded-xl p-3">
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
            ))}
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
