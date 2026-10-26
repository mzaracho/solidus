'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { AlertCircle, Plus, Check, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { getPayers, getFeeRules, createPayer, createFeeRule, getProfessionalMemberships } from '@/services/data'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface CustomPayer {
    id: string
    name: string
    percent: number
    originalPercent: number
}

interface Membership {
    orgId: string
    orgName: string
    professionalId: string
    categoryId: string | null
    categoryName: string | null
    categoryPercentage: number | null
}

export function PayerRulesManager() {
    const params = useParams()
    const orgSlug = params.orgSlug as string
    const [customPayers, setCustomPayers] = useState<CustomPayer[]>([])
    const [memberships, setMemberships] = useState<Membership[]>([])
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(12)
    const [totalItems, setTotalItems] = useState(0)
    const [newPayerName, setNewPayerName] = useState('')
    const [newPayerRetention, setNewPayerRetention] = useState(0)
    const [newPayerCuit, setNewPayerCuit] = useState('')
    const [isDialogOpen, setIsDialogOpen] = useState(false)

    const fetchData = async () => {
        if (!orgSlug) return
        setLoading(true)
        try {
            const [payersData, fetchedRules, fetchedMemberships] = await Promise.all([
                getPayers(orgSlug, page, pageSize),
                getFeeRules(orgSlug, 'PROFESSIONAL'),
                getProfessionalMemberships(orgSlug),
            ])

            const fetchedPayers = payersData?.items || []
            setTotalItems(payersData?.total || 0)
            setMemberships(fetchedMemberships || [])

            // Only keep non-system payers (custom ones created by the professional)
            const mapped = (fetchedPayers || [])
                .filter((p: any) => !p.isManagedBySystem)
                .map((p: any) => {
                    const rule = (fetchedRules || []).find((r: any) => r.payerId === p.id)
                    let percent = 100 - (p.retentionPercentage || 0)
                    if (rule) {
                        const proSplit = rule.splits?.find((s: any) => s.role === 'PROFESSIONAL')
                        percent = proSplit ? proSplit.percentage : 100
                    }
                    return {
                        id: p.id,
                        name: p.name,
                        percent,
                        originalPercent: percent,
                    }
                })

            setCustomPayers(mapped)
        } catch (error) {
            console.error("Failed to load payer rules", error)
        } finally {
            setLoading(false)
        }
    }

    const saveRule = async (payerId: string, percent: number) => {
        const payload = {
            payer: { connect: { id: payerId } },
            professionalCategory: 'all',
            splits: [
                { role: 'PROFESSIONAL', percentage: percent, beneficiaryType: 'PROFESSIONAL' },
                { role: 'ORGANIZATION', percentage: 100 - percent, beneficiaryType: 'ORGANIZATION' }
            ],
            name: 'Professional Fee Rule',
            organization: { connect: { id: orgSlug } }
        }
        try {
            await createFeeRule(orgSlug, payload)
            toast.success("Regla actualizada")
            setCustomPayers(customPayers.map(p =>
                p.id === payerId ? { ...p, originalPercent: percent } : p
            ))
        } catch (e) {
            console.error(e)
            toast.error("Error al guardar regla")
        }
    }

    useEffect(() => {
        fetchData()
    }, [orgSlug, page, pageSize])

    const handlePercentChange = (id: string, newVal: number[]) => {
        setCustomPayers(customPayers.map(p =>
            p.id === id ? { ...p, percent: newVal[0] } : p
        ))
    }

    const handleCreatePayer = async () => {
        if (!newPayerName) return
        setLoading(true)
        try {
            const newPayer = await createPayer(orgSlug, newPayerName, newPayerRetention, newPayerCuit || undefined)
            
            // Crear regla de honorarios de inmediato
            const proPercent = 100 - newPayerRetention
            const payload = {
                payer: { connect: { id: newPayer.id } },
                professionalCategory: 'all',
                splits: [
                    { role: 'PROFESSIONAL', percentage: proPercent, beneficiaryType: 'PROFESSIONAL' },
                    { role: 'ORGANIZATION', percentage: newPayerRetention, beneficiaryType: 'ORGANIZATION' }
                ],
                name: 'Professional Fee Rule',
                organization: { connect: { id: orgSlug } }
            }
            await createFeeRule(orgSlug, payload)

            toast.success("Pagador agregado")
            setNewPayerName('')
            setNewPayerRetention(0)
            setNewPayerCuit('')
            setIsDialogOpen(false)
            fetchData()
        } catch (e) {
            toast.error("Error al crear pagador")
        }
    }

    if (loading) return <div>Cargando reglas...</div>

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Reglas de Cobro por Pagador</CardTitle>
                    <CardDescription>
                        Las organizaciones gestionan su propio porcentaje. Los pagadores externos los configuras vos.
                    </CardDescription>
                </div>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm" className="gap-2">
                            <Plus className="h-4 w-4" />
                            Agregar Pagador
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Agregar Nuevo Pagador</DialogTitle>
                            <DialogDescription>
                                ¿Para qué obra social o entidad querés configurar una regla?
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4">
                            <Input
                                placeholder="Nombre (Ej: OSDE, Swiss Medical)"
                                value={newPayerName}
                                onChange={(e) => setNewPayerName(e.target.value)}
                            />
                            <Input
                                className="mt-3"
                                placeholder="CUIT (Ej: 30-12345678-9)"
                                value={newPayerCuit}
                                onChange={(e) => setNewPayerCuit(e.target.value)}
                            />
                            <div className="mt-4">
                                <label className="text-sm font-medium mb-1 block">Porcentaje de Retención (%)</label>
                                <div className="flex items-center gap-4">
                                    <Slider
                                        value={[newPayerRetention]}
                                        max={100}
                                        step={1}
                                        onValueChange={(val) => setNewPayerRetention(val[0])}
                                        className="flex-1"
                                    />
                                    <span className="w-12 text-right font-medium">{newPayerRetention}%</span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">Lo que se queda la obra social. Vos recibís el restante.</p>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button onClick={handleCreatePayer}>Crear</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardHeader>

            <CardContent className="space-y-4">

                {/* ── Particular (siempre fijo, 100%, bloqueado) ── */}
                <div className="rounded-xl p-4 border bg-muted/30 border-muted shadow-sm">
                    <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-lg">Particular</span>
                            <Badge variant="secondary" className="gap-1 text-xs">
                                <Lock className="h-3 w-3" /> Fijo
                            </Badge>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="font-serif italic text-muted-foreground w-20 text-sm">RECIBO EL</span>
                        <span className="text-2xl font-bold text-primary tabular-nums">100%</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        En cobros directos al paciente recibís el 100%. No se puede modificar.
                    </p>
                </div>

                {/* ── Membresías de organizaciones (bloqueadas, con categoría) ── */}
                {memberships.map((m) => (
                    <div key={m.orgId} className="rounded-xl p-4 border bg-muted/50 border-muted shadow-sm">
                        <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-lg">{m.orgName}</span>
                                <Badge variant="secondary" className="border-yellow-200 bg-yellow-50 text-yellow-700 text-xs">
                                    Gestionado por Org
                                </Badge>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="font-serif italic text-muted-foreground w-20 text-sm">RECIBO EL</span>
                            <span className="text-2xl font-bold text-primary tabular-nums">
                                {m.categoryPercentage != null ? `${m.categoryPercentage}%` : '—'}
                            </span>
                            {m.categoryName && (
                                <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 text-xs">
                                    Categoría: {m.categoryName}
                                </Badge>
                            )}
                        </div>
                        <p className="text-xs text-yellow-600 mt-2 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            {m.categoryName
                                ? `Porcentaje de la categoría "${m.categoryName}" asignada por ${m.orgName}.`
                                : `El porcentaje lo define la administración de ${m.orgName}.`
                            } No podés editarlo.
                        </p>
                    </div>
                ))}

                {/* ── Pagadores propios (editables) ── */}
                {customPayers.map((payer) => (
                    <div key={payer.id} className="rounded-xl p-4 border bg-card border-primary/20 shadow-sm">
                        <div className="mb-3">
                            <span className="font-semibold text-lg">{payer.name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                            <span className="font-serif italic text-muted-foreground w-20 text-sm">RECIBO EL</span>
                            <div className="flex items-center gap-2 flex-1">
                                <Slider
                                    value={[payer.percent]}
                                    max={100}
                                    step={1}
                                    onValueChange={(val) => handlePercentChange(payer.id, val)}
                                />
                                <div className="flex items-center gap-2 min-w-[4rem] justify-end">
                                    <span className="text-lg font-bold text-primary tabular-nums">
                                        {payer.percent}%
                                    </span>
                                    {payer.percent !== payer.originalPercent && (
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-6 w-6 text-green-600 hover:text-green-700 hover:bg-green-50"
                                            onClick={() => saveRule(payer.id, payer.percent)}
                                            title="Confirmar cambio"
                                        >
                                            <Check className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}

                {customPayers.length === 0 && memberships.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                        No tenés pagadores externos configurados. Podés agregar obras sociales u otras entidades.
                    </p>
                )}
            </CardContent>

            {/* Pagination — solo para pagadores propios si hubiera muchos */}
            {totalItems > pageSize && (
                <div className="p-4 border-t flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Mostrar:</span>
                        <select
                            className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm"
                            value={pageSize}
                            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
                        >
                            <option value={12}>12</option>
                            <option value={18}>18</option>
                            <option value={24}>24</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                            Anterior
                        </Button>
                        <span className="text-sm text-muted-foreground">
                            Página {page} de {Math.ceil(totalItems / pageSize) || 1}
                        </span>
                        <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * pageSize >= totalItems}>
                            Siguiente
                        </Button>
                    </div>
                </div>
            )}
        </Card>
    )
}
