import { format } from 'date-fns'
import { API_ERROR_CODE, ROUTES, SESSION_MESSAGES } from '@/lib/constants'
import { toApiError } from '@/lib/api-errors'
import {
    SESSION_EXPIRED_REASON,
    buildLoginPath,
    clearSessionCookie,
    getCookieMaxAgeSeconds,
    mapLoginFailure,
    readSessionToken,
} from '@/lib/session'
import {
    buildActivityTypeBody,
    buildCreateActivityBody,
    buildFeeRuleBody,
    buildOrgUpdateBody,
    buildPatientBody,
    buildPresetBody,
    buildProProfileBody,
    buildStaffCreateBody,
    buildStaffUpdateBody,
    buildUpdateActivityBody,
    buildWorkItemsQuery,
} from '@/lib/request-bodies'

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

// --- AUTENTICACION Y TRANSPORTE ---

/** Contexto opcional de las llamadas. En el servidor el token se pasa explicito (viene de la cookie, ver session.server.ts). */
export interface ApiContext {
    token?: string | null;
}

/** El backend respondio 401 (o no hay token en el servidor). En el cliente nunca se lanza: se redirige al login. */
export class ApiUnauthorizedError extends Error {
    constructor() {
        super('Unauthorized');
        this.name = 'ApiUnauthorizedError';
    }
}

/** El backend respondio 403. `orgDenied`: la organizacion no es accesible. `handled`: ya se aviso al usuario (toast). */
export class ApiForbiddenError extends Error {
    readonly orgDenied: boolean;
    readonly handled: boolean;
    constructor(options: { orgDenied: boolean; handled: boolean }) {
        super(SESSION_MESSAGES.forbiddenAction);
        this.name = 'ApiForbiddenError';
        this.orgDenied = options.orgDenied;
        this.handled = options.handled;
    }
}

/** true si el error ya se comunico al usuario (toast de 403): los componentes no deben mostrar otro. */
export function isHandledApiError(error: unknown): boolean {
    return error instanceof ApiForbiddenError && error.handled;
}

let forbiddenNotifier: (() => void) | null = null;

/** Registra quien muestra el toast de 403 (lo hace providers.tsx; asi data.ts no importa sonner). */
export function registerApiForbiddenNotifier(notifier: (() => void) | null) {
    forbiddenNotifier = notifier;
}

// Evita navegaciones multiples cuando varias llamadas en paralelo reciben 401 o 403.
let navigating = false;

const isBrowser = () => typeof window !== 'undefined';

function getHeaders(orgSlug: string, token?: string | null) {
    const resolved = token ?? (isBrowser() ? readSessionToken() : null);
    // En el servidor no hay cookie accesible desde aqui: sin token no se llama a la API.
    if (!resolved && !isBrowser()) throw new ApiUnauthorizedError();

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        // Organizacion de la URL: el backend verifica que el usuario pertenezca a ella.
        'x-org-id': orgSlug,
    };
    if (resolved) headers['Authorization'] = `Bearer ${resolved}`;
    return headers;
}

function navigateOnce(path: string): Promise<never> {
    if (!navigating) {
        navigating = true;
        window.location.assign(path);
    }
    // La llamada no resuelve ni falla: la pagina se descarta con la navegacion completa (sin toast ni pantalla vacia).
    return new Promise<never>(() => { });
}

async function readErrorCode(res: Response): Promise<string | null> {
    try {
        const body = await res.clone().json();
        return typeof body?.code === 'string' ? body.code : null;
    } catch {
        return null;
    }
}

/** Unico punto de clasificacion de respuestas: 401 y 403 se resuelven aqui; el resto lo maneja cada funcion. */
async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(url, init);

    if (res.status === 401) {
        if (!isBrowser()) throw new ApiUnauthorizedError();
        clearSessionCookie();
        return navigateOnce(buildLoginPath({
            reason: SESSION_EXPIRED_REASON,
            from: window.location.pathname + window.location.search,
        }));
    }

    if (res.status === 403) {
        const orgDenied = (await readErrorCode(res)) === API_ERROR_CODE.ORG_ACCESS_DENIED;
        if (!isBrowser()) throw new ApiForbiddenError({ orgDenied, handled: false });
        const isRead = (init?.method ?? 'GET').toUpperCase() === 'GET';
        if (isRead && orgDenied) return navigateOnce(ROUTES.NO_ACCESS);
        forbiddenNotifier?.();
        throw new ApiForbiddenError({ orgDenied, handled: true });
    }

    return res;
}

