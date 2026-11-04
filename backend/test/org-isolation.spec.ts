/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
/**
 * Feature 007: aislamiento entre organizaciones. Arranca el AppModule REAL con PrismaService
 * reemplazado por una base en memoria (fake-prisma) y OrgAccessService por un stub con roles por
 * usuario y organización. Ningún test toca la base de datos.
 *
 *  (a) Estructural: el conjunto de rutas con parámetro del AppModule tiene que ser IGUAL a las
 *      claves de ID_ROUTE_CASES. Una ruta nueva con :param hace fallar el test hasta que se agregue.
 *  (b) Por cada ruta: recurso de otra organización -> 404 genérico idéntico al de un id inexistente,
 *      sin escrituras; caso legítimo -> 2xx.
 *  (c) Rol: toda escritura de OrgController exige ADMIN.
 *  (d) Ownership de atenciones por HTTP con x-mode org, pro y sin header: mismo resultado.
 *  (e) canLoadActivities por HTTP.
 *  (f) Rutas eliminadas: 404.
 *  (g) Contrato del frontend contra org/*.
 *  (h) Lookup por CUIT acotado a la organización.
 *
 * Feature 009 (modo org/pro decidido en el servidor):
 *  (j) Matriz por HTTP: vínculos x modo pedido x ruta (GET activity, GET dashboard/kpis, GET v1/patients, POST activity).
 *  (k) Financieros solo para ADMIN, con valores conocidos (dashboard en org y settlements/calculate).
 *  (l) Estructural: el conjunto de rutas con @UsesViewMode y los roles exigidos.
 *  (m) Valores de modo inválidos y rutas que ignoran el modo.
 *  (n) Lecturas por id de un profesional sin membresía, y vista pro multi-organización.
 */
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '@src/infrastructure.bootstrap/modules/app-module';
import { configureGlobalPrefix } from '@src/infrastructure.bootstrap/config/app/global-prefix-config';
import { configurePipes } from '@src/infrastructure.bootstrap/config/app/pipes-config';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { OrgAccessService } from '@src/infrastructure/features/auth/services/org-access.service';
import { REQUIRED_ORG_ROLE_KEY } from '@src/infrastructure.bootstrap/guards/org-role-guard';
import { VIEW_MODE_KEY } from '@src/infrastructure.bootstrap/config/core/authentication/view-mode-decorator';
import {
  resolveViewMode,
  ViewLinks,
} from '@src/infrastructure.bootstrap/config/core/authentication/view-mode';
import { OrgController } from '@src/api/controllers/v1/config/org-controller';
import { createFakePrisma } from './helpers/fake-prisma';

// ─── Datos ficticios (ids generados en ejecución) ─────────────────────────────
const id = () => randomUUID();
const orgA = id();
const orgB = id();
const orgC = id(); // SOLO_PRACTICE
const U = {
  admin: id(),
  member: id(),
  pro: id(),
  proNoLoad: id(),
  stranger: id(),
  adminPro: id(), // ADMIN de A con Professional en A y en B
  memberPro: id(), // MEMBER de A con Professional en A
  soloAdmin: id(), // ADMIN de C (SOLO_PRACTICE) sin Professional
  proDeleted: id(), // Professional activo en A y dado de baja en B
};
const I = {
  proA: id(), // Professional de U.pro en A (canLoadActivities = true)
  proNoLoadA: id(), // Professional de U.proNoLoad en A (canLoadActivities = false)
  staffA: id(), // staff de A sin usuario
  proB: id(),
  ptA1: id(),
  ptA2: id(),
  ptB: id(),
  catA: id(),
  catB: id(),
  presetA: id(),
  presetB: id(),
  atA: id(),
  atB: id(),
  atDefault: id(),
  payerA: id(),
  payerSysA: id(),
  payerB: id(),
  wiMember: id(),
  wiOther: id(),
  wiNullPro: id(),
  wiNullOther: id(),
  wiPro: id(),
  wiB: id(),
  staffC: id(), // staff de C sin usuario
  proAdminA: id(),
  proAdminB: id(),
  proMemberA: id(),
  proDelA: id(),
  proDelB: id(),
  ptC: id(),
  wk1: id(), // A, feb: bruto 100, PAGADA; ORG 30, proAdminA 50, proMemberA 20
  wk2: id(), // A, feb: bruto 200, IMPAGA; proMemberA 120 (sin split ORG: remanente 80)
  wkB2: id(), // B, feb: bruto 40, IMPAGA; ORG 15, proAdminB 25; participa proAdminB
  wkNoLoad: id(), // A, mar: del Professional sin permiso de carga
  wkOtherOnPtA2: id(), // A: mismo paciente que wkNoLoad (ptA2) pero de OTRO profesional (staffA)
  wkDelB: id(), // B, mar: de un Professional dado de baja
};
const CUIT = {
  proA: '20111111111',
  staffA: '20222222222',
  proB: '20333333333',
};

const wi = (rowId: string, over: Record<string, any>) => ({
  id: rowId,
  organizationId: orgA,
  patientId: I.ptA1,
  professionalId: I.staffA,
  payerId: I.payerSysA,
  createdByUserId: null,
  paymentStatus: 'UNPAID',
  paymentDate: null,
  grossAmount: 10,
  occurredAt: new Date('2026-01-02T12:00:00Z'),
  serviceType: 'session',
  ...over,
});

