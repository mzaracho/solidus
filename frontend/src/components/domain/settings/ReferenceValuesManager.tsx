'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Bean } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useParams } from 'next/navigation'
import { getOrgConfig, createOrgPreset, deleteOrgPreset, updateOrgPreset, getActivityTypes } from '@/services/data'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { WORK_ITEM_TYPE } from '@/lib/constants'

interface ReferenceValue {
    id: string
    name: string
    value: number
    cardValue?: number
    linkedType: string
}

export function ReferenceValuesManager() {
    const params = useParams()
    const orgSlug = params.orgSlug as string

    const [values, setValues] = useState<ReferenceValue[]>([])
    const [activityTypes, setActivityTypes] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
    const [orgId, setOrgId] = useState<string>('')
    const [editingId, setEditingId] = useState<string | null>(null)
    const [newVal, setNewVal] = useState({ name: '', value: '', cardValue: '', linkedType: 'session' })

    const load = async () => {
        if (!orgSlug) return
        setLoading(true)
        try {
            const config = await getOrgConfig(orgSlug)
            if (config) {
                if (config.id) setOrgId(config.id)
                if (config.presets) {
                    setValues(config.presets)
                }
            }
            // Fetch Activity Types
            const types = await getActivityTypes(orgSlug)
            setActivityTypes(types)
        } catch (e) {
            console.error(e)
            toast.error("Error al cargar valores de referencia")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
    }, [orgSlug])

    const handleEdit = (val: ReferenceValue) => {
        setNewVal({
            name: val.name,
            value: val.value.toString(),
            cardValue: val.cardValue ? val.cardValue.toString() : '',
            linkedType: val.linkedType || WORK_ITEM_TYPE.SESSION
        })
        setEditingId(val.id)
    }

    const handleCancel = () => {
        setNewVal({ name: '', value: '', cardValue: '', linkedType: 'session' })
        setEditingId(null)
    }

    const handleSubmit = async () => {
        if (!newVal.name || !newVal.value) return

        try {
            const payload = {
                name: newVal.name,
                baseValue: parseFloat(newVal.value),
                cardValue: newVal.cardValue ? parseFloat(newVal.cardValue) : null,
                linkedType: newVal.linkedType
            }

            const idToUse = orgId || orgSlug
            let res;

            if (editingId) {
                res = await updateOrgPreset(idToUse, editingId, payload)
            } else {
                res = await createOrgPreset(idToUse, payload)
            }

            if (res) {
                toast.success(editingId ? "Valor actualizado" : "Valor creado")
                handleCancel()
                load()
            } else {
                toast.error("Error al guardar valor")
            }
        } catch (e) {
            toast.error("Error de conexión")
        }
    }

    const handleDelete = (id: string) => {
        setConfirmDeleteId(id)
    }

    const doDelete = async (id: string) => {
        try {
            const idToUse = orgId || orgSlug
            const success = await deleteOrgPreset(idToUse, id)
            if (success) {
                toast.success("Valor eliminado")
                load()
            } else {
                toast.error("Error al eliminar")
            }
        } catch (e) {
            toast.error("Error de conexión")
        }
    }

    if (loading) return <div>Cargando valores...</div>

    return (
        <div className="space-y-4">
            <div className="flex items-end gap-3 p-4 bg-muted/20 rounded-lg flex-wrap">
                <div className="space-y-1 flex-1 min-w-[200px]">
                    <label className="text-xs font-medium">Nombre de Prestación</label>
                    <Input
                        placeholder="Ej: Sesión Premium..."
                        value={newVal.name}
                        onChange={(e) => setNewVal({ ...newVal, name: e.target.value })}
                    />
                </div>

                <div className="space-y-1 w-40">
                    <label className="text-xs font-medium">Tipo de Actividad</label>
                    <Select
                        value={newVal.linkedType}
                        onValueChange={(val) => setNewVal({ ...newVal, linkedType: val })}
                    >
                        <SelectTrigger className="h-10">
                            <SelectValue placeholder="Tipo" />
                        </SelectTrigger>
                        <SelectContent>
                            {activityTypes.length > 0 ? (
                                activityTypes.map((t: any) => (
                                    <SelectItem key={t.code} value={t.code}>{t.name}</SelectItem>
                                ))
                            ) : (
                                <>
                                    <SelectItem value="session">Sesión</SelectItem>
                                    <SelectItem value="admission">Admisión</SelectItem>
                                    <SelectItem value="at">Acompañamiento (AT)</SelectItem>
                                </>
                            )}
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-1 w-28">
                    <label className="text-xs font-medium">Valor Base ($)</label>
                    <Input
                        type="number"
                        placeholder="0.00"
                        value={newVal.value}
                        onChange={(e) => setNewVal({ ...newVal, value: e.target.value })}
                    />
                </div>
                <div className="space-y-1 w-28">
                    <label className="text-xs font-medium">Con Tarjeta ($)</label>
                    <Input
                        type="number"
                        placeholder="Opcional"
                        value={newVal.cardValue}
                        onChange={(e) => setNewVal({ ...newVal, cardValue: e.target.value })}
                        className="bg-indigo-50/50 border-indigo-100"
                    />
                </div>

                <div className="flex gap-2">
                    {editingId && (
                        <Button onClick={handleCancel} variant="ghost" size="icon">
                            <span className="sr-only">Cancelar</span>
                            <Trash2 className="h-4 w-4 rotate-45" />
                        </Button>
                    )}
                    <Button onClick={handleSubmit} size="icon" variant={editingId ? "default" : "secondary"}>
                        {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            <div className="grid gap-3">
                {values.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground border rounded-lg border-dashed">
                        No hay valores de referencia configurados.
                    </div>
                ) : (
                    values.map((val) => (
                        <div key={val.id} className="flex items-center justify-between p-3 border rounded-lg bg-card hover:border-primary/50 transition-colors group">
                            <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                    <Bean className="h-4 w-4" />
                                </div>
                                <div>
                                    <span className="font-medium block">{val.name}</span>
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                                        {activityTypes.find(t => t.code === val.linkedType)?.name || val.linkedType || WORK_ITEM_TYPE.SESSION}
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="font-mono font-semibold">${(val.value || 0).toLocaleString()}</span>
                                {val.cardValue && (
                                    <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded">Card: ${val.cardValue}</span>
                                )}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                                    onClick={() => handleEdit(val)}
                                >
                                    <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => handleDelete(val.id)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <ConfirmDialog
                isOpen={!!confirmDeleteId}
                onClose={() => setConfirmDeleteId(null)}
                onConfirm={() => confirmDeleteId && doDelete(confirmDeleteId)}
                title="Eliminar valor de referencia"
                description="¿Estás seguro de que deseas eliminar este valor? Esta acción no se puede deshacer."
                confirmLabel="Eliminar"
                variant="destructive"
            />
        </div>
    )
}
