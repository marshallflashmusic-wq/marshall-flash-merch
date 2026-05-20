import BottomNav from '@/components/layout/BottomNav'
import SessionProvider from '@/components/providers/SessionProvider'
import HelpRequestsListener from '@/components/providers/HelpRequestsListener'
import TpvAdminMessagesListener from '@/components/providers/TpvAdminMessagesListener'

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="flex flex-col h-full bg-[#0a0a0a]">
        <main className="flex-1 overflow-hidden pb-[72px]">
          {children}
        </main>
        <BottomNav />
        {/* Avisos TPV → admin (toast + beep en admin) */}
        <HelpRequestsListener />
        {/* Avisos admin → TPV (toast + ping en TPV) */}
        <TpvAdminMessagesListener />
      </div>
    </SessionProvider>
  )
}
