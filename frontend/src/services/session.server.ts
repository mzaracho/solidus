import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ROUTES } from '@/lib/constants'
import { AUTH_COOKIE_NAME, SESSION_EXPIRED_REASON, buildLoginPath } from '@/lib/session'
import { ApiForbiddenError, ApiUnauthorizedError } from '@/services/data'

/** Token de la cookie de sesion (solo servidor). Esta funcion no hace llamadas a la API. */
export async function getServerAuthToken(): Promise<string | null> {
    return (await cookies()).get(AUTH_COOKIE_NAME)?.value ?? null
}

/**
 * Ejecuta `fn` con el token de la sesion. Un 401 lleva al login con el aviso de sesion vencida, y un 403 de
 * organizacion a /sin-acceso. `from` lo arma la pagina (nunca sale de headers del cliente).
 * redirect() se llama fuera de los try de data.ts, asi ningun fallback lo traga.
 */
export async function withServerSession<T>(from: string, fn: (token: string) => Promise<T>): Promise<T> {
    const token = await getServerAuthToken()
    if (!token) redirect(buildLoginPath({ reason: SESSION_EXPIRED_REASON, from }))

    let target: string | null = null
    try {
        return await fn(token)
    } catch (error) {
        if (error instanceof ApiUnauthorizedError) {
            target = buildLoginPath({ reason: SESSION_EXPIRED_REASON, from })
        } else if (error instanceof ApiForbiddenError && error.orgDenied) {
            target = ROUTES.NO_ACCESS
        } else {
            throw error
        }
    }
    redirect(target)
}
