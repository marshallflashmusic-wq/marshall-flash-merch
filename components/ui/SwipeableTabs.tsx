'use client'
import { useRef, useState } from 'react'

interface SwipeableTab {
  key: string
  label: React.ReactNode
  content: React.ReactNode
}

interface Props {
  tabs: SwipeableTab[]
  activeKey: string
  onChange: (key: string) => void
  tabBarClassName?: string
  panelClassName?: string   // clase extra para cada panel (p.ej. padding)
  swipeDisabled?: boolean   // bloquea swipe horizontal (ej.: modal abierto)
}

export default function SwipeableTabs({
  tabs,
  activeKey,
  onChange,
  tabBarClassName = '',
  panelClassName = '',
  swipeDisabled = false,
}: Props) {
  const n = tabs.length
  const currentIndex = Math.max(0, tabs.findIndex(t => t.key === activeKey))

  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)

  const startX   = useRef<number | null>(null)
  const startY   = useRef<number | null>(null)
  const dir      = useRef<'h' | 'v' | null>(null)  // dirección detectada

  const reset = () => {
    startX.current = null
    startY.current = null
    dir.current    = null
    setDragX(0)
    setDragging(false)
  }

  // Si hay un Modal abierto, document.body.style.overflow === 'hidden'.
  // En ese caso ignoramos el swipe (evita que el usuario cambie de tab
  // mientras está rellenando un formulario en un modal).
  const isModalOpen = () =>
    typeof document !== 'undefined' && document.body.style.overflow === 'hidden'

  const handleTouchStart = (e: React.TouchEvent) => {
    if (swipeDisabled || isModalOpen()) return
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    dir.current    = null
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (swipeDisabled || isModalOpen()) return
    if (startX.current === null || startY.current === null) return
    const dx = e.touches[0].clientX - startX.current
    const dy = e.touches[0].clientY - startY.current

    // Decidir dirección en el primer movimiento significativo
    if (dir.current === null) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return
      dir.current = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v'
    }

    if (dir.current !== 'h') return   // scroll vertical → no interferir
    e.preventDefault()                 // bloquear scroll mientras deslizamos

    setDragging(true)

    // Efecto rubber-band en los extremos
    const atStart = currentIndex === 0 && dx > 0
    const atEnd   = currentIndex === n - 1 && dx < 0
    setDragX(atStart || atEnd ? dx * 0.15 : dx)
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (swipeDisabled) { reset(); return }
    if (!dragging) { reset(); return }

    const dx = e.changedTouches[0].clientX - (startX.current ?? 0)
    const threshold = 55  // px mínimos para cambiar de tab

    if      (dx < -threshold && currentIndex < n - 1) onChange(tabs[currentIndex + 1].key)
    else if (dx >  threshold && currentIndex > 0)      onChange(tabs[currentIndex - 1].key)

    reset()
  }

  // translateX del slider:
  //   -currentIndex/n * 100%  →  posición base del tab activo
  //   + dragX px              →  offset de arrastre en tiempo real
  const sliderStyle: React.CSSProperties = {
    width:      `${n * 100}%`,
    transform:  `translateX(calc(${-(currentIndex / n) * 100}% + ${dragX}px))`,
    transition: dragging ? 'none' : 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    willChange: 'transform',
    display:    'flex',
    height:     '100%',
  }

  const indicatorStyle: React.CSSProperties = {
    width:      `${100 / n}%`,
    transform:  `translateX(${currentIndex * 100}%)`,
    transition: 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Barra de tabs con indicador animado */}
      <div className={`relative flex shrink-0 border-b border-zinc-800 bg-zinc-950 ${tabBarClassName}`}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`flex-1 py-3 text-sm font-semibold transition-colors duration-200 ${
              tab.key === activeKey ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
        {/* Línea indicadora que se mueve suavemente */}
        <div
          className="absolute bottom-0 left-0 h-0.5 bg-white rounded-full"
          style={indicatorStyle}
        />
      </div>

      {/* Área deslizable. `touch-action: pan-y` permite scroll vertical dentro de
          los paneles pero bloquea gestos horizontales del navegador (back/forward
          swipe). `overscroll-contain` evita que el scroll se filtre al body. */}
      <div
        className="flex-1 min-h-0 overflow-hidden overscroll-contain"
        style={{ touchAction: 'pan-y' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div style={sliderStyle}>
          {tabs.map(tab => (
            <div
              key={tab.key}
              className={`overflow-y-auto overscroll-contain h-full ${panelClassName}`}
              style={{ width: `${100 / n}%`, flexShrink: 0 }}
            >
              {tab.content}
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
