'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ROUTES } from '@/lib/constants'
import { decodeJwtPayload, readSessionToken } from '@/lib/session'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const token = readSessionToken()

    if (!token) {
      router.replace(ROUTES.LOGIN)
      return
    }

    const payload = decodeJwtPayload(token)
    const orgId = payload?.organizationId
    const orgRole = payload?.orgRole
    const roles = (Array.isArray(payload?.roles) ? payload.roles : []) as { code: string }[]

    if (typeof orgId === 'string' && orgId) {
      if (orgRole === 'MEMBER') {
        const hasProfessionalRole = roles.some(r => r.code === 'PROFESSIONAL')
        const fallback = hasProfessionalRole
          ? `/${orgId}/pro/atenciones`
          : `/${orgId}/org/admisiones`
        router.replace(fallback)
      } else {
        router.replace(`/${orgId}/dashboard`)
      }
    } else {
      // Sesión válida sin organización: pantalla explicativa en lugar del rebote mudo al login.
      router.replace(ROUTES.NO_ACCESS)
    }
  }, [router])

  return null
}