const seed = () => ({
  user: Object.values(U).map((uid) => ({
    id: uid,
    name: 'Usuario Ficticio',
    email: `${uid}@example.test`,
    deletedAt: null,
  })),
  organization: [
    { id: orgA, type: 'CLINIC', settings: null, name: 'Org A' },
    { id: orgB, type: 'CLINIC', settings: null, name: 'Org B' },
    { id: orgC, type: 'SOLO_PRACTICE', settings: null, name: 'Org C' },
  ],
  professional: [
    {
      id: I.proA,
      organizationId: orgA,
      userId: U.pro,
      canLoadActivities: true,
      displayName: 'Pro A',
      cuit: CUIT.proA,
      email: 'proa@example.test',
      phone: '1',
      status: 'ACTIVE',
      deletedAt: null,
      categoryId: null,
    },
    {
      id: I.proNoLoadA,
      organizationId: orgA,
      userId: U.proNoLoad,
      canLoadActivities: false,
      displayName: 'Pro Sin Permiso',
      cuit: null,
      status: 'ACTIVE',
      deletedAt: null,
      categoryId: null,
    },
    {
      id: I.staffA,
      organizationId: orgA,
      userId: null,
      canLoadActivities: false,
      displayName: 'Staff A',
      cuit: CUIT.staffA,
      email: 'staff@example.test',
      phone: '2',
      status: 'ACTIVE',
      deletedAt: null,
      categoryId: null,
    },
    {
      id: I.proB,
      organizationId: orgB,
      userId: U.stranger,
      canLoadActivities: true,
      displayName: 'Pro B',
      cuit: CUIT.proB,
      email: 'prob@example.test',
      phone: '3',
      status: 'ACTIVE',
      deletedAt: null,
      categoryId: null,
    },
    {
      id: I.staffC,
      organizationId: orgC,
      userId: null,
      canLoadActivities: false,
      displayName: 'Staff C',
      cuit: null,
      status: 'ACTIVE',
      deletedAt: null,
      categoryId: null,
    },
    {
      id: I.proAdminA,
      organizationId: orgA,
      userId: U.adminPro,
      canLoadActivities: true,
      displayName: 'Pro Admin A',
      cuit: null,
      status: 'ACTIVE',
      deletedAt: null,
      categoryId: null,
    },
    {
      id: I.proAdminB,
      organizationId: orgB,
      userId: U.adminPro,
      canLoadActivities: true,
      displayName: 'Pro Admin B',
      cuit: null,
      status: 'ACTIVE',
      deletedAt: null,
      categoryId: null,
    },
    {
      id: I.proMemberA,
      organizationId: orgA,
      userId: U.memberPro,
      canLoadActivities: false,
      displayName: 'Pro Member A',
      cuit: null,
      status: 'ACTIVE',
      deletedAt: null,
      categoryId: null,
    },
    {
      id: I.proDelA,
      organizationId: orgA,
      userId: U.proDeleted,
      canLoadActivities: true,
      displayName: 'Pro Baja A',
      cuit: null,
      status: 'ACTIVE',
      deletedAt: null,
      categoryId: null,
    },
    {
      id: I.proDelB,
      organizationId: orgB,
      userId: U.proDeleted,
      canLoadActivities: true,
      displayName: 'Pro Baja B',
      cuit: null,
      status: 'ACTIVE',
      deletedAt: new Date(),
      categoryId: null,
    },
  ],
  patient: [
    { id: I.ptA1, organizationId: orgA, firstName: 'Ana', lastName: 'Uno' },
    { id: I.ptA2, organizationId: orgA, firstName: 'Ana', lastName: 'Dos' },
    { id: I.ptB, organizationId: orgB, firstName: 'Beto', lastName: 'Tres' },
    { id: I.ptC, organizationId: orgC, firstName: 'Cora', lastName: 'Cuatro' },
  ],
  professionalCategory: [
    { id: I.catA, organizationId: orgA, name: 'Cat A', percentage: 60 },
    { id: I.catB, organizationId: orgB, name: 'Cat B', percentage: 60 },
  ],
  feePreset: [
    {
      id: I.presetA,
      organizationId: orgA,
      name: 'Preset A',
      value: 10,
      cardValue: null,
      serviceType: 'session',
      linkedType: null,
    },
    {
      id: I.presetB,
      organizationId: orgB,
      name: 'Preset B',
      value: 10,
      cardValue: null,
      serviceType: 'session',
      linkedType: null,
    },
  ],
  activityType: [
    { id: I.atA, organizationId: orgA, code: 'a', name: 'Tipo A', roles: [] },
    { id: I.atB, organizationId: orgB, code: 'b', name: 'Tipo B', roles: [] },
    {
      id: I.atDefault,
      organizationId: null,
      code: 'def',
      name: 'Por defecto',
      roles: [],
    },
  ],
  payer: [
    {
      id: I.payerA,
      organizationId: orgA,
      name: 'OS A',
      professionalId: I.proA,
      isManagedBySystem: false,
    },
    {
      id: I.payerSysA,
      organizationId: orgA,
      name: 'Particular',
      professionalId: null,
      isManagedBySystem: true,
    },
    {
      id: I.payerB,
      organizationId: orgB,
      name: 'OS B',
      professionalId: null,
      isManagedBySystem: false,
    },
  ],
  workItem: [
    wi(I.wiMember, { createdByUserId: U.member }),
    wi(I.wiOther, { createdByUserId: U.stranger }),
    wi(I.wiNullPro, { createdByUserId: null, professionalId: I.proA }),
    wi(I.wiNullOther, { createdByUserId: null }),
    wi(I.wiPro, { createdByUserId: U.pro, professionalId: I.proA }),
    wi(I.wiB, {
      organizationId: orgB,
      patientId: I.ptB,
      professionalId: I.proB,
      payerId: I.payerB,
      createdByUserId: U.stranger,
    }),
    // 009: montos conocidos (febrero) y datos para la vista pro multi-organización
    wi(I.wk1, {
      professionalId: I.proAdminA,
      paymentStatus: 'PAID',
      paymentDate: new Date('2026-02-05T12:00:00Z'),
      grossAmount: 100,
      occurredAt: new Date('2026-02-05T12:00:00Z'),
    }),
    wi(I.wk2, {
      professionalId: I.proMemberA,
      grossAmount: 200,
      occurredAt: new Date('2026-02-06T12:00:00Z'),
    }),
    wi(I.wkB2, {
      organizationId: orgB,
      patientId: I.ptB,
      professionalId: I.proB,
      payerId: I.payerB,
      grossAmount: 40,
      occurredAt: new Date('2026-02-07T12:00:00Z'),
    }),
    wi(I.wkNoLoad, {
      patientId: I.ptA2,
      professionalId: I.proNoLoadA,
      grossAmount: 30,
      occurredAt: new Date('2026-03-03T12:00:00Z'),
    }),
    wi(I.wkOtherOnPtA2, {
      patientId: I.ptA2,
      professionalId: I.staffA,
      grossAmount: 7777,
      occurredAt: new Date('2026-03-05T12:00:00Z'),
    }),
    wi(I.wkDelB, {
      organizationId: orgB,
      patientId: I.ptB,
      professionalId: I.proDelB,
      payerId: I.payerB,
      grossAmount: 15,
      occurredAt: new Date('2026-03-04T12:00:00Z'),
    }),
  ],
  workItemSplit: [
    { workItemId: I.wk1, beneficiaryType: 'ORG', beneficiaryId: null, amount: 30 },
    { workItemId: I.wk1, beneficiaryType: 'PROFESSIONAL', beneficiaryId: I.proAdminA, amount: 50 },
    { workItemId: I.wk1, beneficiaryType: 'PROFESSIONAL', beneficiaryId: I.proMemberA, amount: 20 },
    { workItemId: I.wk2, beneficiaryType: 'PROFESSIONAL', beneficiaryId: I.proMemberA, amount: 120 },
    { workItemId: I.wkB2, beneficiaryType: 'ORG', beneficiaryId: null, amount: 15 },
    { workItemId: I.wkB2, beneficiaryType: 'PROFESSIONAL', beneficiaryId: I.proAdminB, amount: 25 },
  ].map((r) => ({ id: id(), ...r })),
  workItemParticipant: [
    {
      id: id(),
      workItemId: I.wkB2,
      professionalId: I.proAdminB,
      roleLabel: 'Coadmisor',
      feeAmount: 25,
    },
  ],
  organizationMember: [
    { id: id(), organizationId: orgC, userId: U.soloAdmin, role: 'ADMIN' },
  ],
  feeRule: [
    {
      id: id(),
      organizationId: orgA,
      name: 'Regla A',
      payerId: null,
      professionalCategory: null,
      splits: [],
    },
    {
      id: id(),
      organizationId: orgB,
      name: 'Regla B',
      payerId: null,
      professionalCategory: null,
      splits: [],
    },
  ],
});

const ACCESS: Record<string, Record<string, 'ADMIN' | 'MEMBER' | null>> = {
  [U.admin]: { [orgA]: 'ADMIN' },
  [U.member]: { [orgA]: 'MEMBER' },
  [U.pro]: { [orgA]: null },
  [U.proNoLoad]: { [orgA]: null },
  [U.adminPro]: { [orgA]: 'ADMIN' },
  [U.memberPro]: { [orgA]: 'MEMBER' },
  [U.soloAdmin]: { [orgC]: 'ADMIN' },
  [U.proDeleted]: { [orgA]: null },
};

