'use client'

import { useMemo } from 'react'
import { DataTable } from '@/components/ui/data-table'
import { columns } from './columns'
import { ApiActivity, WorkItem, mapActivityToWorkItem } from './data-schema'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PAYMENT_STATUS } from '@/lib/constants'

type Props = {
    /** Ítems crudos de `GET /activity` (primera página). */
    items: ApiActivity[]
    /** Total de atenciones de la organización que devuelve la API. */
    total: number
}

export function WorkloadTable({ items, total }: Props) {
    const data = useMemo(() => items.map(mapActivityToWorkItem), [items])

    const getRowClassName = (row: WorkItem) => {
        if (row.status === PAYMENT_STATUS.PAID) return 'bg-emerald-50/60 dark:bg-emerald-950/20 hover:bg-emerald-100/60 dark:hover:bg-emerald-950/30'
        return ''
    }

    return (
        <Card className="border-none shadow-none">
            <CardHeader className="px-0 pt-0 pb-4">
                <div>
                    <CardTitle className="text-xl font-bold tracking-tight">Carga de Trabajo</CardTitle>
                    <CardDescription>
                        Gestión de prestaciones y honorarios. Mostrando {data.length} de {total} atenciones.
                    </CardDescription>
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
