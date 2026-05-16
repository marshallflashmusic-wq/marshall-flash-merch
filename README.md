# Marshall Flash Merch — PWA de Gestión de Merchandising

Aplicación web progresiva (PWA) para gestión de inventario y ventas de merchandising en conciertos. Diseñada para ser rápida, táctil y funcionar offline.

---

## Stack

- **Next.js 16** (App Router)
- **React 19** + **TypeScript**
- **Tailwind CSS v4**
- **Supabase** (PostgreSQL + Auth)
- **next-pwa** (Service Worker + Offline)
- **Zustand** (Estado global)
- **IndexedDB/idb** (Almacenamiento offline)
- **Lucide React** (Iconos)

---

## Instalación

### 1. Clonar / copiar el proyecto

```bash
cd marshall-flash-merch
npm install
```

### 2. Configurar Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com)
2. Ve a **Settings > API** y copia la URL y la anon key
3. Copia `.env.example` a `.env.local`:

```bash
cp .env.example .env.local
```

4. Rellena las variables en `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key-aqui
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
```

### 3. Ejecutar el schema SQL en Supabase

1. Ve a **SQL Editor** en tu proyecto de Supabase
2. Copia y pega el contenido de `supabase/schema.sql`
3. Ejecuta el script — esto crea todas las tablas, políticas RLS, funciones y datos seed

### 4. Crear el primer usuario admin

En Supabase Dashboard > **Authentication > Users**:
1. Click en "Add user"
2. Introduce email y contraseña
3. Una vez creado, ve a **SQL Editor** y ejecuta:

```sql
UPDATE public.profiles SET role = 'admin' WHERE email = 'tu@email.com';
```

### 5. Ejecutar en desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

### 6. Build de producción

```bash
npm run build
npm run start
```

---

## Estructura del proyecto

```
marshall-flash-merch/
├── app/
│   ├── (auth)/login/         — Pantalla de login
│   ├── (protected)/
│   │   ├── dashboard/        — Dashboard con estadísticas
│   │   ├── inventory/        — Gestión de inventario
│   │   ├── sales/
│   │   │   ├── new/          — ⭐ Nueva venta (pantalla principal)
│   │   │   └── history/      — Historial de ventas
│   │   ├── events/           — Gestión de eventos/conciertos
│   │   └── settings/         — Configuración, usuarios, packs
│   ├── globals.css
│   └── layout.tsx
├── components/
│   ├── ui/                   — Button, Card, Modal, Input, Badge, Select
│   ├── layout/               — TopBar, BottomNav
│   └── providers/            — SessionProvider
├── hooks/
│   ├── useProducts.ts
│   ├── usePacks.ts
│   ├── useEvents.ts
│   └── useSales.ts
├── lib/
│   ├── supabase/             — client.ts, server.ts
│   ├── offline/              — IndexedDB para modo offline
│   └── utils.ts
├── store/
│   ├── cartStore.ts          — Estado del carrito de venta
│   └── appStore.ts           — Estado global (usuario, evento, conexión)
├── types/
│   └── index.ts              — Todos los tipos TypeScript
├── supabase/
│   └── schema.sql            — Schema completo de base de datos
├── public/
│   ├── manifest.json         — PWA manifest
│   ├── icons/                — Iconos 192px y 512px
│   └── images/               — Imágenes de productos
├── scripts/
│   └── generate-icons.js     — Genera iconos PNG desde SVG
└── proxy.ts                  — Autenticación a nivel de rutas
```

---

## Funcionalidades

### Dashboard
- Ingresos y beneficio del día en tiempo real
- Ventas por método de pago
- Productos más vendidos
- Alertas de stock bajo
- Evento activo

### Inventario
- Vista en cards con imagen, stock y precio
- Ajuste rápido de stock (+/-)
- Alertas visuales: stock bajo (ámbar) y sin stock (rojo)
- Crear / editar productos (solo admin)
- Activar/desactivar productos

### Nueva Venta ⭐
- Grid táctil de productos y packs
- Carrito con ajuste de cantidades
- 5 métodos de pago: Efectivo, Bizum, Tarjeta, PayPal, Mixto
- Confirmación visual grande
- Feedback de éxito con animación
- Funciona **offline** — sincroniza automáticamente

### Historial de Ventas
- Filtros por fecha, evento, método de pago
- Detalle completo de cada venta
- Exportar CSV
- Resumen de ingresos y beneficios

### Eventos / Conciertos
- Crear eventos con nombre, ciudad, sala y fecha
- Marcar evento como activo (las ventas se asocian a él)

### Configuración
- Gestión de usuarios (crear staff/admin)
- Gestión de packs (crear/editar packs de productos)
- Exportar inventario CSV

---

## Modo Offline

La app está diseñada para funcionar sin conexión a internet:

1. **Assets cacheados** — la app se carga aunque no haya red
2. **Ventas offline** — se guardan en IndexedDB
3. **Sincronización automática** — al recuperar conexión se suben las ventas pendientes
4. **Indicador de estado** — icono WiFi en la barra superior muestra el estado de conexión
5. **Contador de pendientes** — muestra cuántas ventas están por sincronizar

---

## PWA — Instalación en dispositivos

### iPhone/iPad (Safari)
1. Abre la app en Safari
2. Pulsa el botón "Compartir" (□↑)
3. Selecciona "Añadir a pantalla de inicio"

### Android (Chrome)
1. Abre la app en Chrome
2. Pulsa el menú (⋮)
3. Selecciona "Añadir a pantalla de inicio"

### Escritorio (Chrome/Edge)
1. Aparecerá un icono de instalación en la barra de direcciones
2. O usa el menú > "Instalar aplicación"

---

## Base de datos — Tablas principales

| Tabla | Descripción |
|-------|-------------|
| `profiles` | Usuarios (admins y staff) |
| `products` | Productos de merchandising |
| `categories` | Categorías de productos |
| `packs` | Packs de varios productos |
| `pack_items` | Items dentro de cada pack |
| `events` | Conciertos y eventos |
| `sales` | Ventas realizadas |
| `sale_items` | Líneas de cada venta |
| `inventory_movements` | Registro de todos los movimientos de stock |

---

## Productos iniciales (seed)

| Producto | SKU | Precio compra | Precio venta | Stock |
|----------|-----|--------------|-------------|-------|
| CD Relativa Sencillez | CD-001 | 3,50 € | 10,00 € | 50 |
| Chapa cuadrada | CHAP-SQ-001 | 0,50 € | 2,00 € | 100 |
| Chapa redonda | CHAP-RD-001 | 0,50 € | 2,00 € | 100 |
| Set púas | PUAS-001 | 1,00 € | 4,00 € | 60 |

**Pack Fan** (CD + chapa redonda + set púas) → 14,00 €

---

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública (anon) de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (solo servidor) |

---

## Roles de usuario

### Admin
- Acceso completo a todas las funciones
- Crear/editar/eliminar productos
- Gestionar usuarios
- Crear y gestionar packs
- Ver estadísticas completas
- Exportar datos

### Staff
- Realizar ventas
- Ver inventario y stock
- Ver ventas del día
- **No puede** editar productos ni ver configuración avanzada
