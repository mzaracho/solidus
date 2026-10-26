'use client'

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Trash2, Edit } from "lucide-react"

export type FeeRule = {
    id: string
    payerId: string
    professionalCategory: string
    splitProfessional: number
    splitPractice: number
}

interface FeeRuleCardProps {
    rule: FeeRule
    onUpdate: (rule: FeeRule) => void
    onDelete: (id: string) => void
}

export function FeeRuleCard({ rule, onUpdate, onDelete }: FeeRuleCardProps) {
    return (
        <Card>
            <CardContent className="flex items-center justify-between p-4">
                <div className="grid gap-1">
                    <p className="font-medium">Regla {rule.id}</p>
                    <div className="text-sm text-muted-foreground">
                        Payer: {rule.payerId} | Cat: {rule.professionalCategory}
                    </div>
                    <div className="text-sm">
                        Prof: {rule.splitProfessional}% | Practice: {rule.splitPractice}%
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => { }}>
                        <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onDelete(rule.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
