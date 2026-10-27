import { format } from 'date-fns'

// En el servidor (SSR) el default es localhost (npm run dev fuera de Docker). En Docker lo define
// docker-compose.yml con INTERNAL_API_URL=http://backend:8080/api.
const API_BASE_URL = typeof window === 'undefined'
    ? (process.env.INTERNAL_API_URL || 'http://localhost:8080/api')
    : (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080/api');

// --- MOCK DATA CONSTANTS (Kept for fallback or types if needed, but not used) ---

export const COLORS = {
    primary: '#6366f1',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    slate: '#64748b',
    chart: ['#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#14b8a6']
};

// --- HELPER FOR HEADERS ---
function getAuthToken() {
    if (typeof document !== 'undefined') {
        const match = document.cookie.match(new RegExp('(^| )auth_token=([^;]+)'));
        if (match) return match[2];
    }
    return null;
}

function parseJwt(token: string) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}


function getHeaders(orgSlug: string) {
    const token = getAuthToken();
    let orgIdToUse = orgSlug; // Default to slug (legacy/error case)

    if (token) {
        const decoded = parseJwt(token);
        // If token provides specific Org Context (UUID), use it. 
        // Note: For multi-org tokens, this might be null, but standard flow injects it.
        // Assuming the backend ONLY accepts UUIDs in x-org-id.
        if (decoded && decoded.organizationId) {
            orgIdToUse = decoded.organizationId;
        }
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-org-id': orgIdToUse,
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        const decoded = parseJwt(token);
        // Inject Real User Context from Token
        if (decoded && decoded.sub) {
            headers['x-user-id'] = decoded.sub;
        }
    }
    return headers;
}

// --- SERVICE FUNCTIONS ---

/**
 * GET /dashboard/kpis & /dashboard/chart
 * Aggregates backend calls to match UI expectation
 */
export async function getDashboardStats(
    slug: string,
    mode: 'ORGANIZATION' | 'PROFESSIONAL',
    range: string = '30d',
    chartBasis: 'ACCRUED' | 'CASH' = 'ACCRUED'
) {
    try {
        const headers = getHeaders(slug);

        // Calculate dates based on range
        const end = new Date();
        const start = new Date();

        switch (range) {
            case '7d':
                start.setDate(end.getDate() - 7);
                break;
            case '14d':
                start.setDate(end.getDate() - 14);
                break;
            case 'current_month':
                start.setDate(1); // First day of current month
                break;
            case 'last_month':
                start.setMonth(start.getMonth() - 1);
                start.setDate(1);
                end.setDate(0); // Last day of previous month
                break;
            case '3m':
                start.setMonth(start.getMonth() - 3);
                break;
            case '6m':
                start.setMonth(start.getMonth() - 6);
                break;
            case 'current_year':
                start.setMonth(0, 1); // Jan 1st
                break;
            case 'last_year':
                start.setFullYear(start.getFullYear() - 1);
                start.setMonth(0, 1);
                end.setFullYear(end.getFullYear() - 1);
                end.setMonth(11, 31);
                break;
            default: // Fallback to '30d' or parsing number
                const days = parseInt(range) || 30;
                start.setDate(end.getDate() - days);
        }

        const startDate = format(start, 'yyyy-MM-dd');
        const endDate = format(end, 'yyyy-MM-dd');

        // Parallel fetch for KPIs, Chart and Payers
        const [kpiRes, chartRes, payerRes] = await Promise.all([
            fetch(`${API_BASE_URL}/dashboard/kpis?mode=${mode}&startDate=${startDate}&endDate=${endDate}`, { headers, cache: 'no-store' }),
            fetch(`${API_BASE_URL}/dashboard/chart?mode=${mode}&startDate=${startDate}&endDate=${endDate}&groupBy=day&basis=${chartBasis}`, { headers, cache: 'no-store' }),
            fetch(`${API_BASE_URL}/dashboard/payers?mode=${mode}&startDate=${startDate}&endDate=${endDate}`, { headers, cache: 'no-store' })
        ]);

        if (!kpiRes.ok || !chartRes.ok) throw new Error('Failed to fetch dashboard stats');

        const kpis = await kpiRes.json();
        const chart = await chartRes.json();
        const payers = payerRes.ok ? await payerRes.json() : [];

        // Merge results to match expected UI structure
        return {
            kpi: {
                accruedGross: kpis.accruedGross || 0,
                accruedNet: kpis.accruedNet || 0,
                pending: kpis.pending || 0,
                cashGross: kpis.cashGross || 0,
                cashNet: kpis.cashNet || 0
            },
            chartData: chart || [],
            payerData: payers || []
        };


    } catch (error) {
        console.error(error);
        return null;
    }
}

