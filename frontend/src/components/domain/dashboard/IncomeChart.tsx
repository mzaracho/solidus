'use client'

import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'

interface IncomeChartProps {
    data: any[]
}

export function IncomeChart({ data }: IncomeChartProps) {
    return (
        <Card className="col-span-4 shadow-sm border-border">
            <CardHeader>
                <CardTitle>Evolución de Ingresos</CardTitle>
                <CardDescription>Producción bruta vs cobrada</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
                <ResponsiveContainer width="100%" height={350}>
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id="colorGross" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis
                            dataKey="date"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#94a3b8', fontSize: 12 }}
                            dy={10}
                            tickFormatter={(value) => {
                                if (typeof value === 'string' && value.includes('-')) {
                                    const parts = value.split('-');
                                    if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
                                }
                                return value;
                            }}
                        />
                        <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#94a3b8', fontSize: 12 }}
                            tickFormatter={(val) => `$${val / 1000}k`}
                        />
                        <Tooltip
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            formatter={(val: any, name: any) => [formatCurrency(val), name]}
                            labelFormatter={(label) => {
                                if (typeof label === 'string' && label.includes('-')) {
                                    const parts = label.split('-');
                                    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
                                }
                                return label;
                            }}
                        />
                        <Area
                            type="monotone"
                            dataKey="gross"
                            stroke="#3b82f6"
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorGross)"
                            name="Bruto"
                        />
                        <Area
                            type="monotone"
                            dataKey="net"
                            stroke="#10b981"
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorNet)"
                            name="Neto"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    )
}
