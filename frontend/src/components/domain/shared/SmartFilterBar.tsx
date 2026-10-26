import { Search, ListFilter, X, Calendar as CalendarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState, useEffect } from 'react'
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

type FilterProps = {
    filters: {
        patient: string
        status: string
        startDate: string
        endDate: string
        type?: string // Optional Org Filter
        method?: string // Optional Org Filter
        payer?: string // Optional Pro Filter
    }
    setFilters: (filters: any) => void
    mode: 'ORGANIZATION' | 'PROFESSIONAL'
    uniqueTypes?: string[]
    uniqueMethods?: string[]
    uniquePayers?: any[]
}

export function SmartFilterBar({ filters, setFilters, mode, uniqueTypes = [], uniqueMethods = [], uniquePayers = [] }: FilterProps) {

    // Local state for deferred filtering
    const [localFilters, setLocalFilters] = useState(filters)

    // Sync if parent filters change externally
    useEffect(() => {
        setLocalFilters(filters)
    }, [filters])

    const handleSearch = () => {
        setFilters(localFilters)
    }

    const clearFilters = () => {
        const empty = {
            patient: '',
            status: '',
            startDate: '',
            endDate: '',
            type: '',
            method: '',
            payer: ''
        }
        setLocalFilters(empty)
        setFilters(empty)
    }

    // Helper to handle Date selection -> YYYY-MM-DD string
    const handleDateSelect = (date: Date | undefined, field: 'startDate' | 'endDate') => {
        if (!date) {
            setLocalFilters({ ...localFilters, [field]: '' })
            return
        }
        // Save as YYYY-MM-DD locally
        setLocalFilters({ ...localFilters, [field]: format(date, 'yyyy-MM-dd') })
    }

    // Check if any filter is active locally
    const hasActiveFilters =
        localFilters.patient ||
        localFilters.status ||
        localFilters.startDate ||
        localFilters.endDate ||
        localFilters.type ||
        localFilters.method ||
        localFilters.payer

    return (
        <div className="bg-card p-3 rounded-xl border border-border shadow-sm flex flex-wrap gap-3 items-center mb-4">
            <div className="flex items-center gap-2 text-muted-foreground hidden md:flex">
                <ListFilter size={18} />
                <span className="text-xs font-semibold uppercase tracking-wider">Filtros:</span>
            </div>

            {/* Search Patient */}
            <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                <input
                    type="text"
                    placeholder="Buscar paciente..."
                    className="pl-8 pr-3 py-1.5 bg-muted/50 border border-input rounded-lg text-xs focus:ring-2 focus:ring-primary outline-none w-40"
                    value={localFilters.patient}
                    onChange={e => setLocalFilters({ ...localFilters, patient: e.target.value })}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                />
            </div>

            {/* Status */}
            <select
                className="px-2 py-1.5 bg-muted/50 border border-input rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary"
                value={localFilters.status}
                onChange={e => setLocalFilters({ ...localFilters, status: e.target.value })}
            >
                <option value="">Todos los Estados</option>
                <option value="PAID">Pagado / Cobrado</option>
                <option value="PARTIAL">Parcial</option>
                <option value="UNPAID">Pendiente</option>
            </select>

            {/* ORG Specifics */}
            {mode === 'ORGANIZATION' && (
                <>
                    <select
                        className="px-2 py-1.5 bg-muted/50 border border-input rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary"
                        value={localFilters.type}
                        onChange={e => setLocalFilters({ ...localFilters, type: e.target.value })}
                    >
                        <option value="">Todos los Tipos</option>
                        {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <select
                        className="px-2 py-1.5 bg-muted/50 border border-input rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary"
                        value={localFilters.method}
                        onChange={e => setLocalFilters({ ...localFilters, method: e.target.value })}
                    >
                        <option value="">Todos los Medios</option>
                        {uniqueMethods.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </>
            )}

            {/* PRO Specifics */}
            {mode === 'PROFESSIONAL' && uniquePayers.length > 0 && (
                <select
                    className="px-2 py-1.5 bg-muted/50 border border-input rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary"
                    value={localFilters.payer}
                    onChange={e => setLocalFilters({ ...localFilters, payer: e.target.value })}
                >
                    <option value="">Todos los Pagadores</option>
                    {uniquePayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
            )}

            {/* Date Picker Range */}
            <div className="flex items-center gap-1 bg-muted/50 border border-input rounded-lg px-2 py-1 ml-auto md:ml-0">
                <span className="text-[10px] text-muted-foreground uppercase font-bold mr-1">Desde</span>
                <Popover>
                    <PopoverTrigger asChild>
                        <button className="flex items-center text-xs outline-none hover:text-primary">
                            <span className={cn(
                                "font-medium",
                                !localFilters.startDate && "text-muted-foreground"
                            )}>
                                {localFilters.startDate ? format(new Date(localFilters.startDate + 'T00:00:00'), 'dd/MM/yyyy') : "dd/mm/yyyy"}
                            </span>
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                            mode="single"
                            selected={localFilters.startDate ? new Date(localFilters.startDate + 'T00:00:00') : undefined}
                            onSelect={(d) => handleDateSelect(d, 'startDate')}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>

                <div className="w-px h-3 bg-border mx-2"></div>

                <span className="text-[10px] text-muted-foreground uppercase font-bold mr-1">Hasta</span>
                <Popover>
                    <PopoverTrigger asChild>
                        <button className="flex items-center text-xs outline-none hover:text-primary">
                            <span className={cn(
                                "font-medium",
                                !localFilters.endDate && "text-muted-foreground"
                            )}>
                                {localFilters.endDate ? format(new Date(localFilters.endDate + 'T00:00:00'), 'dd/MM/yyyy') : "dd/mm/yyyy"}
                            </span>
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                            mode="single"
                            selected={localFilters.endDate ? new Date(localFilters.endDate + 'T00:00:00') : undefined}
                            onSelect={(d) => handleDateSelect(d, 'endDate')}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>
            </div>

            <Button size="sm" onClick={handleSearch} className="h-7 text-xs ml-2">
                Buscar
            </Button>

            {/* Clear Filters */}
            {hasActiveFilters && (
                <button
                    onClick={clearFilters}
                    className="text-xs text-destructive hover:text-destructive/80 font-medium md:ml-auto flex items-center gap-1"
                >
                    <X size={12} /> Limpiar
                </button>
            )}
        </div>
    )
}
