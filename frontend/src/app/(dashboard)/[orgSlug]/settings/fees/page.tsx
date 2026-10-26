import { PayerRulesManager } from '@/components/domain/pro/settings/PayerRulesManager'

export default function FeesPage() {
    return (
        <div className="container max-w-4xl mx-auto py-8">
            <h2 className="text-3xl font-bold tracking-tight mb-6 text-primary">Configuración de Honorarios</h2>
            <PayerRulesManager />
        </div>
    )
}
