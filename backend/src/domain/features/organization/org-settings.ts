/**
 * Typed configuration stored in Organization.settings (JSON field).
 * All fields are optional — defaults are applied where each is consumed.
 * This allows any organization to override rules without code changes.
 */
export interface OrgSettings {
  /** Name of the payer used for private/self-paying patients. Default: 'Particular' */
  privatePayerName?: string;

  /**
   * Percentage of gross amount that goes to the professional in Pro mode
   * when the patient is private (privatePayerName). Default: 100
   */
  proModePrivatePatientPct?: number;

  /** Default serviceType when not specified in the request. Default: 'session' */
  defaultServiceType?: string;

  /** Default eventRole when not specified in the request. Default: 'TITULAR' */
  defaultEventRole?: string;

  /**
   * What to do with the co-admissor split when no co-admissor is assigned.
   * 'TO_ADMISOR': the unassigned % goes to the admissor (admissor earns admisorPct + coadmisorPct).
   * 'TO_ORG': the unassigned % stays with the organization.
   * Default: 'TO_ADMISOR'
   */
  admisionNoCoAdmisorBehavior?: 'TO_ADMISOR' | 'TO_ORG';
}

/** Parse and return OrgSettings from the raw JSON field, applying defaults. */
export function parseOrgSettings(raw: unknown): Required<OrgSettings> {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<OrgSettings>;
  return {
    privatePayerName: s.privatePayerName ?? 'Particular',
    proModePrivatePatientPct: s.proModePrivatePatientPct ?? 100,
    defaultServiceType: s.defaultServiceType ?? 'session',
    defaultEventRole: s.defaultEventRole ?? 'TITULAR',
    admisionNoCoAdmisorBehavior: s.admisionNoCoAdmisorBehavior ?? 'TO_ADMISOR',
  };
}