/** En el servidor, un 401 o 403 nunca debe quedar tapado por el valor por defecto de una funcion (null, []). */
function rethrowServerAuthError(error: unknown) {
    if (!isBrowser() && (error instanceof ApiUnauthorizedError || error instanceof ApiForbiddenError)) {
        throw error;
    }
}

export type LoginResult =
    | { status: 'ok'; token: string; maxAge: number }
    | { status: 'invalid' | 'bad-request' | 'server' | 'network' | 'unexpected' | 'other' }
    /** 429: demasiados intentos; `retryAfter` en segundos si el servidor lo informó (y el navegador pudo leerlo). */
    | { status: 'rate-limited'; retryAfter: number | null };

/**
 * POST /v1/auth/login. No usa apiFetch: su 401 es de credenciales, no de sesion.
 * Nunca lanza ni expone el cuerpo de la respuesta.
 */
export async function login(user: string, password: string): Promise<LoginResult> {
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, password }),
        });
    } catch {
        return { status: 'network' };
    }
    const failure = mapLoginFailure(res.status, res.headers.get('Retry-After'));
    if (failure) return failure;

    try {
        const data = await res.json();
        const token = typeof data?.token === 'string' ? data.token : '';
        if (!token) return { status: 'unexpected' };
        const maxAge = getCookieMaxAgeSeconds(token, Date.now());
        if (maxAge === null) return { status: 'unexpected' };
        return { status: 'ok', token, maxAge };
    } catch {
        return { status: 'unexpected' };
    }
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
    chartBasis: 'ACCRUED' | 'CASH' = 'ACCRUED', ctx?: ApiContext) {
    try {
        const headers = getHeaders(slug, ctx?.token);

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
            apiFetch(`${API_BASE_URL}/dashboard/kpis?mode=${mode}&startDate=${startDate}&endDate=${endDate}`, { headers, cache: 'no-store' }),
            apiFetch(`${API_BASE_URL}/dashboard/chart?mode=${mode}&startDate=${startDate}&endDate=${endDate}&groupBy=day&basis=${chartBasis}`, { headers, cache: 'no-store' }),
            apiFetch(`${API_BASE_URL}/dashboard/payers?mode=${mode}&startDate=${startDate}&endDate=${endDate}`, { headers, cache: 'no-store' })
        ]);

        if (!kpiRes.ok || !chartRes.ok) throw await toApiError(kpiRes.ok ? chartRes : kpiRes);

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


        rethrowServerAuthError(error);
        console.error(error);
        return null;
    }
}

/**
 * GET /activity
 * Previously: /api/v1/orgs/:slug/work-items
 */
export async function getWorkItems(slug: string, mode: 'ORGANIZATION' | 'PROFESSIONAL', filters?: any, page: number = 1, limit: number = 20, ctx?: ApiContext) {
    try {
        // Solo viajan los filtros que declara FindAllActivitiesQuery (payer -> payerId, patient -> search); ver request-bodies.ts
        const params = new URLSearchParams(buildWorkItemsQuery(mode, filters, page, limit));

        const res = await apiFetch(`${API_BASE_URL}/activity?${params.toString()}`, {
            headers: getHeaders(slug, ctx?.token),
            cache: 'no-store'
        });

        if (!res.ok) throw await toApiError(res);
        const data = await res.json();

        // Handle both legacy array and new paginated object
        if (Array.isArray(data)) {
            return { items: data, total: data.length };
        }
        return data; // { items, total, ... }
    } catch (error) {
        rethrowServerAuthError(error);
        console.error(error);
        return { items: [], total: 0 };
    }
}



/**
 * GET /v1/patients
 * Previously: /api/v1/orgs/:slug/patients
 */
export async function getPatients(slug: string, search?: string, page: number = 1, limit: number = 12, mode?: 'ORGANIZATION' | 'PROFESSIONAL', ctx?: ApiContext) {
    try {
        const url = new URL(`${API_BASE_URL}/v1/patients`);
        if (search) url.searchParams.append('search', search);
        url.searchParams.append('page', page.toString());
        url.searchParams.append('limit', limit.toString());
        if (mode) url.searchParams.append('mode', mode);

        const res = await apiFetch(url.toString(), {
            headers: getHeaders(slug, ctx?.token),
            cache: 'no-store'
        });
        if (!res.ok) throw await toApiError(res);
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
        rethrowServerAuthError(error);
        console.error(error);
        return { items: [], total: 0 };
    }
}

