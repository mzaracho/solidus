'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
    User,
    Plus,
    ArrowRight,
    History,
    Pencil,
    GitMerge,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogTrigger,
} from '@/components/ui/dialog'

import { getPatients, createPatient, updatePatient, getWorkItems, mergePatient } from '@/services/data'
import { PAYMENT_STATUS } from '@/lib/constants'
import { useStore } from '@/store/useStore'

export function PatientDirectory() {
    const { orgSlug } = useParams() as { orgSlug: string }
    const { viewMode } = useStore()
    const [patients, setPatients] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedPatient, setSelectedPatient] = useState<any | null>(null)
    const [patientHistory, setPatientHistory] = useState<any[]>([])
    const [loadingHistory, setLoadingHistory] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')

    // Pagination State
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(12)
    const [totalItems, setTotalItems] = useState(0)

    // Dialog States
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [isEditOpen, setIsEditOpen] = useState(false)
    const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', phone: '' })

    // Merge States
    const [isMergeOpen, setIsMergeOpen] = useState(false)
    const [mergeSearch, setMergeSearch] = useState('')
    const [mergeResults, setMergeResults] = useState<any[]>([])
    const [mergeTarget, setMergeTarget] = useState<any | null>(null)
    const [mergeLoading, setMergeLoading] = useState(false)

    // Load Data
    const loadPatients = async () => {
        setLoading(true)
        // Now passing page and pageSize
        const data = await getPatients(orgSlug, searchTerm, page, pageSize, viewMode)
        setPatients(data?.items || [])
        setTotalItems(data?.total || 0)
        setLoading(false)
    }

    // Effect: Reload when org, page, pageSize changes. 
    // Search is handled by debouncing or enter key usually, but here we can just reload on effect if we want real-time, 
    // OR typically for server search, we want to debounce. 
    // For simplicity in this prompt, let's reload when searchTerm changes too, but debounce logic is better.
    // However, user Requirement 2 says "Search by name must go to API".
    useEffect(() => {
        if (orgSlug) {
            const timer = setTimeout(() => {
                loadPatients()
            }, 500) // Simple debounce
            return () => clearTimeout(timer)
        }
    }, [orgSlug, page, pageSize, searchTerm, viewMode])

    // When search changes, reset to page 1
    const handleSearchChange = (val: string) => {
        setSearchTerm(val)
        setPage(1)
    }

    const handleCreate = async () => {
        try {
            await createPatient(orgSlug, { ...formData, organizationId: orgSlug })
            toast.success("Paciente creado correctamente")
            setIsCreateOpen(false)
            setFormData({ firstName: '', lastName: '', email: '', phone: '' })
            loadPatients()
        } catch (e) {
            toast.error("Error al crear paciente")
        }
    }

    const handleUpdate = async () => {
        if (!selectedPatient) return
        try {
            await updatePatient(orgSlug, selectedPatient.id, formData)
            toast.success("Paciente actualizado")
            setIsEditOpen(false)
            loadPatients()
            setSelectedPatient({ ...selectedPatient, ...formData })
        } catch (e) {
            toast.error("Error al actualizar paciente")
        }
    }

    const openEdit = (p: any) => {
        setFormData({
            firstName: p.firstName,
            lastName: p.lastName,
            email: p.email || '',
            phone: p.phone || ''
        })
        setIsEditOpen(true)
    }

    const openMerge = () => {
        setMergeSearch('')
        setMergeResults([])
        setMergeTarget(null)
        setIsMergeOpen(true)
    }

    useEffect(() => {
        if (!isMergeOpen || !mergeSearch.trim()) {
            setMergeResults([])
            return
        }
        const timer = setTimeout(async () => {
            const data = await getPatients(orgSlug, mergeSearch, 1, 10, viewMode)
            setMergeResults((data?.items || []).filter((p: any) => p.id !== selectedPatient?.id))
        }, 400)
        return () => clearTimeout(timer)
    }, [mergeSearch, isMergeOpen, viewMode])

    const handleMerge = async () => {
        if (!mergeTarget || !selectedPatient) return
        setMergeLoading(true)
        try {
            await mergePatient(orgSlug, selectedPatient.id, mergeTarget.id)
            toast.success(`${selectedPatient.firstName} ${selectedPatient.lastName} combinado en ${mergeTarget.firstName} ${mergeTarget.lastName}`)
            setIsMergeOpen(false)
            setSelectedPatient(null)
            loadPatients()
        } catch {
            toast.error('Error al combinar pacientes')
        } finally {
            setMergeLoading(false)
        }
    }

    // History Pagination
    const [historyPage, setHistoryPage] = useState(1)
    const [historyLimit, setHistoryLimit] = useState(12)
    const [historyTotal, setHistoryTotal] = useState(0)

    const loadHistory = async (patientId: string) => {
        setLoadingHistory(true)
        try {
            const res = await getWorkItems(orgSlug, viewMode, { patientId }, historyPage, historyLimit)
            const items = res.items || (Array.isArray(res) ? res : [])
            const total = res.total || items.length

            setPatientHistory(items)
            setHistoryTotal(total)
        } catch (e) {
            console.error(e)
            toast.error("Error al cargar historial")
            setPatientHistory([])
        } finally {
            setLoadingHistory(false)
        }
    }

    useEffect(() => {
        if (selectedPatient) {
            loadHistory(selectedPatient.id)
        } else {
            setPatientHistory([])
            setHistoryTotal(0)
        }
    }, [selectedPatient, historyPage, historyLimit, viewMode])

    // Filter Logic Removed - Server side search now used.

    if (loading && patients.length === 0) return <div>Cargando pacientes...</div>

    const totalPages = Math.ceil(totalItems / pageSize)

    if (selectedPatient) {
        return (
            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <Button variant="ghost" onClick={() => setSelectedPatient(null)} className="mb-4 pl-0 gap-2">
                    <ArrowRight className="rotate-180 h-4 w-4" /> Volver
                </Button>

                <div className="grid md:grid-cols-3 gap-6">
                    <div className="md:col-span-1 space-y-6">
                        <Card className="p-6 relative">
                            <div className="absolute top-2 right-2 flex gap-1">
                                {viewMode !== 'PROFESSIONAL' && (
                                    <Button variant="ghost" size="icon" title="Combinar con otro paciente" onClick={openMerge}>
                                        <GitMerge className="h-4 w-4" />
                                    </Button>
                                )}
                                <Button variant="ghost" size="icon" onClick={() => openEdit(selectedPatient)}>
                                    <Pencil className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="text-center">
                                <div className="w-20 h-20 bg-muted rounded-full mx-auto flex items-center justify-center mb-4">
                                    <User className="h-10 w-10 text-muted-foreground" />
                                </div>
                                <h2 className="text-xl font-bold">{selectedPatient.firstName} {selectedPatient.lastName}</h2>
                                <p className="text-sm text-muted-foreground">{selectedPatient.email}</p>
                                <div className="mt-4 text-left space-y-2 border-t pt-4">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Teléfono</span>
                                        <span>{selectedPatient.phone || '-'}</span>
                                    </div>
                                    <div className="flex justify-between text-sm items-center">
                                        <span className="text-muted-foreground">Estado</span>
                                        <Badge variant={selectedPatient.debt > 0 ? "destructive" : "secondary"} className={selectedPatient.debt <= 0 ? "bg-green-100 text-green-700 hover:bg-green-100" : ""}>
                                            {selectedPatient.debt > 0 ? "Deudor" : "Al día"}
                                        </Badge>
                                    </div>
                                    {selectedPatient.debt > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Monto Deuda</span>
                                            <span className="text-red-600 font-bold">
                                                ${selectedPatient.debt.toLocaleString()}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Card>
                    </div>
                    <div className="md:col-span-2">
                        <Card className="p-4">
                            <h3 className="font-semibold mb-4 flex items-center gap-2"><History className="h-4 w-4" /> Historial</h3>
                            {loadingHistory ? (
                                <div className="text-center py-8 text-muted-foreground">Cargando historial...</div>
                            ) : patientHistory.length > 0 ? (
                                <>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Fecha</TableHead>
                                                <TableHead>Profesional</TableHead>
                                                <TableHead>Servicio</TableHead>
                                                <TableHead>Estado</TableHead>
                                                <TableHead className="text-right">Monto</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {patientHistory.map((item) => (
                                                <TableRow key={item.id}>
                                                    <TableCell>{format(new Date(item.date), 'dd/MM/yyyy', { locale: es })}</TableCell>
                                                    <TableCell>{item.professionalName || item.professional?.displayName || 'Profesional'}</TableCell>
                                                    <TableCell>{item.serviceType || 'Atención'}</TableCell>
                                                    <TableCell>
                                                        <Badge variant={item.status === PAYMENT_STATUS.PAID ? 'secondary' : 'outline'} className={item.status === PAYMENT_STATUS.PAID ? 'bg-green-100 text-green-700' : 'text-yellow-600 border-yellow-200'}>
                                                            {item.status === PAYMENT_STATUS.PAID ? 'Pagado' : 'Pendiente'}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right">${Number(item.grossAmount).toLocaleString()}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>

                                    <div className="flex items-center justify-between px-2 border-t pt-4 mt-4">
                                        <div className="flex items-center space-x-4">
                                            <div className="text-xs text-muted-foreground">
                                                Mostrando {((historyPage - 1) * historyLimit) + 1} a {Math.min(historyPage * historyLimit, historyTotal)} de {historyTotal}
                                            </div>
                                            <select
                                                className="h-8 w-[70px] rounded-md border border-input bg-background px-2 py-1 text-xs"
                                                value={historyLimit}
                                                onChange={(e) => {
                                                    setHistoryLimit(Number(e.target.value));
                                                    setHistoryPage(1);
                                                }}
                                            >
                                                {[12, 18, 24].map((size) => (
                                                    <option key={size} value={size}>
                                                        {size}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="flex items-center space-x-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                                                disabled={historyPage === 1 || loadingHistory}
                                            >
                                                Anterior
                                            </Button>
                                            <div className="text-xs font-medium">
                                                Página {historyPage} de {Math.ceil(historyTotal / historyLimit) || 1}
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setHistoryPage(p => Math.min(Math.ceil(historyTotal / historyLimit), p + 1))}
                                                disabled={historyPage >= Math.ceil(historyTotal / historyLimit) || loadingHistory}
                                            >
                                                Siguiente
                                            </Button>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="text-sm text-muted-foreground text-center py-8">
                                    No hay historial de atenciones registrado.
                                </div>
                            )}
                        </Card>

                    </div>
                </div>

                {/* Edit Dialog */}
                <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>Editar Paciente</DialogTitle></DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <Input placeholder="Nombre" value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} />
                                <Input placeholder="Apellido" value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} />
                            </div>
                            <Input placeholder="Email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                            <Input placeholder="Teléfono" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                        </div>
                        <DialogFooter>
                            <Button onClick={handleUpdate}>Guardar Cambios</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Merge Dialog */}
                <Dialog open={isMergeOpen} onOpenChange={(open) => { setIsMergeOpen(open); if (!open) setMergeTarget(null) }}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Combinar Paciente</DialogTitle>
                        </DialogHeader>
                        {!mergeTarget ? (
                            <div className="space-y-4 py-2">
                                <p className="text-sm text-muted-foreground">
                                    Buscá el paciente destino. Todos los turnos de <strong>{selectedPatient?.firstName} {selectedPatient?.lastName}</strong> serán transferidos y este registro será eliminado.
                                </p>
                                <Input
                                    placeholder="Buscar por nombre..."
                                    value={mergeSearch}
                                    onChange={e => setMergeSearch(e.target.value)}
                                    autoFocus
                                />
                                <div className="space-y-1 max-h-60 overflow-y-auto">
                                    {mergeResults.length === 0 && mergeSearch.trim() && (
                                        <p className="text-sm text-muted-foreground text-center py-4">Sin resultados</p>
                                    )}
                                    {mergeResults.map((p: any) => (
                                        <div
                                            key={p.id}
                                            className="flex items-center justify-between p-2 rounded-md hover:bg-muted cursor-pointer"
                                            onClick={() => setMergeTarget(p)}
                                        >
                                            <span className="font-medium text-sm">{p.firstName} {p.lastName}</span>
                                            {p.debt > 0 && <span className="text-xs text-red-500">Deudor</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4 py-2">
                                <p className="text-sm">
                                    ¿Estás seguro? Los turnos de <strong>{selectedPatient?.firstName} {selectedPatient?.lastName}</strong> pasarán a <strong>{mergeTarget.firstName} {mergeTarget.lastName}</strong> y el primer registro será eliminado.
                                </p>
                                <p className="text-xs text-muted-foreground">Esta acción no se puede deshacer.</p>
                            </div>
                        )}
                        <DialogFooter>
                            {mergeTarget ? (
                                <>
                                    <Button variant="outline" onClick={() => setMergeTarget(null)}>Volver</Button>
                                    <Button variant="destructive" onClick={handleMerge} disabled={mergeLoading}>
                                        {mergeLoading ? 'Combinando...' : 'Confirmar'}
                                    </Button>
                                </>
                            ) : (
                                <Button variant="outline" onClick={() => setIsMergeOpen(false)}>Cancelar</Button>
                            )}
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-between">
                <Input
                    placeholder="Buscar por nombre..."
                    value={searchTerm}
                    onChange={e => handleSearchChange(e.target.value)}
                    className="max-w-sm"
                />
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button><Plus className="mr-2 h-4 w-4" /> Nuevo Paciente</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader><DialogTitle>Nuevo Paciente</DialogTitle></DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <Input placeholder="Nombre" value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} />
                                <Input placeholder="Apellido" value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} />
                            </div>
                            <Input placeholder="Email" type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                            <Input placeholder="Teléfono" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
                            <Button onClick={handleCreate}>Guardar</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {patients.map((p: any) => (
                    <Card key={p.id} className="cursor-pointer hover:border-primary transition-colors" onClick={() => setSelectedPatient(p)}>
                        <div className="p-4 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                    <User className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="font-semibold">{p.firstName} {p.lastName}</div>
                                    <div className="text-xs text-muted-foreground">{p.email}</div>
                                </div>
                            </div>
                            <div className="text-right">
                                {p.debt > 0 ? (
                                    <Badge variant="destructive" className="text-[10px] px-1 py-0 h-5">Deudor</Badge>
                                ) : (
                                    <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100 text-[10px] px-1 py-0 h-5">Al día</Badge>
                                )}
                            </div>
                        </div>
                        {p.debt > 0 && (
                            <div className="px-4 pb-3 text-xs text-red-500 font-medium text-right">
                                Deuda: ${p.debt.toLocaleString()}
                            </div>
                        )}
                    </Card>
                ))}
            </div>

            {/* Pagination Footer */}
            <div className="flex items-center justify-between px-2 border-t pt-4">
                <div className="flex items-center space-x-4">
                    <div className="text-xs text-muted-foreground">
                        Mostrando {((page - 1) * pageSize) + 1} a {Math.min(page * pageSize, totalItems)} de {totalItems} registros
                    </div>
                    <select
                        className="h-8 w-[70px] rounded-md border border-input bg-background px-2 py-1 text-xs"
                        value={pageSize}
                        onChange={(e) => {
                            setPageSize(Number(e.target.value));
                            setPage(1);
                        }}
                    >
                        {[12, 18, 24].map((size) => (
                            <option key={size} value={size}>
                                {size}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1 || loading}
                    >
                        Anterior
                    </Button>
                    <div className="text-xs font-medium">
                        Página {page} de {Math.ceil(totalItems / pageSize) || 1}
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(Math.ceil(totalItems / pageSize), p + 1))}
                        disabled={page >= Math.ceil(totalItems / pageSize) || loading}
                    >
                        Siguiente
                    </Button>
                </div>
            </div>
        </div>
    )
}

