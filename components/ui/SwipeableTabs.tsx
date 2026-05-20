'use client'
import { useEffect, useRef, useState } from 'react'

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
  panelClassName?: string
  swipeDisabled?: boolean
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

  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)
  const dir    = useRef<'h' | 'v' | null>(null)

  const areaRef = useRef<HTMLDivElement | null>(null)

  // Estado mutable accesible desde los listeners no-React (passive:false).
  const stateRef = useRef({ swipeDisabled, currentIndex, n })
  stateRef.current = { swipeDisabled, currentIndex, n }

  const reset = () => {
    startX.current = null
    startY.current = null
    dir.current    = null
    setDragX(0)
    setDragging(false)
  }

  const isModalOpen = () =>
    typeof document !== 'undefined' && document.body.style.overflow === 'hidden'

  // Listeners manuales con { passive: false } para que preventDefault sí frene
  // el scroll vertical del navegador cuando detectamos un swipe horizontal.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return

    const onTouchStart = (e: TouchEvent) => {
      if (stateRef.current.swipeDisabled || isModalOpen()) return
      startX.current = e.touches[0].clientX
      startY.current = e.touches[0].clientY
      dir.current    = null
    }

    const onTouchMove = (e: TouchEvent) => {
      if (stateRef.current.swipeDisabled || isModalOpen()) return
      if (startX.current === null || startY.current === null) return
      const dx = e.touches[0].clientX - startX.current
      const dy = e.touches[0].clientY - startY.current

      // Decidir dirección con un umbral pequeño y favoreciendo el horizontal:
      // si el desplazamiento horizontal supera al vertical más un margen,
      // tratamos el gesto como swipe.
      if (dir.current === null) {
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return
        dir.current = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v'
      }

      if (dir.current !== 'h') return

      // Bloquear scroll vertical del body durante el slide horizontal.
      if (e.cancelable) e.preventDefault()

      setDragging(true)

      const { currentIndex: idx, n: total } = stateRef.current
      const atStart = idx === 0 && dx > 0
      const atEnd   = idx === total - 1 && dx < 0
      setDragX(atStart || atEnd ? dx * 0.15 : dx)
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (stateRef.current.swipeDisabled) { reset(); return }
      const wasDragging = dir.current === 'h'
      if (!wasDragging) { reset(); return }

      const dx = e.changedTouches[0].clientX - (startX.current ?? 0)
      const threshold = 55
      const { currentIndex: idx, n: total } = stateRef.current

      if      (dx < -threshold && idx < total - 1) onChange(tabs[idx + 1].key)
      else if (dx >  threshold && idx > 0)         onChange(tabs[idx - 1].key)

      reset()
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove',  onTouchMove,  { passive: false })
    el.addEventListener('touchend',   onTouchEnd,   { passive: true })
    el.addEventListener('touchcancel', onTouchEnd,  { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove',  onTouchMove)
      el.removeEventListener('touchend',   onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
    // tabs/onChange capturados al montar; cambios de tabs no son críticos
    // porque siempre leemos via stateRef o tabs en cierre. Para minimizar
    // re-attachments, solo re-attachamos cuando cambia la cantidad de tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length])

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
        <div
          className="absolute bottom-0 left-0 h-0.5 bg-white rounded-full"
          style={indicatorStyle}
        />
      </div>

      {/* Área deslizable. touch-action:pan-y permite scroll vertical natural
          hasta que detectamos un swipe horizontal y llamamos preventDefault. */}
      <div
        ref={areaRef}
        className="flex-1 min-h-0 overflow-hidden overscroll-contain"
        style={{ touchAction: 'pan-y' }}
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
