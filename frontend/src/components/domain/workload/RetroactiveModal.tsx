'use client'

import { useState, useEffect, useRef, useId } from 'react'
import { format } from 'date-fns'
import { AlertTriangle, Lock, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { WorkItem } from './data-schema'
import { formatCurrency } from '@/lib/utils'
import { ACTIVITY_EDIT_TEXTS, API_ERROR_CODE } from '@/lib/constants'
import { ApiRequestError, errorMessageOf } from '@/lib/api-errors'
import { isActivityCollected } from '@/lib/activity-permissions'
import { financialChanges, validateAmountInput } from '@/lib/activity-edit'
import { getPayers, isHandledApiError } from '@/services/data'

type PayerOption = { id: string; name: string }

interface RetroactiveModalProps {
    item: WorkItem | null
    open: boolean
    orgSlug: string
    onOpenChange: (open: boolean) => void
    /**
     * Guarda los cambios (solo monto y/o pagador). Tiene que LANZAR si el backend rechaza el cambio: el modal solo
     * informa exito despues de que confirma. Con `ACTIVITY_ALREADY_COLLECTED` el modal bloquea los campos.
     */
    onSave: (changes: { grossAmount?: number; payerId?: string | null }) => Promise<void>
    /** Se llama ante un 409 por cobro simultaneo, para refrescar los datos de la tabla. */
    onConflict?: () => void
}

/**
 * Edicion de monto y pagador de una prestacion (017, #45). Se habilitan solo si la atencion no esta cobrada; si lo
 * esta (o se cobro mientras se editaba) se ven en solo lectura con el texto que lo explica. El backend recalcula
 * honorarios y distribucion al guardar: la UI lo avisa y no muestra ningun neto estimado.
 */
export function RetroactiveModal(props: RetroactiveModalProps) {
    // El formulario se monta solo mientras el dialogo esta abierto y por atencion: su estado arranca limpio con los
    // valores guardados (sin efectos que copien props al estado).
    if (!props.open || !props.item) return null
    return <RetroactiveModalDialog key={props.item.id} {...props} item={props.item} />
}

function RetroactiveModalDialog({ item, orgSlug, onOpenChange, onSave, onConflict }: RetroactiveModalProps & { item: WorkItem }) {
    const uid = useId()
    const amountId = `${uid}-amount`
    const payerFieldId = `${uid}-payer`
    const lockTextId = `${uid}-lock`
    const amountErrorId = `${uid}-amount-error`

    const [amountText, setAmountText] = useState(item.grossAmount === null ? '' : String(item.grossAmount))
    const [payerId, setPayerId] = useState(item.payerId ?? '')
    const [payers, setPayers] = useState<PayerOption[]>([])
    const [payersLoading, setPayersLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [conflictLocked, setConflictLocked] = useState(false)
    const errorRef = useRef<HTMLDivElement>(null)

    // Los pagadores reales de la organizacion (con su id)
    useEffect(() => {
        if (!orgSlug) return
        let cancelled = false
        getPayers(orgSlug, 1, 100)
            .then((data) => {
                if (cancelled) return
                const list: PayerOption[] = Array.isArray(data?.items) ? data.items : []
                setPayers(list.map((p) => ({ id: p.id, name: p.name })))
            })
            .catch(() => { if (!cancelled) setPayers([]) })
            .finally(() => { if (!cancelled) setPayersLoading(false) })
        return () => { cancelled = true }
    }, [orgSlug])

    const locked = isActivityCollected(item) || conflictLocked
    const amountCheck = validateAmountInput(amountText)
    const amountInvalid = !locked && !amountCheck.ok
    const changes = financialChanges(
        { grossAmount: item.grossAmount, payerId: item.payerId },
        {
            grossAmount: amountCheck.ok ? amountCheck.value : undefined,
            payerId: payerId === '' ? undefined : payerId,
        },
    )
    const hasChanges = Object.keys(changes).length > 0
    const canSave = !locked && !saving && !payersLoading && !amountInvalid && hasChanges

    // El pagador guardado puede no estar en la lista (borrado o paginado): se muestra como opcion deshabilitada.
    const savedPayerMissing = !!item.payerId && !payers.some((p) => p.id === item.payerId)
    const payerName = (id: string) => payers.find((p) => p.id === id)?.name ?? item.payerName ?? ACTIVITY_EDIT_TEXTS.noPayer

    const handleSave = async () => {
        if (!canSave) return
        setSaving(true)
        setErrorMessage(null)
        try {
            await onSave(changes)
            toast.success(ACTIVITY_EDIT_TEXTS.updatedRecalc)
            onOpenChange(false)
        } catch (e) {
            // Un 403 ya se aviso con el toast de acceso: no se duplica.
            if (isHandledApiError(e)) return
            if (e instanceof ApiRequestError && e.code === API_ERROR_CODE.ACTIVITY_ALREADY_COLLECTED) {
                // Se cobro mientras se editaba: se bloquea ya, se vuelve a lo guardado y se refrescan los datos.
                setConflictLocked(true)
                setAmountText(item.grossAmount === null ? '' : String(item.grossAmount))
                setPayerId(item.payerId ?? '')
                setErrorMessage(e.message)
                onConflict?.()
            } else {
                const extra = e instanceof ApiRequestError && e.status === 404 && changes.payerId !== undefined
                    ? ` ${ACTIVITY_EDIT_TEXTS.pickAnotherPayer}`
                    : ''
                setErrorMessage(`${errorMessageOf(e, ACTIVITY_EDIT_TEXTS.saveError)}${extra}`)
            }
            // El foco pasa al aviso de error
            setTimeout(() => errorRef.current?.focus(), 0)
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
            <DialogContent
                className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto"
                aria-busy={saving}
                onEscapeKeyDown={(e) => { if (saving) e.preventDefault() }}
                onInteractOutside={(e) => { if (saving) e.preventDefault() }}
            >
                <DialogHeader>
                    <DialogTitle>Editar Prestación</DialogTitle>
                    <DialogDescription>
                        ID: {item.id} • {format(item.date, 'dd/MM/yyyy')}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    {errorMessage && (
                        <Alert
                            variant="destructive"
                            className="bg-red-50 text-red-900 border-red-200"
                            ref={errorRef}
                            tabIndex={-1}
                        >
                            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                            <AlertDescription className="text-red-900">{errorMessage}</AlertDescription>
                        </Alert>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor={`${uid}-pro`}>Profesional</Label>
                            <Input id={`${uid}-pro`} value={item.professionalName} disabled className="bg-muted" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`${uid}-pat`}>Paciente</Label>
                            <Input id={`${uid}-pat`} value={item.patientName} disabled className="bg-muted" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor={payerFieldId}>{ACTIVITY_EDIT_TEXTS.payerLabel}</Label>
                        {locked ? (
                            <Input
                                id={payerFieldId}
                                value={item.payerName ?? ACTIVITY_EDIT_TEXTS.noPayer}
                                readOnly
                                aria-readonly="true"
                                aria-describedby={lockTextId}
                                className="bg-muted text-foreground"
                            />
                        ) : (
                            <>
                                <Select value={payerId} onValueChange={setPayerId} disabled={payersLoading}>
                                    <SelectTrigger id={payerFieldId} aria-required="true" aria-busy={payersLoading}>
                                        <SelectValue
                                            placeholder={payersLoading ? ACTIVITY_EDIT_TEXTS.loadingPayers : ACTIVITY_EDIT_TEXTS.selectPayer}
                                        >
                                            {payerId ? payerName(payerId) : undefined}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {savedPayerMissing && item.payerId && (
                                            <SelectItem value={item.payerId} disabled>
                                                {item.payerName ?? ACTIVITY_EDIT_TEXTS.noPayer}
                                            </SelectItem>
                                        )}
                                        {payers.map((p) => (
                                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {!payersLoading && payers.length === 0 && (
                                    <p className="text-sm text-muted-foreground">
                                        {ACTIVITY_EDIT_TEXTS.noPayersAvailable}. {ACTIVITY_EDIT_TEXTS.noPayersHelp}
                                    </p>
                                )}
                            </>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor={amountId}>{ACTIVITY_EDIT_TEXTS.amountLabel}</Label>
                        {locked ? (
                            <Input
                                id={amountId}
                                value={item.grossAmount === null ? '' : formatCurrency(item.grossAmount)}
                                readOnly
                                aria-readonly="true"
                                aria-describedby={lockTextId}
                                className="bg-muted text-foreground font-mono"
                            />
                        ) : (
                            <>
                                <div className="relative">
                                    <Input
                                        id={amountId}
                                        type="text"
                                        inputMode="decimal"
                                        value={amountText}
                                        onChange={(e) => setAmountText(e.target.value)}
                                        aria-required="true"
                                        aria-invalid={amountInvalid ? true : undefined}
                                        aria-describedby={amountInvalid ? amountErrorId : undefined}
                                        className="pl-8 font-mono"
                                    />
                                    <span className="absolute left-3 top-2.5 text-muted-foreground" aria-hidden="true">$</span>
                                </div>
                                {amountInvalid && !amountCheck.ok && (
                                    <p id={amountErrorId} className="text-sm text-destructive">{amountCheck.message}</p>
                                )}
                                {item.grossAmount !== null && (
                                    <p className="text-sm text-muted-foreground">Valor guardado: {formatCurrency(item.grossAmount)}</p>
                                )}
                            </>
                        )}
                        {locked && (
                            <p id={lockTextId} className="flex items-center gap-2 text-sm text-foreground">
                                <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
                                {ACTIVITY_EDIT_TEXTS.collectedLock}
                            </p>
                        )}
                    </div>

                    {/* Aviso de recalculo: siempre presente en el DOM (region viva), visible solo si hay cambios */}
                    <div role="status" aria-live="polite">
                        {hasChanges && !locked && (
                            <Alert className="bg-amber-50 text-amber-900 border-amber-200">
                                <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
                                <AlertTitle className="text-amber-800">{ACTIVITY_EDIT_TEXTS.recalcTitle}</AlertTitle>
                                <AlertDescription className="text-sm text-amber-900">
                                    {ACTIVITY_EDIT_TEXTS.recalcBody}
                                </AlertDescription>
                            </Alert>
                        )}
                    </div>
                </div>

                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-0">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
                    <Button onClick={handleSave} disabled={!canSave} aria-busy={saving}>
                        <Save className="w-4 h-4 mr-2" aria-hidden="true" />
                        {saving
                            ? ACTIVITY_EDIT_TEXTS.saving
                            : hasChanges && !locked
                                ? ACTIVITY_EDIT_TEXTS.saveRecalc
                                : ACTIVITY_EDIT_TEXTS.save}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
