import { create } from 'zustand'
import type { CartItem, Product, Pack, PaymentMethod, ProductVariant, PackSizeSelection } from '@/types'
import { generateId } from '@/lib/utils'

interface CartStore {
  items: CartItem[]
  paymentMethod: PaymentMethod
  eventId: string | null
  addProduct: (product: Product, size?: string, variant?: ProductVariant) => void
  addPack: (pack: Pack, packSizeSelections?: PackSizeSelection[]) => void
  removeItem: (id: string) => void
  updateQuantity: (id: string, quantity: number) => void
  setPaymentMethod: (method: PaymentMethod) => void
  setEventId: (id: string | null) => void
  clearCart: () => void
  total: () => number
  totalCost: () => number
  profit: () => number
  itemCount: () => number
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  paymentMethod: 'efectivo',
  eventId: null,

  addProduct: (product: Product, size?: string, variant?: ProductVariant) => {
    const { items } = get()
    const effectiveVariantId = variant?.id || undefined
    // Productos textiles: clave por (product.id + size) para líneas separadas por talla
    const existing = items.find(i =>
      i.type === 'product' &&
      i.product?.id === product.id &&
      i.size === size &&
      i.variant_id === effectiveVariantId
    )
    if (existing) {
      set({ items: items.map(i => i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i) })
    } else {
      set({
        items: [
          ...items,
          {
            id: generateId(),
            type: 'product',
            product,
            quantity: 1,
            unit_price: product.sale_price,
            unit_cost: product.purchase_price,
            variant_id: effectiveVariantId,
            size,
          },
        ],
      })
    }
  },

  addPack: (pack: Pack, packSizeSelections?: PackSizeSelection[]) => {
    const { items } = get()
    const packCost = pack.items?.reduce((acc, item) => {
      return acc + (item.product?.purchase_price ?? 0) * item.quantity
    }, 0) ?? 0

    // Si hay selección de tallas, cada venta del pack es siempre una línea nueva
    if (packSizeSelections && packSizeSelections.length > 0) {
      set({
        items: [
          ...items,
          {
            id: generateId(),
            type: 'pack',
            pack,
            quantity: 1,
            unit_price: pack.sale_price,
            unit_cost: packCost,
            packSizeSelections,
          },
        ],
      })
      return
    }

    const existing = items.find(i => i.type === 'pack' && i.pack?.id === pack.id && !i.packSizeSelections?.length)
    if (existing) {
      set({ items: items.map(i => i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i) })
    } else {
      set({
        items: [
          ...items,
          {
            id: generateId(),
            type: 'pack',
            pack,
            quantity: 1,
            unit_price: pack.sale_price,
            unit_cost: packCost,
          },
        ],
      })
    }
  },

  removeItem: (id: string) => {
    set({ items: get().items.filter(i => i.id !== id) })
  },

  updateQuantity: (id: string, quantity: number) => {
    if (quantity <= 0) {
      get().removeItem(id)
      return
    }
    set({ items: get().items.map(i => (i.id === id ? { ...i, quantity } : i)) })
  },

  setPaymentMethod: (method) => set({ paymentMethod: method }),
  setEventId: (id) => set({ eventId: id }),
  clearCart: () => set({ items: [], paymentMethod: 'efectivo' }),

  total: () => get().items.reduce((acc, i) => acc + i.unit_price * i.quantity, 0),
  totalCost: () => get().items.reduce((acc, i) => acc + i.unit_cost * i.quantity, 0),
  profit: () => get().total() - get().totalCost(),
  itemCount: () => get().items.reduce((acc, i) => acc + i.quantity, 0),
}))
