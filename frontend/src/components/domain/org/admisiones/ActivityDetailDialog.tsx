import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { formatCurrency } from "@/lib/utils"
import { PAYMENT_STATUS } from '@/lib/constants'

interface Category {
    name: string
    percentage: number
}

interface ActivityDetailDialogProps {
    isOpen: boolean
    onClose: () => void
    activity: any
    /** Categories from getOrgConfig — used to derive split percentages dynamically */
    categories?: Category[]
    /** When no co-admissor, whether the unassigned % goes to the admissor ('TO_ADMISOR') or stays with the org ('TO_ORG'). Default: 'TO_ADMISOR' */
    noCoAdmisorBehavior?: 'TO_ADMISOR' | 'TO_ORG'
}

function findPct(categories: Category[], name: string, fallback: number): number {
    return categories.find(c => c.name.toLowerCase() === name.toLowerCase())?.percentage ?? fallback
}

export function ActivityDetailDialog({
    isOpen,
    onClose,
    activity,
    categories = [],
    noCoAdmisorBehavior = 'TO_ADMISOR',
}: ActivityDetailDialogProps) {
    if (!activity) return null

    const val = activity.admissionValue || activity.grossAmount || 0
    const serviceType = (activity.serviceType || activity.type || '').toLowerCase()
    const isAdmision = serviceType === 'admision'

    // ── Admisión: distribución calculada desde categorías ─────────────────────
    const hasCoadmisor = !!(activity.coadmisorName && activity.coadmisorName !== '-')
    const admisorBasePct = findPct(categories, 'Admisor', 50)
    const coadmisorPct = findPct(categories, 'Coadmisor', 20)
    const orgPct = 100 - admisorBasePct - coadmisorPct
    let effectiveAdmisorPct = admisorBasePct
    let effectiveOrgPct = orgPct
    if (!hasCoadmisor) {
        if (noCoAdmisorBehavior === 'TO_ADMISOR') {
            effectiveAdmisorPct = admisorBasePct + coadmisorPct
        } else {
            effectiveOrgPct = orgPct + coadmisorPct
        }
    }
    const fundacionShare = val * (effectiveOrgPct / 100)
    const admisorShare = val * (effectiveAdmisorPct / 100)
    const coadmisorShare = hasCoadmisor ? val * (coadmisorPct / 100) : 0

    // ── Sesión / AT: distribución desde splits reales de la BD ────────────────
    // activity.splits viene del endpoint getWorkItemById como array de WorkItemSplit
    const splits: Array<{ beneficiaryType: string; roleLabel: string; amount: number; professionalName?: string }> =
        Array.isArray(activity.splits) ? activity.splits : []
    const proSplits = splits.filter(s => s.beneficiaryType === 'PROFESSIONAL')
    const orgSplits  = splits.filter(s => s.beneficiaryType === 'ORG')

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Detalle de Actividad</DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-muted-foreground">Fecha</span>
                        <span className="text-sm">
                            {activity.date
                                ? new Date((typeof activity.date === 'string' && activity.date.length === 10)
                                    ? activity.date + 'T12:00:00'
                                    : activity.date).toLocaleDateString()
                                : '-'}
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-muted-foreground">Paciente</span>
                        <span className="font-semibold">{activity.patientName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-muted-foreground">Tipo</span>
                        <Badge variant="outline" className="capitalize">
                            {activity.type || activity.serviceType || 'Actividad'}
                        </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-muted-foreground">Cobrado</span>
                        <Badge variant={activity.paymentStatus === PAYMENT_STATUS.PAID ? 'default' : 'secondary'}>
                            {activity.paymentStatus === PAYMENT_STATUS.PAID ? 'Sí' : 'No'}
                        </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-muted-foreground">Fecha de cobro</span>
                        <span className="text-sm">
                            {activity.paymentDate ? new Date((activity.paymentDate as string).substring(0, 10) + 'T12:00:00').toLocaleDateString() : '-'}
                        </span>
                    </div>
                    {activity.paymentMethod && (
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-muted-foreground">Medio de Pago</span>
                            <span className="text-sm">{activity.paymentMethod}</span>
                        </div>
                    )}

                    <Separator />

                    <div className="space-y-3">
                        <h4 className="text-sm font-semibold mb-2">Distribución</h4>

                        <div className="flex justify-between items-center bg-muted/50 p-2 rounded">
                            <span className="text-sm font-bold">Valor Total</span>
                            <span className="text-sm font-bold">{formatCurrency(val)}</span>
                        </div>

                        {isAdmision ? (
                            // ── Admisión: mostrar con lógica de categorías ────────────────────────
                            <div className="space-y-2 px-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">
                                        Organización ({effectiveOrgPct}%)
                                    </span>
                                    <span>{formatCurrency(fundacionShare)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">
                                        Admisor/a ({effectiveAdmisorPct}%)
                                        {!hasCoadmisor && noCoAdmisorBehavior === 'TO_ADMISOR' && coadmisorPct > 0 && (
                                            <span className="ml-1 text-xs text-amber-600">(incluye {coadmisorPct}% sin co-admisor)</span>
                                        )}
                                    </span>
                                    <span className="text-green-600 font-medium">{formatCurrency(admisorShare)}</span>
                                </div>
                                {hasCoadmisor && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Co-Admisor/a ({coadmisorPct}%)</span>
                                        <span className="text-blue-600 font-medium">{formatCurrency(coadmisorShare)}</span>
                                    </div>
                                )}
                            </div>
                        ) : splits.length > 0 ? (
                            // ── Sesión / AT: mostrar splits reales de la BD ───────────────────────
                            <div className="space-y-2 px-2">
                                {orgSplits.map((s, i) => (
                                    <div key={i} className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">
                                            {s.roleLabel || 'Organización'}
                                        </span>
                                        <span>{formatCurrency(s.amount)}</span>
                                    </div>
                                ))}
                                {proSplits.map((s, i) => (
                                    <div key={i} className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">
                                            {s.roleLabel || 'Profesional'}
                                            {s.professionalName && (
                                                <span className="ml-1 text-xs text-muted-foreground/70">({s.professionalName})</span>
                                            )}
                                        </span>
                                        <span className="text-green-600 font-medium">{formatCurrency(s.amount)}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            // ── Fallback: sin splits disponibles ─────────────────────────────────
                            <p className="text-xs text-muted-foreground px-2">Sin detalle de distribución disponible.</p>
                        )}
                    </div>

                    <Separator />

                    <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                            Profesional: <span className="text-foreground">{activity.professionalName || activity.admisorName}</span>
                        </p>
                        {hasCoadmisor && (
                            <p className="text-xs text-muted-foreground">
                                Co-Profesional: <span className="text-foreground">{activity.coProfessionalName || activity.coadmisorName}</span>
                            </p>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