/**
 * GET /activity
 * Previously: /api/v1/orgs/:slug/work-items
 */
export async function getWorkItems(slug: string, mode: 'ORGANIZATION' | 'PROFESSIONAL', filters?: any, page: number = 1, limit: number = 20) {
    try {
        const params = new URLSearchParams({
            mode: mode,
            page: page.toString(),
            limit: limit.toString()
        });

        if (filters) {
            Object.keys(filters).forEach(key => {
                if (filters[key]) params.append(key, filters[key]);
            });
            // Ensure specific mapping if needed, but existing logic seems to iterate keys
            // If filters.payer is set, it appends 'payer=ID'. Backend needs to expect 'payer' or we map here.
            // Backend Query Handler has: if (query.payerId) ...
            // Frontend generic iterator sends 'payer'.
            // Quick fix: Map 'payer' to 'payerId' if needed, or update backend DTO to accept 'payer' alias.
            // Backend Query DTO: @IsOptional() payerId?: string.
            // But it doesn't have 'payer' property?
            // Wait, backend 'FindAllActivitiesQuery' has:
            // @ApiPropertyOptional() payerId?: string;
            // It does NOT have 'payer'.
            // AtencionesTable passes `filters.payer` (which is ID from dropdown).
            // So we send `payer=ID`. NestJS DTO mapping *might* fail to map `payer` to `payerId` automatically unless we use @Expose or alias.
            // Better to map it here in frontend data service.
            if (filters.payer) params.set('payerId', filters.payer);
            if (filters.patient) params.set('search', filters.patient);
        }

        const res = await fetch(`${API_BASE_URL}/activity?${params.toString()}`, {
            headers: getHeaders(slug),
            cache: 'no-store'
        });

        if (!res.ok) throw new Error('Failed to fetch work items');
        const data = await res.json();

        // Handle both legacy array and new paginated object
        if (Array.isArray(data)) {
            return { items: data, total: data.length };
        }
        return data; // { items, total, ... }
    } catch (error) {
        console.error(error);
        return { items: [], total: 0 };
    }
}



/**
 * GET /v1/patients
 * Previously: /api/v1/orgs/:slug/patients
 */
export async function getPatients(slug: string, search?: string, page: number = 1, limit: number = 12, mode?: 'ORGANIZATION' | 'PROFESSIONAL') {
    try {
        const url = new URL(`${API_BASE_URL}/v1/patients`);
        if (search) url.searchParams.append('search', search);
        url.searchParams.append('page', page.toString());
        url.searchParams.append('limit', limit.toString());
        if (mode) url.searchParams.append('mode', mode);

        const res = await fetch(url.toString(), {
            headers: getHeaders(slug),
            cache: 'no-store'
        });
        if (!res.ok) throw new Error('Failed to fetch patients');
        const data = await res.json();

        if (Array.isArray(data)) {
            return { items: data, total: data.length };
        }
        // Normalize backend response (PaginatedArrayDto uses totalItems, PaginatedActivity uses total)
        return {
            items: data.items || [],
            total: data.total ?? data.totalItems ?? 0
        };
    } catch (error) {
        console.error(error);
        return { items: [], total: 0 };
    }
}

/**
 * GET /fee-rules
 * Previously: /api/v1/orgs/:slug/config/rules
 */
export async function getFeeRules(slug: string, mode: 'ORGANIZATION' | 'PROFESSIONAL') {
    try {
        const res = await fetch(`${API_BASE_URL}/fee-rules?mode=${mode}`, {
            headers: getHeaders(slug),
            cache: 'no-store'
        });
        if (!res.ok) throw new Error('Failed to fetch fee rules');
        return await res.json();
    } catch (error) {
        console.error(error);
        return null; // Return empty array or null based on component expectation
    }
}

/**
 * POST /activity
 * Previously: /api/v1/orgs/:slug/work-items
 * Requires x-mode header
 */
