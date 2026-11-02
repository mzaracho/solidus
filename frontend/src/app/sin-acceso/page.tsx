import type { Metadata } from 'next'
import { AccessDenied } from '@/components/domain/auth/AccessDenied'
import { decodeJwtPayload } from '@/lib/session'
import { getServerAuthToken } from '@/services/session.server'

export const metadata: Metadata = {
    title: 'Sin acceso · Solidus',
}

// Sin query params: nada de la URL se muestra ni elige el texto (no se filtra la organización consultada).
export default async function NoAccessPage() {
    const token = await getServerAuthToken()
    const payload = token ? decodeJwtPayload(token) : null
    // El token solo decide qué texto mostrar; la autorización real es del backend.
    const hasOrganization = typeof payload?.organizationId === 'string' && payload.organizationId.length > 0

    return <AccessDenied variant={hasOrganization ? 'noAccess' : 'noOrg'} />
}
