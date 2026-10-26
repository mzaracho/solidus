'use client'

import { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { formatCurrency } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ADMISSION_SPLITS } from '@/lib/constants'

export type AdmisionSession = {
    id: string
    date: Date
    patientName: string
    admisorName: string
    coadmisorName: string | null
    admissionValue: number
}


export const columns: ColumnDef<AdmisionSession>[] = [
    {
        accessorKey: 'date',
        header: 'Fecha',
        cell: ({ row }) => format(row.getValue('date'), 'dd-MM-yyyy'),
    },
    {
        accessorKey: 'patientName',
        header: 'Paciente',
        cell: ({ row }) => <span className="font-medium">{row.getValue('patientName')}</span>,
    },
    {
        accessorKey: 'admisorName',
        header: 'Admisora',
    },
    {
        accessorKey: 'coadmisorName',
        header: 'Coadmisora',
        cell: ({ row }) => row.getValue('coadmisorName') || '-',
    },
    {
        accessorKey: 'admissionValue',
        header: 'Valor Admisión',
        cell: ({ row }) => formatCurrency(row.getValue('admissionValue')),
    },
    {
        id: 'fundacionShare',
        header: '$ Fundación (30%)',
        cell: ({ row }) => {
            const val = row.original.admissionValue
            const share = val * ADMISSION_SPLITS.FUNDACION
            return <span className="text-muted-foreground">{formatCurrency(share)}</span>
        }
    },
    {
        id: 'admisorShare',
        header: '$ Admisora (50%)',
        cell: ({ row }) => {
            const val = row.original.admissionValue
            const share = val * ADMISSION_SPLITS.ADMISOR
            return <span className="text-green-700 font-medium">{formatCurrency(share)}</span>
        }
    },
    {
        id: 'coadmisorShare',
        header: '$ Coadmisora (20%)',
        cell: ({ row }) => {
            const val = row.original.admissionValue
            // If no coadmisor, does Admisor or Fundacion get the rest? 
            // Assumption: Logic holds only if Coadmisor exists. If not, maybe Admisor gets more?
            // For MVP based on Excel, Coadmisor exists in examples. I will assume fixed splits for now.
            if (!row.original.coadmisorName) return '-'

            const share = val * ADMISSION_SPLITS.COADMISOR
            return <span className="text-blue-700 font-medium">{formatCurrency(share)}</span>
        }
    },
]
