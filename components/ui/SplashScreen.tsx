'use client'
import { useState, useEffect } from 'react'

export default function SplashScreen() {
  const [logoReady, setLogoReady] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    // Siguiente frame: dispara el fade-in del logo
    const raf = requestAnimationFrame(() => setLogoReady(true))
    // 1.6 s después: inicia fade-out del overlay
    const t1 = setTimeout(() => setFadeOut(true), 1600)
    // 2.2 s: desmonta el componente
    const t2 = setTimeout(() => setHidden(true), 2200)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  if (hidden) return null

  return (
    <div
      style={{
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 0.55s ease',
      }}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0a0a0a]"
    >
      {/* Logo */}
      <div
        style={{
          opacity: logoReady ? 1 : 0,
          transform: logoReady ? 'scale(1)' : 'scale(0.82)',
          transition: 'opacity 0.65s ease, transform 0.65s ease',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-512.png"
          alt="MyMerch"
          width={112}
          height={112}
          className="rounded-[28px] shadow-2xl shadow-amber-500/20"
        />
      </div>

      {/* Nombre con ligero delay */}
      <p
        style={{
          opacity: logoReady ? 1 : 0,
          transform: logoReady ? 'translateY(0px)' : 'translateY(10px)',
          transition: 'opacity 0.65s ease 0.18s, transform 0.65s ease 0.18s',
        }}
        className="mt-5 text-white text-2xl font-black tracking-tight"
      >
        MyMerch
      </p>
    </div>
  )
}