/**
 * GET /fee-rules
 * Previously: /api/v1/orgs/:slug/config/rules
 */
export async function getFeeRules(slug: string, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/fee-rules`, {
            headers: getHeaders(slug, ctx?.token),
            cache: 'no-store'
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error(error);
        return null; // Return empty array or null based on component expectation
    }
}

/**
 * POST /activity
 * Previously: /api/v1/orgs/:slug/work-items
 * Requires x-mode header
 */
export async function createWorkItem(slug: string, data: any, ctx?: ApiContext) {
    try {
        const headers = getHeaders(slug, ctx?.token);

        // El modo (x-mode) es solo una preferencia: el backend decide la vista efectiva segun los vinculos del usuario.
        // 'mode' viaja unicamente en el header, nunca en el body.
        const { mode, ...body } = data ?? {};
        if (mode) {
            (headers as any)['x-mode'] = mode;
        }

        const res = await apiFetch(`${API_BASE_URL}/activity`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(buildCreateActivityBody(body))
        });

        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error(error);
        throw error; // re-throw so the caller can handle and show the error
    }
}

/**
 * GET /org/config
 * Returns categories, presets, and staff (professionals)
 */
export async function getOrgConfig(slug: string, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/org/config`, {
            headers: getHeaders(slug, ctx?.token),
            cache: 'no-store'
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error(error);
        return { categories: [], presets: [], staff: [] };
    }
}

/**
 * PUT /org/staff/:id/category
 */
export async function assignStaffCategory(slug: string, staffId: string, categoryId: string, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/org/staff/${staffId}/category`, {
            method: 'PUT',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify({ categoryId })
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error(error);
        throw error;
    }
}

/**
 * GET /pro/payers
 */
// GET /pro/payers
export async function getPayers(slug: string, page: number = 1, limit: number = 12, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/pro/payers?page=${page}&limit=${limit}`, {
            headers: getHeaders(slug, ctx?.token),
            cache: 'no-store'
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error(error);
        return { items: [], total: 0 };
    }
}

/**
 * GET /pro/context
 * Returns the professional record (id, displayName, canLoadActivities) for the authenticated user.
 */
export async function getProfessionalContext(slug: string, ctx?: ApiContext): Promise<{ id: string; displayName: string; cuit?: string; phone?: string; email?: string; canLoadActivities: boolean; userId: string; categoryId?: string; category?: { id: string; name: string; percentage: number } } | null> {
    try {
        const res = await apiFetch(`${API_BASE_URL}/pro/context`, {
            headers: getHeaders(slug, ctx?.token),
            cache: 'no-store'
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error('getProfessionalContext Error', error);
        return null;
    }
}

/**
 * GET /pro/memberships
 * Returns all orgs the authenticated professional belongs to, with their assigned category and percentage.
 */
export async function getProfessionalMemberships(slug: string, ctx?: ApiContext): Promise<Array<{
    orgId: string;
    orgName: string;
    professionalId: string;
    canLoadActivities: boolean;
    categoryId: string | null;
    categoryName: string | null;
    categoryPercentage: number | null;
}>> {
    try {
        const res = await apiFetch(`${API_BASE_URL}/pro/memberships`, {
            headers: getHeaders(slug, ctx?.token),
            cache: 'no-store'
        });
        if (!res.ok) return [];
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error('getProfessionalMemberships Error', error);
        return [];
    }
}

/**
 * PUT /pro/profile
 * Updates the professional record for the authenticated user.
 */
export async function updateProfessionalProfile(slug: string, data: any, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/pro/profile`, {
            method: 'PUT',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify(buildProProfileBody(data))
        });
        if (!res.ok) throw await toApiError(res)
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error("updateProfessionalProfile Error", error);
        throw error;
    }
}

/**
 * POST /pro/payers
 */
export async function createPayer(slug: string, name: string, retentionPercentage: number = 0, cuit?: string, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/pro/payers`, {
            method: 'POST',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify({ name, retentionPercentage, ...(cuit ? { cuit } : {}) })
        });
        if (!res.ok) throw await toApiError(res)
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error("createPayer Error", error);
        throw error;
    }
}

/**
 * POST /org/staff
 */
