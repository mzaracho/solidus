'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { IncomeChart } from '@/components/domain/dashboard/IncomeChart'
import { PayerChart } from '@/components/domain/dashboard/PayerChart'
import { KpiCards } from '@/components/domain/dashboard/KpiCards'
import { getDashboardStats } from '@/services/data'
import { useStore } from '@/store/useStore'

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export default function DashboardPage() {
    const params = useParams()
    const { viewMode } = useStore()
    const [stats, setStats] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [range, setRange] = useState('current_month')
    const [chartBasis, setChartBasis] = useState<'ACCRUED' | 'CASH'>('ACCRUED')

    const orgSlug = params.orgSlug as string

    useEffect(() => {
        const load = async () => {
            if (!orgSlug) return
            setLoading(true)
            try {
                // chartValueType defaults to 'NET' - REMOVED, now returns both
                const data = await getDashboardStats(orgSlug, viewMode, range, chartBasis)
                setStats(data)
            } catch (e) {
                console.error('Dashboard load error', e)
                setStats(null)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [viewMode, orgSlug, range, chartBasis])

    if (loading) return <div className="p-8">Cargando dashboard...</div>

    // 5 KPIs Mapping
    const kpiData = stats && stats.kpi ? [
        {
            title: "Facturación Bruta",
            value: `$ ${stats.kpi.accruedGross.toLocaleString('es-AR')}`,
            description: "Total trabajado (Devengado)",
            trend: "neutral"
        },
        {
            title: "Facturación Neta", // Real Net Income (Accrued)
            value: `$ ${stats.kpi.accruedNet.toLocaleString('es-AR')}`,
            description: viewMode === 'ORGANIZATION' ? "Retenciones estimadas" : "Tu ganancia real (Devengada)",
            trend: "up"
        },
        {
            title: "Pendiente de Cobro",
            value: `$ ${stats.kpi.pending.toLocaleString('es-AR')}`,
            description: "En gestión de cobro",
            trend: "neutral"
        },
        {
            title: "Cobrado Bruto",
            value: `$ ${stats.kpi.cashGross.toLocaleString('es-AR')}`,
            description: "Ingresos totales (Percibido)",
            trend: "neutral"
        },
        {
            title: "Cobrado Neto", // Real Net Cash
            value: `$ ${stats.kpi.cashNet.toLocaleString('es-AR')}`,
            description: "Tu ganancia de bolsillo (Percibida)",
            trend: "up"
        }
    ] : []

    return (
        <div className="flex-1 space-y-4 p-8 pt-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
                <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                        <Label htmlFor="chart-basis" className="text-sm font-medium">
                            Gráfico: {chartBasis === 'ACCRUED' ? 'Devengado' : 'Percibido'}
                        </Label>
                        <Switch
                            id="chart-basis"
                            checked={chartBasis === 'CASH'}
                            onCheckedChange={(c) => setChartBasis(c ? 'CASH' : 'ACCRUED')}
                        />
                    </div>
                    <Select value={range} onValueChange={setRange}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Seleccionar periodo" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="7d">Últimos 7 días</SelectItem>
                            <SelectItem value="14d">Últimos 14 días</SelectItem>
                            <SelectItem value="current_month">Mes en curso</SelectItem>
                            <SelectItem value="last_month">Mes anterior</SelectItem>
                            <SelectItem value="3m">Últimos 3 meses</SelectItem>
                            <SelectItem value="6m">Últimos 6 meses</SelectItem>
                            <SelectItem value="current_year">Año en curso</SelectItem>
                            <SelectItem value="last_year">Año anterior</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Check for missing stats to prevent crash */}
            {
                stats && stats.kpi ? (
                    <>
                        <KpiCards data={kpiData} />
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                            <IncomeChart data={stats.chartData} />
                            <PayerChart data={stats.payerData} />
                        </div>
                    </>
                ) : (
                    <div className="p-4 rounded-md border bg-muted/50 text-muted-foreground text-sm">
                        No se pudieron cargar las estadísticas. Verifique la conexión con el servidor.
                    </div>
                )
            }
        </div >
    )
}
