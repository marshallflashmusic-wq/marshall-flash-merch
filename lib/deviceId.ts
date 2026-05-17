// ID único y persistente por dispositivo/navegador.
// Se genera una sola vez y se guarda en localStorage.
export function getDeviceId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('merch-device-id')
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    localStorage.setItem('merch-device-id', id)
  }
  return id
}
