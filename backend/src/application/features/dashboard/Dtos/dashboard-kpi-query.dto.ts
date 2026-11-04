/**
 * Tipo interno que recibe DashboardService.getKpis. NO es un contrato de request: el body/query real se
 * valida en GetDashboardKpisQuery (014). Sin decoradores de class-validator a propósito.
 */
export interface DashboardKpiQueryDto {
  organizationId: string;
  startDate?: string;
  endDate?: string;
  basis?: 'ACCRUED' | 'CASH';
  valueType?: 'NET' | 'GROSS';
}
