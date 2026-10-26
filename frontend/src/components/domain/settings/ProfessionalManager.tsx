'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus } from "lucide-react"
import { getOrgConfig, assignStaffCategory, createStaff, updateStaff } from '@/services/data'

interface Professional {
    id: string
    displayName: string
    categoryId?: string
    email?: string
    category?: { id: string, name: string }
    canLoadActivities?: boolean
}

export function ProfessionalManager() {
    const params = useParams()
    const orgSlug = params.orgSlug as string
    const [professionals, setProfessionals] = useState<any[]>([])
    const [categories, setCategories] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [newPro, setNewPro] = useState({ name: '', surname: '', email: '', cuit: '', phone: '', canLoadActivities: false })

    const loadData = async () => {
        if (!orgSlug) return
        setLoading(true)
        const config = await getOrgConfig(orgSlug)
        if (config) {
            setProfessionals(config.staff || [])
            setCategories(config.categories || [])
        }
        setLoading(false)
    }

    useEffect(() => {
        loadData()
    }, [orgSlug])

    const handleCategoryChange = async (profId: string, catId: string) => {
        setProfessionals(prev => prev.map(p =>
            p.id === profId ? { ...p, categoryId: catId } : p
        ))
        await assignStaffCategory(orgSlug, profId, catId)
    }

    const handleCreate = async () => {
        // Basic validation
        if (!newPro.name || !newPro.surname || !newPro.email || !newPro.cuit) return;

        await createStaff(orgSlug, newPro)
        setIsDialogOpen(false)
        setNewPro({ name: '', surname: '', email: '', cuit: '', phone: '', canLoadActivities: false })
        loadData() // Refresh list
    }

    if (loading) return <div>Cargando profesionales...</div>

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Listado de Profesionales</h3>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="gap-2">
                            <Plus className="h-4 w-4" />
                            Agregar Profesional
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Agregar Nuevo Profesional</DialogTitle>
                            <DialogDescription>
                                Crea un registro de profesional. Si el email coincide con un usuario actual o futuro, se podrá vincular.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="name" className="text-right">Nombre</Label>
                                <Input id="name" value={newPro.name} onChange={e => setNewPro({ ...newPro, name: e.target.value })} className="col-span-3" required />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="surname" className="text-right">Apellido</Label>
                                <Input id="surname" value={newPro.surname} onChange={e => setNewPro({ ...newPro, surname: e.target.value })} className="col-span-3" required />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="email" className="text-right">Email</Label>
                                <Input id="email" type="email" value={newPro.email} onChange={e => setNewPro({ ...newPro, email: e.target.value })} className="col-span-3" required />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="cuit" className="text-right">CUIT</Label>
                                <Input id="cuit" value={newPro.cuit} onChange={e => setNewPro({ ...newPro, cuit: e.target.value })} className="col-span-3" required />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="phone" className="text-right">Teléfono</Label>
                                <Input id="phone" value={newPro.phone} onChange={e => setNewPro({ ...newPro, phone: e.target.value })} className="col-span-3" />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="canLoad" className="text-right">Habilitar Carga</Label>
                                <div className="col-span-3 flex items-center space-x-2">
                                  <Switch id="canLoad" checked={newPro.canLoadActivities} onCheckedChange={val => setNewPro({ ...newPro, canLoadActivities: val })} />
                                  <span className="text-sm text-muted-foreground leading-snug">El profesional podrá registrar/borrar sus propias actividades.</span>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button onClick={handleCreate}>Guardar</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Profesional</TableHead>
                            <TableHead>Categoría Asignada</TableHead>
                            <TableHead>Carga Autónoma</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {professionals.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={2} className="text-center h-24">
                                    No hay profesionales cargados.
                                </TableCell>
                            </TableRow>
                        ) : (
                            professionals.map((prof) => (
                                <TableRow key={prof.id}>
                                    <TableCell className="font-medium">
                                        <div>{prof.displayName || prof.name || prof.email}</div>
                                        {prof.email && <div className="text-xs text-muted-foreground">{prof.email}</div>}
                                    </TableCell>
                                    <TableCell>
                                        <Select
                                            defaultValue={prof.categoryId || (prof.category?.id)}
                                            onValueChange={(val) => handleCategoryChange(prof.id, val)}
                                        >
                                            <SelectTrigger className="w-[200px]">
                                                <SelectValue placeholder="Seleccionar categoría" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {categories.map((cat) => (
                                                    <SelectItem key={cat.id} value={cat.id}>
                                                        {cat.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center space-x-2">
                                            <Switch 
                                                checked={prof.canLoadActivities || false} 
                                                onCheckedChange={async (val) => {
                                                    setProfessionals(prev => prev.map(p => p.id === prof.id ? { ...p, canLoadActivities: val } : p));
                                                    await updateStaff(orgSlug, prof.id, { name: prof.name || prof.displayName.split(' ')[0], surname: prof.surname || prof.displayName.split(' ').slice(1).join(' '), email: prof.email || '', cuit: prof.cuit || '', phone: prof.phone || '', canLoadActivities: val });
                                                }} 
                                            />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
