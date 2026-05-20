'use client'
import { useState } from 'react'
import Image from 'next/image'
import {
  HelpCircle, CalendarDays, Package, ShoppingCart, Terminal,
  ChevronDown,
} from 'lucide-react'
import TopBar from '@/components/layout/TopBar'
import Card from '@/components/ui/Card'

type Section = {
  key: string
  title: string
  icon: React.ElementType
  steps: string[]
}

const SECTIONS: Section[] = [
  {
    key: 'create-event',
    title: 'Crear un concierto',
    icon: CalendarDays,
    steps: [
      'Entra en la pestaña "Conciertos" y pulsa el botón +.',
      'Rellena nombre, ciudad, sala y fecha. Las notas son opcionales.',
      'Pulsa "Activar y asignar artículos" para crear el concierto, marcarlo como activo y abrir el editor de stock.',
    ],
  },
  {
    key: 'assign-stock',
    title: 'Asignar artículos a un concierto',
    icon: Package,
    steps: [
      'Desde el listado de conciertos, abre el concierto y pulsa "Stock concierto".',
      'Selecciona los productos y la cantidad que quieres reservar para ese concierto.',
      'La asignación reserva unidades lógicamente: no se descuentan del stock global hasta que se vendan.',
    ],
  },
  {
    key: 'tpv',
    title: 'Abrir un TPV para vendedores',
    icon: Terminal,
    steps: [
      'Entra en Config → TPV y elige la duración del PIN.',
      'Pulsa "Generar PIN" y comparte el código con el vendedor.',
      'El vendedor entra en /login → "Tengo un PIN", introduce el PIN y su nombre, y queda en modo TPV.',
      'Cada PIN puede usarse por un único dispositivo a la vez.',
    ],
  },
  {
    key: 'sell',
    title: 'Hacer una venta',
    icon: ShoppingCart,
    steps: [
      'En "Vender" elige si la venta es en un concierto o rápida (fuera de concierto).',
      'Añade productos o packs al carrito. Si es un concierto, el catálogo se limita a lo asignado.',
      'Pulsa el carrito, elige método de pago y confirma. La venta se guarda y descuenta stock automáticamente.',
    ],
  },
  {
    key: 'close-event',
    title: 'Cerrar o cancelar un concierto',
    icon: CalendarDays,
    steps: [
      'En la pestaña "Conciertos", abre el menú del concierto y pulsa "Cerrar" cuando termine.',
      'Al cerrar, las unidades no vendidas dejan de estar reservadas y vuelven a estar disponibles.',
      'Las ventas registradas se mantienen ligadas al concierto en el historial.',
    ],
  },
]

export default function HelpPage() {
  const [open, setOpen] = useState<string | null>('create-event')

  return (
    <div className="h-full flex flex-col">
      <TopBar title="Ayuda" subtitle="Tutorial rápido" />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <Card padding="md">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-zinc-900 border border-zinc-800">
              <Image
                src="/icons/icon-192.png"
                alt="MyMerch"
                width={48}
                height={48}
                className="w-full h-full object-cover"
                priority
              />
            </div>
            <div>
              <p className="text-white font-bold text-sm">MyMerch</p>
              <p className="text-zinc-500 text-xs mt-0.5">
                App TPV de merchandising para conciertos. Toca cada sección para ver los pasos.
              </p>
            </div>
          </div>
        </Card>

        {SECTIONS.map(section => {
          const Icon = section.icon
          const isOpen = open === section.key
          return (
            <Card key={section.key} padding="none">
              <button
                onClick={() => setOpen(isOpen ? null : section.key)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-zinc-800/50 transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0">
                  <Icon size={16} className="text-zinc-300" />
                </div>
                <p className="flex-1 text-white text-sm font-semibold">{section.title}</p>
                <ChevronDown
                  size={16}
                  className={`text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {isOpen && (
                <ol className="px-4 pb-4 pt-1 space-y-2 list-decimal list-inside text-sm text-zinc-300">
                  {section.steps.map((step, i) => (
                    <li key={i} className="leading-snug">{step}</li>
                  ))}
                </ol>
              )}
            </Card>
          )
        })}

        {/* Créditos */}
        <div className="pt-4 pb-2 text-center">
          <div className="inline-flex items-center gap-2 text-zinc-600">
            <HelpCircle size={14} />
            <p className="text-xs">¿Algo no funciona? Avísanos.</p>
          </div>
          <p className="text-zinc-500 text-xs mt-3 font-semibold">Powered by MyMerch</p>
          <p className="text-zinc-700 text-[10px] mt-1">v1.0 · MyMerch</p>
        </div>
      </div>
    </div>
  )
}
