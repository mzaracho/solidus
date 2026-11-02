'use client'

import { useEffect, useRef } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ROUTES, SESSION_MESSAGES } from '@/lib/constants'
import { clearSessionCookie } from '@/lib/session'

interface AccessDeniedProps {
    /** noAccess: sesión válida con organización, sin permiso. noOrg: sesión válida sin organizaciones. */
    variant: 'noAccess' | 'noOrg'
}

export function AccessDenied({ variant }: AccessDeniedProps) {
    const headingRef = useRef<HTMLHeadingElement>(null)
    const noOrg = variant === 'noOrg'

    useEffect(() => {
        headingRef.current?.focus()
    }, [])

    const handleLogout = () => {
        clearSessionCookie()
        window.location.assign(ROUTES.LOGIN)
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md text-center">
                <CardHeader className="items-center">
                    <ShieldAlert aria-hidden="true" className="mb-2 h-10 w-10 text-muted-foreground" />
                    <CardTitle>
                        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
                            {noOrg ? SESSION_MESSAGES.noOrgTitle : SESSION_MESSAGES.noAccessTitle}
                        </h1>
                    </CardTitle>
                    <CardDescription>
                        {noOrg ? SESSION_MESSAGES.noOrgDescription : SESSION_MESSAGES.noAccessDescription}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:justify-center">
                    {!noOrg && (
                        <Button className="w-full sm:w-auto" onClick={() => window.location.assign('/')}>
                            {SESSION_MESSAGES.backToStart}
                        </Button>
                    )}
                    <Button className="w-full sm:w-auto" variant="outline" onClick={handleLogout}>
                        {SESSION_MESSAGES.logout}
                    </Button>
                </CardContent>
            </Card>
        </main>
    )
}
