import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, Event } from '@/types'

interface AppStore {
  user: User | null
  activeEvent: Event | null
  isOnline: boolean
  pendingSyncCount: number
  isSaleMode: boolean
  setUser: (user: User | null) => void
  setActiveEvent: (event: Event | null) => void
  setIsOnline: (online: boolean) => void
  setPendingSyncCount: (count: number) => void
  setSaleMode: (value: boolean) => void
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      user: null,
      activeEvent: null,
      isOnline: true,
      pendingSyncCount: 0,
      isSaleMode: false,
      setUser: (user) => set({ user }),
      setActiveEvent: (event) => set({ activeEvent: event }),
      setIsOnline: (isOnline) => set({ isOnline }),
      setPendingSyncCount: (pendingSyncCount) => set({ pendingSyncCount }),
      setSaleMode: (isSaleMode) => set({ isSaleMode }),
    }),
    {
      name: 'marshall-flash-app',
      partialize: (state) => ({
        user: state.user,
        activeEvent: state.activeEvent,
        isSaleMode: state.isSaleMode,
      }),
    }
  )
)
