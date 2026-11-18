import { Sidebar } from '@/components/layout/Sidebar'
import { SessionProvider } from '@/components/providers/SessionProvider'
import { getServerSessionIdentity } from '@/services/session.server'

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    // Claims de presentacion (nombre, email, ids, roles) para el cliente; el token nunca sale del servidor.
    const identity = await getServerSessionIdentity()
    return (
        <SessionProvider identity={identity}>
            <div className="flex h-screen overflow-hidden bg-background">
                <Sidebar />
                <main className="flex-1 overflow-y-auto bg-background">
                    {children}
                </main>
            </div>
        </SessionProvider>
    )
}
