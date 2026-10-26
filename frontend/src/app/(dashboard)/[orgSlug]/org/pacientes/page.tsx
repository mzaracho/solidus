import { PacientesTable } from '@/components/domain/org/pacientes/PacientesTable'

export default function PacientesPage() {
    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">Pacientes (Sesiones)</h2>
            </div>
            <div className="rounded-md border p-6">
                <PacientesTable />
            </div>
        </div>
    )
}
