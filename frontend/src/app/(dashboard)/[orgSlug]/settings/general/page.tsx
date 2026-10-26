'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Save, Loader2 } from 'lucide-react'
import { updateOrgSettings, getOrgDetails, getProfessionalContext, updateProfessionalProfile } from '@/services/data'
import { toast } from 'sonner'
import { useStore } from '@/store/useStore'

export default function SettingsGeneralPage() {
    const { orgSlug } = useParams() as { orgSlug: string }
    const { viewMode } = useStore()
    const [loading, setLoading] = useState(false)
    
    // Unified form data
    const [formData, setFormData] = useState({
        name: '',
        cuit: '',
        address: '',
        phone: '',
        email: '',
        alertsDays: 60,
        emailNotifs: true
    })

    // Load initial data
    useEffect(() => {
        if (!orgSlug) return;
        const load = async () => {
            try {
                if (viewMode === 'PROFESSIONAL') {
                    const data = await getProfessionalContext(orgSlug);
                    if (data) {
                        setFormData(prev => ({
                            ...prev,
                            name: data.displayName || '',
                            cuit: data.cuit || '',
                            phone: data.phone || '',
                            email: data.email || ''
                        }))
                    }
                } else {
                    const data = await getOrgDetails(orgSlug);
                    if (data) {
                        setFormData(prev => ({
                            ...prev,
                            name: data.name || '',
                            cuit: data.cuit || '',
                            address: data.address || '',
                            alertsDays: data.settings?.alertsDays || 60,
                            emailNotifs: data.settings?.emailNotifs ?? true
                        }))
                    }
                }
            } catch (e) {
                console.error("Failed to load settings", e);
            }
        }
        load();
    }, [orgSlug, viewMode])

    const handleSave = async () => {
        setLoading(true)
        try {
            if (!orgSlug) {
                toast.error("Error: Falta ID de organización");
                return;
            }

            if (viewMode === 'PROFESSIONAL') {
                await updateProfessionalProfile(orgSlug, {
                    displayName: formData.name,
                    cuit: formData.cuit,
                    phone: formData.phone,
                    email: formData.email
                });
                toast.success("Perfil profesional actualizado")
            } else {
                await updateOrgSettings(orgSlug, {
                    name: formData.name,
                    cuit: formData.cuit,
                    address: formData.address,
                    settings: {
                        alertsDays: formData.alertsDays,
                        emailNotifs: formData.emailNotifs
                    }
                });
                toast.success("Ajustes de organización guardados")
            }
        } catch (error: any) {
            toast.error(error.message || "Error al guardar ajustes")
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <h2 className="text-3xl font-bold tracking-tight mb-6">
                {viewMode === 'PROFESSIONAL' ? 'Mi Perfil Profesional' : 'Ajustes Generales'}
            </h2>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {viewMode === 'PROFESSIONAL' ? 'Datos Personales' : 'Datos de la Organización'}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>{viewMode === 'PROFESSIONAL' ? 'Nombre Completo' : 'Razón Social / Nombre Completo'}</Label>
                            <Input
                                placeholder="Ej: Juan Pérez"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>CUIT / ID Fiscal</Label>
                            <Input
                                placeholder="XX-XXXXXXXX-X"
                                value={formData.cuit}
                                onChange={e => setFormData({ ...formData, cuit: e.target.value })}
                            />
                        </div>
                        {viewMode === 'ORGANIZATION' ? (
                            <div className="space-y-2">
                                <Label>Dirección</Label>
                                <Input
                                    placeholder="Calle Falsa 123"
                                    value={formData.address}
                                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                                />
                            </div>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <Label>Email</Label>
                                    <Input
                                        placeholder="correo@ejemplo.com"
                                        value={formData.email}
                                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Teléfono</Label>
                                    <Input
                                        placeholder="+54 9 11 1234-5678"
                                        value={formData.phone}
                                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>

            {viewMode === 'ORGANIZATION' && (
                <Card>
                    <CardHeader>
                        <CardTitle>Preferencias del Sistema</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium text-sm">Alertas de Deuda</p>
                                <p className="text-xs text-muted-foreground">Marcar automáticamente como deudor tras X días</p>
                            </div>
                            <Input
                                type="number"
                                className="w-20 text-right"
                                value={formData.alertsDays}
                                onChange={e => setFormData({ ...formData, alertsDays: parseInt(e.target.value) })}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium text-sm">Notificaciones por Email</p>
                                <p className="text-xs text-muted-foreground">Recibir resumen semanal de cobranzas</p>
                            </div>
                            <Checkbox
                                checked={formData.emailNotifs}
                                onCheckedChange={(c: any) => setFormData({ ...formData, emailNotifs: c })}
                            />
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Guardar Cambios
                </Button>
            </div>
        </div>
    )
}

