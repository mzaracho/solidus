'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Pencil, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { getActivityTypes, createActivityType, updateActivityType, deleteActivityType } from '@/services/data'

type FeeStrategy = 'CATEGORY' | 'FIXED'

interface RoleConfig {
    roleLabel: string
    isRequired: boolean
    feeStrategy: FeeStrategy
    fixedPercentage?: number
}

interface ActivityType {
    id: string
    code: string
    name: string
    baseValue?: number
    cardValue?: number
    roles?: RoleConfig[]
}

const EMPTY_ROLE: RoleConfig = { roleLabel: '', isRequired: true, feeStrategy: 'CATEGORY' }

function RoleEditor({ role, index, onChange, onRemove }: {
    role: RoleConfig
    index: number
    onChange: (r: RoleConfig) => void
    onRemove: () => void
}) {
    return (
        <div className="flex flex-col gap-2 rounded-md border p-3 bg-muted/10">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Rol #{index + 1}</span>
                <button onClick={onRemove} className="text-destructive hover:opacity-70">
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase">Nombre del Rol</label>
                    <Input
                        placeholder="ej: Admisor"
                        value={role.roleLabel}
                        onChange={e => onChange({ ...role, roleLabel: e.target.value })}
                        className="h-8 text-sm"
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase">Estrategia</label>
                    <Select
                        value={role.feeStrategy}
                        onValueChange={(v: FeeStrategy) => onChange({ ...role, feeStrategy: v, fixedPercentage: v === 'CATEGORY' ? undefined : (role.fixedPercentage ?? 0) })}
                    >
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="CATEGORY">Por Categoría</SelectItem>
                            <SelectItem value="FIXED">Porcentaje Fijo</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <div className="flex items-center gap-4">
                {role.feeStrategy === 'FIXED' && (
                    <div className="space-y-1 flex-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">% Honorario</label>
                        <div className="relative">
                            <Input
                                type="number" min={0} max={100}
                                placeholder="ej: 30"
                                value={role.fixedPercentage ?? ''}
                                onChange={e => onChange({ ...role, fixedPercentage: parseFloat(e.target.value) || 0 })}
                                className="h-8 text-sm pr-6"
                            />
                            <span className="absolute right-2 top-2 text-xs text-muted-foreground">%</span>
                        </div>
                    </div>
                )}
                <div className="flex items-center gap-2 mt-3">
                    <input
                        type="checkbox"
                        id={`required-${index}`}
                        checked={role.isRequired}
                        onChange={e => onChange({ ...role, isRequired: e.target.checked })}
                        className="h-3.5 w-3.5 accent-primary"
                    />
                    <label htmlFor={`required-${index}`} className="text-xs text-muted-foreground">Obligatorio</label>
                </div>
            </div>
        </div>
    )
}

const EMPTY_FORM = { code: '', name: '', baseValue: '', cardValue: '', roles: [] as RoleConfig[] }

