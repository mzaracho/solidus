import { PatientDirectory } from "@/components/domain/patients/PatientDirectory"

export default function PatientsDashboardPage() {
    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">Gestión de Pacientes</h2>
            </div>

            <PatientDirectory />
        </div>
    )
}
