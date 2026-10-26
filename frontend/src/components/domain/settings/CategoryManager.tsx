'use client'

import { useState, useEffect } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useParams } from 'next/navigation'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { getOrgConfig, createCategory, updateCategory, deleteCategory } from '@/services/data'
import { toast } from 'sonner'

interface Category {
    id: string
    name: string
    percentage: number
}

export function CategoryManager() {
    const params = useParams()
    const orgSlug = params.orgSlug as string

    const [categories, setCategories] = useState<Category[]>([])
    const [loading, setLoading] = useState(true)
    const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
    const [newCat, setNewCat] = useState<{ name: string; split: string }>({ name: '', split: '' })
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editValues, setEditValues] = useState<{ name: string; split: string }>({ name: '', split: '' })

    const load = async () => {
        if (!orgSlug) return
        setLoading(true)
        try {
            const config = await getOrgConfig(orgSlug)
            if (config && config.categories) {
                setCategories(config.categories)
            }
        } catch {
            toast.error('Error al cargar categorías')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
    }, [orgSlug])

    const handleAdd = async () => {
        if (!newCat.name.trim() || !newCat.split) return
        const splitVal = parseFloat(newCat.split)
        if (isNaN(splitVal) || splitVal < 0 || splitVal > 100) {
            toast.error('El porcentaje debe estar entre 0 y 100')
            return
        }

        try {
            const created = await createCategory(orgSlug, newCat.name.trim(), splitVal)
            if (!created) throw new Error()
            setNewCat({ name: '', split: '' })
            await load()
            toast.success('Categoría creada')
        } catch {
            toast.error('Error al crear categoría')
        }
    }

    const startEdit = (cat: Category) => {
        setEditingId(cat.id)
        setEditValues({ name: cat.name, split: String(cat.percentage ?? '') })
    }

    const cancelEdit = () => {
        setEditingId(null)
        setEditValues({ name: '', split: '' })
    }

    const handleUpdate = async (id: string) => {
        const splitVal = parseFloat(editValues.split)
        if (!editValues.name.trim() || isNaN(splitVal) || splitVal < 0 || splitVal > 100) {
            toast.error('Nombre requerido y porcentaje entre 0 y 100')
            return
        }
        try {
            const updated = await updateCategory(orgSlug, id, editValues.name.trim(), splitVal)
            if (!updated) throw new Error()
            cancelEdit()
            await load()
            toast.success('Categoría actualizada')
        } catch {
            toast.error('Error al actualizar categoría')
        }
    }

    const handleDelete = (id: string, name: string) => {
        setConfirmDelete({ id, name })
    }

    const doDelete = async (id: string) => {
        try {
            const ok = await deleteCategory(orgSlug, id)
            if (!ok) throw new Error()
            await load()
            toast.success('Categoría eliminada')
        } catch {
            toast.error('Error al eliminar categoría. Puede estar en uso por un profesional.')
        }
    }

    if (loading) return <div>Cargando categorías...</div>

    return (
        <div className="space-y-6">
            {/* Form para agregar nueva categoría */}
            <div className="flex items-end gap-4 rounded-lg border p-4 bg-muted/20">
                <div className="space-y-2 flex-1">
                    <label className="text-sm font-medium">Nombre de Categoría</label>
                    <Input
                        placeholder="Ej: Acompañante Terapéutico"
                        value={newCat.name}
                        onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    />
                </div>
                <div className="space-y-2 w-32">
                    <label className="text-sm font-medium">% Prof.</label>
                    <div className="relative">
                        <Input
                            type="number"
                            min={0}
                            max={100}
                            placeholder="70"
                            value={newCat.split}
                            onChange={(e) => setNewCat({ ...newCat, split: e.target.value })}
                            className="pr-6"
                            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        />
                        <span className="absolute right-3 top-2.5 text-xs text-muted-foreground">%</span>
                    </div>
                </div>
                <Button onClick={handleAdd} disabled={!newCat.name.trim() || !newCat.split}>
                    <Plus className="h-4 w-4 mr-2" />
                    Agregar
                </Button>
            </div>

            {/* Tabla de categorías */}
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Categoría</TableHead>
                            <TableHead>Split por Defecto (Profesional)</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {categories.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={3} className="text-center h-24 text-muted-foreground">
                                    No hay categorías configuradas.
                                </TableCell>
                            </TableRow>
                        ) : (
                            categories.map((cat) => (
                                <TableRow key={cat.id}>
                                    <TableCell className="font-medium">
                                        {editingId === cat.id ? (
                                            <Input
                                                value={editValues.name}
                                                onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                                                className="h-8 w-48"
                                                autoFocus
                                            />
                                        ) : cat.name}
                                    </TableCell>
                                    <TableCell>
                                        {editingId === cat.id ? (
                                            <div className="relative w-28">
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    max={100}
                                                    value={editValues.split}
                                                    onChange={(e) => setEditValues({ ...editValues, split: e.target.value })}
                                                    className="h-8 pr-6"
                                                />
                                                <span className="absolute right-3 top-2 text-xs text-muted-foreground">%</span>
                                            </div>
                                        ) : (
                                            <Badge variant="outline" className="bg-green-50 text-green-700 hover:bg-green-50">
                                                {cat.percentage ?? 0}%
                                            </Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            {editingId === cat.id ? (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                                        onClick={() => handleUpdate(cat.id)}
                                                    >
                                                        <Check className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-muted-foreground"
                                                        onClick={cancelEdit}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </>
                                            ) : (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => startEdit(cat)}
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                        onClick={() => handleDelete(cat.id, cat.name)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <ConfirmDialog
                isOpen={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                onConfirm={() => confirmDelete && doDelete(confirmDelete.id)}
                title={`Eliminar categoría "${confirmDelete?.name}"`}
                description="Si hay profesionales asignados a esta categoría, la operación fallará."
                confirmLabel="Eliminar"
                variant="destructive"
            />
        </div>
    )
}
