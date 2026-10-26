import { WorkloadTable } from '@/components/domain/workload/WorkloadTable'
import { getWorkItems } from '@/services/data'

export default async function WorkItemsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
    const { orgSlug } = await params
    // Fetch data server-side
    // Mode 'ORGANIZATION' is assumed for this view, or we could fetch user context.
    // Defaulting to ORGANIZATION based on URL structure.
    const items = await getWorkItems(orgSlug, 'ORGANIZATION')

    return (
        <div className="container mx-auto py-6">
            <WorkloadTable data={items} />
        </div>
    )
}
