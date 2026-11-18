import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
    AUTH_COOKIE_NAME,
    LEGACY_AUTH_COOKIE_NAME,
    SESSION_EXPIRED_REASON,
    buildLoginPath,
    decodeJwtPayload,
    legacyCookieDeletion,
    sessionCookieDeletion,
} from '@/lib/session'


export function middleware(request: NextRequest) {
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
    const { pathname, search } = request.nextUrl
    const secure = request.nextUrl.protocol === 'https:'

    // La cookie vieja `auth_token` (la escribia el navegador desde JS) nunca autentica: se borra en cualquier respuesta.
    const finish = (response: NextResponse) => {
        if (request.cookies.has(LEGACY_AUTH_COOKIE_NAME)) {
            response.cookies.set(LEGACY_AUTH_COOKIE_NAME, '', legacyCookieDeletion(secure))
        }
        return response
    }

    // Define public paths
    const publicPaths = ['/login', '/favicon.ico', '/_next']

    // Check if trying to access public path
    if (publicPaths.some(path => pathname.startsWith(path))) {
        const response = NextResponse.next()
        // Aviso de sesion vencida: JS no puede borrar la cookie HttpOnly, la borra el servidor (corta el bucle con un
        // token invalido pero no vencido, por ejemplo tras rotar JWT_SECRET).
        // Los prefetch de next/link no llegan aca: el matcher de /login los excluye (Next no expone sus headers al middleware).
        if (pathname === '/login' && request.nextUrl.searchParams.get('reason') === SESSION_EXPIRED_REASON) {
            response.cookies.set(AUTH_COOKIE_NAME, '', sessionCookieDeletion(secure))
        }
        return finish(response)
    }

    // Sin cookie: ingreso normal, con la ruta de retorno y sin aviso de sesión vencida.
    if (!token) {
        return finish(NextResponse.redirect(new URL(buildLoginPath({ from: pathname + search }), request.url)))
    }

    // Con cookie: se decodifica (sin verificar la firma) solo para ahorrar un viaje a la API cuando ya venció,
    // no trae `exp` o no es un token (por ejemplo un `mock_token` viejo). La verificación real es del backend.
    const exp = decodeJwtPayload(token)?.exp
    if (typeof exp !== 'number' || exp * 1000 <= Date.now()) {
        const response = NextResponse.redirect(
            new URL(buildLoginPath({ reason: SESSION_EXPIRED_REASON, from: pathname + search }), request.url),
        )
        response.cookies.set(AUTH_COOKIE_NAME, '', sessionCookieDeletion(secure))
        return finish(response)
    }

    return finish(NextResponse.next())
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - /login (tiene su propia entrada, abajo)
         */
        { source: '/((?!api|_next/static|_next/image|favicon.ico|login(?:/|$)).*)' },
        // /login corre el middleware salvo en los prefetch: un prefetch de next/link a /login?reason=session_expired
        // no debe cerrar la sesion (Next no expone esos headers a request.headers, por eso se filtra aca).
        {
            source: '/login',
            missing: [
                { type: 'header', key: 'next-router-prefetch' },
                { type: 'header', key: 'purpose', value: 'prefetch' },
            ],
        },
    ],
}
