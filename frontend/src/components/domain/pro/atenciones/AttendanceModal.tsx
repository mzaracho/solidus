import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useState, useEffect } from "react"
import { ATTENDANCE } from '@/lib/constants'

interface Props {
    isOpen: boolean
    onClose: () => void
    onConfirm: (status: string) => void
    initialStatus: string
    loading?: boolean
}

export function AttendanceModal({ isOpen, onClose, onConfirm, initialStatus, loading }: Props) {
    const [status, setStatus] = useState(initialStatus)

    useEffect(() => {
        setStatus(initialStatus || ATTENDANCE.PRESENT)
    }, [initialStatus, isOpen])

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Cargar Asistencia</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Estado de Asistencia
                        </label>
                        <Select
                            value={status}
                            onValueChange={setStatus}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="PRESENT">Asistió</SelectItem>
                                <SelectItem value="ABSENT_WITH_NOTICE">Canceló +24 hs</SelectItem>
                                <SelectItem value="ABSENT_NO_NOTICE">Canceló -24 hs / No asistió</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={loading}>
                        Cancelar
                    </Button>
                    <Button onClick={() => onConfirm(status)} disabled={loading}>
                        {loading ? 'Guardando...' : 'Guardar'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
