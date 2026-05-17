'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAppStore } from '@/store/appStore'
import { Zap, Lock, Mail, Eye, EyeOff, ChevronDown, Hash, User } from 'lucide-react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

export default function LoginPage() {
  const router = useRouter()
  const { setSaleMode, setTpvSession } = useAppStore()

  const [showTpvForm, setShowTpvForm] = useState(false)
  const [pin, setPin] = useState('')
  const [sellerName, setSellerName] = useState('')
  const [tpvLoading, setTpvLoading] = useState(false)
  const [tpvError, setTpvError] = useState('')

  const [showAdminForm, setShowAdminForm] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')

  const handleTpvLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setTpvError('')
    setTpvLoading(true)
    try {
      const res = await fetch('/api/tpv-sessions/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, sellerName }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTpvError(data.error ?? 'PIN no válido')
        return
      }
      setTpvSession(data.session)
      setSaleMode(true)
      router.push('/sales/new')
    } catch {
      setTpvError('Error de conexión. Comprueba el wifi.')
    } finally {
      setTpvLoading(false)
    }
  }

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdminError('')
    setAdminLoading(true)
    try {
      const supabase = createClient()
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        setAdminError('Email o contraseña incorrectos')
      } else {
        setTpvSession(null)
        setSaleMode(false)
        router.push('/dashboard')
        router.refresh()
      }
    } catch {
      setAdminError('Error de conexión.')
    } finally {
      setAdminLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-5">
      <div className="w-full max-w-sm flex flex-col gap-5">

        {/* Branding */}
        <div className="flex flex-col items-center mb-2">
          <div className="w-20 h-20 rounded-2xl overflow-hidden mb-3 shadow-lg shadow-green-500/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-512.png" alt="MyMerch" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-black text-white tracking-tight">MyMerch</h1>
          <p className="text-zinc-600 text-xs mt-0.5">Gestión de inventario y Punto de venta</p>
        </div>

        {/* MODO VENTA — con PIN */}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => { setShowTpvForm(v => !v); setTpvError('') }}
            className="w-full bg-white hover:bg-zinc-100 active:bg-zinc-200 rounded-3xl p-7 flex flex-col items-center gap-3 transition-all duration-100 tap-scale shadow-2xl shadow-white/10"
          >
            <Zap size={44} className="text-black" strokeWidth={2.5} fill="currentColor" />
            <div className="text-center">
              <p className="text-black text-2xl font-black tracking-tight leading-none">MODO VENTA</p>
              <p className="text-black/60 text-sm font-medium mt-1">Acceso con PIN de vendedor</p>
            </div>
          </button>

          {showTpvForm && (
            <form
              onSubmit={handleTpvLogin}
              className="flex flex-col gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 fade-in"
            >
              <Input
                label="PIN de acceso"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                placeholder="0000"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                icon={<Hash size={16} />}
                required
                autoComplete="off"
              />
              <Input
                label="Tu nombre"
                type="text"
                placeholder="Ej: Pablo"
                value={sellerName}
                onChange={e => setSellerName(e.target.value)}
                icon={<User size={16} />}
                required
                autoComplete="off"
              />
              {tpvError && (
                <p className="text-red-400 text-xs text-center bg-red-950/50 border border-red-900 rounded-xl py-2">
                  {tpvError}
                </p>
              )}
              <Button type="submit" fullWidth loading={tpvLoading}>
                <Zap size={16} />
                Entrar al TPV
              </Button>
            </form>
          )}
        </div>

        {/* Acceso Admin — colapsable */}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setShowAdminForm(v => !v)}
            className="flex items-center justify-center gap-2 py-2.5 text-zinc-500 hover:text-zinc-300 transition-colors text-sm"
          >
            <Lock size={14} />
            <span>Acceso administrador</span>
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${showAdminForm ? 'rotate-180' : ''}`}
            />
          </button>

          {showAdminForm && (
            <form onSubmit={handleAdminLogin} className="flex flex-col gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 fade-in">
              <Input
                type="email"
                placeholder="admin@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                icon={<Mail size={16} />}
                required
                autoComplete="email"
              />
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="Contraseña"
                value={password}
                onChange={e => setPassword(e.target.value)}
                icon={<Lock size={16} />}
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-zinc-500 hover:text-zinc-300 p-1"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                }
                required
                autoComplete="current-password"
              />
              {adminError && (
                <p className="text-red-400 text-xs text-center bg-red-950/50 border border-red-900 rounded-xl py-2">{adminError}</p>
              )}
              <Button type="submit" fullWidth loading={adminLoading} variant="secondary">
                Entrar como admin
              </Button>
            </form>
          )}
        </div>

      </div>

      <p className="text-zinc-700 text-[11px] mt-6">Powered by Marshall Flash</p>
    </div>
  )
}
