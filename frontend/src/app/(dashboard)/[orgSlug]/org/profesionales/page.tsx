'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getOrgConfig, createStaff, assignStaffCategory } from '@/services/data'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { User, Plus, Trash2, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { updateStaff, deleteStaff } from '@/services/data'
import { Switch } from '@/components/ui/switch'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'

export default function ProfessionalsPage() {
    const params = useParams()
    const orgSlug = params.orgSlug as string
    const [staff, setStaff] = useState<any[]>([])
    const [categories, setCategories] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
    const [creating, setCreating] = useState(false)

    const [editingId, setEditingId] = useState<string | null>(null)

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        surname: '',
        userId: '',
        cuit: '',
        email: '',
        phone: '',
        canLoadActivities: false,
        categoryId: '',
    })

    const load = async () => {
        if (!orgSlug) return
        setLoading(true)
        const config = await getOrgConfig(orgSlug)
        if (config && config.staff) {
            setStaff(config.staff)
        }
        if (config && config.categories) {
            setCategories(config.categories)
        }
        setLoading(false)
    }

    useEffect(() => {
        load()
    }, [orgSlug])

    const handleCreateOrUpdate = async () => {
        // Validation
        if (!formData.name || !formData.surname || !formData.email) {
            toast.error('Complete los campos obligatorios: Nombre, Apellido y Email (*)')
            return
        }
        if (!editingId && !formData.cuit) {
            toast.error('El CUIT / CUIL es obligatorio para dar de alta un profesional')
            return
        }

        setCreating(true)
        try {
            let res
            if (editingId) {
                // Update general data
                res = await updateStaff(orgSlug, editingId, formData)
                // Update category separately if changed
                if (formData.categoryId) {
                    await assignStaffCategory(orgSlug, editingId, formData.categoryId)
                }
                if (res?.warning) {
                    toast.warning(res.warning)
                } else {
                    toast.success('Profesional actualizado exitosamente')
                }
            } else {
                // Create
                res = await createStaff(orgSlug, formData)
                if (res && res.id) {
                    // Assign category if selected
                    if (formData.categoryId) {
                        await assignStaffCategory(orgSlug, res.id, formData.categoryId)
                    }
                    toast.success('Profesional creado exitosamente')
                } else {
                    throw new Error('No se pudo crear')
                }
            }

            setIsDialogOpen(false)
            setFormData({ name: '', surname: '', userId: '', cuit: '', email: '', phone: '', canLoadActivities: false, categoryId: '' })
            setEditingId(null)
            load()
        } catch (e) {
            console.error(e)
            toast.error('Error al guardar profesional')
        } finally {
            setCreating(false)
        }
    }

    const openEdit = (pro: any) => {
        // Split displayName into name/surname: last word = surname, rest = name
        let name = ''
        let surname = ''

        if (pro.displayName) {
            const parts = pro.displayName.trim().split(/\s+/)
            if (parts.length === 1) {
                name = parts[0]
            } else {
                surname = parts[parts.length - 1]
                name = parts.slice(0, parts.length - 1).join(' ')
            }
        }

        setFormData({
            name,
            surname,
            userId: pro.userId || '',
            cuit: pro.cuit || '',
            email: pro.email || pro.user?.email || '',
            phone: pro.phone || '',
            canLoadActivities: pro.canLoadActivities ?? false,
            categoryId: pro.category?.id || pro.categoryId || '',
        })
        setEditingId(pro.id)
        setIsDialogOpen(true)
    }

    const startCreate = () => {
        setFormData({ name: '', surname: '', userId: '', cuit: '', email: '', phone: '', canLoadActivities: false, categoryId: '' })
        setEditingId(null)
        setIsDialogOpen(true)
    }

    const handleDelete = (id: string, name: string) => {
        setConfirmDelete({ id, name })
    }

    const doDelete = async (id: string) => {

        try {
            await deleteStaff(orgSlug, id)
            toast.success('Profesional eliminado')
            load()
        } catch (e: any) {
            console.error(e)
            if (e.message && (e.message.includes('Foreign key') || e.message.includes('constraint') || e.message.includes('work items'))) {
                toast.error('No se puede eliminar: El profesional tiene actividades asociadas.')
            } else {
                toast.error('Error al eliminar profesional: ' + e.message)
            }
        }
    }

    if (loading) return <div className="p-8">Cargando profesionales...</div>

    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">Gestión de Profesionales</h2>
                <Dialog open={isDialogOpen} onOpenChange={(open) => {
                    setIsDialogOpen(open)
                    if (!open) setEditingId(null)
                }}>
                    <DialogTrigger asChild>
                        <Button onClick={startCreate}>
                            <Plus className="mr-2 h-4 w-4" />
                            Alta Profesional
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[500px]">
                        <DialogHeader>
                            <DialogTitle>{editingId ? 'Editar Profesional' : 'Alta de Profesional'}</DialogTitle>
                            <DialogDescription>
                                {editingId ? 'Modifique los datos del profesional.' : 'Ingrese los datos del profesional para registrarlo en la organización.'}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Nombre *</Label>
                                    <Input
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="Ej: Dr. Juan"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Apellido *</Label>
                                    <Input
                                        value={formData.surname}
                                        onChange={e => setFormData({ ...formData, surname: e.target.value })}
                                        placeholder="Ej: Pérez"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>CUIT / CUIL {!editingId && '*'}</Label>
                                <Input
                                    value={formData.cuit}
                                    onChange={e => setFormData({ ...formData, cuit: e.target.value })}
                                    placeholder="Sin guiones"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Email *</Label>
                                <Input
                                    type="email"
                                    value={formData.email}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    placeholder="email@ejemplo.com"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Se usará para invitar o vincular un usuario existente.
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label>Teléfono</Label>
                                <Input
                                    value={formData.phone}
                                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="+54 9 11 ..."
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Categoría</Label>
                                <Select
                                    value={formData.categoryId || 'none'}
                                    onValueChange={(val) => setFormData({ ...formData, categoryId: val === 'none' ? '' : val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Sin categoría" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Sin categoría</SelectItem>
                                        {categories.map((cat) => (
                                            <SelectItem key={cat.id} value={cat.id}>
                                                {cat.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
                                <div className="space-y-0.5">
                                    <Label className="text-sm font-medium">Permitir carga de actividades</Label>
                                    <p className="text-[11px] text-muted-foreground">
                                        Si está activo, este profesional podrá cargar sus propias actividades desde la vista Pro.
                                    </p>
                                </div>
                                <Switch
                                    checked={formData.canLoadActivities}
                                    onCheckedChange={(checked) => setFormData({ ...formData, canLoadActivities: checked })}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={creating}>Cancelar</Button>
                            <Button onClick={handleCreateOrUpdate} disabled={creating}>
                                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {editingId ? 'Guardar Cambios' : 'Crear Profesional'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Profesionales Asociados</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nombre</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Categoría</TableHead>
                                <TableHead>Carga Actividades</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {staff.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-24 text-center">
                                        No hay profesionales asociados.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                staff.map((pro) => (
                                    <TableRow key={pro.id}>
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                <User className="h-4 w-4 text-muted-foreground" />
                                                {pro.displayName || pro.name || 'Sin Nombre'}
                                            </div>
                                        </TableCell>
                                        <TableCell>{pro.email || pro.user?.email || 'Sin Email'}</TableCell>
                                        <TableCell>
                                            {pro.category ? (
                                                <Badge variant="outline">{pro.category.name}</Badge>
                                            ) : (
                                                <span className="text-muted-foreground text-sm">Sin categoría</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {pro.canLoadActivities ? (
                                                <Badge variant="default" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Habilitado</Badge>
                                            ) : (
                                                <span className="text-muted-foreground text-sm">No</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary"
                                                    onClick={() => openEdit(pro)}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                                    onClick={() => handleDelete(pro.id, (pro.displayName || pro.name || 'Profesional'))}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <ConfirmDialog
                isOpen={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                onConfirm={() => confirmDelete && doDelete(confirmDelete.id)}
                title={`Eliminar a ${confirmDelete?.name}`}
                description="¿Estás seguro de que deseas eliminar este profesional? Esta acción no se puede deshacer."
                confirmLabel="Eliminar"
                variant="destructive"
            />
        </div>
    )
}
