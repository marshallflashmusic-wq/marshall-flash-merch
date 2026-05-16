import { create } from 'zustand'
import type { CartItem, Product, Pack, PaymentMethod } from '@/types'
import { generateId } from '@/lib/utils'

interface CartStore {
  items: CartItem[]
  paymentMethod: PaymentMethod
  eventId: string | null
  addProduct: (product: Product) => void
  addPack: (pack: Pack) => void
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

  addProduct: (product: Product) => {
    const { items } = get()
    const existing = items.find(i => i.type === 'product' && i.product?.id === product.id)
    if (existing) {
      set({
        items: items.map(i =>
          i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i
        ),
      })
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
          },
        ],
      })
    }
  },

  addPack: (pack: Pack) => {
    const { items } = get()
    const existing = items.find(i => i.type === 'pack' && i.pack?.id === pack.id)
    const packCost = pack.items?.reduce((acc, item) => {
      return acc + (item.product?.purchase_price ?? 0) * item.quantity
    }, 0) ?? 0

    if (existing) {
      set({
        items: items.map(i =>
          i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i
        ),
      })
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
    set({
      items: get().items.map(i => (i.id === id ? { ...i, quantity } : i)),
    })
  },

  setPaymentMethod: (method) => set({ paymentMethod: method }),
  setEventId: (id) => set({ eventId: id }),
  clearCart: () => set({ items: [], paymentMethod: 'efectivo' }),

  total: () => get().items.reduce((acc, i) => acc + i.unit_price * i.quantity, 0),
  totalCost: () => get().items.reduce((acc, i) => acc + i.unit_cost * i.quantity, 0),
  profit: () => get().total() - get().totalCost(),
  itemCount: () => get().items.reduce((acc, i) => acc + i.quantity, 0),
}))
