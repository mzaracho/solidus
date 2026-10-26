'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
    getOrgConfig,
    updateOrgSettings,
    createPatient,
    createFeeRule,
    createWorkItem,
    getDashboardStats,
    getWorkItems,
    getPatients,
    getFeeRules
} from '@/services/data'

export default function TestSuitePage({ params }: { params: { orgSlug: string } }) {
    const [logs, setLogs] = useState<string[]>([])
    const [isRunning, setIsRunning] = useState(false)

    const log = (msg: string) => setLogs(prev => [...prev, `${new Date().toISOString().split('T')[1].split('.')[0]} - ${msg}`])

    const runTests = async () => {
        setIsRunning(true)
        setLogs([])
        log('Starting System Verification...')

        try {
            const SLUG = params.orgSlug || 'default-org-id'; // Should be injected or taken from context
            const MODE = 'PROFESSIONAL';

            // 1. Verify Org Config
            log('1. Fetching Org Config...')
            const config = await getOrgConfig(SLUG)
            if (config) log(`✅ Config Loaded: ${config.categories?.length || 0} categories`)
            else log('❌ Failed to load config')

            // 2. Update Org Settings
            log('2. Updating Org Settings...')
            try {
                const updated = await updateOrgSettings(SLUG, { name: 'Updated via Test Suite' })
                log(`✅ Org Settings Updated: ${updated.name}`)
            } catch (e) {
                log(`❌ Update Org Settings Failed: ${e}`)
            }

            // 3. Create Patient
            log('3. Creating Patient...')
            const patientData = {
                firstName: 'Test',
                lastName: `Patient-${Date.now()}`,
                email: `test${Date.now()}@example.com`
            }
            const patient = await createPatient(SLUG, patientData)
            if (patient && patient.id) log(`✅ Patient Created: ${patient.firstName} ${patient.lastName} (${patient.id})`)
            else log('❌ Failed to create patient')

            // 4. Create Fee Rule
            log('4. Creating Fee Rule...')
            const ruleData = {
                name: `Rule-${Date.now()}`,
                splits: { "professional": 70, "org": 30 },
                conditions: {}
            }
            const rule = await createFeeRule(SLUG, ruleData)
            if (rule && rule.id) log(`✅ Fee Rule Created: ${rule.name}`)
            else log('❌ Failed to create fee rule (Method might be missing/failing)')

            // 5. Create 3 Activities (Work Items)
            log('5. Creating 3 Activities...')
            for (let i = 1; i <= 3; i++) {
                const activityData = {
                    serviceType: 'CONSULTA',
                    grossAmountCents: 1000 * i,
                    occurredAt: new Date().toISOString(),
                    patientId: patient?.id, // Link to created patient
                    mode: MODE
                }
                const activity = await createWorkItem(SLUG, activityData)
                if (activity && activity.id) log(`✅ Activity ${i} Created: $${activity.grossAmountCents / 100}`)
                else log(`❌ Failed to create Activity ${i}`)
            }

            // 6. Verify Dashboard Data
            log('6. Verifying Dashboard...')
            const stats = await getDashboardStats(SLUG, MODE, '30d')
            if (stats && stats.kpi) {
                log(`✅ Dashboard KPIs: Billed $${stats.kpi.accruedGross / 100}, Pending $${stats.kpi.pending / 100}`)
                if (stats.kpi.accruedGross > 0) log('✅ Dashboard reflects data!')
                else log('⚠️ Dashboard shows 0 billed (Async indexing might be slow?)')
            } else {
                log('❌ Failed to fetch Dashboard stats')
            }

            log('🏁 Verification Complete')

        } catch (error) {
            log(`❌ CRITICAL ERROR: ${error}`)
        } finally {
            setIsRunning(false)
        }
    }

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>System Verification Suite</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="mb-4">
                        <p className="text-sm text-gray-500 mb-4">
                            Simulates "Professional" actions: Create Patient, Create Rules, Create Activities, check Dashboard.
                        </p>
                        <Button onClick={runTests} disabled={isRunning}>
                            {isRunning ? 'Running...' : 'Run Verification'}
                        </Button>
                    </div>

                    <div className="bg-slate-950 text-green-400 p-4 rounded-md font-mono text-xs h-96 overflow-y-auto">
                        {logs.length === 0 ? 'Ready to run tests...' : logs.map((l, i) => <div key={i}>{l}</div>)}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
