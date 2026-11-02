import { WorkloadTable } from '@/components/domain/workload/WorkloadTable'
import { getWorkItems } from '@/services/data'
import { withServerSession } from '@/services/session.server'

export default async function WorkItemsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
    const { orgSlug } = await params
    // Fetch data server-side
    // Mode 'ORGANIZATION' is assumed for this view, or we could fetch user context.
    // Defaulting to ORGANIZATION based on URL structure.
    const result = await withServerSession(`/${orgSlug}/work-items`, (token) =>
        getWorkItems(orgSlug, 'ORGANIZATION', undefined, 1, 20, { token }),
    )

    return (
        <div className="container mx-auto py-6">
            <WorkloadTable items={result?.items ?? []} total={result?.total ?? 0} />
        </div>
    )
}