export async function createStaff(slug: string, data: any, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/org/staff`, {
            method: 'POST',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify(buildStaffCreateBody(data))
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error(error);
        throw error;
    }
}

/**
 * PUT /org/staff/:id
 */
export async function updateStaff(slug: string, id: string, data: any, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/org/staff/${id}`, {
            method: 'PUT',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify(buildStaffUpdateBody(data))
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error(error);
        throw error;
    }
}

/**
 * DELETE /org/staff/:id
 */
export async function deleteStaff(slug: string, id: string, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/org/staff/${id}`, {
            method: 'DELETE',
            headers: getHeaders(slug, ctx?.token)
        });
        if (!res.ok) throw await toApiError(res)
        return true;
    } catch (error) {
        rethrowServerAuthError(error);
        console.error(error);
        // Throw to let UI handle the specific error (e.g. FK constraint)
        throw error;
    }
}


/**
 * GET /v1/patients/:id/summary
 * Returns total debt + list of pending work items for a patient
 */
export async function getPatientSummary(slug: string, patientId: string, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/v1/patients/${patientId}/summary`, {
            headers: getHeaders(slug, ctx?.token),
            cache: 'no-store',
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error('getPatientSummary Error', error);
        return null;
    }
}

/**
 * POST /v1/patients
 */
export async function createPatient(slug: string, data: any, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/v1/patients`, {
            method: 'POST',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify(buildPatientBody(data))
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error(error);
        throw error;
    }
}

/**
 * POST /v1/patients/:sourceId/merge
 * Merges source patient into target: reassigns all work items and deletes source.
 */
export async function mergePatient(slug: string, sourceId: string, targetId: string, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/v1/patients/${sourceId}/merge`, {
            method: 'POST',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify({ targetId }),
        });
        if (!res.ok) throw await toApiError(res);
        return true;
    } catch (error) {
        rethrowServerAuthError(error);
        console.error(error);
        throw error;
    }
}

/**
 * PUT /v1/patients/:id
 */
export async function updatePatient(slug: string, id: string, data: any, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/v1/patients/${id}`, {
            method: 'PUT',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify(buildPatientBody(data))
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error(error);
        throw error;
    }
}

/**
 * PUT /activity/:id
 * Previously: /api/v1/orgs/:slug/work-items/:id
 */
export async function updateWorkItem(slug: string, id: string, data: any, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/activity/${id}`, {
            method: 'PUT',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify(buildUpdateActivityBody(data))
        });
        if (!res.ok) throw await toApiError(res)
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error("updateWorkItem Error", error);
        throw error;
    }
}

/**
 * GET /activity/:id
 */
export async function getWorkItemById(slug: string, id: string, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/activity/${id}`, {
            headers: getHeaders(slug, ctx?.token),
            cache: 'no-store'
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error("getWorkItemById Error", error);
        return null;
    }
}

/**
 * DELETE /activity/:id
 */
export async function deleteWorkItem(slug: string, id: string, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/activity/${id}`, {
            method: 'DELETE',
            headers: getHeaders(slug, ctx?.token)
        });
        if (!res.ok) throw await toApiError(res)
        return true;
    } catch (error) {
        rethrowServerAuthError(error);
        console.error("deleteWorkItem Error", error);
        throw error;
    }
}


/**
 * PUT /org
 */
export async function updateOrgSettings(slug: string, data: any, ctx?: ApiContext) {
    try {
        const headers = getHeaders(slug, ctx?.token);

        const res = await apiFetch(`${API_BASE_URL}/org`, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(buildOrgUpdateBody(data))
        });

        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error("updateOrgSettings Error", error);
        throw error;
    }
}

/**
 * GET /org
 * Fetches the Organization record (name, CUIT, settings)
 */
export async function getOrgDetails(slug: string, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/org`, {
            headers: getHeaders(slug, ctx?.token),
            cache: 'no-store'
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error("getOrgDetails Error", error);
        return null;
    }
}

/**
 * POST /org/categories
 */
export async function createCategory(slug: string, name: string, percentage?: number, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/org/categories`, {
            method: 'POST',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify({ name, percentage }),
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error('createCategory Error', error);
        throw error;
    }
}

/**
 * PUT /org/categories/:id
 */
