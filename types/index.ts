export type UserRole = 'admin' | 'staff'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  avatar_url?: string
  active: boolean
  created_at: string
}

export interface Category {
  id: string
  name: string
  color?: string
  created_at: string
}

export interface Product {
  id: string
  name: string
  description?: string
  category_id?: string
  category?: Category
  sku?: string
  size?: string
  purchase_price: number
  sale_price: number
  stock: number
  min_stock: number
  image_url?: string
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface Pack {
  id: string
  name: string
  description?: string
  sale_price: number
  image_url?: string
  active: boolean
  items?: PackItem[]
  created_at: string
  updated_at: string
}

export interface PackItem {
  id: string
  pack_id: string
  product_id: string
  product?: Product
  quantity: number
}

export interface Event {
  id: string
  name: string
  city: string
  venue: string
  date: string
  notes?: string
  active: boolean
  created_at: string
}

export type PaymentMethod = 'efectivo' | 'bizum' | 'tarjeta' | 'paypal' | 'mixto'

export interface Sale {
  id: string
  event_id?: string
  event?: Event
  user_id: string | null
  user?: User
  payment_method: PaymentMethod
  total_amount: number
  total_cost: number
  profit: number
  notes?: string | null
  synced: boolean
  created_at: string
  items?: SaleItem[]
}

export interface SaleItem {
  id: string
  sale_id: string
  product_id?: string
  product?: Product
  pack_id?: string
  pack?: Pack
  quantity: number
  unit_price: number
  unit_cost: number
  subtotal: number
  profit: number
}

export type MovementType = 'sale' | 'adjustment' | 'restock' | 'pack_sale' | 'return'

export interface InventoryMovement {
  id: string
  product_id: string
  product?: Product
  type: MovementType
  quantity: number
  previous_stock: number
  new_stock: number
  reference_id?: string
  notes?: string
  user_id: string
  created_at: string
}

export interface CartItem {
  id: string
  type: 'product' | 'pack'
  product?: Product
  pack?: Pack
  quantity: number
  unit_price: number
  unit_cost: number
}

export interface DashboardStats {
  sales_today: number
  revenue_today: number
  profit_today: number
  items_sold_today: number
  low_stock_count: number
  top_products: { name: string; quantity: number; revenue: number }[]
  sales_by_payment: { method: PaymentMethod; total: number; count: number }[]
}

export interface SaleFilters {
  date_from?: string
  date_to?: string
  event_id?: string
  user_id?: string
  payment_method?: PaymentMethod
}

export interface OfflineSale {
  id: string
  data: Omit<Sale, 'id' | 'created_at'>
  items: Omit<SaleItem, 'id' | 'sale_id'>[]
  stockDecrements: { product_id: string; quantity: number }[]
  created_at: string
  pending_sync: boolean
}
