import { openDB, type IDBPDatabase } from 'idb'
import type { OfflineSale, Product } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MerchDB = any

let db: IDBPDatabase<MerchDB> | null = null

export async function getDB(): Promise<IDBPDatabase<MerchDB>> {
  if (db) return db
  db = await openDB<MerchDB>('marshall-flash-merch', 1, {
    upgrade(database) {
      const salesStore = database.createObjectStore('offline_sales', { keyPath: 'id' })
      salesStore.createIndex('by-pending', 'pending_sync')
      database.createObjectStore('cached_products', { keyPath: 'id' })
      database.createObjectStore('cached_events', { keyPath: 'id' })
    },
  })
  return db
}

export async function savePendingSale(sale: OfflineSale): Promise<void> {
  const database = await getDB()
  await database.put('offline_sales', sale)
}

export async function getPendingSales(): Promise<OfflineSale[]> {
  const database = await getDB()
  const all: OfflineSale[] = await database.getAll('offline_sales')
  return all.filter(s => s.pending_sync)
}

export async function markSaleSynced(id: string): Promise<void> {
  const database = await getDB()
  const sale = await database.get('offline_sales', id)
  if (sale) {
    sale.pending_sync = false
    await database.put('offline_sales', sale)
  }
}

export async function deleteSyncedSale(id: string): Promise<void> {
  const database = await getDB()
  await database.delete('offline_sales', id)
}

export async function cacheProducts(products: Product[]): Promise<void> {
  const database = await getDB()
  const tx = database.transaction('cached_products', 'readwrite')
  await Promise.all(products.map(p => tx.store.put(p)))
  await tx.done
}

export async function getCachedProducts(): Promise<Product[]> {
  const database = await getDB()
  return database.getAll('cached_products')
}

export async function cacheEvents(events: { id: string; name: string; city: string; venue: string; date: string }[]): Promise<void> {
  const database = await getDB()
  const tx = database.transaction('cached_events', 'readwrite')
  await Promise.all(events.map(e => tx.store.put(e)))
  await tx.done
}

export async function getCachedEvents() {
  const database = await getDB()
  return database.getAll('cached_events')
}