export async function updateCategory(slug: string, id: string, name: string, percentage?: number, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/org/categories/${id}`, {
            method: 'PUT',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify({ name, percentage }),
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error('updateCategory Error', error);
        throw error;
    }
}

/**
 * DELETE /org/categories/:id
 */
export async function deleteCategory(slug: string, id: string, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/org/categories/${id}`, {
            method: 'DELETE',
            headers: getHeaders(slug, ctx?.token),
        });
        if (!res.ok) throw await toApiError(res);
        return true;
    } catch (error) {
        rethrowServerAuthError(error);
        console.error('deleteCategory Error', error);
        throw error;
    }
}

/**
 * POST /fee-rules
 */
export async function createFeeRule(slug: string, data: any, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/fee-rules`, {
            method: 'POST',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify(buildFeeRuleBody(data))
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error("createFeeRule Error", error);
        throw error;
    }
}



/**
 * POST /org/presets
 */
export async function createOrgPreset(slug: string, data: any, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/org/presets`, {
            method: 'POST',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify(buildPresetBody(data))
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error("createOrgPreset Error", error);
        throw error;
    }
}

/**
 * DELETE /org/presets/:id
 */
export async function deleteOrgPreset(slug: string, id: string, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/org/presets/${id}`, {
            method: 'DELETE',
            headers: getHeaders(slug, ctx?.token)
        });
        if (!res.ok) throw await toApiError(res);
        return true;
    } catch (error) {
        rethrowServerAuthError(error);
        console.error("deleteOrgPreset Error", error);
        throw error;
    }
}

/**
 * PUT /org/presets/:id
 */
export async function updateOrgPreset(slug: string, id: string, data: any, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/org/presets/${id}`, {
            method: 'PUT',
            headers: getHeaders(slug, ctx?.token),
            body: JSON.stringify(buildPresetBody(data))
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error("updateOrgPreset Error", error);
        throw error;
    }
}

/**
 * GET /settlements/calculate
 */
export async function calculateSettlements(slug: string, month: string, ctx?: ApiContext) {
    try {
        // La organizacion la toma el backend de x-org-id (validado); no se manda organizationId en la query.
        const res = await apiFetch(`${API_BASE_URL}/settlements/calculate?month=${encodeURIComponent(month)}`, {
            headers: getHeaders(slug, ctx?.token),
            cache: 'no-store'
        });

        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error("calculateSettlements Error", error);
        return [];
    }
}

/**
 * GET /org/activity-types
 */
export async function getActivityTypes(slug: string, ctx?: ApiContext) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/org/activity-types`, {
            headers: getHeaders(slug, ctx?.token),
            cache: 'no-store'
        });
        if (!res.ok) throw await toApiError(res);
        return await res.json();
    } catch (error) {
        rethrowServerAuthError(error);
        console.error("getActivityTypes Error", error);
        return [];
    }
}

/**
 * POST /org/activity-types
 */
export async function createActivityType(slug: string, data: {
    code: string;
    name: string;
    baseValue?: number;
    cardValue?: number;
    roles?: { roleLabel: string; isRequired: boolean; feeStrategy: 'CATEGORY' | 'FIXED'; fixedPercentage?: number }[];
}, ctx?: ApiContext) {
    const res = await apiFetch(`${API_BASE_URL}/org/activity-types`, {
        method: 'POST',
        headers: getHeaders(slug, ctx?.token),
        body: JSON.stringify(buildActivityTypeBody(data, 'create')),
    });
    if (!res.ok) throw await toApiError(res);
    return res.json();
}

/**
 * PUT /org/activity-types/:id
 */
export async function updateActivityType(slug: string, id: string, data: {
    name?: string;
    baseValue?: number;
    cardValue?: number;
    roles?: { roleLabel: string; isRequired: boolean; feeStrategy: 'CATEGORY' | 'FIXED'; fixedPercentage?: number }[];
}, ctx?: ApiContext) {
    const res = await apiFetch(`${API_BASE_URL}/org/activity-types/${id}`, {
        method: 'PUT',
        headers: getHeaders(slug, ctx?.token),
        body: JSON.stringify(buildActivityTypeBody(data, 'update')),
    });
    if (!res.ok) throw await toApiError(res);
    return res.json();
}

/**
 * DELETE /org/activity-types/:id
 */
export async function deleteActivityType(slug: string, id: string, ctx?: ApiContext) {
    const res = await apiFetch(`${API_BASE_URL}/org/activity-types/${id}`, {
        method: 'DELETE',
        headers: getHeaders(slug, ctx?.token),
    });
    if (!res.ok) throw await toApiError(res);
    return res.json();
}
