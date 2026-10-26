'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function LoginPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLoading(true)
        setError('')

        const formData = new FormData(e.currentTarget)
        const email = formData.get('email')
        const password = formData.get('password')

        try {
            // Use internal API call or direct backend call
            // Here we assume we call a Next.js API route or directly to backend via data.ts logic?
            // Let's call backend directly for now using the client-side URL
            // But we need to set the cookie.
            // Better approach for Next.js App Router: Call a Server Action or Route Handler that sets the cookie.
            // For simplicity in this audit: Set cookie in client (not secure but works for audit) or use a helper.

            const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080/api'
            const res = await fetch(`${apiUrl}/v1/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: email, password }) // Matching LoginQuery structure
            })

            if (!res.ok) {
                throw new Error('Credenciales inválidas')
            }

            const data = await res.json()

            // Save token to cookie (Client Side)
            // In real app, this should be httpOnly cookie from backend or server action
            document.cookie = `auth_token=${data.token || 'mock_token'}; path=/; max-age=86400`

            window.location.href = '/' // Force refresh to update middleware state
        } catch (err: any) {
            setError(err.message || 'Error al iniciar sesión')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
            <div className="w-full max-w-md space-y-8 rounded-2xl bg-zinc-900/50 p-8 border border-zinc-800 backdrop-blur-xl shadow-2xl">
                <div className="text-center">
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Solidus</h1>
                    <p className="text-zinc-400">Inicia sesión para continuar</p>
                </div>

                <form onSubmit={handleSubmit} className="mt-8 space-y-6">
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="email" className="sr-only">Email</label>
                            <input
                                id="email"
                                name="email"
                                type="text" // Username or Email
                                autoComplete="username"
                                required
                                className="relative block w-full rounded-lg border border-zinc-700 bg-zinc-800 p-3 text-white placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm transition-all"
                                placeholder="Usuario o Email"
                            />
                        </div>
                        <div>
                            <label htmlFor="password" className="sr-only">Contraseña</label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                required
                                className="relative block w-full rounded-lg border border-zinc-700 bg-zinc-800 p-3 text-white placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm transition-all"
                                placeholder="Contraseña"
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="text-red-400 text-sm text-center bg-red-950/30 p-2 rounded border border-red-900/50 animate-pulse">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="group relative flex w-full justify-center rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                        {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Ingresar'}
                    </button>
                </form>
            </div>
        </div>
    )
}
