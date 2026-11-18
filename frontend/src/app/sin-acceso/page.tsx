import type { Metadata } from 'next'
import { AccessDenied } from '@/components/domain/auth/AccessDenied'
import { getServerSessionIdentity } from '@/services/session.server'

export const metadata: Metadata = {
    title: 'Sin acceso · Solidus',
}

// Sin query params: nada de la URL se muestra ni elige el texto (no se filtra la organización consultada).
export default async function NoAccessPage() {
    // La identidad solo decide qué texto mostrar; la autorización real es del backend.
    const hasOrganization = (await getServerSessionIdentity()).organizationId !== null

    return <AccessDenied variant={hasOrganization ? 'noAccess' : 'noOrg'} />
}