export async function createWorkItem(slug: string, data: any) {
    try {
        const headers = getHeaders(slug);

        // Backend ActivityController expects 'x-mode' header. 
        // We assume 'mode' is inside data or needs to be passed. 
        // For now, defaulting to ORGANIZATION or extracting from data if present.
        // Ideally, the UI function call should pass 'mode' explicitly.
        if (data.mode) {
            (headers as any)['x-mode'] = data.mode;
        }

        const res = await fetch(`${API_BASE_URL}/activity`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        });

        if (!res.ok) {
            let errorMessage = 'Error al guardar la actividad';
            try {
                const errBody = await res.json();
                // Try to extract the most useful message from the backend error shape
                if (errBody?.errors?.[0]?.message) {
                    errorMessage = errBody.errors[0].message;
                } else if (errBody?.message) {
                    errorMessage = errBody.message;
                } else if (typeof errBody?.details === 'string') {
                    try {
                        const details = JSON.parse(errBody.details);
                        if (details?.message) errorMessage = details.message;
                    } catch { /* ignore */ }
                }
            } catch { /* ignore JSON parse error */ }
            throw new Error(errorMessage);
        }
        return await res.json();
    } catch (error) {
        console.error(error);
        throw error; // re-throw so the caller can handle and show the error
    }
}

/**
 * GET /org/config
 * Returns categories, presets, and staff (professionals)
 */
export async function getOrgConfig(slug: string) {
    try {
        const res = await fetch(`${API_BASE_URL}/org/config?orgId=${slug}`, {
            headers: getHeaders(slug),
            cache: 'no-store'
        });
        if (!res.ok) throw new Error('Failed to fetch org config');
        return await res.json();
    } catch (error) {
        console.error(error);
        return { categories: [], presets: [], staff: [] };
    }
}

/**
 * PUT /org/staff/:id/category
 */
export async function assignStaffCategory(slug: string, staffId: string, categoryId: string) {
    try {
        const res = await fetch(`${API_BASE_URL}/org/staff/${staffId}/category`, {
            method: 'PUT',
            headers: getHeaders(slug),
            body: JSON.stringify({ categoryId })
        });
        if (!res.ok) throw new Error('Failed to assign category');
        return await res.json();
    } catch (error) {
        console.error(error);
        return { success: false };
    }
}

/**
 * GET /pro/payers
 */
// GET /pro/payers
export async function getPayers(slug: string, page: number = 1, limit: number = 12) {
    try {
        const res = await fetch(`${API_BASE_URL}/pro/payers?page=${page}&limit=${limit}`, {
            headers: getHeaders(slug),
            cache: 'no-store'
        });
        if (!res.ok) throw new Error('Failed to fetch payers');
        return await res.json();
    } catch (error) {
        console.error(error);
        return { items: [], total: 0 };
    }
}

/**
 * GET /pro/context
 * Returns the professional record (id, displayName, canLoadActivities) for the authenticated user.
 */