// ─── (a) Tabla de rutas con parámetro ─────────────────────────────────────────
interface Attack {
  path: string;
  body?: any;
  /** Ids del recurso ajeno que se reemplazan por un UUID al azar para armar la respuesta de "inexistente". */
  foreign: string[];
}
interface IdRouteCase {
  attacks: Attack[];
  legit: { path: string; body?: any };
}
const p = (s: string) => `/api${s}`;
const ID_ROUTE_CASES: Record<string, IdRouteCase> = {
  'get /api/activity/:id': {
    attacks: [{ path: p(`/activity/${I.wiB}`), foreign: [I.wiB] }],
    legit: { path: p(`/activity/${I.wiMember}`) },
  },
  'put /api/activity/:id': {
    attacks: [
      {
        path: p(`/activity/${I.wiB}`),
        body: { attendance: 'PRESENT' },
        foreign: [I.wiB],
      },
    ],
    legit: {
      path: p(`/activity/${I.wiMember}`),
      body: { attendance: 'PRESENT' },
    },
  },
  'delete /api/activity/:id': {
    attacks: [{ path: p(`/activity/${I.wiB}`), foreign: [I.wiB] }],
    legit: { path: p(`/activity/${I.wiMember}`) },
  },
  'get /api/v1/patients/:id/debt': {
    attacks: [{ path: p(`/v1/patients/${I.ptB}/debt`), foreign: [I.ptB] }],
    legit: { path: p(`/v1/patients/${I.ptA1}/debt`) },
  },
  'get /api/v1/patients/:id/summary': {
    attacks: [{ path: p(`/v1/patients/${I.ptB}/summary`), foreign: [I.ptB] }],
    legit: { path: p(`/v1/patients/${I.ptA1}/summary`) },
  },
  'put /api/v1/patients/:id': {
    attacks: [
      {
        path: p(`/v1/patients/${I.ptB}`),
        body: { firstName: 'X', lastName: 'Y' },
        foreign: [I.ptB],
      },
    ],
    legit: {
      path: p(`/v1/patients/${I.ptA1}`),
      body: { firstName: 'X', lastName: 'Y' },
    },
  },
  'post /api/v1/patients/:id/merge': {
    attacks: [
      {
        path: p(`/v1/patients/${I.ptB}/merge`),
        body: { targetId: I.ptA2 },
        foreign: [I.ptB],
      },
      {
        path: p(`/v1/patients/${I.ptA1}/merge`),
        body: { targetId: I.ptB },
        foreign: [I.ptB],
      },
    ],
    legit: {
      path: p(`/v1/patients/${I.ptA1}/merge`),
      body: { targetId: I.ptA2 },
    },
  },
  'put /api/org/categories/:id': {
    attacks: [
      {
        path: p(`/org/categories/${I.catB}`),
        body: { name: 'N', percentage: 50 },
        foreign: [I.catB],
      },
    ],
    legit: {
      path: p(`/org/categories/${I.catA}`),
      body: { name: 'N', percentage: 50 },
    },
  },
  'delete /api/org/categories/:id': {
    attacks: [{ path: p(`/org/categories/${I.catB}`), foreign: [I.catB] }],
    legit: { path: p(`/org/categories/${I.catA}`) },
  },
  'put /api/org/presets/:id': {
    attacks: [
      {
        path: p(`/org/presets/${I.presetB}`),
        body: { name: 'N', baseValue: 5 },
        foreign: [I.presetB],
      },
    ],
    legit: {
      path: p(`/org/presets/${I.presetA}`),
      body: { name: 'N', baseValue: 5 },
    },
  },
  'delete /api/org/presets/:id': {
    attacks: [{ path: p(`/org/presets/${I.presetB}`), foreign: [I.presetB] }],
    legit: { path: p(`/org/presets/${I.presetA}`) },
  },
  'put /api/org/staff/:id': {
    attacks: [
      {
        path: p(`/org/staff/${I.proB}`),
        body: { name: 'N', surname: 'S', email: 'n@example.test' },
        foreign: [I.proB],
      },
    ],
    legit: {
      path: p(`/org/staff/${I.staffA}`),
      body: { name: 'N', surname: 'S', email: 'n@example.test' },
    },
  },
  'put /api/org/staff/:id/category': {
    attacks: [
      {
        path: p(`/org/staff/${I.proB}/category`),
        body: { categoryId: I.catA },
        foreign: [I.proB],
      },
      {
        path: p(`/org/staff/${I.staffA}/category`),
        body: { categoryId: I.catB },
        foreign: [I.catB],
      },
    ],
    legit: {
      path: p(`/org/staff/${I.staffA}/category`),
      body: { categoryId: I.catA },
    },
  },
  'delete /api/org/staff/:id': {
    attacks: [{ path: p(`/org/staff/${I.proB}`), foreign: [I.proB] }],
    legit: { path: p(`/org/staff/${I.staffA}`) },
  },
  'put /api/org/activity-types/:id': {
    attacks: [
      {
        path: p(`/org/activity-types/${I.atB}`),
        body: { name: 'N' },
        foreign: [I.atB],
      },
      {
        path: p(`/org/activity-types/${I.atDefault}`),
        body: { name: 'N' },
        foreign: [I.atDefault],
      },
    ],
    legit: { path: p(`/org/activity-types/${I.atA}`), body: { name: 'N' } },
  },
  'delete /api/org/activity-types/:id': {
    attacks: [
      { path: p(`/org/activity-types/${I.atB}`), foreign: [I.atB] },
      { path: p(`/org/activity-types/${I.atDefault}`), foreign: [I.atDefault] },
    ],
    legit: { path: p(`/org/activity-types/${I.atA}`) },
  },
  'put /api/pro/payers/:id': {
    attacks: [
      {
        path: p(`/pro/payers/${I.payerB}`),
        body: { name: 'N' },
        foreign: [I.payerB],
      },
    ],
    legit: { path: p(`/pro/payers/${I.payerA}`), body: { name: 'N' } },
  },
  'delete /api/pro/payers/:id': {
    attacks: [{ path: p(`/pro/payers/${I.payerB}`), foreign: [I.payerB] }],
    legit: { path: p(`/pro/payers/${I.payerA}`) },
  },
};

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
};
const join = (...parts: string[]) =>
  '/' +
  parts
    .map((x) => x.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

describe('Aislamiento entre organizaciones (AppModule real, base en memoria)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const fake = createFakePrisma(seed());
  const registeredControllers = new Set<any>();
  const allRoutes: Array<{
    key: string;
    method: string;
    template: string;
    ctrl: any;
    handler: any;
  }> = [];

  beforeAll(async () => {
    // los 4xx esperados los registra el logger central con console.error: se silencian en este spec
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.JWT_SECRET = 'k'.repeat(40);
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fake.client)
      .overrideProvider(OrgAccessService)
      .useValue({
        getAccess: async (userId: string, orgId: string) => {
          const role = ACCESS[userId]?.[orgId];
          return role === undefined
            ? { allowed: false, memberRole: null }
            : { allowed: true, memberRole: role };
        },
        // Derivados del seed con las mismas columnas que la consulta real (status, deletedAt).
        getActiveProfessionals: async (userId: string) =>
          fake
            .rows('professional')
            .filter(
              (r) =>
                r.userId === userId &&
                r.status === 'ACTIVE' &&
                r.deletedAt === null,
            )
            .map((r) => ({
              id: r.id,
              organizationId: r.organizationId,
              canLoadActivities: !!r.canLoadActivities,
            })),
        getOrgType: async (orgId: string) =>
          fake.rows('organization').find((o) => o.id === orgId)?.type ?? null,
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureGlobalPrefix(app);
    configurePipes(app);
    await app.init();
    jwt = moduleRef.get(JwtService);

    const container = moduleRef.get(ModulesContainer);
    const seen = new Set<string>();
    for (const mod of container.values()) {
      for (const wrapper of mod.controllers.values()) {
        const ctrl = wrapper.metatype as any;
        if (!ctrl) continue;
        registeredControllers.add(ctrl);
        const base: string = Reflect.getMetadata(PATH_METADATA, ctrl) ?? '';
        const proto = ctrl.prototype;
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name === 'constructor') continue;
          const handler = proto[name];
          if (typeof handler !== 'function') continue;
          const methodId = Reflect.getMetadata(METHOD_METADATA, handler);
          if (methodId === undefined) continue;
          const sub: string = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
          const isHealth = base.replace(/^\/+/, '').startsWith('health');
          const template = isHealth ? join(base, sub) : join('api', base, sub);
          const method = METHOD_NAMES[methodId] ?? 'get';
          const key = `${method} ${template}`;
          if (seen.has(key)) continue;
          seen.add(key);
          allRoutes.push({ key, method, template, ctrl, handler });
        }
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => fake.reset());

  const tokenOf = (userId: string) => jwt.sign({ sub: userId });
  const call = async (
    userId: string,
    method: string,
    path: string,
    opts: { body?: any; mode?: string; org?: string } = {},
  ) => {
    let req = (request(app.getHttpServer()) as any)
      [method](path)
      .set('Authorization', `Bearer ${tokenOf(userId)}`)
      .set('x-org-id', opts.org ?? orgA);
    if (opts.mode) req = req.set('x-mode', opts.mode);
    const res =
      method === 'get' || method === 'delete'
        ? await req.send(opts.body)
        : await req.send(opts.body ?? {});
    // Contrato de error único (013): toda respuesta >= 400 es { code, errors: [{ message }] }, sin details.
    if (res.status >= 400) {
      expect(Object.keys(res.body).sort()).toEqual(['code', 'errors']);
      expect(typeof res.body.code).toBe('string');
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(typeof res.body.errors[0].message).toBe('string');
    }
    return res;
  };
  const swap = (text: string, ids: string[]) =>
    ids.reduce((acc, from) => acc.split(from).join(id()), text);

  // ─── (a) ────────────────────────────────────────────────────────────────────
  it('(a) toda ruta con parámetro del AppModule está en ID_ROUTE_CASES (y al revés)', () => {
    const withParams = allRoutes
      .filter((r) => r.template.includes(':'))
      .map((r) => r.key)
      .sort();
    expect(withParams).toEqual(Object.keys(ID_ROUTE_CASES).sort());
  });

  // Feature 011: guardia estructural contra controladores huérfanos. Toda clase @Controller de
  // src/** tiene que estar registrada en un módulo cargado por AppModule; si no,
  // sus rutas responden 404 y nadie revisa que cumplan el aislamiento (005/007/009).
  // Lista blanca (clase -> justificación). Hoy vacía: no hay controladores huérfanos a propósito.
  const ORPHAN_CONTROLLERS_ALLOWLIST: Record<string, string> = {};

  // Se recorre todo src/** (un controlador mal ubicado también cuenta). Se excluyen specs y .d.ts, y
  // los puntos de entrada con efectos al importarse: api/main.ts (llama a bootstrap() y levanta el
  // servidor) e infrastructure.bootstrap/bootstrap.ts (crea la app Nest). Ninguno declara controladores.
  const SIDE_EFFECT_FILES = [
    ['api', 'main.ts'],
    ['infrastructure.bootstrap', 'bootstrap.ts'],
  ].map((parts) => path.join(__dirname, '..', 'src', ...parts));

  it('(a2) todo @Controller de src/** está registrado en un módulo de AppModule', () => {
    const dir = path.join(__dirname, '..', 'src');
    const walkTs = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(d, e.name);
        if (e.isDirectory()) return walkTs(full);
        return e.name.endsWith('.ts') &&
          !e.name.endsWith('.spec.ts') &&
          !e.name.endsWith('.d.ts') &&
          !SIDE_EFFECT_FILES.includes(full)
          ? [full]
          : [];
      });
    const declared: Array<{ name: string; ctrl: any }> = [];
    for (const file of walkTs(dir)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(file);
      for (const [name, exp] of Object.entries(mod)) {
        // @Controller() guarda su path como metadata propia de la clase
        if (
          typeof exp === 'function' &&
          Reflect.hasOwnMetadata(PATH_METADATA, exp)
        ) {
          declared.push({ name, ctrl: exp });
        }
      }
    }
    // la detección no puede quedar vacía por error (p. ej. un cambio de metadata de Nest)
    expect(declared.length).toBeGreaterThan(0);
    const registered = registeredControllers;
    const orphans = declared
      .filter((d) => !registered.has(d.ctrl))
      .map((d) => d.name)
      .filter((n) => !(n in ORPHAN_CONTROLLERS_ALLOWLIST))
      .sort();
    expect(orphans).toEqual([]);
    // la lista blanca no acumula entradas obsoletas
    for (const n of Object.keys(ORPHAN_CONTROLLERS_ALLOWLIST)) {
      expect(declared.some((d) => d.name === n)).toBe(true);
    }
  });

  // ─── (b) ────────────────────────────────────────────────────────────────────
  describe('(b) recurso de otra organización -> 404 genérico sin escrituras; legítimo -> 2xx', () => {
    for (const [key, c] of Object.entries(ID_ROUTE_CASES)) {
      const [method] = key.split(' ');
      it(key, async () => {
        for (const attack of c.attacks) {
          fake.reset();
          const before = fake.writeCount();
          const res = await call(U.admin, method, attack.path, {
            body: attack.body,
          });
          expect({ attack: attack.path, status: res.status }).toEqual({
            attack: attack.path,
            status: 404,
          });
          expect(res.body.code).toBe('not-found');
          expect(res.body.errors).toEqual([{ message: 'No se encontró el recurso.' }]);
          expect(fake.writeCount()).toBe(before);

          // inexistente: mismo cuerpo, byte a byte
          const missingPath = swap(attack.path, attack.foreign);
          const missingBody = attack.body
            ? JSON.parse(swap(JSON.stringify(attack.body), attack.foreign))
            : undefined;
          const missing = await call(U.admin, method, missingPath, {
            body: missingBody,
          });
          expect(missing.status).toBe(404);
          expect(missing.text).toBe(res.text);
          expect(fake.writeCount()).toBe(before);
        }
        fake.reset();
        const ok = await call(U.admin, method, c.legit.path, {
          body: c.legit.body,
        });
        expect({ legit: c.legit.path, status: ok.status }).toEqual({
          legit: c.legit.path,
          status: expect.any(Number),
        });
        expect(ok.status).toBeGreaterThanOrEqual(200);
        expect(ok.status).toBeLessThan(300);
      });
    }

    it('un id que no es UUID da el mismo 404', async () => {
      const bad = await call(U.admin, 'get', p('/activity/abc'));
      const missing = await call(U.admin, 'get', p(`/activity/${id()}`));
      expect(bad.status).toBe(404);
      expect(bad.text).toBe(missing.text);
    });
  });

  // ─── (c) ────────────────────────────────────────────────────────────────────
  describe('(c) escrituras de configuración: solo ADMIN', () => {
    const orgWrites = () =>
      allRoutes.filter((r) => r.ctrl === OrgController && r.method !== 'get');

    it('toda ruta no GET de OrgController declara @RequireOrgRole("ADMIN")', () => {
      expect(orgWrites().length).toBe(14);
      const missing = orgWrites()
        .filter(
          (r) =>
            Reflect.getMetadata(REQUIRED_ORG_ROLE_KEY, r.handler) !== 'ADMIN',
        )
        .map((r) => r.key);
      expect(missing).toEqual([]);
    });

    it.each([
      ['MEMBER', U.member],
      ['profesional sin membresía', U.pro],
      ['profesional sin permiso de carga', U.proNoLoad],
    ])(
      '%s recibe 403 forbidden en todas las escrituras de org/*, sin escrituras',
      async (_n, user) => {
        const bad: string[] = [];
        for (const r of orgWrites()) {
          const path = r.template.replace(/:[A-Za-z]+/g, () => id());
          const before = fake.writeCount();
          const res = await call(user, r.method, path, { body: {} });
          if (
            res.status !== 403 ||
            res.body?.code !== 'forbidden' ||
            fake.writeCount() !== before
          ) {
            bad.push(`${r.key} -> ${res.status}`);
          }
        }
        expect(bad).toEqual([]);
      },
    );

    it('las lecturas de org/* que usan los formularios siguen abiertas a MEMBER y profesional', async () => {
      for (const user of [U.member, U.pro]) {
        for (const path of ['/api/org', '/api/org/activity-types']) {
          const res = await call(user, 'get', path);
          expect({ path, status: res.status }).toEqual({ path, status: 200 });
        }
      }
    });
  });

  // ─── (d) ────────────────────────────────────────────────────────────────────
  describe('(d) ownership de atenciones por HTTP, igual con x-mode org, pro y sin header', () => {
    type Who = 'admin' | 'member' | 'pro';
    const items = [
      'wiMember',
      'wiOther',
      'wiNullPro',
      'wiNullOther',
      'wiPro',
    ] as const;
    // [edit, delete] esperado por usuario y atención (decisión 1 de 00-estado)
    const expected: Record<
      Who,
      Record<(typeof items)[number], [boolean, boolean]>
    > = {
      admin: {
        wiMember: [true, true],
        wiOther: [true, true],
        wiNullPro: [true, true],
        wiNullOther: [true, true],
        wiPro: [true, true],
      },
      member: {
        wiMember: [true, true],
        wiOther: [true, false],
        wiNullPro: [true, false],
        wiNullOther: [true, false],
        wiPro: [true, false],
      },
      pro: {
        wiMember: [false, false],
        wiOther: [false, false],
        wiNullPro: [true, true],
        wiNullOther: [false, false],
        wiPro: [true, true],
      },
    };
    const modes: Array<string | undefined> = ['org', 'pro', undefined];

    for (const who of ['admin', 'member', 'pro'] as Who[]) {
      for (const item of items) {
        it(`${who} sobre ${item}`, async () => {
          const [canEdit, canDelete] = expected[who][item];
          for (const mode of modes) {
            fake.reset();
            const before = fake.writeCount();
            const put = await call(U[who], 'put', p(`/activity/${I[item]}`), {
              body: { attendance: 'PRESENT' },
              mode,
            });
            expect({ who, item, mode, op: 'edit', status: put.status }).toEqual(
              {
                who,
                item,
                mode,
                op: 'edit',
                status: canEdit ? 200 : 403,
              },
            );
            if (!canEdit) {
              expect(put.body.code).toBe('forbidden');
              expect(fake.writeCount()).toBe(before);
            }
            fake.reset();
            const del = await call(
              U[who],
              'delete',
              p(`/activity/${I[item]}`),
              { mode },
            );
            expect({
              who,
              item,
              mode,
              op: 'delete',
              status: del.status,
            }).toEqual({
              who,
              item,
              mode,
              op: 'delete',
              status: canDelete ? 200 : 403,
            });
            if (!canDelete)
              expect(fake.rows('workItem').some((r) => r.id === I[item])).toBe(
                true,
              );
          }
        });
      }
    }

    it('una atención cobrada con fecha de pago no se borra, ni siquiera el ADMIN', async () => {
      const rows = fake.rows('workItem');
      expect(rows.length).toBeGreaterThan(0);
      // se marca como cobrada en la base en memoria
      await call(U.admin, 'put', p(`/activity/${I.wiMember}`), {
        body: { paymentStatus: 'PAID', paymentDate: '2026-02-01' },
      });
      const del = await call(U.admin, 'delete', p(`/activity/${I.wiMember}`));
      expect(del.status).toBe(403);
      expect(fake.rows('workItem').some((r) => r.id === I.wiMember)).toBe(true);
    });
  });

  // ─── (e) ────────────────────────────────────────────────────────────────────
  describe('(e) POST /activity: canLoadActivities y organización', () => {
    const body = (over: Record<string, any> = {}) => ({
      date: '2026-03-01',
      organizationId: orgA,
      patientId: I.ptA1,
      ...over,
    });

    it('profesional con canLoadActivities=true carga a su Professional con x-mode pro o sin header; con x-mode org: 403', async () => {
      for (const mode of ['pro', undefined]) {
        fake.reset();
        const res = await call(U.pro, 'post', p('/activity'), {
          body: body(),
          mode,
        });
        expect({ mode, status: res.status }).toEqual({ mode, status: 201 });
        const created = fake
          .rows('workItem')
          .find(
            (r) =>
              r.createdByUserId === U.pro && !Object.values(I).includes(r.id),
          );
        expect(created?.professionalId).toBe(I.proA);
        expect(created?.organizationId).toBe(orgA);
      }
      // 009: sin membresía no se usa la rama org (criterio 3)
      fake.reset();
      const denied = await call(U.pro, 'post', p('/activity'), {
        body: body(),
        mode: 'org',
      });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('forbidden');
      expect(fake.writeCount()).toBe(0);
    });

    it('profesional con canLoadActivities=false: 403 forbidden sin escrituras, con cualquier x-mode', async () => {
      for (const mode of ['org', 'pro', undefined]) {
        fake.reset();
        const res = await call(U.proNoLoad, 'post', p('/activity'), {
          body: body(),
          mode,
        });
        expect({ mode, status: res.status, code: res.body.code }).toEqual({
          mode,
          status: 403,
          code: 'forbidden',
        });
        expect(fake.writeCount()).toBe(0);
      }
    });

    it('con patientId inexistente: el permiso va primero (false -> 403, true -> 404)', async () => {
      const denied = await call(U.proNoLoad, 'post', p('/activity'), {
        body: body({ patientId: id() }),
      });
      expect(denied.status).toBe(403);
      const passed = await call(U.pro, 'post', p('/activity'), {
        body: body({ patientId: id() }),
      });
      expect(passed.status).toBe(404);
      expect(passed.body.code).toBe('not-found');
      expect(fake.writeCount()).toBe(0);
    });

    it('un profesional no carga a otro Professional', async () => {
      const res = await call(U.pro, 'post', p('/activity'), {
        body: body({ professionalId: I.staffA }),
      });
      expect(res.status).toBe(403);
      expect(fake.writeCount()).toBe(0);
    });

    it.each([
      ['ADMIN', U.admin],
      ['MEMBER', U.member],
    ])('%s carga con un profesional de la organización', async (_n, user) => {
      const res = await call(user, 'post', p('/activity'), {
        body: body({ professionalId: I.staffA }),
        mode: 'org',
      });
      expect(res.status).toBe(201);
    });

    it.each([
      ['patientId', { patientId: I.ptB }],
      ['professionalId', { professionalId: I.proB }],
      ['activityTypeId', { professionalId: I.staffA, activityTypeId: I.atB }],
      ['presetId', { professionalId: I.staffA, presetId: I.presetB }],
      ['payerId', { professionalId: I.staffA, payerId: I.payerB }],
      [
        'participante',
        {
          professionalId: I.staffA,
          participants: [{ professionalId: I.proB, roleLabel: 'Admisor' }],
        },
      ],
    ])(
      '%s de otra organización: 404 genérico sin escrituras',
      async (_n, over) => {
        const res = await call(U.admin, 'post', p('/activity'), {
          body: body(over),
          mode: 'org',
        });
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('not-found');
        expect(fake.writeCount()).toBe(0);
      },
    );

    it('organizationId de una organización sin vínculo: 403 del guard', async () => {
      const res = await call(U.admin, 'post', p('/activity'), {
        body: body({ organizationId: orgB }),
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('org-access-denied');
    });
  });

  // ─── (f) ────────────────────────────────────────────────────────────────────
  it('(f) rutas eliminadas: 404 de Nest', async () => {
    const gone: Array<[string, string]> = [
      ['get', '/api/config/activity-types'],
      ['post', '/api/config/categories'],
      ['put', `/api/config/categories/${id()}`],
      ['delete', `/api/config/activity-types/${id()}`],
      ['get', '/api/config/dictionaries'],
      ['get', '/api/system/professionals?cuit=1'],
      ['get', '/api/pro/payers/lookup?cuit=1'],
      ['get', '/api/settlements'],
      ['get', `/api/settlements/${id()}/details`],
      ['get', '/api/fee-engine/professional-categories'],
      ['delete', `/api/fee-engine/professional-categories/${id()}`],
    ];
    const bad: string[] = [];
    for (const [method, path] of gone) {
      const res = await call(U.admin, method, path, { body: {} });
      if (res.status !== 404) bad.push(`${method} ${path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
    expect(fake.writeCount()).toBe(0);
  });

  // ─── (g) ────────────────────────────────────────────────────────────────────
  describe('(g) contrato del frontend contra org/*', () => {
    it('POST org/categories con { name, percentage } (sin orgId) crea en la organización del request', async () => {
      const res = await call(U.admin, 'post', p('/org/categories'), {
        body: { name: 'Nueva', percentage: 80 },
      });
      expect(res.status).toBe(201);
      expect(
        fake.rows('professionalCategory').find((r) => r.name === 'Nueva')
          ?.organizationId,
      ).toBe(orgA);
    });

    it('POST y PUT org/activity-types con el payload de ActivityTypesManager', async () => {
      const payload = {
        code: 'Sesion Nueva',
        name: 'Sesión nueva',
        baseValue: 100,
        cardValue: 20,
        roles: [
          {
            roleLabel: 'Profesional',
            isRequired: true,
            feeStrategy: 'CATEGORY',
          },
          {
            roleLabel: 'Admisor',
            isRequired: false,
            feeStrategy: 'FIXED',
            fixedPercentage: 10,
          },
        ],
      };
      const created = await call(U.admin, 'post', p('/org/activity-types'), {
        body: payload,
      });
      expect(created.status).toBe(201);
      const row = fake
        .rows('activityType')
        .find((r) => r.name === 'Sesión nueva');
      expect(row?.organizationId).toBe(orgA);
      expect(row?.code).toBe('sesion_nueva');
      const updated = await call(
        U.admin,
        'put',
        p(`/org/activity-types/${row!.id}`),
        { body: payload },
      );
      expect(updated.status).toBe(200);
    });

    it('POST org/presets y POST org/staff crean en la organización del request', async () => {
      const preset = await call(U.admin, 'post', p('/org/presets'), {
        body: { name: 'P', baseValue: 3 },
      });
      expect(preset.status).toBe(201);
      const staff = await call(U.admin, 'post', p('/org/staff'), {
        body: {
          name: 'Nuevo',
          surname: 'Staff',
          cuit: '20999999999',
          categoryId: '',
        },
      });
      expect(staff.status).toBe(201);
      expect(
        fake.rows('professional').find((r) => r.cuit === '20999999999')
          ?.organizationId,
      ).toBe(orgA);
    });

    it('GET org/activity-types usa el header y solo devuelve los de la organización', async () => {
      const res = await call(U.member, 'get', p('/org/activity-types'));
      expect(res.status).toBe(200);
      expect(res.body.map((r: any) => r.id)).toEqual([I.atA]);
    });
  });

  // ─── (h) ────────────────────────────────────────────────────────────────────
  describe('(h) org/staff/lookup acotado a la organización', () => {
    it('CUIT de un profesional de otra organización: NOT_FOUND', async () => {
      const res = await call(
        U.admin,
        'get',
        p(`/org/staff/lookup?cuit=${CUIT.proB}`),
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ type: 'NOT_FOUND' });
    });

    it('CUIT de la organización: respuesta mínima, sin email ni teléfono', async () => {
      const res = await call(
        U.admin,
        'get',
        p(`/org/staff/lookup?cuit=${CUIT.proA}`),
      );
      expect(res.body).toEqual({
        type: 'PROFESSIONAL',
        id: I.proA,
        name: 'Pro A',
        hasUser: true,
      });
    });

    it('exige ADMIN', async () => {
      const res = await call(
        U.member,
        'get',
        p(`/org/staff/lookup?cuit=${CUIT.proA}`),
      );
      expect(res.status).toBe(403);
    });
  });

  // ─── fee-rules y pagadores por HTTP ─────────────────────────────────────────
  describe('POST fee-rules y POST pro/payers por HTTP', () => {
    const rule = (over: Record<string, any> = {}) => ({
      name: 'R',
      professionalCategory: 'all',
      splits: [
        {
          role: 'PROFESSIONAL',
          percentage: 70,
          beneficiaryType: 'PROFESSIONAL',
        },
      ],
      ...over,
    });

    it('pagador de otra organización: 404 sin escrituras', async () => {
      const res = await call(U.admin, 'post', p('/fee-rules'), {
        body: rule({ payer: { connect: { id: I.payerB } } }),
      });
      expect(res.status).toBe(404);
      expect(fake.writeCount()).toBe(0);
    });

    it('el profesional dueño del pagador crea la regla; con un pagador ajeno recibe 403', async () => {
      const ok = await call(U.pro, 'post', p('/fee-rules'), {
        body: rule({ payer: { connect: { id: I.payerA } } }),
      });
      expect(ok.status).toBe(201);
      fake.reset();
      const no = await call(U.pro, 'post', p('/fee-rules'), {
        body: rule({ payer: { connect: { id: I.payerSysA } } }),
      });
      expect(no.status).toBe(403);
      expect(fake.writeCount()).toBe(0);
    });

    it('un body con organization.connect a otra organización se ignora', async () => {
      const res = await call(U.admin, 'post', p('/fee-rules'), {
        body: rule({
          payer: { connect: { id: I.payerA } },
          organization: { connect: { id: orgB } },
        }),
      });
      expect(res.status).toBe(201);
      expect(
        fake.rows('feeRule').find((r) => r.name === 'R')?.organizationId,
      ).toBe(orgA);
    });

    it('POST pro/payers: un MEMBER sin Professional recibe 403; con Professional crea un pagador propio', async () => {
      const denied = await call(U.member, 'post', p('/pro/payers'), {
        body: { name: 'OS Nueva' },
      });
      expect(denied.status).toBe(403);
      expect(fake.writeCount()).toBe(0);
      const own = await call(U.pro, 'post', p('/pro/payers'), {
        body: { name: 'OS Nueva' },
      });
      expect(own.status).toBe(201);
      expect(
        fake.rows('payer').find((r) => r.name === 'OS Nueva')?.professionalId,
      ).toBe(I.proA);
    });
  });

  // ─── (i) ALTA-1: sin x-org-id, la organización sale solo del contexto validado ──
  describe('(i) sin x-org-id y con ?orgId= u ?organizationId= propio: solo datos de esa organización', () => {
    const noHeader = (userId: string, path: string, query?: string) =>
      (request(app.getHttpServer()) as any)
        .get(query ? `${path}${path.includes('?') ? '&' : '?'}${query}` : path)
        .set('Authorization', `Bearer ${tokenOf(userId)}`);
    const QUERIES = [`orgId=${orgA}`, `organizationId=${orgA}`];
    const RANGE = 'startDate=2026-01-01&endDate=2026-01-31&groupBy=day';

    for (const q of QUERIES) {
      describe(`con ?${q.split('=')[0]}=<organización propia>`, () => {
        it('GET pro/payers: solo pagadores de la organización (admin, miembro y profesional)', async () => {
          for (const u of [U.admin, U.member, U.pro]) {
            const res = await noHeader(u, p('/pro/payers'), q);
            expect(res.status).toBe(200);
            expect(res.body.items.length).toBeGreaterThan(0);
            for (const it of res.body.items)
              expect(it.organizationId).toBe(orgA);
            expect(res.body.items.map((x: any) => x.id)).not.toContain(
              I.payerB,
            );
          }
        });

        it('GET dashboard/chart: totales solo de la organización', async () => {
          const res = await noHeader(
            U.admin,
            p('/dashboard/chart'),
            `${q}&${RANGE}`,
          );
          expect(res.status).toBe(200);
          const gross = res.body.reduce((a: number, r: any) => a + r.gross, 0);
          expect(gross).toBe(50); // 5 atenciones de A; con la de B serían 60
        });

        it('GET dashboard/payers: solo pagadores de la organización', async () => {
          const res = await noHeader(
            U.admin,
            p('/dashboard/payers'),
            `${q}&${RANGE}`,
          );
          expect(res.status).toBe(200);
          expect(res.body).toEqual([{ name: 'Particular', value: 50 }]);
        });

        it('GET dashboard/kpis: solo la organización', async () => {
          const res = await noHeader(
            U.admin,
            p('/dashboard/kpis'),
            `${q}&${RANGE}`,
          );
          expect(res.status).toBe(200);
          expect(res.body.accruedGross).toBe(50);
        });

        it('GET fee-rules, v1/patients, activity, org, org/config, org/activity-types y pro/context', async () => {
          const rules = await noHeader(U.admin, p('/fee-rules'), q);
          expect(rules.status).toBe(200);
          expect(rules.body.map((r: any) => r.name)).toEqual(['Regla A']);

          // GET v1/patients usa relaciones que fake-prisma no soporta: se prueba el cableado con el alta
          const created = await (request(app.getHttpServer()) as any)
            .post(p(`/v1/patients?${q}`))
            .set('Authorization', `Bearer ${tokenOf(U.admin)}`)
            .send({ firstName: 'Nuevo', lastName: 'Paciente' });
          expect(created.status).toBe(201);
          expect(
            fake.rows('patient').find((r) => r.firstName === 'Nuevo')
              ?.organizationId,
          ).toBe(orgA);

          const acts = await noHeader(U.admin, p('/activity'), q);
          expect(acts.status).toBe(200);
          expect(JSON.stringify(acts.body)).not.toContain(I.wiB);

          const org = await noHeader(U.admin, p('/org'), q);
          expect(org.status).toBe(200);
          expect(org.body.id).toBe(orgA);

          const cfg = await noHeader(U.admin, p('/org/config'), q);
          expect(cfg.status).toBe(200);
          expect(cfg.body.categories.map((c: any) => c.id)).toEqual([I.catA]);
          expect(cfg.body.presets.map((c: any) => c.id)).toEqual([I.presetA]);

          const types = await noHeader(U.member, p('/org/activity-types'), q);
          expect(types.status).toBe(200);
          expect(types.body.map((t: any) => t.id)).toEqual([I.atA]);

          const ctxRes = await noHeader(U.pro, p('/pro/context'), q);
          expect(ctxRes.status).toBe(200);
          expect(ctxRes.body.id).toBe(I.proA);
        });
      });
    }

    it('PUT org sin header actualiza solo la organización indicada', async () => {
      const res = await (request(app.getHttpServer()) as any)
        .put(p(`/org?orgId=${orgA}`))
        .set('Authorization', `Bearer ${tokenOf(U.admin)}`)
        .send({ name: 'Nuevo Nombre' });
      expect(res.status).toBeLessThan(300);
      expect(fake.rows('organization').find((o) => o.id === orgA)?.name).toBe(
        'Nuevo Nombre',
      );
      expect(fake.rows('organization').find((o) => o.id === orgB)?.name).toBe(
        'Org B',
      );
    });

    it('sin x-org-id ni organización en query: 403 en las rutas con organización', async () => {
      for (const path of [
        '/pro/payers',
        '/dashboard/chart',
        '/dashboard/payers',
        '/dashboard/kpis',
        '/fee-rules',
        '/v1/patients',
        '/activity',
        '/org',
        '/org/config',
        '/org/activity-types',
      ]) {
        const res = await noHeader(U.admin, p(path), RANGE);
        expect({ path, status: res.status }).toEqual({ path, status: 403 });
      }
    });

    it('?orgId= u ?organizationId= de una organización ajena sin header: 403 y sin datos', async () => {
      for (const path of [
        '/pro/payers',
        '/dashboard/chart',
        '/dashboard/payers',
        '/fee-rules',
        '/org/config',
      ]) {
        for (const param of ['orgId', 'organizationId']) {
          const res = await noHeader(
            U.admin,
            p(path),
            `${param}=${orgB}&${RANGE}`,
          );
          expect({ path, param, status: res.status }).toEqual({
            path,
            param,
            status: 403,
          });
          expect(JSON.stringify(res.body)).not.toContain('OS B');
        }
      }
    });

    it('x-org-id propio con ?orgId= ajeno: 403 (el guard valida todas las fuentes)', async () => {
      const res = await call(U.admin, 'get', p(`/pro/payers?orgId=${orgB}`));
      expect(res.status).toBe(403);
    });
  });

  // ─── fee-rules: validación de splits por HTTP (MEDIA-1) y merge sin targetId (BAJA-2) ──
  describe('POST fee-rules con splits inválidos y merge sin targetId', () => {
    const ruleWith = (splits: any) => ({
      name: 'R',
      professionalCategory: 'all',
      payer: { connect: { id: I.payerA } },
      splits,
    });

    it('splits abusivos: 400 genérico y sin escrituras', async () => {
      const cases: any[] = [
        [
          {
            role: 'PROFESSIONAL',
            percentage: 100,
            beneficiaryType: 'PROFESSIONAL',
          },
          {
            role: 'ORGANIZATION',
            percentage: 100,
            beneficiaryType: 'ORGANIZATION',
          },
        ],
        [
          {
            role: 'PROFESSIONAL',
            percentage: -10,
            beneficiaryType: 'PROFESSIONAL',
          },
        ],
        [{ beneficiary: 'PROFESSIONAL', type: 'FIXED', value: -5 }],
        { professional: 70, org: 30 },
        [],
      ];
      for (const c of cases) {
        fake.reset();
        const res = await call(U.pro, 'post', p('/fee-rules'), {
          body: ruleWith(c),
        });
        expect(res.status).toBe(400);
        expect(fake.writeCount()).toBe(0);
      }
    });

    it('splits que genera la UI: 201', async () => {
      const res = await call(U.pro, 'post', p('/fee-rules'), {
        body: ruleWith([
          {
            role: 'PROFESSIONAL',
            percentage: 70,
            beneficiaryType: 'PROFESSIONAL',
          },
          {
            role: 'ORGANIZATION',
            percentage: 30,
            beneficiaryType: 'ORGANIZATION',
          },
        ]),
      });
      expect(res.status).toBe(201);
    });

    it('POST v1/patients/:id/merge con body vacío o targetId inválido: 400 sin escrituras', async () => {
      for (const body of [
        undefined,
        {},
        { targetId: null },
        { targetId: 5 },
        { targetId: '' },
        { targetId: ['x'] },
      ]) {
        fake.reset();
        const res = await (request(app.getHttpServer()) as any)
          .post(p(`/v1/patients/${I.ptA1}/merge`))
          .set('Authorization', `Bearer ${tokenOf(U.admin)}`)
          .set('x-org-id', orgA)
          .send(body);
        expect({ body, status: res.status }).toEqual({ body, status: 400 });
        expect(fake.writeCount()).toBe(0);
      }
    });
  });

  // ─── 009: modo org/pro decidido en el servidor ─────────────────────────────
  // Vínculos de cada perfil en la organización de la URL (X). La tabla de resultados sale de resolveViewMode,
  // el mismo código que la matriz del diseño (§4.2) cubre con it.each en view-mode.spec.ts.
  type Profile = {
    user: string;
    org: string;
    links: ViewLinks;
  };
  const PROFILES: Record<string, Profile> = {
    admin: {
      user: U.admin,
      org: orgA,
      links: { role: 'ADMIN', hasProfessional: false, soloPracticeAdmin: false },
    },
    member: {
      user: U.member,
      org: orgA,
      links: { role: 'MEMBER', hasProfessional: false, soloPracticeAdmin: false },
    },
    pro: {
      user: U.pro,
      org: orgA,
      links: { role: null, hasProfessional: true, soloPracticeAdmin: false },
    },
    adminPro: {
      user: U.adminPro,
      org: orgA,
      links: { role: 'ADMIN', hasProfessional: true, soloPracticeAdmin: false },
    },
    memberPro: {
      user: U.memberPro,
      org: orgA,
      links: { role: 'MEMBER', hasProfessional: true, soloPracticeAdmin: false },
    },
    soloAdmin: {
      user: U.soloAdmin,
      org: orgC,
      links: { role: 'ADMIN', hasProfessional: false, soloPracticeAdmin: true },
    },
  };
  const QUERY_MODES: Array<['ORGANIZATION' | 'PROFESSIONAL' | undefined, 'org' | 'pro' | null]> = [
    ['ORGANIZATION', 'org'],
    ['PROFESSIONAL', 'pro'],
    [undefined, null],
  ];
  const FEB = 'startDate=2026-02-01&endDate=2026-02-28';

  describe('(j) matriz por HTTP: vínculos x modo pedido x ruta', () => {
    type RouteCase = {
      name: string;
      financial: boolean;
      run: (pf: Profile, qm?: string) => any;
      okStatus: number;
    };
    const getWith = (pf: Profile, path: string, qm?: string) =>
      call(pf.user, 'get', p(`${path}${qm ? (path.includes('?') ? '&' : '?') + 'mode=' + qm : ''}`), {
        org: pf.org,
      });
    const routes: RouteCase[] = [
      {
        name: 'GET activity',
        financial: false,
        okStatus: 200,
        run: (pf, qm) => getWith(pf, '/activity', qm),
      },
      {
        name: 'GET v1/patients',
        financial: false,
        okStatus: 200,
        run: (pf, qm) => getWith(pf, '/v1/patients', qm),
      },
      {
        name: 'GET dashboard/kpis',
        financial: true,
        okStatus: 200,
        run: (pf, qm) => getWith(pf, `/dashboard/kpis?${FEB}`, qm),
      },
    ];

    for (const route of routes) {
      for (const [pname, pf] of Object.entries(PROFILES)) {
        it(`${route.name} - ${pname}`, async () => {
          for (const [qm, requested] of QUERY_MODES) {
            fake.reset();
            const expected = resolveViewMode(
              requested,
              pf.links,
              route.financial ? { orgRole: 'ADMIN' } : {},
            );
            const res = await route.run(pf, qm);
            expect({ pname, qm, status: res.status }).toEqual({
              pname,
              qm,
              status: expected ? route.okStatus : 403,
            });
            if (!expected) {
              expect(res.body.code).toBe('forbidden');
              expect(fake.writeCount()).toBe(0);
            }
          }
        });
      }
    }

    for (const [pname, pf] of Object.entries(PROFILES)) {
      it(`POST activity - ${pname}`, async () => {
        const patientId = pf.org === orgC ? I.ptC : I.ptA1;
        for (const [header, requested] of [
          ['org', 'org'],
          ['pro', 'pro'],
          [undefined, null],
        ] as const) {
          fake.reset();
          const expected = resolveViewMode(requested, pf.links);
          // En org se carga con un profesional de la organización; en pro, a su propio Professional.
          const orgStaff = pf.org === orgC ? I.staffC : I.staffA;
          const res = await call(pf.user, 'post', p('/activity'), {
            body: {
              date: '2026-03-01',
              organizationId: pf.org,
              patientId,
              ...(expected === 'org' ? { professionalId: orgStaff } : {}),
            },
            mode: header,
            org: pf.org,
          });
          if (expected) {
            expect({ pname, header, status: res.status, body: res.body.code }).toEqual({
              pname,
              header,
              status: 201,
              body: undefined,
            });
          } else {
            expect({ pname, header, status: res.status }).toEqual({
              pname,
              header,
              status: 403,
            });
            expect(res.body.code).toBe('forbidden');
            expect(fake.writeCount()).toBe(0);
          }
        }
      });
    }

    it('en pro, GET activity solo devuelve atenciones del propio Professional (propias o como participante)', async () => {
      for (const pname of ['pro', 'adminPro', 'memberPro']) {
        const pf = PROFILES[pname];
        const own = fake
          .rows('professional')
          .filter((r) => r.userId === pf.user && r.status === 'ACTIVE' && r.deletedAt === null)
          .map((r) => r.id);
        const parts = fake
          .rows('workItemParticipant')
          .filter((r) => own.includes(r.professionalId))
          .map((r) => r.workItemId);
        const allowed = fake
          .rows('workItem')
          .filter((r) => own.includes(r.professionalId) || parts.includes(r.id))
          .map((r) => r.id)
          .sort();
        const res = await getWith(pf, '/activity', 'PROFESSIONAL');
        expect(res.status).toBe(200);
        expect(res.body.items.map((x: any) => x.id).sort()).toEqual(allowed);
      }
    });

    it('en pro, GET v1/patients: con permiso de carga ve la organización; sin él, solo los que atendió', async () => {
      const withLoad = await getWith(PROFILES.pro, '/v1/patients', 'PROFESSIONAL');
      const ids = withLoad.body.items.map((x: any) => x.id);
      expect(ids).toEqual(expect.arrayContaining([I.ptA1, I.ptA2]));
      expect(ids).not.toContain(I.ptB);
      expect(ids).not.toContain(I.ptC);

      const noLoad = await call(U.proNoLoad, 'get', p('/v1/patients?mode=PROFESSIONAL'));
      expect(noLoad.status).toBe(200);
      // atendió a ptA2 (wkNoLoad) y a nadie más; ptA1 es de la organización pero no lo atendió
      expect(noLoad.body.items.map((x: any) => x.id)).toEqual([I.ptA2]);
    });
  });

  describe('(k) financieros de la organización: solo ADMIN', () => {
    const dash = (user: string, kind: string, extra: string, mode = 'ORGANIZATION') =>
      call(user, 'get', p(`/dashboard/${kind}?${FEB}&groupBy=day&mode=${mode}${extra}`));

    it.each(['admin', 'adminPro'])('%s: dashboard org con los valores conocidos', async (pname) => {
      const user = PROFILES[pname].user;
      const kpis = await dash(user, 'kpis', '');
      expect(kpis.status).toBe(200);
      expect(kpis.body).toEqual({
        accruedGross: 300,
        accruedNet: 110,
        pending: 200,
        cashGross: 100,
        cashNet: 30,
      });
      const chart = await dash(user, 'chart', '');
      expect(chart.status).toBe(200);
      expect(chart.body).toEqual([
        { date: '2026-02-05', gross: 100, net: 30 },
        { date: '2026-02-06', gross: 200, net: 80 },
      ]);
      const payers = await dash(user, 'payers', '');
      expect(payers.status).toBe(200);
      expect(payers.body).toEqual([{ name: 'Particular', value: 300 }]);
    });

    it.each(['member', 'memberPro', 'pro'])('%s: 403 en kpis, chart y payers con mode=ORGANIZATION', async (pname) => {
      for (const kind of ['kpis', 'chart', 'payers']) {
        fake.reset();
        const res = await dash(PROFILES[pname].user, kind, '');
        expect({ kind, status: res.status, code: res.body.code }).toEqual({
          kind,
          status: 403,
          code: 'forbidden',
        });
        expect(JSON.stringify(res.body)).not.toContain('accrued');
      }
    });

    it('vista pro: montos del propio Professional (adminPro en dos organizaciones, memberPro)', async () => {
      const a = await dash(U.adminPro, 'kpis', '', 'PROFESSIONAL');
      expect(a.status).toBe(200);
      expect(a.body).toEqual({
        accruedGross: 140, // wk1 (100) + wkB2 (40, participa en B)
        accruedNet: 75, // 50 + 25
        pending: 25, // wkB2 impaga
        cashGross: 100,
        cashNet: 50,
      });
      const m = await dash(U.memberPro, 'kpis', '', 'PROFESSIONAL');
      expect(m.status).toBe(200);
      expect(m.body).toEqual({
        accruedGross: 200,
        accruedNet: 120,
        pending: 120,
        cashGross: 0,
        cashNet: 0,
      });
      const chart = await dash(U.memberPro, 'chart', '', 'PROFESSIONAL');
      expect(chart.body).toEqual([{ date: '2026-02-06', gross: 200, net: 120 }]);
    });

    it('settlements/calculate: ADMIN 200 (con o sin organizationId propio); MEMBER y profesional 403', async () => {
      const ok = await call(U.admin, 'get', p('/settlements/calculate?month=2026-02'));
      expect(ok.status).toBe(200);
      expect(Array.isArray(ok.body)).toBe(true);
      const own = await call(
        U.admin,
        'get',
        p(`/settlements/calculate?month=2026-02&organizationId=${orgA}`),
      );
      expect(own.status).toBe(200);
      const both = await call(U.adminPro, 'get', p('/settlements/calculate?month=2026-02'));
      expect(both.status).toBe(200);
      for (const user of [U.member, U.memberPro, U.pro]) {
        const res = await call(user, 'get', p('/settlements/calculate?month=2026-02'));
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('forbidden');
      }
    });

    it('settlements/calculate con organizationId de otra organización: 403 del guard y sin datos', async () => {
      const res = await call(
        U.admin,
        'get',
        p(`/settlements/calculate?month=2026-02&organizationId=${orgB}`),
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('org-access-denied');
    });
  });

  describe('(l) estructural: rutas con @UsesViewMode', () => {
    it('el conjunto es exactamente el esperado, con orgRole ADMIN en las tres del dashboard', () => {
      const marked = allRoutes
        .filter((r) => Reflect.getMetadata(VIEW_MODE_KEY, r.handler) !== undefined)
        .map((r) => ({
          key: r.key,
          options: Reflect.getMetadata(VIEW_MODE_KEY, r.handler),
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
      expect(marked).toEqual(
        [
          { key: 'get /api/activity', options: {} },
          { key: 'post /api/activity', options: {} },
          { key: 'get /api/dashboard/chart', options: { orgRole: 'ADMIN' } },
          { key: 'get /api/dashboard/kpis', options: { orgRole: 'ADMIN' } },
          { key: 'get /api/dashboard/payers', options: { orgRole: 'ADMIN' } },
          { key: 'get /api/v1/patients', options: {} },
        ].sort((a, b) => a.key.localeCompare(b.key)),
      );
    });

    it('settlements/calculate exige ADMIN por metadata', () => {
      const route = allRoutes.find((r) => r.key === 'get /api/settlements/calculate');
      expect(route).toBeDefined();
      expect(Reflect.getMetadata(REQUIRED_ORG_ROLE_KEY, route!.handler)).toBe('ADMIN');
    });
  });

  describe('(m) valores de modo', () => {
    it.each([
      ['?mode=xyz', '/activity?mode=xyz', undefined],
      ['?mode=a&mode=b', '/activity?mode=a&mode=b', undefined],
      ['header pro con query ORGANIZATION', '/activity?mode=ORGANIZATION', 'pro'],
    ])('%s: 400 invalid-mode', async (_n, path, header) => {
      const res = await call(U.adminPro, 'get', p(path), { mode: header });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid-mode');
    });

    it('header y query equivalentes (pro / PROFESSIONAL): 200', async () => {
      const res = await call(U.adminPro, 'get', p('/activity?mode=PROFESSIONAL'), {
        mode: 'pro',
      });
      expect(res.status).toBe(200);
    });

    it('?mode=org en GET fee-rules (ruta sin decorador): 200, se ignora', async () => {
      const res = await call(U.admin, 'get', p('/fee-rules?mode=org'));
      expect(res.status).toBe(200);
      const garbage = await call(U.admin, 'get', p('/fee-rules?mode=xyz'));
      expect(garbage.status).toBe(200);
    });
  });

  describe('(n) lecturas por id de un profesional sin membresía y vista pro multi-organización', () => {
    it('GET activity/:id: propias 200; de otro profesional el mismo 404 que un id inexistente', async () => {
      for (const own of [I.wiPro, I.wiNullPro]) {
        const ok = await call(U.pro, 'get', p(`/activity/${own}`));
        expect({ own, status: ok.status }).toEqual({ own, status: 200 });
      }
      const foreign = await call(U.pro, 'get', p(`/activity/${I.wiMember}`));
      const missing = await call(U.pro, 'get', p(`/activity/${id()}`));
      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(foreign.text).toBe(missing.text);
      expect(foreign.body.code).toBe('not-found');
      // un MEMBER sigue leyendo cualquier atención de su organización
      const member = await call(U.member, 'get', p(`/activity/${I.wiNullOther}`));
      expect(member.status).toBe(200);
    });

    it('patients/:id/summary y /debt: con permiso de carga, los de la organización; de otra organización: 404', async () => {
      for (const kind of ['summary', 'debt']) {
        const ok = await call(U.pro, 'get', p(`/v1/patients/${I.ptA1}/${kind}`));
        expect({ kind, status: ok.status }).toEqual({ kind, status: 200 });
        const other = await call(U.pro, 'get', p(`/v1/patients/${I.ptB}/${kind}`));
        const missing = await call(U.pro, 'get', p(`/v1/patients/${id()}/${kind}`));
        expect(other.status).toBe(404);
        expect(other.text).toBe(missing.text);
      }
    });

    it('sin permiso de carga: solo pacientes que atendió; el resto, el mismo 404', async () => {
      for (const kind of ['summary', 'debt']) {
        const attended = await call(U.proNoLoad, 'get', p(`/v1/patients/${I.ptA2}/${kind}`));
        expect({ kind, status: attended.status }).toEqual({ kind, status: 200 });
        const notAttended = await call(U.proNoLoad, 'get', p(`/v1/patients/${I.ptA1}/${kind}`));
        const missing = await call(U.proNoLoad, 'get', p(`/v1/patients/${id()}/${kind}`));
        expect(notAttended.status).toBe(404);
        expect(notAttended.text).toBe(missing.text);
      }
      const act = await call(U.proNoLoad, 'get', p(`/activity/${I.wkNoLoad}`));
      expect(act.status).toBe(200);
      const actForeign = await call(U.proNoLoad, 'get', p(`/activity/${I.wiPro}`));
      expect(actForeign.status).toBe(404);
    });

    it('MEDIA-1: paciente atendido por dos profesionales; sin membresía solo ve lo suyo (resumen, deuda, listado)', async () => {
      const summary = await call(U.proNoLoad, 'get', p(`/v1/patients/${I.ptA2}/summary`));
      expect(summary.status).toBe(200);
      expect(summary.body.pendingItems.map((x: any) => x.id)).toEqual([I.wkNoLoad]);
      expect(summary.body.totalDebt).toBe(30);
      expect(summary.text).not.toContain('7777');
      const debt = await call(U.proNoLoad, 'get', p(`/v1/patients/${I.ptA2}/debt`));
      expect(debt.status).toBe(200);
      expect(Number(debt.text)).toBe(30);
      // el miembro sigue viendo todo
      const member = await call(U.member, 'get', p(`/v1/patients/${I.ptA2}/summary`));
      expect(member.body.totalDebt).toBe(30 + 7777);
      expect(Number((await call(U.member, 'get', p(`/v1/patients/${I.ptA2}/debt`))).text)).toBe(30 + 7777);
      // con permiso de carga, sin membresía: tampoco ve lo ajeno
      const withLoad = await call(U.pro, 'get', p(`/v1/patients/${I.ptA2}/summary`));
      expect(withLoad.status).toBe(200);
      expect(withLoad.text).not.toContain('7777');
    });

    it('miembro: lee pacientes y atenciones de su organización sin restricción adicional', async () => {
      for (const user of [U.member, U.admin]) {
        const res = await call(user, 'get', p(`/v1/patients/${I.ptA1}/summary`));
        expect(res.status).toBe(200);
      }
    });

    it('adminPro en pro (x-org-id A) ve su atención de B como externa y no las de B de otros', async () => {
      const res = await call(U.adminPro, 'get', p('/activity?mode=PROFESSIONAL'));
      expect(res.status).toBe(200);
      const byId = new Map(res.body.items.map((x: any) => [x.id, x]));
      expect([...byId.keys()].sort()).toEqual([I.wk1, I.wkB2].sort());
      expect((byId.get(I.wkB2) as any).isExternal).toBe(true);
      expect((byId.get(I.wkB2) as any).netAmount).toBe(25);
      expect((byId.get(I.wk1) as any).isExternal).toBe(false);
      expect((byId.get(I.wk1) as any).netAmount).toBe(50);
      expect(byId.has(I.wiB)).toBe(false);
    });

    it('proDeleted en pro no ve las atenciones de su Professional dado de baja', async () => {
      const res = await call(U.proDeleted, 'get', p('/activity?mode=PROFESSIONAL'));
      expect(res.status).toBe(200);
      expect(res.body.items.map((x: any) => x.id)).not.toContain(I.wkDelB);
      expect(res.body.items).toEqual([]);
    });
  });
});
