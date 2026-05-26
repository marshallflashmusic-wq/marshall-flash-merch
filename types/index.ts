export type UserRole = 'admin' | 'staff' | 'boss'

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

export interface ProductVariant {
  id: string
  product_id: string
  size: string
  stock: number
  updated_at: string
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
  online_price?: number | null
  stock: number
  min_stock: number
  image_url?: string
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
  variants?: ProductVariant[]
}

export interface Pack {
  id: string
  name: string
  description?: string
  sale_price: number
  online_price?: number | null
  image_url?: string
  active: boolean
  items?: PackItem[]
  available_stock?: number
  created_at: string
  updated_at: string
}

export interface PackItem {
  id: string
  pack_id: string
  product_id: string
  product?: Product
  quantity: number
  individual_pack_price?: number | null
}

export type EventStatus = 'upcoming' | 'active' | 'closed' | 'cancelled'

export interface Event {
  id: string
  name: string
  city: string
  venue: string
  date: string
  notes?: string
  active: boolean
  status: EventStatus
  closed_at?: string | null
  created_at: string
}

export interface EventInventoryItem {
  id: string
  event_id: string
  product_id: string
  variant_id?: string | null
  quantity_assigned: number
  quantity_sold: number
  quantity_remaining: number
  warehouse_id?: string | null
  product_name?: string
  product_image?: string | null
  product_sale_price?: number
  product_purchase_price?: number
  variant_size?: string | null
  variant_global_stock?: number | null
  product_global_stock?: number
  product?: Product
  variant?: ProductVariant
}

export type TpvFlow = 'event' | 'quick' | null

export type PaymentMethod = 'efectivo' | 'bizum' | 'tarjeta' | 'paypal' | 'mixto'

export type SaleChannel = 'pos' | 'web'

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
  seller_name?: string | null
  seller_type?: 'admin' | 'tpv' | null
  sale_channel?: SaleChannel
  shipping_cost?: number
  shipping_actual_cost?: number
  created_at: string
  items?: SaleItem[]
}

export interface TpvSession {
  id: string
  pin_code: string
  seller_name: string | null
  created_at: string
  expires_at: string
  active: boolean
  created_by: string | null
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
  warehouse_id?: string | null
  warehouse?: { id: string; name: string } | null
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

export interface PackSizeSelection {
  product_id: string
  variant_id: string
  size: string
}

export interface CartItem {
  id: string
  type: 'product' | 'pack'
  product?: Product
  pack?: Pack
  quantity: number
  unit_price: number
  unit_cost: number
  // Textil individual
  variant_id?: string
  size?: string
  // Pack con artículos textiles
  packSizeSelections?: PackSizeSelection[]
  // Almacén de origen elegido para venta rápida (por item)
  warehouse_id?: string
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
  amount_min?: number
  amount_max?: number
  sale_channel?: SaleChannel
}

export interface OfflineSale {
  id: string
  data: Omit<Sale, 'id' | 'created_at'>
  items: Omit<SaleItem, 'id' | 'sale_id'>[]
  stockDecrements: {
    product_id: string
    quantity: number
    movement_type?: string
    variant_id?: string
    event_inventory_id?: string
    warehouse_id?: string
  }[]
  created_at: string
  pending_sync: boolean
}
