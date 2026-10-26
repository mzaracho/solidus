'use client'

import { useState, useEffect } from 'react'
import { User, Coins, Clock, Layers } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { useStore } from '@/store/useStore'
import { getPatients, getActivityTypes } from '@/services/data'
import { DatePicker } from '@/components/ui/date-picker'
import {
    PAYMENT_STATUS,
    ATTENDANCE,
    WORK_ITEM_TYPE,
    PAYMENT_METHOD,
    FORM_STATUS,
    FormStatus,
    MIN_PATIENT_SEARCH_LENGTH,
    ACTIVITY_TYPE_PREFIX,
    PAYER_PARTICULAR,
} from '@/lib/constants'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoleConfig {
    roleLabel: string
    isRequired: boolean
    feeStrategy: 'CATEGORY' | 'FIXED'
    fixedPercentage?: number
}

interface ActivityTypeRecord {
    id: string
    code: string
    name: string
    baseValue?: number
    cardValue?: number
    roles?: RoleConfig[]
}

export type WorkItemFormData = {
    date: string
    month: string
    patient: string
    patientId?: string
    patientOrganizationId?: string
    type: string
    professional: string
    // Multi-participant map: roleLabel -> professionalId
    participantsByRole: Record<string, string>
    hours: number
    quantity: number
    gross: number
    baseValue: number
    payer: string
    status: FormStatus
    paymentMethod: string
    paymentDate: string
    presetId: string
    packDates: string[]
    attendance: string
    activityTypeId?: string
}

