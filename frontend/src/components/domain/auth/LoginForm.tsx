'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { SESSION_MESSAGES } from '@/lib/constants'
import { AUTH_COOKIE_NAME, clearSessionCookie, sanitizeFrom } from '@/lib/session'
import { login, type LoginResult } from '@/services/data'

type LoginFailure = Exclude<LoginResult['status'], 'ok'>

const FAILURE_MESSAGES: Record<LoginFailure, string> = {
    invalid: SESSION_MESSAGES.invalidCredentials,
    'bad-request': SESSION_MESSAGES.missingFields,
    network: SESSION_MESSAGES.network,
    server: SESSION_MESSAGES.server,
    unexpected: SESSION_MESSAGES.unexpected,
    other: SESSION_MESSAGES.other,
}

const INPUT_CLASSES =
    'relative block w-full rounded-lg border border-zinc-700 bg-zinc-800 p-3 text-white placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm transition-all'

interface LoginFormProps {
    /** true si la URL trae reason=session_expired (lista cerrada: nunca se muestra texto de la URL). */
    showSessionNotice: boolean
    /** Ruta de retorno ya saneada en el servidor; se vuelve a sanear al usarla. */
    from: string | null
}

export function LoginForm({ showSessionNotice, from }: LoginFormProps) {
    const [loading, setLoading] = useState(false)
    const [notice, setNotice] = useState(showSessionNotice)
    const [failure, setFailure] = useState<{ kind: LoginFailure; attempt: number } | null>(null)
    const submittingRef = useRef(false)
    const userRef = useRef<HTMLInputElement>(null)
    const passwordRef = useRef<HTMLInputElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)

    // Con el aviso de sesión vencida la cookie vieja se borra acá (el servidor no puede), para evitar bucles.
    useEffect(() => {
        if (showSessionNotice) clearSessionCookie()
    }, [showSessionNotice])

    // Foco tras un fallo (UX 1.2): 401 a Contraseña; 400 al primer campo vacío; el resto al botón.
    useEffect(() => {
        if (!failure) return
        if (failure.kind === 'invalid') {
            passwordRef.current?.focus()
        } else if (failure.kind === 'bad-request') {
            if (!userRef.current?.value) userRef.current?.focus()
            else if (!passwordRef.current?.value) passwordRef.current?.focus()
            else userRef.current?.focus()
        } else {
            buttonRef.current?.focus()
        }
    }, [failure])

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        if (submittingRef.current) return
        submittingRef.current = true
        setLoading(true)
        setNotice(false)
        setFailure(null)

        const formData = new FormData(e.currentTarget)
        const user = String(formData.get('email') ?? '')
        const password = String(formData.get('password') ?? '')

        const result = await login(user, password)

        if (result.status === 'ok') {
            const secure = window.location.protocol === 'https:' ? '; Secure' : ''
            document.cookie = `${AUTH_COOKIE_NAME}=${result.token}; path=/; max-age=${result.maxAge}; SameSite=Lax${secure}`
            // Navegación completa para que el middleware vea la cookie. El botón queda en "Ingresando…".
            window.location.assign(sanitizeFrom(from) ?? '/')
            return
        }

        if (result.status === 'invalid' && passwordRef.current) passwordRef.current.value = ''
        submittingRef.current = false
        setLoading(false)
        setFailure((prev) => ({ kind: result.status, attempt: (prev?.attempt ?? 0) + 1 }))
    }

    const message = failure ? FAILURE_MESSAGES[failure.kind] : ''
    const invalidCredentials = failure?.kind === 'invalid'

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
            <div className="w-full max-w-md space-y-8 rounded-2xl bg-zinc-900/50 p-8 border border-zinc-800 backdrop-blur-xl shadow-2xl">
                <div className="text-center">
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Solidus</h1>
                    <p className="text-zinc-400">{SESSION_MESSAGES.loginSubtitle}</p>
                </div>

                <form onSubmit={handleSubmit} className="mt-8 space-y-6" noValidate>
                    {showSessionNotice && (
                        <div role="status">
                            {notice && (
                                <p className="text-amber-300 text-sm text-center bg-amber-950/30 p-2 rounded border border-amber-700/60">
                                    {SESSION_MESSAGES.sessionExpired}
                                </p>
                            )}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="email" className="sr-only">Email</label>
                            <input
                                ref={userRef}
                                id="email"
                                name="email"
                                type="text" // Username or Email
                                autoComplete="username"
                                autoFocus={showSessionNotice}
                                required
                                aria-invalid={invalidCredentials || undefined}
                                aria-describedby={message ? 'login-error' : undefined}
                                className={INPUT_CLASSES}
                                placeholder="Usuario o Email"
                            />
                        </div>
                        <div>
                            <label htmlFor="password" className="sr-only">Contraseña</label>
                            <input
                                ref={passwordRef}
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                required
                                aria-invalid={invalidCredentials || undefined}
                                aria-describedby={message ? 'login-error' : undefined}
                                className={INPUT_CLASSES}
                                placeholder="Contraseña"
                            />
                        </div>
                    </div>

                    {/* Presente desde el inicio: el lector de pantalla anuncia el texto cuando se inyecta. */}
                    <div
                        id="login-error"
                        role="alert"
                        className={message ? 'text-red-400 text-sm text-center bg-red-950/30 p-2 rounded border border-red-900/50' : undefined}
                    >
                        {message}
                    </div>

                    <button
                        ref={buttonRef}
                        type="submit"
                        disabled={loading}
                        aria-busy={loading}
                        className="group relative flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                        {loading && <Loader2 aria-hidden="true" className="animate-spin h-5 w-5" />}
                        {loading ? SESSION_MESSAGES.submitBusy : SESSION_MESSAGES.submitIdle}
                    </button>
                </form>
            </div>
        </div>
    )
}