export async function getProfessionalContext(slug: string): Promise<{ id: string; displayName: string; cuit?: string; phone?: string; email?: string; canLoadActivities: boolean; userId: string; categoryId?: string; category?: { id: string; name: string; percentage: number } } | null> {
    try {
        const res = await fetch(`${API_BASE_URL}/pro/context`, {
            headers: getHeaders(slug),
            cache: 'no-store'
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (error) {
        console.error('getProfessionalContext Error', error);
        return null;
    }
}

/**
 * GET /pro/memberships
 * Returns all orgs the authenticated professional belongs to, with their assigned category and percentage.
 */
export async function getProfessionalMemberships(slug: string): Promise<Array<{
    orgId: string;
    orgName: string;
    professionalId: string;
    canLoadActivities: boolean;
    categoryId: string | null;
    categoryName: string | null;
    categoryPercentage: number | null;
}>> {
    try {
        const res = await fetch(`${API_BASE_URL}/pro/memberships`, {
            headers: getHeaders(slug),
            cache: 'no-store'
        });
        if (!res.ok) return [];
        return await res.json();
    } catch (error) {
        console.error('getProfessionalMemberships Error', error);
        return [];
    }
}

/**
 * PUT /pro/profile
 * Updates the professional record for the authenticated user.
 */
export async function updateProfessionalProfile(slug: string, data: any) {
    try {
        const res = await fetch(`${API_BASE_URL}/pro/profile`, {
            method: 'PUT',
            headers: getHeaders(slug),
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Failed to update professional profile: ${err}`);
        }
        return await res.json();
    } catch (error) {
        console.error("updateProfessionalProfile Error", error);
        throw error;
    }
}

/**
 * POST /pro/payers
 */
export async function createPayer(slug: string, name: string, retentionPercentage: number = 0, cuit?: string) {
    try {
        const res = await fetch(`${API_BASE_URL}/pro/payers`, {
            method: 'POST',
            headers: getHeaders(slug),
            body: JSON.stringify({ name, retentionPercentage, ...(cuit ? { cuit } : {}) })
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Failed to create payer: ${err}`);
        }
        return await res.json();
    } catch (error) {
        console.error("createPayer Error", error);
        return null;
    }
}

/**
 * POST /org/staff
 */
export async function createStaff(slug: string, data: any) {
    try {
        const res = await fetch(`${API_BASE_URL}/org/staff`, {
            method: 'POST',
            headers: getHeaders(slug),
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Failed to create staff');
        return await res.json();
    } catch (error) {
        console.error(error);
        return { success: false };
    }
}

/**
 * PUT /org/staff/:id
 */
export async function updateStaff(slug: string, id: string, data: any) {
    try {
        const res = await fetch(`${API_BASE_URL}/org/staff/${id}`, {
            method: 'PUT',
            headers: getHeaders(slug),
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Failed to update staff');
        return await res.json();
    } catch (error) {
        console.error(error);
        return { success: false };
    }
}

/**
 * DELETE /org/staff/:id
 */
export async function deleteStaff(slug: string, id: string) {
    try {
        const res = await fetch(`${API_BASE_URL}/org/staff/${id}`, {
            method: 'DELETE',
            headers: getHeaders(slug)
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Failed to delete staff: ${err}`);
        }
        return true;
    } catch (error) {
        console.error(error);
        // Throw to let UI handle the specific error (e.g. FK constraint)
        throw error;
    }
}


/**
 * GET /v1/patients/:id/summary
 * Returns total debt + list of pending work items for a patient
 */
export async function getPatientSummary(slug: string, patientId: string) {
    try {
        const res = await fetch(`${API_BASE_URL}/v1/patients/${patientId}/summary`, {
            headers: getHeaders(slug),
            cache: 'no-store',
        });
        if (!res.ok) throw new Error('Failed to fetch patient summary');
        return await res.json();
    } catch (error) {
        console.error('getPatientSummary Error', error);
        return null;
    }
}

/**
 * POST /v1/patients
 */
export async function createPatient(slug: string, data: any) {
    try {
        const res = await fetch(`${API_BASE_URL}/v1/patients`, {
            method: 'POST',
            headers: getHeaders(slug),
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Failed to create patient');
        return await res.json();
    } catch (error) {
        console.error(error);
        return null;
    }
}

/**
 * POST /v1/patients/:sourceId/merge
 * Merges source patient into target: reassigns all work items and deletes source.
 */
export async function mergePatient(slug: string, sourceId: string, targetId: string) {
    try {
        const res = await fetch(`${API_BASE_URL}/v1/patients/${sourceId}/merge`, {
            method: 'POST',
            headers: getHeaders(slug),
            body: JSON.stringify({ targetId }),
        });
        if (!res.ok) throw new Error('Failed to merge patients');
        return true;
    } catch (error) {
        console.error(error);
        throw error;
    }
}

/**
 * PUT /v1/patients/:id
 */
export async function updatePatient(slug: string, id: string, data: any) {
    try {
        const res = await fetch(`${API_BASE_URL}/v1/patients/${id}`, {
            method: 'PUT',
            headers: getHeaders(slug),
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Failed to update patient');
        return await res.json();
    } catch (error) {
        console.error(error);
        return null;
    }
}

/**
 * PUT /activity/:id
 * Previously: /api/v1/orgs/:slug/work-items/:id
 */
export async function updateWorkItem(slug: string, id: string, data: any) {
    try {
        const res = await fetch(`${API_BASE_URL}/activity/${id}`, {
            method: 'PUT',
            headers: getHeaders(slug),
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Failed to update work item: ${err}`);
        }
        return await res.json();
    } catch (error) {
        console.error("updateWorkItem Error", error);
        return { success: false, error };
    }
}

/**
 * GET /activity/:id
 */
export async function getWorkItemById(slug: string, id: string) {
    try {
        const res = await fetch(`${API_BASE_URL}/activity/${id}`, {
            headers: getHeaders(slug),
            cache: 'no-store'
        });
        if (!res.ok) throw new Error('Failed to fetch work item');
        return await res.json();
    } catch (error) {
        console.error("getWorkItemById Error", error);
        return null;
    }
}

/**
 * DELETE /activity/:id
 */
export async function deleteWorkItem(slug: string, id: string) {
    try {
        const res = await fetch(`${API_BASE_URL}/activity/${id}`, {
            method: 'DELETE',
            headers: getHeaders(slug)
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Failed to delete work item: ${err}`);
        }
        return true;
    } catch (error) {
        console.error("deleteWorkItem Error", error);
        return false;
    }
}


/**
 * PUT /org
 */
export async function updateOrgSettings(slug: string, data: any) {
    try {
        const headers = getHeaders(slug);
        console.log("data.ts: updateOrgSettings", { slug, headers, data });

        const res = await fetch(`${API_BASE_URL}/org`, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(data)
        });

        if (!res.ok) {
            let errorMessage = 'Failed to update settings';
            console.error("data.ts: Request failed", { status: res.status, statusText: res.statusText });
            try {
                const errorData = await res.json();
                if (errorData.code === 'unhandled-exception') {
                    throw new Error("Error en el sistema. Reintente, sino ponganse en contacto");
                }
                errorMessage = errorData.message || JSON.stringify(errorData);
            } catch (e) {
                if (e instanceof Error && e.message === "Error en el sistema. Reintente, sino ponganse en contacto") {
                    throw e;
                }
                errorMessage = await res.text();
            }
            throw new Error(errorMessage);
        }
        return await res.json();
    } catch (error) {
        console.error("updateOrgSettings Error", error);
        throw error;
    }
}

/**
 * GET /org
 * Fetches Organization details (name, CUIT, settings)
 */
export async function getOrgDetails(slug: string) {
    try {
        const res = await fetch(`${API_BASE_URL}/org`, {
            headers: getHeaders(slug),
            cache: 'no-store'
        });
        if (!res.ok) throw new Error('Failed to fetch org details');
        return await res.json();
    } catch (error) {
        console.error("getOrgDetails Error", error);
        return null;
    }
}

/**
 * POST /config/categories
 */
export async function createCategory(slug: string, name: string, percentage?: number) {
    try {
        const res = await fetch(`${API_BASE_URL}/config/categories`, {
            method: 'POST',
            headers: getHeaders(slug),
            body: JSON.stringify({ name, percentage }),
        });
        if (!res.ok) throw new Error('Failed to create category');
        return await res.json();
    } catch (error) {
        console.error('createCategory Error', error);
        return null;
    }
}

/**
 * PUT /config/categories/:id
 */
export async function updateCategory(slug: string, id: string, name: string, percentage?: number) {
    try {
        const res = await fetch(`${API_BASE_URL}/config/categories/${id}`, {
            method: 'PUT',
            headers: getHeaders(slug),
            body: JSON.stringify({ name, percentage }),
        });
        if (!res.ok) throw new Error('Failed to update category');
        return await res.json();
    } catch (error) {
        console.error('updateCategory Error', error);
        return null;
    }
}

/**
 * DELETE /config/categories/:id
 */
export async function deleteCategory(slug: string, id: string) {
    try {
        const res = await fetch(`${API_BASE_URL}/config/categories/${id}`, {
            method: 'DELETE',
            headers: getHeaders(slug),
        });
        if (!res.ok) throw new Error('Failed to delete category');
        return true;
    } catch (error) {
        console.error('deleteCategory Error', error);
        return false;
    }
}

/**
 * POST /fee-rules
 */
export async function createFeeRule(slug: string, data: any) {
    try {
        const res = await fetch(`${API_BASE_URL}/fee-rules`, {
            method: 'POST',
            headers: getHeaders(slug),
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Failed to create fee rule');
        return await res.json();
    } catch (error) {
        console.error("createFeeRule Error", error);
        return null;
    }
}



/**
 * POST /org/presets
 */
export async function createOrgPreset(slug: string, data: any) {
    try {
        const res = await fetch(`${API_BASE_URL}/org/presets`, {
            method: 'POST',
            headers: getHeaders(slug),
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Failed to create preset');
        return await res.json();
    } catch (error) {
        console.error("createOrgPreset Error", error);
        return null;
    }
}

/**
 * DELETE /org/presets/:id
 */
export async function deleteOrgPreset(slug: string, id: string) {
    try {
        const res = await fetch(`${API_BASE_URL}/org/presets/${id}`, {
            method: 'DELETE',
            headers: getHeaders(slug)
        });
        if (!res.ok) throw new Error('Failed to delete preset');
        return true;
    } catch (error) {
        console.error("deleteOrgPreset Error", error);
        return false;
    }
}

/**
 * PUT /org/presets/:id
 */
export async function updateOrgPreset(slug: string, id: string, data: any) {
    try {
        const res = await fetch(`${API_BASE_URL}/org/presets/${id}`, {
            method: 'PUT',
            headers: getHeaders(slug),
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Failed to update preset');
        return await res.json();
    } catch (error) {
        console.error("updateOrgPreset Error", error);
        return null;
    }
}

/**
 * GET /settlements/calculate
 */
export async function calculateSettlements(slug: string, month: string) {
    try {
        const orgDetails = await getOrgDetails(slug); // We need the ID, not slug usually, but headers handle slug->UUID often? 
        // Wait, the backend query expects 'organizationId'. 
        // 'getHeaders' puts orgSlug/ID in 'x-org-id'.
        // But the Query DTO has 'organizationId' property.
        // We usually rely on the Controller to extract from Header or Body?
        // Let's check Controller. 
        // Controller: async calculate(@Query() query: CalculateSettlementsQuery)
        // Query DTO has organizationId.
        // Frontend must pass it in Query Params? 
        // Yes, if the DTO expects it.
        // Does getOrgDetails give us the UUID? Yes.

        // Actually, let's reuse the pattern. If the backend expects it in query, we pass it.
        // However, 'getHeaders' logic in 'data.ts' tries to handle 'x-org-id'.
        // But the Query Object logic in NestJS with @Query maps from query string.
        // We should pass organizationId in query string.

        // We need to resolve slug to ID if we don't have it.
        // Or assume slug IS the ID (if user puts UUID in URL).
        // But usually slug is 'nombre-clinica'.
        // We might need to fetch Org ID first or let the backend middleware handle it (if it did).
        // The codebase seems to rely on 'x-org-id' header heavily, but this specific Query DTO demands it.
        // Let's try to fetch org details first to be safe, or if we have it in context.
        // ProfessionalPayouts receives 'slug' in URL.
        // New Endpoint: /settlements/calculate?month=...&organizationId=...

        let orgId = slug;
        // Try to fetch real ID if slug seems like a slug
        const details = await getOrgDetails(slug);
        if (details && details.id) orgId = details.id;

        const res = await fetch(`${API_BASE_URL}/settlements/calculate?month=${month}&organizationId=${orgId}`, {
            headers: getHeaders(slug),
            cache: 'no-store'
        });

        if (!res.ok) throw new Error('Failed to calculate settlements');
        return await res.json();
    } catch (error) {
        console.error("calculateSettlements Error", error);
        return [];
    }
}

/**
 * GET /config/activity-types
 */
export async function getActivityTypes(slug: string) {
    try {
        const res = await fetch(`${API_BASE_URL}/config/activity-types?orgId=${slug}`, {
            headers: getHeaders(slug),
            cache: 'no-store'
        });
        if (!res.ok) throw new Error('Failed to fetch activity types');
        return await res.json();
    } catch (error) {
        console.error("getActivityTypes Error", error);
        return [];
    }
}

/**
 * POST /config/activity-types
 */
export async function createActivityType(slug: string, data: {
    code: string;
    name: string;
    baseValue?: number;
    cardValue?: number;
    roles?: { roleLabel: string; isRequired: boolean; feeStrategy: 'CATEGORY' | 'FIXED'; fixedPercentage?: number }[];
}) {
    const res = await fetch(`${API_BASE_URL}/config/activity-types`, {
        method: 'POST',
        headers: getHeaders(slug),
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al crear prestación');
    }
    return res.json();
}

/**
 * PUT /config/activity-types/:id
 */
export async function updateActivityType(slug: string, id: string, data: {
    name?: string;
    baseValue?: number;
    cardValue?: number;
    roles?: { roleLabel: string; isRequired: boolean; feeStrategy: 'CATEGORY' | 'FIXED'; fixedPercentage?: number }[];
}) {
    const res = await fetch(`${API_BASE_URL}/config/activity-types/${id}`, {
        method: 'PUT',
        headers: getHeaders(slug),
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al actualizar prestación');
    }
    return res.json();
}

/**
 * DELETE /config/activity-types/:id
 */
export async function deleteActivityType(slug: string, id: string) {
    const res = await fetch(`${API_BASE_URL}/config/activity-types/${id}`, {
        method: 'DELETE',
        headers: getHeaders(slug),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al eliminar prestación');
    }
    return res.json();
}
