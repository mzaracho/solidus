import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
    const token = request.cookies.get('auth_token')?.value
    const { pathname } = request.nextUrl

    // Define public paths
    const publicPaths = ['/login', '/favicon.ico', '/_next']

    // Check if trying to access public path
    if (publicPaths.some(path => pathname.startsWith(path))) {
        return NextResponse.next()
    }

    // If no token, redirect to login
    if (!token) {
        const loginUrl = new URL('/login', request.url)
        // Optional: save return url
        // loginUrl.searchParams.set('from', pathname)
        return NextResponse.redirect(loginUrl)
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