type Props = {
    isOpen: boolean
    onClose: () => void
    onSubmit: (data: any[]) => void
    rulesOrg: any
    rulesPro: any
    orgSlug?: string
    initialData?: any
    mode?: 'ORGANIZATION' | 'PROFESSIONAL'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const safeDate = (dateStr: string | undefined | null) => {
    if (!dateStr) return undefined
    try {
        const d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00')
        if (isNaN(d.getTime())) return undefined
        return d
    } catch {
        return undefined
    }
}

const DEFAULT_FORM: WorkItemFormData = {
    date: new Date().toISOString().split('T')[0],
    month: new Date().toISOString().slice(0, 7),
    patient: '',
    type: WORK_ITEM_TYPE.SESSION,
    professional: '',
    participantsByRole: {},
    hours: 1,
    quantity: 1,
    gross: 0,
    baseValue: 0,
    payer: '',
    status: FORM_STATUS.PENDING,
    paymentMethod: PAYMENT_METHOD.CASH,
    paymentDate: new Date().toISOString().split('T')[0],
    presetId: '',
    packDates: [],
    attendance: ATTENDANCE.PRESENT,
    activityTypeId: undefined,
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkItemForm({ isOpen, onClose, onSubmit, rulesOrg, rulesPro, orgSlug, initialData, mode: forcedMode }: Props) {
    const { viewMode: storeMode } = useStore()
    const viewMode = forcedMode || storeMode

    const [activityTypes, setActivityTypes] = useState<ActivityTypeRecord[]>([])
    const [activeActivityType, setActiveActivityType] = useState<ActivityTypeRecord | null>(null)

    // Reload activity types each time the form opens (ensures fresh data after creating types in settings)
    useEffect(() => {
        if (orgSlug && isOpen) {
            getActivityTypes(orgSlug).then(data => setActivityTypes(Array.isArray(data) ? data : []))
        }
    }, [orgSlug, isOpen])

    // Populate form when editing or resetting
    useEffect(() => {
        if (isOpen && initialData) {
            const d = new Date(initialData.date)
            const dateStr = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
            let status: FormStatus = FORM_STATUS.PENDING
            if (initialData.paymentStatus === PAYMENT_STATUS.PAID || initialData.paid === true) status = FORM_STATUS.PAID
            else if (initialData.paymentStatus === PAYMENT_STATUS.PARTIAL) status = FORM_STATUS.PARTIAL
            let type: string = WORK_ITEM_TYPE.SESSION
            if (initialData.serviceType === WORK_ITEM_TYPE.AT) type = WORK_ITEM_TYPE.AT
            if (initialData.serviceType === WORK_ITEM_TYPE.ADMISSION || initialData.serviceType === 'Admisión') type = WORK_ITEM_TYPE.ADMISSION
            if (['session', 'team_meeting', 'parent_orientation', 'report', 'supervision', 'evaluation', 'aptitude'].includes(initialData.serviceType)) {
                type = initialData.serviceType
            }
            setFormData({
                ...DEFAULT_FORM,
                date: dateStr,
                month: dateStr.slice(0, 7),
                patient: initialData.patientName || '',
                patientId: initialData.patientId,
                type,
                professional: initialData.professionalId || '',
                participantsByRole: {},
                hours: initialData.quantity || 1,
                gross: initialData.grossAmount || initialData.fees || 0,
                payer: initialData.payerId || '',
                status,
                paymentMethod: initialData.paymentMethod || PAYMENT_METHOD.CASH,
                paymentDate: initialData.paymentDate && initialData.paymentDate !== 'null'
                    ? new Date(initialData.paymentDate).toISOString().split('T')[0] : '',
                presetId: initialData.presetId || '',
                attendance: initialData.attendance || ATTENDANCE.PRESENT,
                activityTypeId: initialData.activityTypeId,
            })
            setPatientSearch(initialData.patientName || '')
        } else if (isOpen && !initialData) {
            setFormData(DEFAULT_FORM)
            setPatientSearch('')
            setActiveActivityType(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialData])

    const [formData, setFormData] = useState<WorkItemFormData>(DEFAULT_FORM)
    const [patientSearch, setPatientSearch] = useState('')
    const [patientSuggestions, setPatientSuggestions] = useState<any[]>([])
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [isPrivate, setIsPrivate] = useState(true)

    const allPayers: any[] = Array.isArray(rulesPro?.payers) ? rulesPro.payers : []
    const orgPayers: { id: string; name: string; isOrg: boolean; professionalId?: string }[] =
        Array.isArray(rulesPro?.memberships)
            ? rulesPro.memberships
                .filter((m: any) => m.canLoadActivities)
                .map((m: any) => {
                    const sysPayer = allPayers.find((p: any) => p.isManagedBySystem && p.organizationId === m.orgId)
                    return { id: sysPayer?.id ?? m.orgId, name: m.orgName, isOrg: true, professionalId: m.professionalId }
                })
            : []

    const isOrgPayerSelected = viewMode === 'PROFESSIONAL' && orgPayers.some(p => p.id === formData.payer)
    const enforceOrgRules = (viewMode === 'ORGANIZATION' || isOrgPayerSelected) && rulesOrg?.type !== 'SOLO_PRACTICE'

    // ── Resolve ActivityType whenever presetId or type changes ────────────────
    useEffect(() => {
        if (!activityTypes.length) return
        // Try to match by presetId → preset.linkedType → activityType.code
        const preset = rulesOrg?.values?.find((v: any) => v.id === formData.presetId)
        const linkedCode = preset?.linkedType ?? formData.type
        const matched = activityTypes.find(t => t.code === linkedCode) ?? null
        setActiveActivityType(matched)
        
        let initialParticipants = { ...formData.participantsByRole }
        let newProfessional = formData.professional
        let updated = false

        if (viewMode === 'PROFESSIONAL') {
            const currentOrgPayer = orgPayers.find(p => p.id === formData.payer)
            if (currentOrgPayer?.professionalId) {
                if (matched && matched.roles?.length) {
                    const firstRole = matched.roles[0].roleLabel
                    if (!initialParticipants[firstRole] || initialParticipants[firstRole] === '__none__') {
                        initialParticipants[firstRole] = currentOrgPayer.professionalId
                        updated = true
                    }
                } else {
                    if (!newProfessional || newProfessional === '__none__') {
                        newProfessional = currentOrgPayer.professionalId
                        updated = true
                    }
                }
            }
        }

        if (matched || updated) {
            setFormData(prev => ({ 
                ...prev, 
                activityTypeId: matched ? matched.id : undefined, 
                ...(updated ? { participantsByRole: initialParticipants, professional: newProfessional } : {})
            }))
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formData.presetId, formData.type, activityTypes])

    // ── Preset price calculation ──────────────────────────────────────────────
    const getPresetValue = (presetId: string, method: string) => {
        const preset = rulesOrg?.values?.find((v: any) => v.id === presetId)
        if (!preset) return 0
        return (method === PAYMENT_METHOD.CREDIT_CARD && preset.cardValue) ? preset.cardValue : preset.value
    }

    useEffect(() => {
        if (!enforceOrgRules) return
        const presetId = formData.presetId
        const calculationMethod = formData.status === FORM_STATUS.PAID ? formData.paymentMethod : PAYMENT_METHOD.CASH
        const isAT = formData.type === WORK_ITEM_TYPE.AT
        const multiplier = isAT ? (formData.hours || 1) : 1

        if (presetId && rulesOrg?.values) {
            // Caso preset — lógica existente sin cambios
            const rawUnitPrice = getPresetValue(presetId, calculationMethod)
            const rawBasePrice = getPresetValue(presetId, PAYMENT_METHOD.CASH)
            const unitPrice = parseFloat(String(rawUnitPrice)) || 0
            const baseUnitPrice = parseFloat(String(rawBasePrice)) || 0
            if (unitPrice >= 0 || baseUnitPrice >= 0) {
                setFormData(prev => ({ ...prev, gross: unitPrice * multiplier, baseValue: baseUnitPrice * multiplier }))
            }
        } else if (!presetId && activeActivityType) {
            // Caso activity type libre
            const useCard = calculationMethod === PAYMENT_METHOD.CREDIT_CARD && activeActivityType.cardValue != null
            const unitPrice = useCard ? (activeActivityType.cardValue || 0) : (activeActivityType.baseValue || 0)
            const baseUnitPrice = activeActivityType.baseValue || 0
            if (unitPrice > 0 || baseUnitPrice > 0) {
                setFormData(prev => ({ ...prev, gross: unitPrice * multiplier, baseValue: baseUnitPrice * multiplier }))
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formData.presetId, formData.type, formData.status, formData.paymentMethod, formData.hours, enforceOrgRules, rulesOrg, activeActivityType])

    // ── Pack dates generation ─────────────────────────────────────────────────
    useEffect(() => {
        if (formData.quantity > 1) {
            const startDate = safeDate(formData.date)
            if (!startDate) return
            const dates = Array.from({ length: formData.quantity }, () => startDate.toISOString().split('T')[0])
            setFormData(prev => ({ ...prev, packDates: dates }))
        } else {
            setFormData(prev => ({ ...prev, packDates: [] }))
        }
    }, [formData.quantity, formData.date])

    useEffect(() => {
        if (!orgSlug || patientSearch === formData.patient) return
        if (patientSearch.length < MIN_PATIENT_SEARCH_LENGTH) { setPatientSuggestions([]); setShowSuggestions(false); return }
        const t = setTimeout(() => {
            getPatients(orgSlug, patientSearch, 1, 12, viewMode).then(data => {
                const list = Array.isArray(data) ? data : (data?.items || [])
                setPatientSuggestions(list)
                if (patientSearch !== formData.patient) setShowSuggestions(true)
            })
        }, 300)
        return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [patientSearch, orgSlug, formData.patient])

    const selectPatient = (p: any) => {
        const name = `${p.firstName} ${p.lastName}`
        let autoPayer = formData.payer
        let autoPrivate = isPrivate

        if (viewMode === 'PROFESSIONAL') {
            const matchedMembership = p.organizationId && Array.isArray(rulesPro?.memberships)
                ? rulesPro.memberships.find((m: any) => m.orgId === p.organizationId && m.canLoadActivities)
                : null

            // Solo aplicar lógica de ORG si la membresía coincide con el orgSlug actual
            // (Si estamos en Psico LSA y elegimos Particular Prueba de Virtual Org, debe ser Privado)
            if (matchedMembership && p.organizationId === orgSlug && rulesOrg?.type !== 'SOLO_PRACTICE') {
                const sysPayer = Array.isArray(rulesPro?.payers)
                    ? rulesPro.payers.find((payer: any) => payer.isManagedBySystem && payer.organizationId === p.organizationId)
                    : null
                autoPayer = sysPayer?.id ?? p.organizationId
                autoPrivate = false
            } else {
                autoPrivate = true
                autoPayer = PAYER_PARTICULAR
            }
            setIsPrivate(autoPrivate)
        }

        setFormData(prev => {
            const contextChanged = prev.patientOrganizationId !== p.organizationId;
            const baseState = contextChanged ? { ...DEFAULT_FORM, date: prev.date, month: prev.month } : { ...prev };
            return {
                ...baseState,
                patient: name,
                patientId: p.id,
                patientOrganizationId: p.organizationId,
                payer: autoPayer
            };
        })
        setPatientSearch(name)
        setShowSuggestions(false)
    }

    const handlePresetSelect = (val: string) => {
        // Check if it's an activity type (prefixed with __type__)
        if (val.startsWith(ACTIVITY_TYPE_PREFIX)) {
            const typeCode = val.replace(ACTIVITY_TYPE_PREFIX, '')
            setFormData(prev => ({ ...prev, presetId: '', type: typeCode, professional: '', participantsByRole: {} }))
            return
        }
        const preset = rulesOrg?.values?.find((v: any) => v.id === val)
        if (preset) {
            setFormData(prev => ({ ...prev, presetId: val, hours: 1, quantity: 1, type: preset.linkedType || WORK_ITEM_TYPE.SESSION, professional: '', participantsByRole: {} }))
        } else {
            setFormData(prev => ({ ...prev, presetId: '', professional: '', participantsByRole: {} }))
        }
    }

    const updatePackDate = (idx: number, newDate: string) => {
        const newDates = [...formData.packDates]
        newDates[idx] = newDate
        setFormData({ ...formData, packDates: newDates })
    }

    // ── Derived: does the active ActivityType have role config? ───────────────
    const roles: RoleConfig[] = activeActivityType?.roles ?? []
    const hasRoles = roles.length > 0

    // ── Submit ────────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        if (!formData.patient) { toast.error("El campo 'Paciente' es obligatorio."); return }
        if (!formData.date) { toast.error("La fecha es obligatoria."); return }

        if (enforceOrgRules) {
            if (hasRoles) {
                // Validate required roles
                const missingRequired = roles.filter(r => r.isRequired && !formData.participantsByRole[r.roleLabel])
                if (missingRequired.length > 0) {
                    toast.error(`Debes asignar: ${missingRequired.map(r => r.roleLabel).join(', ')}`)
                    return
                }
            } else {
                // Legacy: require at least one professional
                if (([WORK_ITEM_TYPE.SESSION, WORK_ITEM_TYPE.ADMISSION, WORK_ITEM_TYPE.AT] as string[]).includes(formData.type) && !formData.professional) {
                    toast.error("Debes seleccionar un Profesional.")
                    return
                }
            }
            if (formData.type === WORK_ITEM_TYPE.AT && formData.hours <= 0) {
                toast.error("La cantidad de horas debe ser mayor a 0."); return
            }
        }

        if (viewMode === 'PROFESSIONAL' && !isPrivate && !formData.payer) {
            toast.error("Debes seleccionar una Obra Social o marcar 'Particular'."); return
        }

        const mode = viewMode === 'ORGANIZATION' ? 'org' : 'pro'
        const baseDate = safeDate(formData.date)
        if (!baseDate) { toast.error("Fecha inválida"); return }
        baseDate.setHours(12, 0, 0, 0)

        // Build participants array for backend
        const participants = hasRoles
            ? Object.entries(formData.participantsByRole)
                .filter(([, proId]) => !!proId)
                .map(([roleLabel, professionalId]) => ({ professionalId, roleLabel }))
            : undefined

        // Determine primary professionalId (first participant or legacy field)
        const primaryProfessionalId = hasRoles
            ? (participants?.[0]?.professionalId ?? formData.professional)
            : formData.professional

        const baseItem = {
            ...formData,
            date: baseDate,
            amount: formData.gross,
            professionalId: primaryProfessionalId,
            participants,
            activityTypeId: formData.activityTypeId,
            presetId: formData.presetId,
            payerId: formData.payer === PAYER_PARTICULAR ? null : formData.payer,
            organizationId: formData.patientOrganizationId, // <--- Add this
            paymentStatus: formData.status === FORM_STATUS.PAID ? PAYMENT_STATUS.PAID : formData.status === FORM_STATUS.PARTIAL ? PAYMENT_STATUS.PARTIAL : PAYMENT_STATUS.UNPAID,
            paid: formData.status === FORM_STATUS.PAID,
            mode,
            serviceType: formData.type,
        }

        try {
            if (formData.type === WORK_ITEM_TYPE.SESSION && formData.quantity > 1) {
                const items = formData.packDates.map(dateStr => {
                    const d = safeDate(dateStr)
                    if (d) d.setHours(12, 0, 0, 0)
                    return { ...baseItem, date: d || baseDate, hours: 1 }
                })
                await onSubmit(items)
            } else {
                await onSubmit([baseItem])
            }
            onClose()
        } catch (error: any) {
            // Error is already shown by the parent (AtencionesTable), but show here too for safety
            // Only show if parent didn't already show it
            const msg = error?.message || 'Error al guardar la actividad'
            toast.error(msg)
            // Don't close the modal on error
        }
    }

    // ── Lists ─────────────────────────────────────────────────────────────────
    const professionalsList = (): { id: string; name: string }[] => {
        if (!rulesOrg?.professionals || !Array.isArray(rulesOrg.professionals)) return []
        return rulesOrg.professionals.map((p: any) => ({ id: p.id, name: p.name || 'Sin Nombre' }))
    }
    const safeValues = Array.isArray(rulesOrg?.values) ? rulesOrg.values : []
    // Custom payers (obras sociales, etc. created by the professional)
    const customPayers: { id: string; name: string; isOrg: boolean }[] =
        Array.isArray(rulesPro?.payers)
            ? rulesPro.payers
                .filter((p: any) => !p.isManagedBySystem)
                .map((p: any) => ({ id: p.id, name: p.name, isOrg: false }))
            : []
    // Org memberships where the professional has canLoadActivities = true
    // Resolve the actual payerId for the org by finding the system-managed payer with matching organizationId
    const payersList = [
        ...customPayers,
        ...(formData.patientOrganizationId && formData.patientOrganizationId !== orgSlug ? [] : orgPayers)
    ]
    const proList = professionalsList()

    // ─────────────────────────────────────────────────────────────────────────

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {initialData
                            ? 'Editar Actividad'
                            : viewMode === 'ORGANIZATION' ? 'Nueva Carga de Organización' : 'Registrar Cobro Profesional'}
                    </DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-4">

                    {/* Patient Search */}
                    <div className="space-y-2 relative">
                        <label className="text-xs font-semibold text-muted-foreground uppercase">Paciente <span className="text-destructive">*</span></label>
                        <div className="relative">
                            <User className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Escribe al menos 3 letras..."
                                className="pl-9"
                                value={patientSearch}
                                onChange={e => setPatientSearch(e.target.value)}
                            />
                        </div>
                        {showSuggestions && (
                            <div className="absolute z-10 w-full bg-popover border rounded-md shadow-md mt-1 max-h-48 overflow-auto">
                                {patientSuggestions.length > 0 ? (
                                    patientSuggestions.map(p => (
                                        <button key={p.id} onClick={() => selectPatient(p)}
                                            className="w-full text-left px-4 py-2 text-sm hover:bg-muted text-popover-foreground border-b last:border-0">
                                            {p.firstName} {p.lastName}
                                        </button>
                                    ))
                                ) : (
                                    <div className="px-4 py-2 text-sm text-muted-foreground italic">No encontrado.</div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Activity / Preset Selector */}
                    {enforceOrgRules && (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-muted-foreground uppercase">Actividad / Prestación <span className="text-destructive">*</span></label>
                                <Select
                                    value={
                                        formData.presetId
                                            ? formData.presetId
                                            : formData.type && !formData.presetId
                                                    ? `${ACTIVITY_TYPE_PREFIX}${formData.type}`
                                                    : ''
                                    }
                                    onValueChange={handlePresetSelect}
                                >
                                    <SelectTrigger><SelectValue placeholder="Seleccionar actividad..." /></SelectTrigger>
                                    <SelectContent>
                                        {!(formData.patientOrganizationId && formData.patientOrganizationId !== orgSlug) && safeValues.map((v: any) => (
                                            <SelectItem key={v.id} value={v.id}>{v.name} - ${v.value}</SelectItem>
                                        ))}
                                        {activityTypes.map((t: any) => (
                                            <SelectItem key={t.code} value={`${ACTIVITY_TYPE_PREFIX}${t.code}`}>{t.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}

                    {/* Date / Month Input */}
                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-muted-foreground uppercase">
                            {formData.type === WORK_ITEM_TYPE.AT ? 'Mes de Cobertura' : 'Fecha Inicio'} <span className="text-destructive">*</span>
                        </label>
                        {formData.type === WORK_ITEM_TYPE.AT ? (
                            <Input type="month" value={formData.month}
                                onChange={e => setFormData({ ...formData, month: e.target.value, date: `${e.target.value}-01` })} />
                        ) : (
                            <DatePicker
                                date={safeDate(formData.date)}
                                setDate={(d) => { if (d && !isNaN(d.getTime())) setFormData({ ...formData, date: d.toISOString().split('T')[0] }) }}
                            />
                        )}
                    </div>

                    {/* ── Org-mode: Dynamic Participants or Legacy Selectors ── */}
                    {enforceOrgRules && (
                        <div className="p-4 bg-muted/20 rounded-lg space-y-4">
                            {hasRoles ? (
                                /* ── Multi-role participant selectors ─────────── */
                                <div className="space-y-3">
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
                                        Participantes
                                        {activeActivityType && (
                                            <span className="ml-1 text-primary font-mono normal-case">{activeActivityType.name}</span>
                                        )}
                                    </p>
                                    {roles.map(role => (
                                        <div key={role.roleLabel} className="space-y-1">
                                            <label className="text-xs font-medium">
                                                {role.roleLabel}
                                                {role.isRequired
                                                    ? <span className="text-destructive ml-1">*</span>
                                                    : <span className="text-muted-foreground text-[10px] ml-1">(Opcional)</span>}
                                                {role.feeStrategy === 'FIXED'
                                                    ? <span className="text-muted-foreground text-[10px] ml-2">{role.fixedPercentage}% fijo</span>
                                                    : <span className="text-muted-foreground text-[10px] ml-2">Por categoría</span>}
                                            </label>
                                            <Select
                                                value={formData.participantsByRole[role.roleLabel] ?? '__none__'}
                                                onValueChange={val => setFormData(prev => ({
                                                    ...prev,
                                                    participantsByRole: {
                                                        ...prev.participantsByRole,
                                                        [role.roleLabel]: val === '__none__' ? '' : val
                                                    }
                                                }))}
                                            >
                                                <SelectTrigger><SelectValue placeholder={role.isRequired ? "Seleccionar..." : "Sin asignar"} /></SelectTrigger>
                                                <SelectContent>
                                                    {!role.isRequired && <SelectItem value="__none__">Sin asignar</SelectItem>}
                                                    {proList
                                                        .filter(p => {
                                                            // Exclude already selected professionals for other roles (except own slot)
                                                            const usedIds = Object.entries(formData.participantsByRole)
                                                                .filter(([label]) => label !== role.roleLabel)
                                                                .map(([, id]) => id)
                                                                .filter(Boolean)
                                                            return !usedIds.includes(p.id)
                                                        })
                                                        .map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ))}

                                    {/* AT hours when applicable */}
                                    {formData.type === WORK_ITEM_TYPE.AT && (
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium">Cantidad Horas <span className="text-destructive">*</span></label>
                                            <Input type="number" value={formData.hours}
                                                onChange={e => setFormData({ ...formData, hours: parseFloat(e.target.value) || 0 })} />
                                        </div>
                                    )}
                                </div>
                            ) : (
                                /* ── Legacy single/co-professional selectors ── */
                                <>
                                    {formData.type !== WORK_ITEM_TYPE.AT && (
                                        <div className="space-y-2">
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">
                                                    {formData.type === WORK_ITEM_TYPE.ADMISSION ? 'Profesional (Admisor)' : 'Profesional'} <span className="text-destructive">*</span>
                                                </label>
                                                <Select value={formData.professional} onValueChange={val => setFormData({ ...formData, professional: val })}>
                                                    <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                                                    <SelectContent>
                                                        {proList.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {formData.type === WORK_ITEM_TYPE.ADMISSION && (
                                                <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                                                    <label className="text-xs font-medium">
                                                        Profesional (Co-Admisor) <span className="text-muted-foreground text-[10px]">(Opcional)</span>
                                                    </label>
                                                    <Select
                                                        value={formData.participantsByRole['Co-Admisor'] ?? '__none__'}
                                                        onValueChange={val => setFormData(prev => ({
                                                            ...prev,
                                                            participantsByRole: { ...prev.participantsByRole, 'Co-Admisor': val === '__none__' ? '' : val }
                                                        }))}
                                                    >
                                                        <SelectTrigger><SelectValue placeholder="Sin Co-Admisor" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="__none__">Sin Co-Admisor</SelectItem>
                                                            {proList.filter(p => p.id !== formData.professional).map(p => (
                                                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            )}

                                            {formData.type === WORK_ITEM_TYPE.SESSION && (
                                                <div className="flex justify-between items-center pt-2 border-t border-muted/50 mt-2">
                                                    <label className="text-xs font-semibold text-indigo-600 flex items-center gap-1">
                                                        <Layers size={14} /> Pack de Sesiones
                                                    </label>
                                                    <Input type="number" min="1" max="12" className="w-16 text-right h-8"
                                                        value={formData.quantity}
                                                        onChange={e => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })} />
                                                </div>
                                            )}

                                            {formData.quantity > 1 && (
                                                <div className="mt-2 space-y-2 max-h-32 overflow-y-auto pr-1">
                                                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Detalle de Fechas</p>
                                                    {formData.packDates.map((d, i) => (
                                                        <div key={i} className="flex items-center gap-2">
                                                            <span className="text-xs text-muted-foreground w-6">#{i + 1}</span>
                                                            <DatePicker date={safeDate(d)}
                                                                setDate={(val) => { if (val) updatePackDate(i, val.toISOString().split('T')[0]) }}
                                                                className="h-8 text-xs" />
                                                        </div>
                                                    ))}
                                                    <div className="text-right">
                                                        <span className="inline-flex items-center gap-2 px-2 py-1 rounded bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold">
                                                            Total Pack: ${(formData.gross * formData.quantity).toLocaleString()}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {formData.type === WORK_ITEM_TYPE.AT && (
                                        <div className="space-y-2">
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Profesional AT <span className="text-destructive">*</span></label>
                                                <Select value={formData.professional} onValueChange={val => setFormData({ ...formData, professional: val })}>
                                                    <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                                                    <SelectContent>
                                                        {proList.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                                                <label className="text-xs font-medium">
                                                    Coordinador <span className="text-muted-foreground text-[10px]">(Opcional)</span>
                                                </label>
                                                <Select
                                                    value={formData.participantsByRole['Coordinador'] ?? '__none__'}
                                                    onValueChange={val => setFormData(prev => ({
                                                        ...prev,
                                                        participantsByRole: { ...prev.participantsByRole, 'Coordinador': val === '__none__' ? '' : val }
                                                    }))}
                                                >
                                                    <SelectTrigger><SelectValue placeholder="Sin Coordinador" /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="__none__">Sin Coordinador</SelectItem>
                                                        {proList.filter(p => p.id !== formData.professional).map(p => (
                                                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Cantidad Horas <span className="text-destructive">*</span></label>
                                                <Input type="number" value={formData.hours}
                                                    onChange={e => setFormData({ ...formData, hours: parseFloat(e.target.value) || 0 })} />
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* Attendance (Edit only) */}
                    {initialData && (
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-muted-foreground uppercase">Asistencia</label>
                            <Select value={formData.attendance} onValueChange={val => setFormData({ ...formData, attendance: val })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="PRESENT">Asistió</SelectItem>
                                    <SelectItem value="ABSENT_WITH_NOTICE">Canceló +24 hs</SelectItem>
                                    <SelectItem value="ABSENT_NO_NOTICE">Canceló -24 hs / No asistió</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Pro Mode Payer Selector */}
                    {viewMode === 'PROFESSIONAL' && (
                        <div className="space-y-4 border-b pb-4">
                            <div className="flex items-center gap-2">
                                <Checkbox id="private-patient" checked={isPrivate}
                                    onCheckedChange={(c: any) => {
                                        setIsPrivate(c)
                                        setFormData(prev => ({ ...prev, payer: c ? PAYER_PARTICULAR : '' }))
                                    }} />
                                <div className="grid gap-1.5 leading-none">
                                    <label htmlFor="private-patient" className="text-sm font-medium leading-none">
                                        Paciente Particular
                                    </label>
                                    <p className="text-[10px] text-muted-foreground">Si se marca, el pagador será "Particular".</p>
                                </div>
                            </div>
                            {!isPrivate && (
                                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                                    <label className="text-xs font-semibold text-muted-foreground uppercase">Obra Social / Pagador <span className="text-destructive">*</span></label>
                                    <Select value={formData.payer} onValueChange={val => setFormData({ ...formData, payer: val })}>
                                        <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                                        <SelectContent>
                                            {payersList.map((p: any) => (
                                                <SelectItem key={p.id} value={p.id}>
                                                    <span className="flex items-center gap-2">
                                                        {p.name}
                                                        {p.isOrg && (
                                                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">ORG</span>
                                                        )}
                                                    </span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Payment & Status */}
                    <div className="space-y-4 border-t pt-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-muted-foreground uppercase">Estado <span className="text-destructive">*</span></label>
                                <Select value={formData.status} onValueChange={(val: any) => setFormData({ ...formData, status: val })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={FORM_STATUS.PENDING}>Pendiente</SelectItem>
                                        <SelectItem value={FORM_STATUS.PARTIAL}>Parcial</SelectItem>
                                        <SelectItem value={FORM_STATUS.PAID}>Pagado</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-muted-foreground uppercase">
                                    {formData.quantity > 1 ? 'Monto Unitario' : 'Monto Total'}
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                                    <Input type="number" className="pl-7 font-semibold"
                                        disabled={enforceOrgRules && (!!formData.presetId || !!activeActivityType?.baseValue)}
                                        value={formData.gross === 0 && Number.isNaN(formData.gross) ? '' : formData.gross}
                                        onFocus={e => { if (e.target.value === '0') setFormData({ ...formData, gross: '' as any }) }}
                                        onBlur={e => { if (e.target.value === '') setFormData({ ...formData, gross: 0 }) }}
                                        onChange={e => {
                                            const val = e.target.value === '' ? ('' as any) : parseFloat(e.target.value)
                                            setFormData({ ...formData, gross: val })
                                        }} />
                                </div>
                            </div>
                        </div>

                        {formData.status === FORM_STATUS.PAID && (
                            <div className="grid grid-cols-2 gap-4 bg-emerald-50 p-3 rounded-lg border border-emerald-100 animate-in slide-in-from-top-2">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-emerald-700 uppercase">Medio Pago</label>
                                    <Select value={formData.paymentMethod} onValueChange={val => setFormData({ ...formData, paymentMethod: val })}>
                                        <SelectTrigger className="h-8 text-xs border-emerald-200"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={PAYMENT_METHOD.CASH}>Efectivo</SelectItem>
                                            <SelectItem value="Transferencia">Transferencia</SelectItem>
                                            <SelectItem value={PAYMENT_METHOD.CREDIT_CARD}>Tarjeta de Crédito</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-emerald-700 uppercase">Fecha Cobro</label>
                                    <DatePicker
                                        date={safeDate(formData.paymentDate)}
                                        setDate={(d) => { if (d) setFormData({ ...formData, paymentDate: d.toISOString().split('T')[0] }) }}
                                        className="h-8 text-xs border-emerald-200"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button onClick={handleSubmit}>Guardar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
