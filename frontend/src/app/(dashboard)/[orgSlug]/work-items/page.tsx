import { WorkloadTable } from '@/components/domain/workload/WorkloadTable'
import { ApiForbiddenError, getWorkItems } from '@/services/data'
import { withServerSession } from '@/services/session.server'

export default async function WorkItemsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
    const { orgSlug } = await params
    // Fetch data server-side
    // Mode 'ORGANIZATION' is assumed for this view, or we could fetch user context.
    // Defaulting to ORGANIZATION based on URL structure.
    const result = await withServerSession(`/${orgSlug}/work-items`, (token) =>
        getWorkItems(orgSlug, 'ORGANIZATION', undefined, 1, 20, { token }).catch((error: unknown) => {
            // 403 de rol/modo (no de organizacion): el backend no ofrece esta vista al usuario; se muestra vacia
            // en lugar de romper la pagina. El 403 de organizacion lo maneja withServerSession (/sin-acceso).
            if (error instanceof ApiForbiddenError && !error.orgDenied) return null
            throw error
        }),
    )

    return (
        <div className="container mx-auto py-6">
            <WorkloadTable items={result?.items ?? []} total={result?.total ?? 0} />
        </div>
    )
}
