'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FeeRule, FeeRuleCard } from './FeeRuleCard'
import { useStore } from '@/store/useStore'

export function FeeRulesList() {
    const { userRole } = useStore()
    const [rules, setRules] = useState<FeeRule[]>([])
    const isReadOnly = userRole === 'MEMBER'

    const handleUpdate = (updatedRule: FeeRule) => {
        setRules(rules.map(r => r.id === updatedRule.id ? updatedRule : r))
    }

    const handleDelete = (id: string) => {
        setRules(rules.filter(r => r.id !== id))
    }

    const handleAdd = () => {
        const newRule: FeeRule = {
            id: Math.random().toString(36).substr(2, 9),
            payerId: 'particular',
            professionalCategory: 'all',
            splitProfessional: 50,
            splitPractice: 50
        }
        setRules([newRule, ...rules])
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Constructor de Reglas</h2>
                    <p className="text-muted-foreground">Define cómo se distribuyen los honorarios automáticamente.</p>
                </div>
                {!isReadOnly && (
                    <Button onClick={handleAdd}>
                        <Plus className="w-4 h-4 mr-2" />
                        Nueva Regla
                    </Button>
                )}
            </div>

            <div className="grid gap-6">
                {rules.map(rule => (
                    <FeeRuleCard
                        key={rule.id}
                        rule={rule}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                    />
                ))}
            </div>
        </div>
    )
}
