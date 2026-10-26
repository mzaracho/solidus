import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DollarSign, Wallet, Activity, CreditCard, TrendingUp } from "lucide-react"

interface KpiData {
    title: string
    value: string
    description: string
    trend: string
}

export function KpiCards({ data }: { data: KpiData[] }) {
    const icons = [Activity, DollarSign, Wallet, CreditCard, TrendingUp]

    return (
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
            {data.map((item, i) => {
                const Icon = icons[i] || Activity
                return (
                    <Card key={i}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                {item.title}
                            </CardTitle>
                            <Icon className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{item.value}</div>
                            <p className="text-xs text-muted-foreground">
                                {item.description}
                            </p>
                        </CardContent>
                    </Card>
                )
            })}
        </div>
    )
}
