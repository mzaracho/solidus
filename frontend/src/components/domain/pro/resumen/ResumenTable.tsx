'use client'

import { columns } from './columns'
import { DataTable } from '@/components/ui/data-table'

export function ResumenTable() {
    return (
        <DataTable columns={columns} data={[]} />
    )
}
