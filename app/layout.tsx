import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Marshall Flash Merch',
  description: 'Gestión de inventario y ventas de merchandising',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MF Merch',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0a0a',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className="h-full">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="h-full overflow-hidden bg-[#0a0a0a] text-white">
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(regs) {
              if (regs.length === 0) return;
              var ps = regs.map(function(r) { return r.unregister(); });
              Promise.all(ps).then(function() {
                if ('caches' in window) {
                  caches.keys().then(function(names) {
                    Promise.all(names.map(function(n) { return caches.delete(n); }))
                      .then(function() { window.location.reload(); });
                  });
                } else {
                  window.location.reload();
                }
              });
            });
          }
        `}} />
        {children}
      </body>
    </html>
  )
}
