'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShoppingCart, Plus, Minus, Trash2, Package, Package2, Check, ChevronLeft,
  CreditCard, Wallet, Globe, Truck,
} from 'lucide-react'
import { useProducts } from '@/hooks/useProducts'
import { usePacks } from '@/hooks/usePacks'
import { useSales } from '@/hooks/useSales'
import { useAppStore } from '@/store/appStore'
import { formatCurrency, generateId } from '@/lib/utils'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import PackCollage from '@/components/ui/PackCollage'
import SwipeableTabs from '@/components/ui/SwipeableTabs'
import type { CartItem, PaymentMethod, Pack, PackSizeSelection, Product, ProductVariant } from '@/types'

const SIZES_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Única']

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: React.ElementType }[] = [
  { value: 'tarjeta', label: 'Tarjeta', icon: CreditCard },
  { value: 'paypal', label: 'PayPal', icon: Wallet },
]

export default function WebOrderPage() {
  const router = useRouter()
  const { user } = useAppStore()
  const { products, loading: loadingProducts, refetch: refetchProducts, patchStocks } = useProducts()
  const { packs, loading: loadingPacks, refetch: refetchPacks } = usePacks()
  const { createSale, loading: creating } = useSales()

  // Solo Boss puede acceder
  useEffect(() => {
    if (user && user.role !== 'boss') router.replace('/dashboard')
  }, [user, router])

  const [tab, setTab] = useState<'products' | 'packs'>('products')
  const [items, setItems] = useState<CartItem[]>([])
  const [shippingPaid, setShippingPaid] = useState('')
  const [shippingActual, setShippingActual] = useState('')
  const [payment, setPayment] = useState<PaymentMethod>('tarjeta')
  const [notes, setNotes] = useState('')
  const [showCart, setShowCart] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [saleError, setSaleError] = useState('')
  const [sizePicker, setSizePicker] = useState<Product | null>(null)
  const [packSizePicker, setPackSizePicker] = useState<Pack | null>(null)

  const cartCount = items.reduce((a, i) => a + i.quantity, 0)
  const itemsTotal = items.reduce((a, i) => a + i.unit_price * i.quantity, 0)
  const shippingPaidNum = Math.max(0, Number(shippingPaid) || 0)
  const shippingActualNum = Math.max(0, Number(shippingActual) || 0)
  const shippingDiff = shippingPaidNum - shippingActualNum
  const grandTotal = itemsTotal + shippingPaidNum

  const productQty = (productId: string) =>
    items.filter(i => i.type === 'product' && i.product?.id === productId)
      .reduce((s, i) => s + i.quantity, 0)

  const packQty = (packId: string) =>
    items.filter(i => i.type === 'pack' && i.pack?.id === packId)
      .reduce((s, i) => s + i.quantity, 0)

  const priceFor = (p: { sale_price: number; online_price?: number | null }) =>
    p.online_price != null && p.online_price >= 0 ? p.online_price : p.sale_price

  const addProduct = (product: Product, size?: string, variant?: ProductVariant) => {
    const variantId = variant?.id
    setItems(prev => {
      const existing = prev.find(i =>
        i.type === 'product' && i.product?.id === product.id && i.size === size && i.variant_id === variantId
      )
      if (existing) {
        return prev.map(i => i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i)
      }
      return [
        ...prev,
        {
          id: generateId(),
          type: 'product',
          product,
          quantity: 1,
          unit_price: priceFor(product),
          unit_cost: product.purchase_price,
          variant_id: variantId,
          size,
        },
      ]
    })
  }

  const addPack = (pack: Pack, packSizeSelections?: PackSizeSelection[]) => {
    const packCost = pack.items?.reduce((acc, it) =>
      acc + (it.product?.purchase_price ?? 0) * it.quantity, 0) ?? 0
    const unitPrice = priceFor(pack)
    setItems(prev => {
      if (packSizeSelections && packSizeSelections.length > 0) {
        return [
          ...prev,
          {
            id: generateId(),
            type: 'pack',
            pack,
            quantity: 1,
            unit_price: unitPrice,
            unit_cost: packCost,
            packSizeSelections,
          },
        ]
      }
      const existing = prev.find(i => i.type === 'pack' && i.pack?.id === pack.id && !i.packSizeSelections?.length)
      if (existing) return prev.map(i => i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [
        ...prev,
        { id: generateId(), type: 'pack', pack, quantity: 1, unit_price: unitPrice, unit_cost: packCost },
      ]
    })
  }

  const decreaseItem = (id: string) => {
    setItems(prev => prev
      .map(i => i.id === id ? { ...i, quantity: i.quantity - 1 } : i)
      .filter(i => i.quantity > 0)
    )
  }

  const removeItem = (id: string) => setItems(prev => prev.filter(i => i.id !== id))

  const handleSubmit = async () => {
    if (items.length === 0) return
    setSaleError('')
    const result = await createSale(items, payment, null, notes || undefined, {
      saleChannel: 'web',
      shippingCost: shippingPaidNum,
      shippingActualCost: shippingActualNum,
    })
    if (result.success) {
      // Actualización optimista de stock
      const decrements = items.flatMap(item => {
        if (item.type === 'product' && item.product) {
          return [{ product_id: item.product.id, qty: item.quantity }]
        }
        if (item.type === 'pack' && item.pack?.items) {
          return item.pack.items.map(pi => ({ product_id: pi.product_id, qty: pi.quantity * item.quantity }))
        }
        return []
      })
      patchStocks(decrements)
      setItems([])
      setShippingPaid('')
      setShippingActual('')
      setNotes('')
      setShowCart(false)
      setShowSuccess(true)
      refetchProducts()
      refetchPacks()
      setTimeout(() => setShowSuccess(false), 2200)
    } else {
      setSaleError(result.error ?? 'No se pudo registrar el pedido')
    }
  }

  if (!user || user.role !== 'boss') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <header className="flex items-center gap-3 px-3 py-2 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800 shrink-0">
        <button
          onClick={() => router.push('/dashboard')}
          className="p-2 rounded-xl hover:bg-zinc-800 text-zinc-400"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Globe size={14} className="text-purple-400 shrink-0" />
            <h1 className="text-sm font-bold text-white truncate">Nuevo pedido web</h1>
          </div>
          <p className="text-[10px] text-zinc-500 truncate">Solo Boss · canal web</p>
        </div>
        {cartCount > 0 && (
          <button
            onClick={() => setShowCart(true)}
            className="relative p-2 rounded-xl bg-white text-black"
          >
            <ShoppingCart size={18} strokeWidth={2.5} />
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-purple-500 rounded-full text-white text-xs font-black flex items-center justify-center">
              {cartCount}
            </span>
          </button>
        )}
      </header>

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
            content: loadingProducts ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
                <Package size={40} />
                <p className="mt-2 text-sm">No hay productos activos</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 auto-rows-min">
                {products.map(p => {
                  const isTextile = p.category?.name === 'Textil'
                  return (
                    <ProductCard
                      key={p.id}
                      product={p}
                      quantity={productQty(p.id)}
                      hasVariants={isTextile}
                      onAdd={() => isTextile ? setSizePicker(p) : addProduct(p)}
                      onDecrease={() => {
                        if (isTextile) return
                        const it = items.find(i => i.type === 'product' && i.product?.id === p.id)
                        if (it) decreaseItem(it.id)
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
            content: loadingPacks ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            ) : packs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
                <Package2 size={40} />
                <p className="mt-2 text-sm">No hay packs configurados</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {packs.map(pack => {
                  const textilItems = pack.items?.filter(i => i.product?.category?.name === 'Textil') ?? []
                  return (
                    <PackCard
                      key={pack.id}
                      pack={pack}
                      quantity={packQty(pack.id)}
                      onAdd={() => textilItems.length > 0 ? setPackSizePicker(pack) : addPack(pack)}
                      onDecrease={() => {
                        if (textilItems.length > 0) return
                        const it = items.find(i => i.type === 'pack' && i.pack?.id === pack.id)
                        if (it) decreaseItem(it.id)
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
              <p className="text-white font-black text-xl">{formatCurrency(itemsTotal)}</p>
            </div>
            <Button size="lg" onClick={() => setShowCart(true)} className="px-6 bg-purple-500 hover:bg-purple-400 text-white">
              Continuar
            </Button>
          </div>
        </div>
      )}

      {/* Modal carrito + datos del pedido */}
      <Modal open={showCart} onClose={() => setShowCart(false)} title="Pedido web" size="md">
        <div className="space-y-4">
          {/* Items */}
          {items.length === 0 ? (
            <p className="text-center text-zinc-500 text-sm py-6">Carrito vacío</p>
          ) : (
            <div className="space-y-2">
              {items.map(it => {
                const label = it.type === 'product'
                  ? `${it.product?.name ?? ''}${it.size ? ` · ${it.size}` : ''}`
                  : `${it.pack?.name ?? 'Pack'}${it.packSizeSelections?.length ? ` · ${it.packSizeSelections.map(s => s.size).join('/')}` : ''}`
                return (
                  <div key={it.id} className="flex items-center gap-2 p-2 bg-zinc-800/50 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold truncate">{label}</p>
                      <p className="text-zinc-500 text-xs">{formatCurrency(it.unit_price)} · {it.quantity} ud{it.quantity !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => decreaseItem(it.id)}
                        className="w-7 h-7 rounded-lg bg-zinc-700 flex items-center justify-center active:scale-90"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="text-white font-bold text-sm w-5 text-center">{it.quantity}</span>
                      <button
                        onClick={() => removeItem(it.id)}
                        className="w-7 h-7 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center active:scale-90"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Gastos de envío: pagado por cliente y real para empresa */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              <Truck size={12} />Gastos de envío
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-zinc-500 mb-1">Pagado por el cliente</p>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={shippingPaid}
                    onChange={e => setShippingPaid(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 pr-7 text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500 text-sm"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">€</span>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 mb-1">Real (coste empresa)</p>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={shippingActual}
                    onChange={e => setShippingActual(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 pr-7 text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500 text-sm"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">€</span>
                </div>
              </div>
            </div>
            {(shippingPaidNum > 0 || shippingActualNum > 0) && Math.abs(shippingDiff) > 0.001 && (
              <p className={`text-[11px] mt-1.5 font-semibold ${shippingDiff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {shippingDiff >= 0
                  ? `+${formatCurrency(shippingDiff)} de margen en el envío`
                  : `${formatCurrency(shippingDiff)} de pérdida en el envío`}
              </p>
            )}
          </div>

          {/* Método de pago */}
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Método de pago</p>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map(m => {
                const Icon = m.icon
                const selected = payment === m.value
                return (
                  <button
                    key={m.value}
                    onClick={() => setPayment(m.value)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${
                      selected
                        ? 'border-purple-500 bg-purple-500/10 text-white'
                        : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
                    }`}
                  >
                    <Icon size={16} />
                    <span className="text-sm font-semibold">{m.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Notas / dirección */}
          <div>
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5 block">
              Dirección y notas
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Nombre, dirección de envío, comentarios…"
              rows={3}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500 resize-none"
            />
          </div>

          {/* Resumen */}
          <div className="bg-zinc-800/50 rounded-xl p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Artículos</span>
              <span className="text-white font-semibold">{formatCurrency(itemsTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Envío cobrado</span>
              <span className="text-white font-semibold">{formatCurrency(shippingPaidNum)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Envío real</span>
              <span className="text-zinc-400">{formatCurrency(shippingActualNum)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-zinc-700">
              <span className="text-white font-bold">Total cobrado al cliente</span>
              <span className="text-white font-black text-lg">{formatCurrency(grandTotal)}</span>
            </div>
          </div>

          {saleError && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {saleError}
            </p>
          )}

          <Button
            fullWidth
            size="lg"
            onClick={handleSubmit}
            loading={creating}
            disabled={items.length === 0 || creating}
            className="bg-purple-500 hover:bg-purple-400 text-white"
          >
            Registrar pedido web
          </Button>
        </div>
      </Modal>

      {/* Modal éxito */}
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 slide-up">
            <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center shadow-2xl shadow-green-500/50">
              <Check size={48} className="text-white" strokeWidth={3} />
            </div>
            <p className="text-white text-2xl font-black">¡Pedido registrado!</p>
          </div>
        </div>
      )}

      {/* Modal selector de talla */}
      <SizePickerModal
        open={!!sizePicker}
        product={sizePicker}
        onClose={() => setSizePicker(null)}
        onSelect={(size, variant) => {
          if (sizePicker) addProduct(sizePicker, size, variant)
        }}
      />

      {/* Modal selector de tallas de pack */}
      <PackSizePickerModal
        open={!!packSizePicker}
        pack={packSizePicker}
        onClose={() => setPackSizePicker(null)}
        onConfirm={selections => {
          if (packSizePicker) addPack(packSizePicker, selections)
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

  return (
    <div className={`relative flex flex-col bg-zinc-900 border rounded-2xl overflow-hidden transition-all ${
      quantity > 0 ? 'border-purple-500 shadow-lg shadow-purple-500/10' : isOutOfStock ? 'border-zinc-800 opacity-40' : 'border-zinc-800'
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
          <div className="absolute top-2 right-2 w-7 h-7 bg-purple-500 rounded-full flex items-center justify-center shadow-lg z-10">
            <span className="text-white text-sm font-black">{quantity}</span>
          </div>
        )}
        <div className="absolute top-2 left-2 z-10">
          <span className="bg-black/75 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md leading-none backdrop-blur-sm">
            {product.stock} ud{product.stock !== 1 ? 's' : ''}
          </span>
        </div>
      </button>

      <div className="p-2.5">
        <p className="text-white text-sm font-semibold leading-tight line-clamp-1">{product.name}</p>
        <div className="flex items-center justify-between mt-1.5">
          {product.online_price != null
            ? (
              <div className="flex flex-col leading-none">
                <span className="text-purple-300 font-black text-base">{formatCurrency(product.online_price)}</span>
                <span className="text-zinc-600 text-[10px] line-through">{formatCurrency(product.sale_price)}</span>
              </div>
            )
            : <p className="text-white font-black text-base">{formatCurrency(product.sale_price)}</p>
          }
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
                className="w-6 h-6 rounded-lg bg-purple-500 flex items-center justify-center active:scale-90"
              >
                <Plus size={11} className="text-white" strokeWidth={3} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tarjeta de pack ─────────────────────────────────────────────────────────
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

  return (
    <div className={`relative flex bg-zinc-900 border rounded-2xl overflow-hidden transition-all ${
      quantity > 0 ? 'border-purple-500 shadow-lg shadow-purple-500/10' : isOutOfStock ? 'border-zinc-800 opacity-40' : 'border-zinc-800'
    }`}>
      <button
        onClick={onAdd}
        disabled={isOutOfStock}
        className="relative w-28 h-28 shrink-0 bg-zinc-800 active:scale-95 transition-transform"
      >
        <PackCollage items={pack.items ?? []} />
      </button>
      <div className="flex-1 min-w-0 p-3 flex flex-col justify-between">
        <div className="min-w-0">
          <p className="text-white text-base font-bold leading-tight line-clamp-2">{pack.name}</p>
          {pack.items && pack.items.length > 0 && (
            <p className="text-zinc-500 text-xs mt-1 line-clamp-2 leading-relaxed">
              {pack.items.map(i => `${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.product?.name ?? '?'}`).join(' · ')}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between mt-2">
          {pack.online_price != null
            ? (
              <div className="flex flex-col leading-none">
                <span className="text-purple-300 font-black text-xl">{formatCurrency(pack.online_price)}</span>
                <span className="text-zinc-600 text-[10px] line-through">{formatCurrency(pack.sale_price)}</span>
              </div>
            )
            : <span className="text-white font-black text-xl leading-none">{formatCurrency(pack.sale_price)}</span>
          }
          {quantity > 0 ? (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={onDecrease}
                className="w-8 h-8 rounded-xl bg-zinc-800 flex items-center justify-center active:scale-90"
              >
                <Minus size={13} />
              </button>
              <span className="text-white font-black text-base w-5 text-center">{quantity}</span>
              <button
                onClick={onAdd}
                className="w-8 h-8 rounded-xl bg-purple-500 flex items-center justify-center active:scale-90"
              >
                <Plus size={13} className="text-white" strokeWidth={3} />
              </button>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center shrink-0">
              <Plus size={15} className="text-purple-300" strokeWidth={2.5} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Selector de talla ──────────────────────────────────────────────────────
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

  return (
    <Modal open={open} onClose={onClose} title="Elige la talla" size="sm">
      <div className="space-y-3">
        <p className="text-zinc-400 text-sm font-medium truncate">{product?.name}</p>
        <div className="space-y-2">
          {sortedVariants.length > 0
            ? sortedVariants.map(v => {
                const outOfStock = v.stock === 0
                return (
                  <button
                    key={v.id}
                    disabled={outOfStock}
                    onClick={() => { onSelect(v.size, v); onClose() }}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                      outOfStock
                        ? 'border-zinc-800 opacity-40 cursor-not-allowed'
                        : 'border-zinc-700 hover:border-purple-500 active:bg-white/5'
                    }`}
                  >
                    <span className="text-white font-bold text-xl">{v.size}</span>
                    <span className={`text-sm font-semibold ${outOfStock ? 'text-red-500' : 'text-zinc-400'}`}>
                      {outOfStock ? 'Agotado' : `${v.stock} ud${v.stock !== 1 ? 's' : ''}`}
                    </span>
                  </button>
                )
              })
            : SIZES_ORDER.map(size => (
                <button
                  key={size}
                  onClick={() => { onSelect(size); onClose() }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-700 hover:border-purple-500 active:bg-white/5 transition-all"
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

// ─── Selector de tallas para packs ──────────────────────────────────────────
function PackSizePickerModal({
  open, pack, onClose, onConfirm,
}: {
  open: boolean
  pack: Pack | null
  onClose: () => void
  onConfirm: (selections: PackSizeSelection[]) => void
}) {
  if (!open || !pack) return null
  return (
    <PackSizePickerModalInner pack={pack} onClose={onClose} onConfirm={onConfirm} />
  )
}

function PackSizePickerModalInner({
  pack, onClose, onConfirm,
}: {
  pack: Pack
  onClose: () => void
  onConfirm: (selections: PackSizeSelection[]) => void
}) {
  const [selections, setSelections] = useState<Record<string, { variant_id: string; size: string }>>({})
  const textilItems = pack.items?.filter(i => i.product?.category?.name === 'Textil') ?? []

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
    <Modal open onClose={onClose} title="Elige las tallas del pack" size="sm">
      <div className="space-y-4">
        {textilItems.map(item => {
          const sortedVariants = (item.product?.variants ?? [])
            .slice()
            .sort((a, b) => SIZES_ORDER.indexOf(a.size) - SIZES_ORDER.indexOf(b.size))
          const sizesToShow = sortedVariants.length > 0
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
                          ? 'border-purple-500 bg-purple-500 text-white'
                          : outOfStock
                            ? 'border-zinc-800 text-zinc-700 cursor-not-allowed'
                            : 'border-zinc-700 text-zinc-300 hover:border-zinc-400'
                      }`}
                    >
                      <span className="block font-bold text-sm">{opt.size}</span>
                      {opt.stock >= 0 && (
                        <span className={`block text-[10px] mt-0.5 ${
                          selected ? 'text-purple-200' : outOfStock ? 'text-zinc-700' : 'text-zinc-500'
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
          <Button fullWidth disabled={!allSelected} onClick={handleConfirm} className="bg-purple-500 hover:bg-purple-400 text-white">
            Añadir al carrito
          </Button>
        </div>
      </div>
    </Modal>
  )
}
