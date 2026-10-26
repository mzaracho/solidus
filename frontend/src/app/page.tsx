'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

function parseJwt(token: string) {
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64))
  } catch {
    return null
  }
}

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const match = document.cookie.match(/(^| )auth_token=([^;]+)/)
    const token = match ? match[2] : null

    if (!token) {
      router.replace('/login')
      return
    }

    const payload = parseJwt(token)
    const orgId = payload?.organizationId
    const orgRole = payload?.orgRole
    const roles: { code: string }[] = payload?.roles || []

    if (orgId) {
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
      router.replace('/login')
    }
  }, [router])

  return null
}
