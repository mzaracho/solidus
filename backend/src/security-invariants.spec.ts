/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import * as fs from 'fs';
import * as path from 'path';

// Invariantes estáticos de seguridad del feature 005: se leen los fuentes (sin *.spec.ts).
const SRC = __dirname;

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });

const files = walk(SRC);
const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, '/');
const sources = files.map((file) => ({
  file: rel(file),
  text: fs.readFileSync(file, 'utf8'),
}));

const filesMatching = (re: RegExp) =>
  sources.filter((s) => re.test(s.text)).map((s) => s.file);

describe('invariantes de seguridad', () => {
  it('x-user-id solo aparece en el guard de autenticación', () => {
    expect(filesMatching(/x-user-id/i)).toEqual([
      'infrastructure.bootstrap/guards/authentication-guard.ts',
    ]);
  });

  it('nadie decodifica JWT sin verificar en el backend', () => {
    expect(filesMatching(/\.decode\(/)).toEqual([]);
  });

  it('no quedan referencias a los guards y servicios retirados', () => {
    expect(
      filesMatching(/ApiKeyGuard|VerifyTokenService|JwtAuthGuard|AuthGuard\b/),
    ).toEqual([]);
  });

  it('console.log solo existe en el logger central', () => {
    expect(filesMatching(/console\.log\(/)).toEqual([
      'infrastructure.bootstrap/config/core/logger.ts',
    ]);
  });

  it('no hay otros console.* con payloads fuera del logger central', () => {
    expect(
      filesMatching(/console\.(info|debug|warn|error|dir|table)\(/),
    ).toEqual(['infrastructure.bootstrap/config/core/logger.ts']);
  });

  it('CORS no refleja cualquier origen', () => {
    expect(filesMatching(/origin:\s*true/)).toEqual([]);
  });

  it('hay exactamente un JwtModule.register*', () => {
    const matches = sources.flatMap((s) =>
      [...s.text.matchAll(/JwtModule\s*\.\s*register(Async)?\s*\(/g)].map(
        () => s.file,
      ),
    );
    expect(matches).toEqual(['infrastructure.bootstrap/modules/app-module.ts']);
  });

  it('ningún controlador usa @UseGuards con guards de autenticación (el guard es global)', () => {
    const offenders = sources
      .filter((s) => s.file.startsWith('api/controllers/'))
      .filter((s) => /UseGuards\((?!OrgRoleGuard\))/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('los controladores no leen la organización o el usuario de headers directamente para identidad', () => {
    expect(filesMatching(/@Headers\(\s*['"]x-user-id['"]\s*\)/)).toEqual([]);
  });

  // ─── Feature 007: aislamiento entre organizaciones ──────────────────────────
  it('007: los controladores duplicados o sin uso ya no existen', () => {
    for (const gone of [
      'api/controllers/v1/config/config-controller.ts',
      'api/controllers/v1/config/system-controller.ts',
      'api/controllers/v1/fee-engine/professional-category-controller.ts',
    ]) {
      expect(fs.existsSync(path.join(SRC, gone))).toBe(false);
    }
  });

  // ─── Feature 009: el modo (org/pro) lo decide el servidor ───────────────────
  // x-mode y ?mode= solo los lee ViewModeGuard (una vez); el resto del backend recibe ctx.view.
  const X_MODE_ALLOWLIST: Record<string, string> = {
    'domain/constants/app.constants.ts': 'comentario sobre los valores que circulan',
    'infrastructure.bootstrap/config/app/cors-config.ts':
      'lista el header como permitido en CORS; no lo lee',
    'infrastructure.bootstrap/config/core/authentication/auth-context.ts':
      'comentario de ViewAccessContext',
    'infrastructure.bootstrap/config/core/authentication/view-mode.ts':
      'comentario: lógica pura, recibe los valores ya leídos',
    'infrastructure.bootstrap/guards/view-mode-guard.ts':
      'único lugar que lee el header y la query: arma request.viewAccess',
  };

  it('009: x-mode solo se menciona en el ViewModeGuard, CORS y comentarios justificados', () => {
    expect(filesMatching(/x-mode/i).sort()).toEqual(
      Object.keys(X_MODE_ALLOWLIST).sort(),
    );
    const guard = sources.find(
      (s) => s.file === 'infrastructure.bootstrap/guards/view-mode-guard.ts',
    )!.text;
    expect(guard.match(/['"]x-mode['"]/g)).toHaveLength(1);
  });

  it('009: ningún controlador, handler ni servicio lee el modo del cliente', () => {
    const offenders = sources
      .filter(
        (s) =>
          s.file.startsWith('api/') ||
          s.file.startsWith('application/') ||
          s.file.startsWith('infrastructure/'),
      )
      .filter(
        (s) =>
          /@Query\(\s*['"]mode['"]/.test(s.text) ||
          /@Headers\(\s*['"]x-mode['"]/i.test(s.text) ||
          /headers\s*(\?\.)?\[\s*['"]x-mode['"]/i.test(s.text) ||
          /query\s*(\?\.)?\[\s*['"]mode['"]/.test(s.text) ||
          /\b(query|command|dto|data|q)\.mode\b/.test(s.text),
      )
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('009: ningún comando, query ni DTO declara un campo mode', () => {
    const offenders: string[] = [];
    for (const s of sources.filter((x) =>
      x.file.startsWith('application/features/'),
    )) {
      for (const m of s.text.matchAll(/export class (\w+)[^{]*\{/g)) {
        const start = m.index + m[0].length;
        const end = s.text.indexOf('\n}', start);
        const body = s.text.slice(start, end === -1 ? undefined : end);
        if (/^\s+mode\??\s*[:!]/m.test(body)) offenders.push(`${s.file}:${m[1]}`);
      }
    }
    const filter = sources.find(
      (s) => s.file === 'domain/features/patients/find-all-patients-filter.ts',
    )!.text;
    if (/^\s+mode\??\s*[:!]/m.test(filter)) offenders.push('FindAllPatientsFilter');
    expect(offenders).toEqual([]);
  });

  it('009: isProfessionalMode solo aparece en app.constants.ts y en el login (código de rol, no dato del cliente)', () => {
    expect(filesMatching(/isProfessionalMode/).sort()).toEqual([
      'application/features/auth/login-query-handler.ts',
      'domain/constants/app.constants.ts',
    ]);
  });

  it('009: las rutas que dependen del modo declaran @UsesViewMode y los handlers piden requireViewScope', () => {
    for (const file of [
      'application/features/activity/queries/find-all-activities-query.ts',
      'application/features/activity/commands/create-activity-command.ts',
      'application/features/dashboard/queries/get-dashboard-kpis-query.ts',
      'application/features/dashboard/queries/get-dashboard-chart-query.ts',
      'application/features/dashboard/queries/get-dashboard-payer-dist-query.ts',
      'application/features/patients/queries/find-all-patients-query.ts',
    ]) {
      const text = sources.find((s) => s.file === file)!.text;
      expect(`${file} ${/requireViewScope\(ctx\)/.test(text)}`).toBe(`${file} true`);
    }
  });

  it('007: update y delete de atenciones no dependen del modo', () => {
    for (const file of [
      'application/features/activity/commands/update-activity-command.ts',
      'application/features/activity/commands/delete-activity-command.ts',
      'application/features/activity/activity-ownership.ts',
    ]) {
      const text = sources.find((s) => s.file === file)!.text;
      expect(text).not.toMatch(/isProfessionalMode|\bmode\b/);
    }
  });

  // Archivos que acceden a un modelo con `where: { id` sin importar org-resource, y por qué es seguro.
  const WHERE_ID_ALLOWLIST: Record<string, string> = {
    'application/features/config/commands/update-organization-command.ts':
      'el id es el x-org-id validado por OrgAccessGuard y la ruta exige ADMIN',
    'application/features/config/queries/get-organization-query.ts':
      'el id es el x-org-id validado por OrgAccessGuard',
    'application/features/settlements/queries/calculate-settlements-query.ts':
      'el id es @CurrentOrgId() (validado por OrgAccessGuard) y la ruta exige ADMIN',
    'infrastructure/features/auth/services/org-access.service.ts':
      'consulta la pertenencia: filtra por la membresía o el vínculo del usuario autenticado',
    'infrastructure/features/dashboard/dashboard.service.ts':
      'lee entidades de ids ya filtrados por la organización validada',
    'infrastructure/features/fee-engine/fee-resolution.service.ts':
      'lee ids que quien llama (ActivityService) ya verificó contra la organización',
    'infrastructure/features/patients/patients.service.ts':
      'servicio de pacientes: los handlers verifican el id con foundOr404 antes de llamarlo',
  };
  const WHERE_ID = /where:\s*\{\s*id\b/;

  it('007: todo archivo que opera por where: { id importa org-resource o está en la lista blanca justificada', () => {
    const offenders = sources
      .filter(
        (s) =>
          (s.file.startsWith('application/features/') ||
            s.file.startsWith('infrastructure/features/')) &&
          WHERE_ID.test(s.text) &&
          !/org-resource/.test(s.text),
      )
      .map((s) => s.file)
      .filter((f) => !(f in WHERE_ID_ALLOWLIST))
      .sort();
    expect(offenders).toEqual([]);
    // la lista blanca no acumula entradas obsoletas
    for (const f of Object.keys(WHERE_ID_ALLOWLIST)) {
      const src = sources.find((s) => s.file === f);
      expect(src).toBeDefined();
      expect(WHERE_ID.test(src!.text)).toBe(true);
      expect(/org-resource/.test(src!.text)).toBe(false);
    }
  });

  // Campos *Id de comandos y queries (clases `implements IRequest`) y cómo se controla cada uno (criterio 4).
  //  verified   : el handler lo valida con requireId/optionalId y foundOr404 contra el scope o la organización destino
  //  ignored    : el valor del body se ignora; la organización sale del contexto validado
  //  controller : lo asigna el controlador desde el header o el token ya validados por los guards globales
  //  filter     : filtro dentro de un where ya acotado a la organización; un id ajeno da una lista vacía
  const ID_FIELDS: Record<
    string,
    'verified' | 'ignored' | 'controller' | 'filter'
  > = {
    'AssignStaffCategoryCommand.categoryId': 'verified',
    'AssignStaffCategoryCommand.id': 'verified',
    'CalculateSettlementsQuery.organizationId': 'controller',
    'CreateActivityCommand.activityTypeId': 'verified',
    'CreateActivityCommand.organizationId': 'verified',
    'CreateActivityCommand.patientId': 'verified',
    'CreateActivityCommand.payerId': 'verified',
    'CreateActivityCommand.presetId': 'verified',
    'CreateActivityCommand.professionalId': 'verified',
    'CreateActivityTypeCommand.orgId': 'ignored',
    'CreateCategoryCommand.orgId': 'ignored',
    'CreatePatientCommand.organizationId': 'controller',
    'CreatePayerCommand.orgId': 'ignored',
    'CreatePresetCommand.orgId': 'ignored',
    'CreateStaffCommand.categoryId': 'verified',
    'CreateStaffCommand.orgId': 'ignored',
    'DeleteActivityCommand.id': 'verified',
    'DeleteActivityTypeCommand.id': 'verified',
    'DeleteCategoryCommand.id': 'verified',
    'DeletePayerCommand.id': 'verified',
    'DeletePresetCommand.id': 'verified',
    'DeleteStaffCommand.id': 'verified',
    'FindActivityByIdQuery.id': 'verified',
    'FindAllActivitiesQuery.organizationId': 'controller',
    'FindAllActivitiesQuery.patientId': 'filter',
    'FindAllActivitiesQuery.payerId': 'filter',
    'FindAllActivitiesQuery.professionalId': 'filter',
    'FindAllPatientsQuery.organizationId': 'controller',
    'FindAllPatientsQuery.userId': 'controller',
    'FindFeeRulesQuery.organizationId': 'controller',
    'FindFeeRulesQuery.userId': 'controller',
    'GetActivityTypesQuery.orgId': 'controller',
    'GetDashboardChartQuery.orgId': 'controller',
    'GetDashboardKpisQuery.organizationId': 'controller',
    'GetDashboardPayerDistributionQuery.orgId': 'controller',
    'GetDebtQuery.id': 'verified',
    'GetOrgConfigQuery.orgId': 'controller',
    'GetOrganizationQuery.orgId': 'controller',
    'GetPatientSummaryQuery.patientId': 'verified',
    'GetPayersQuery.orgId': 'controller',
    'GetPayersQuery.userId': 'controller',
    'MergePatientCommand.sourceId': 'verified',
    'MergePatientCommand.targetId': 'verified',
    'UpdateActivityCommand.id': 'verified',
    'UpdateActivityTypeCommand.id': 'verified',
    'UpdateCategoryCommand.id': 'verified',
    'UpdateOrganizationCommand.id': 'controller',
    'UpdatePatientCommand.id': 'verified',
    'UpdatePayerCommand.id': 'verified',
    'UpdatePresetCommand.id': 'verified',
    'UpdateStaffCommand.id': 'verified',
  };

  it('007: cada campo *Id de comandos y queries está clasificado (un campo nuevo hace fallar el test)', () => {
    const found = new Set<string>();
    for (const s of sources.filter((x) =>
      x.file.startsWith('application/features/'),
    )) {
      for (const m of s.text.matchAll(
        /export class (\w+) implements IRequest</g,
      )) {
        const start = m.index + m[0].length;
        const end = s.text.indexOf('\n}', start);
        const body = s.text.slice(start, end === -1 ? undefined : end);
        for (const f of body.matchAll(
          /^\s+(?:public readonly |readonly )?(id|\w+Id)\??\s*[:!]/gm,
        )) {
          found.add(`${m[1]}.${f[1]}`);
        }
        for (const c of body.matchAll(/constructor\(([^)]*)\)/g)) {
          for (const f of c[1].matchAll(
            /(?:public readonly |readonly )?(id|\w+Id)\??\s*:/g,
          )) {
            found.add(`${m[1]}.${f[1]}`);
          }
        }
      }
    }
    expect([...found].sort()).toEqual(Object.keys(ID_FIELDS).sort());
  });

  it('009: cada campo "controller" de ID_FIELDS lo asigna el controlador que despacha la clase', () => {
    const controllers = sources.filter((s) =>
      s.file.startsWith('api/controllers/'),
    );
    const missing: string[] = [];
    for (const [key, kind] of Object.entries(ID_FIELDS)) {
      if (kind !== 'controller') continue;
      const [cls, field] = key.split('.');
      const users = controllers.filter((c) =>
        new RegExp(`\\b${cls}\\b`).test(c.text),
      );
      if (users.length === 0) {
        missing.push(`${key}: ningún controlador despacha la clase`);
      } else if (
        !users.some((c) => new RegExp(`\\.${field}\\s*=(?!=)`).test(c.text))
      ) {
        missing.push(`${key}: el controlador no asigna el campo`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('007: los comandos con ids verificados viven en archivos que usan org-resource o el contexto', () => {
    const verified = new Set(
      Object.entries(ID_FIELDS)
        .filter(([, kind]) => kind === 'verified')
        .map(([key]) => key.split('.')[0]),
    );
    const bad: string[] = [];
    for (const cls of verified) {
      const file = sources.find((s) =>
        new RegExp(`export class ${cls} implements IRequest<`).test(s.text),
      )!;
      if (!/org-resource|requireOrgScope/.test(file.text)) bad.push(file.file);
    }
    expect(bad).toEqual([]);
  });

  // ALTA-1: la organización sale solo de request.orgAccess (CurrentOrgId / RequestContext), nunca del header crudo.
  const X_ORG_ID_ALLOWLIST: Record<string, string> = {
    'infrastructure.bootstrap/config/app/cors-config.ts':
      'lista el header como permitido en CORS; no lo lee',
    'infrastructure.bootstrap/config/core/authentication/auth-context.ts':
      'comentario del contexto validado',
    'infrastructure.bootstrap/config/core/authentication/current-org-decorator.ts':
      'comentario: el decorador lee orgAccess, no el header',
    'infrastructure.bootstrap/guards/org-access-guard.ts':
      'único lugar que lee el header: lo valida y arma request.orgAccess',
  };

  it('007: x-org-id solo se menciona en el guard, CORS y comentarios justificados (ningún controlador ni handler)', () => {
    expect(filesMatching(/x-org-id/i).sort()).toEqual(
      Object.keys(X_ORG_ID_ALLOWLIST).sort(),
    );
  });

  it('007: ningún controlador ni handler lee la organización de @Headers, headers[...], @Query o @Body', () => {
    const offenders = sources
      .filter(
        (s) =>
          s.file.startsWith('api/') ||
          s.file.startsWith('application/') ||
          s.file.startsWith('infrastructure/'),
      )
      .filter(
        (s) =>
          /@Headers\(\s*['"]x-org-id['"]/i.test(s.text) ||
          /headers\s*(\?\.)?\[\s*['"]x-org-id['"]/i.test(s.text) ||
          /@(Query|Body)\(\s*['"](orgId|organizationId)['"]/.test(s.text),
      )
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('007: los controladores con organización usan @CurrentOrgId()', () => {
    const using = sources
      .filter((s) => s.file.startsWith('api/controllers/'))
      .filter((s) => /@CurrentOrgId\(\)/.test(s.text))
      .map((s) => s.file)
      .sort();
    expect(using).toEqual([
      'api/controllers/v1/activity/activity-controller.ts',
      'api/controllers/v1/config/org-controller.ts',
      'api/controllers/v1/config/pro-controller.ts',
      'api/controllers/v1/dashboard/dashboard-controller.ts',
      'api/controllers/v1/fee-engine/fee-rules-controller.ts',
      'api/controllers/v1/patients/patients-controller.ts',
      'api/controllers/v1/settlements/settlements-controller.ts',
    ]);
  });

  it('007: solo ProController inyecta PrismaService entre los controladores', () => {
    const offenders = sources
      .filter(
        (s) =>
          s.file.startsWith('api/controllers/') && /PrismaService/.test(s.text),
      )
      .map((s) => s.file);
    expect(offenders).toEqual(['api/controllers/v1/config/pro-controller.ts']);
  });

  it('007: los handlers de config no leen la organización del comando', () => {
    for (const file of [
      'application/features/config/commands/category-commands.ts',
      'application/features/config/commands/preset-commands.ts',
      'application/features/config/commands/activity-type-commands.ts',
      'application/features/config/commands/staff-commands.ts',
    ]) {
      const text = sources.find((s) => s.file === file)!.text;
      expect(text).not.toMatch(/command\.orgId/);
    }
  });
});
