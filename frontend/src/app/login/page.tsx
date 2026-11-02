import type { Metadata } from 'next'
import { LoginForm } from '@/components/domain/auth/LoginForm'
import { SESSION_EXPIRED_REASON, sanitizeFrom } from '@/lib/session'

export const metadata: Metadata = {
    title: 'Iniciar sesión · Solidus',
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
    const params = await searchParams
    // `reason` es una lista cerrada: cualquier otro valor se ignora y nunca se muestra texto de la URL.
    const showSessionNotice = first(params.reason) === SESSION_EXPIRED_REASON
    const from = sanitizeFrom(first(params.from))

    return <LoginForm showSessionNotice={showSessionNotice} from={from} />
}
