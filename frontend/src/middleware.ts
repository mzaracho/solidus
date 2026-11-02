import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { AUTH_COOKIE_NAME, SESSION_EXPIRED_REASON, buildLoginPath, decodeJwtPayload } from '@/lib/session'

export function middleware(request: NextRequest) {
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
    const { pathname, search } = request.nextUrl

    // Define public paths
    const publicPaths = ['/login', '/favicon.ico', '/_next']

    // Check if trying to access public path
    if (publicPaths.some(path => pathname.startsWith(path))) {
        return NextResponse.next()
    }

    // Sin cookie: ingreso normal, con la ruta de retorno y sin aviso de sesión vencida.
    if (!token) {
        return NextResponse.redirect(new URL(buildLoginPath({ from: pathname + search }), request.url))
    }

    // Con cookie: se decodifica (sin verificar la firma) solo para ahorrar un viaje a la API cuando ya venció,
    // no trae `exp` o no es un token (por ejemplo un `mock_token` viejo). La verificación real es del backend.
    const exp = decodeJwtPayload(token)?.exp
    if (typeof exp !== 'number' || exp * 1000 <= Date.now()) {
        const response = NextResponse.redirect(
            new URL(buildLoginPath({ reason: SESSION_EXPIRED_REASON, from: pathname + search }), request.url),
        )
        response.cookies.delete(AUTH_COOKIE_NAME)
        return response
    }

    return NextResponse.next()
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
}
