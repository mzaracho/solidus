'use client'

import { createContext, useContext, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { EMPTY_SESSION_IDENTITY, type SessionIdentity } from '@/lib/session'
import { useStore } from '@/store/useStore'

const SessionIdentityContext = createContext<SessionIdentity>(EMPTY_SESSION_IDENTITY)

/**
 * Identidad de la sesion para presentar la UI (018). La arma el layout de servidor a partir de la cookie HttpOnly:
 * el cliente nunca lee el JWT. Es solo presentacion: el backend decide los permisos.
 */
export function SessionProvider({ identity, children }: { identity: SessionIdentity; children: React.ReactNode }) {
    const router = useRouter()
    const { setAvailableRoles, setOrgRole } = useStore()

    // Carga roles y rol de organizacion en el store (antes lo hacia un hidratador que leia la cookie): Sidebar, view-mode y columns lo leen de ahi.
    useEffect(() => {
        setAvailableRoles(identity.roles)
        setOrgRole(identity.orgRole)
    }, [identity, setAvailableRoles, setOrgRole])

    // Pagina restaurada del bfcache (por ejemplo "Atras" despues de cerrar sesion): se pide de nuevo al servidor,
    // y el middleware redirige al login si ya no hay cookie.
    useEffect(() => {
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted) router.refresh()
        }
        window.addEventListener('pageshow', onPageShow)
        return () => window.removeEventListener('pageshow', onPageShow)
    }, [router])

    return <SessionIdentityContext.Provider value={identity}>{children}</SessionIdentityContext.Provider>
}

export function useSessionIdentity(): SessionIdentity {
    return useContext(SessionIdentityContext)
}
