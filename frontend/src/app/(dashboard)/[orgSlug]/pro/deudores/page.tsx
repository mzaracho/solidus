import { DeudoresTable } from '@/components/domain/pro/deudores/DeudoresTable'

export default function DeudoresPage() {
    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">Pacientes Deudores</h2>
            </div>
            <div className="rounded-md border p-6">
                <DeudoresTable />
            </div>
        </div>
    )
}
