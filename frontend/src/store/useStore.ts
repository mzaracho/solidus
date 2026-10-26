import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORE_NAME } from '@/lib/constants'

// Defines the roles available in the application
export type UserRole = 'OWNER' | 'MEMBER'

// Defines the two main operational modes
export type ViewMode = 'ORGANIZATION' | 'PROFESSIONAL'

// Interface defining the shape of our Global Store
interface AppState {
    userRole: UserRole
    availableRoles: { code: string, name: string }[] // Roles from DB
    orgRole: string | null // 'ADMIN' | 'MEMBER'
    viewMode: ViewMode
    orgSlug: string // The current organization identifier in the URL
    setRole: (role: UserRole) => void
    setAvailableRoles: (roles: { code: string, name: string }[]) => void
    setOrgRole: (role: string | null) => void
    setViewMode: (mode: ViewMode) => void
    setOrgSlug: (slug: string) => void
}

/**
 * Global State Management using Zustand.
 */
export const useStore = create<AppState>()(
    persist(
        (set) => ({
            userRole: 'OWNER',
            availableRoles: [],
            orgRole: null,
            viewMode: 'ORGANIZATION', // Default view mode
            orgSlug: '',

            setRole: (role) => set({ userRole: role }),
            setAvailableRoles: (roles) => set({ availableRoles: roles }),
            setOrgRole: (role) => set({ orgRole: role }),
            setViewMode: (mode) => set({ viewMode: mode }),
            setOrgSlug: (slug) => set({ orgSlug: slug }),
        }),
        {
            name: STORE_NAME, // name of item in storage
            partialize: (state) => ({
                viewMode: state.viewMode,
                userRole: state.userRole,
                orgSlug: state.orgSlug,
                orgRole: state.orgRole
            }), // Only persist specific fields
        }
    )
)