export function ActivityTypesManager() {
    const params = useParams()
    const orgSlug = params.orgSlug as string

    const [types, setTypes] = useState<ActivityType[]>([])
    const [loading, setLoading] = useState(true)
    const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState(EMPTY_FORM)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const load = async () => {
        if (!orgSlug) return
        setLoading(true)
        try {
            const data = await getActivityTypes(orgSlug)
            setTypes(Array.isArray(data) ? data : [])
        } catch {
            toast.error('Error al cargar prestaciones')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() }, [orgSlug])

    const openCreate = () => {
        setEditingId(null)
        setForm(EMPTY_FORM)
        setDialogOpen(true)
    }

    const openEdit = (t: ActivityType) => {
        setEditingId(t.id)
        setForm({
            code: t.code,
            name: t.name,
            baseValue: t.baseValue != null ? String(t.baseValue) : '',
            cardValue: t.cardValue != null ? String(t.cardValue) : '',
            roles: t.roles ? [...t.roles] : [],
        })
        setDialogOpen(true)
    }

    const addRole = () => {
        if (form.roles.length >= 3) { toast.error('Máximo 3 roles por prestación'); return }
        setForm(f => ({ ...f, roles: [...f.roles, { ...EMPTY_ROLE }] }))
    }

    const updateRole = (i: number, r: RoleConfig) => {
        setForm(f => { const roles = [...f.roles]; roles[i] = r; return { ...f, roles } })
    }

    const removeRole = (i: number) => {
        setForm(f => ({ ...f, roles: f.roles.filter((_, idx) => idx !== i) }))
    }

    const handleSave = async () => {
        if (!form.code.trim() || !form.name.trim()) {
            toast.error('Código y nombre son obligatorios')
            return
        }
        for (const r of form.roles) {
            if (!r.roleLabel.trim()) { toast.error('Todos los roles deben tener nombre'); return }
            if (r.feeStrategy === 'FIXED' && (r.fixedPercentage == null || r.fixedPercentage < 0 || r.fixedPercentage > 100)) {
                toast.error(`El rol "${r.roleLabel}" requiere un porcentaje entre 0 y 100`); return
            }
        }

        setSaving(true)
        try {
            const payload = {
                code: form.code.trim(),
                name: form.name.trim(),
                baseValue: form.baseValue ? parseFloat(form.baseValue) : undefined,
                cardValue: form.cardValue ? parseFloat(form.cardValue) : undefined,
                roles: form.roles.length > 0 ? form.roles : undefined,
            }
            if (editingId) {
                await updateActivityType(orgSlug, editingId, payload)
                toast.success('Prestación actualizada')
            } else {
                await createActivityType(orgSlug, payload)
                toast.success('Prestación creada')
            }
            setDialogOpen(false)
            await load()
        } catch (e: any) {
            toast.error(e.message || 'Error al guardar')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = (id: string, name: string) => {
        setConfirmDelete({ id, name })
    }

    const doDelete = async (id: string) => {
        try {
            await deleteActivityType(orgSlug, id)
            toast.success('Prestación eliminada')
            await load()
        } catch (e: any) {
            toast.error(e.message || 'Error al eliminar')
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                    Configura las prestaciones de tu organización con sus roles de profesionales y estrategias de honorarios.
                </p>
                <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4 mr-1" /> Nueva Prestación
                </Button>
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Cargando...</p>
            ) : types.length === 0 ? (
                <div className="text-center py-8 border rounded-md border-dashed">
                    <p className="text-sm text-muted-foreground">No hay prestaciones configuradas.</p>
                    <Button variant="link" size="sm" onClick={openCreate}>Crear la primera</Button>
                </div>
            ) : (
                <div className="space-y-2">
                    {types.map(t => (
                        <div key={t.id} className="rounded-md border bg-card">
                            <div className="flex items-center justify-between px-4 py-3">
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                                        className="text-muted-foreground hover:text-foreground"
                                    >
                                        {expandedId === t.id
                                            ? <ChevronUp className="h-4 w-4" />
                                            : <ChevronDown className="h-4 w-4" />}
                                    </button>
                                    <div>
                                        <span className="font-medium text-sm">{t.name}</span>
                                        <span className="ml-2 text-xs text-muted-foreground font-mono">{t.code}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    {t.baseValue != null && (
                                        <span className="text-xs">Base: <span className="font-semibold text-foreground">${Number(t.baseValue).toLocaleString()}</span></span>
                                    )}
                                    {t.cardValue != null && (
                                        <span className="text-xs">Tarjeta: <span className="font-semibold text-foreground">${Number(t.cardValue).toLocaleString()}</span></span>
                                    )}
                                    <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
                                        {(t.roles?.length ?? 0)} rol{(t.roles?.length ?? 0) !== 1 ? 'es' : ''}
                                    </span>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)}>
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(t.id, t.name)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>

                            {expandedId === t.id && t.roles && t.roles.length > 0 && (
                                <div className="px-4 pb-3 border-t pt-3">
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Roles configurados</p>
                                    <div className="space-y-1">
                                        {t.roles.map((r, i) => (
                                            <div key={i} className="flex items-center gap-3 text-xs">
                                                <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                                                <span className="font-medium">{r.roleLabel}</span>
                                                <span className="text-muted-foreground">
                                                    {r.feeStrategy === 'FIXED'
                                                        ? `${r.fixedPercentage}% fijo`
                                                        : 'Por categoría'}
                                                </span>
                                                {!r.isRequired && <span className="text-muted-foreground italic">Opcional</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Create / Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingId ? 'Editar Prestación' : 'Nueva Prestación'}</DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-4 py-2">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-muted-foreground uppercase">Código <span className="text-destructive">*</span></label>
                                <Input
                                    placeholder="ej: admision"
                                    value={form.code}
                                    disabled={!!editingId}
                                    onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                                />
                                {!editingId && <p className="text-[10px] text-muted-foreground">Identificador único, sin espacios.</p>}
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-muted-foreground uppercase">Nombre <span className="text-destructive">*</span></label>
                                <Input
                                    placeholder="ej: Admisión"
                                    value={form.name}
                                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-muted-foreground uppercase">Valor Base (Efectivo)</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-xs text-muted-foreground">$</span>
                                    <Input
                                        type="number" min={0} className="pl-6"
                                        placeholder="0"
                                        value={form.baseValue}
                                        onChange={e => setForm(f => ({ ...f, baseValue: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-muted-foreground uppercase">Valor Tarjeta</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-xs text-muted-foreground">$</span>
                                    <Input
                                        type="number" min={0} className="pl-6"
                                        placeholder="0"
                                        value={form.cardValue}
                                        onChange={e => setForm(f => ({ ...f, cardValue: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold text-muted-foreground uppercase">
                                    Roles de Profesionales <span className="text-muted-foreground font-normal">(máx. 3)</span>
                                </label>
                                {form.roles.length < 3 && (
                                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addRole}>
                                        <Plus className="h-3 w-3 mr-1" /> Agregar Rol
                                    </Button>
                                )}
                            </div>
                            {form.roles.length === 0 && (
                                <p className="text-xs text-muted-foreground italic py-2 text-center border rounded-md border-dashed">
                                    Sin roles — un solo profesional por actividad.
                                </p>
                            )}
                            {form.roles.map((r, i) => (
                                <RoleEditor
                                    key={i}
                                    role={r}
                                    index={i}
                                    onChange={r => updateRole(i, r)}
                                    onRemove={() => removeRole(i)}
                                />
                            ))}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                isOpen={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                onConfirm={() => confirmDelete && doDelete(confirmDelete.id)}
                title={`Eliminar prestación "${confirmDelete?.name}"`}
                description="Esta acción no se puede deshacer."
                confirmLabel="Eliminar"
                variant="destructive"
            />
        </div>
    )
}
