// Service worker de desarrollo: se autodestruye para no interferir con la app.
// El build de producción (npm run build) regenera este archivo con next-pwa.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.registration.unregister().then(() => self.clients.matchAll()).then((clients) => {
      clients.forEach((client) => client.navigate(client.url))
    })
  )
})
