'use client'

import { DataTable } from '@/components/ui/data-table'
import { columns } from './columns'
import { WorkItem } from './data-schema'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export function WorkloadTable({ data }: { data: any[] }) {

    const getRowClassName = (row: WorkItem) => {
        if (row.status === 'Paid') return 'bg-emerald-50/60 dark:bg-emerald-950/20 hover:bg-emerald-100/60 dark:hover:bg-emerald-950/30'
        if (row.status === 'Rejected') return 'bg-red-50/60 dark:bg-red-950/20 hover:bg-red-100/60 dark:hover:bg-red-950/30'
        return ''
    }

    return (
        <Card className="border-none shadow-none">
            <CardHeader className="px-0 pt-0 pb-4">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-xl font-bold tracking-tight">Carga de Trabajo</CardTitle>
                        <CardDescription>Gestión de prestaciones y honorarios.</CardDescription>
                    </div>
                    <Button size="sm" className="h-8 gap-1">
                        <Plus className="h-3.5 w-3.5" />
                        Nuevo Item
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="px-0">
                <DataTable
                    columns={columns}
                    data={data}
                    getRowClassName={getRowClassName}
                />
            </CardContent>
        </Card>
    )
}
