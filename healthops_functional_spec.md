# HealthOps - Especificación Funcional Completa

Este documento detalla el funcionamiento integral de HealthOps, una plataforma diseñada para la gestión operativa y financiera de clínicas de salud (Organizaciones) y profesionales independientes.

---

## 1. Perfiles de Usuario y Roles

### 1.1 Dentro de una Organización (OrgRole)
Las organizaciones cuentan con dos tipos de perfiles internos:

| Perfil | Acceso a Dashboard | Gestión de Pacientes/Actividades | Liquidaciones | Reglas de Honorarios |
| :--- | :---: | :---: | :---: | :---: |
| **Admin** | ✅ | ✅ | ✅ | ✅ |
| **Member** | ❌ | ✅ | ❌ | ❌ |

- **Admin (ej. Marisol/Directora)**: Tiene control total sobre la configuración de la clínica, visualización de métricas financieras y cierre de pagos a profesionales.
- **Member (ej. Lionel/Administrativo)**: Se encarga de la carga diaria de datos, gestión de turnos y pacientes, pero no tiene visibilidad sobre los números globales del negocio.

### 1.2 Profesionales Independientes
- Los profesionales (ej. Camila) operan en su propio entorno, cargando sus pacientes particulares y sus propios pagadores (Obras Sociales).
- Pueden vincularse a organizaciones externas para formar parte de su red de atención.

---

## 2. Gestión de Entidades y Relaciones

### 2.1 Organizaciones vs Pagadores
- **Autonomía del Profesional**: Un profesional carga sus propios pagadores (Razon Social + CUIT). Si el CUIT no está en el sistema, configura manualmente el % de retención.
- **Vínculo con Organización**: Si el profesional ingresa el CUIT de una organización registrada en HealthOps (ej. Psico LSA), el sistema bloquea el alta manual. El vínculo **debe ser gestionado por la organización**.
- **Jerarquía de Reglas**: Una vez vinculados, el % de retención es definido por la administración de la organización y el profesional no puede editarlo.

### 2.2 Relación Profesional-Usuario
- **Profesional con Usuario**: Tiene acceso al sistema con su propio mail y gestiona su propia agenda.
- **Identidad Única (CUIT/CUIL)**: Un profesional se identifica unívocamente por su CUIT/CUIL. Un mismo usuario profesional puede estar vinculado a múltiples organizaciones simultáneamente.
- **Vínculo Multi-Organización**: El profesional verá en su panel de "Pagadores" a todas las organizaciones que lo hayan dado de alta en su red.
- **Profesional sin Usuario**: Es gestionado enteramente por la organización (ej. Martin/Belen). Son profesionales que no interactúan con el software, pero cuyos honorarios y actividades deben ser liquidados por la clínica. El CUIT permite unificar el perfil si en el futuro se registra.

### 2.3 Visibilidad de Pacientes
- Un profesional ve los pacientes que él mismo creó.
- Un profesional ve los pacientes creados por una organización (Admin/Member) **solo si existe una actividad** que lo vincule con dicho paciente.

---

## 3. Gestión de Actividades (WorkItems)

### 3.1 Carga por el Profesional (Modo Pro)
- **Selecciones**: Paciente, Fecha, Pagador (u opción "Paciente Particular").
- **Particular**: Si se marca como particular, el profesional percibe el 100% (retención 0). Se genera un registro de "Split" al 100% para mantener la consistencia en los reportes financieros.
- **Cálculo Neto**: `Monto Bruto - % Retención del Pagador/Org`.
- **Estados de Pago**: 
    - **Pendiente**: Permite edición y eliminación.
    - **Pagado**: Bloquea edición/eliminación (solo permite cambiar asistencia). Requiere fecha de cobro y medio de pago (Efectivo, Transferencia, Tarjeta).

### 3.2 Carga por la Organización (Modo Org)
- **Actividad / Prestación**: Se selecciona el tipo de servicio (ej. Sesión, Admisión).
- **Múltiples Profesionales**: Cada actividad puede requerir hasta 3 profesionales con roles específicos (ej. Admisor, Coadmisor, Intérprete).
- **Monto**: Precargado según la actividad (base), pero editable.
- **Cálculo de Ganancia Org**: Es el remanente después de asignar los honorarios a todos los profesionales involucrados.

---

## 4. Motor de Honorarios (Fee Rules)

Se definen dos estrategias para determinar cuánto cobra cada profesional en una actividad de la organización:

1.  **Por Categoría**: El profesional tiene asignada una categoría (Senior, Junior, Staff) con un % predefinido.
2.  **Por Rol en Actividad**: Se asigna un % fijo para un rol específico (ej. "Coadmisor" cobra el 30% del valor base), ignorando la categoría individual del profesional.

### 4.1 Lógica de Pagos con Tarjeta
- **Cálculo de Honorario**: El honorario del profesional se calcula **siempre sobre el Valor Base** de la actividad.
- **Diferencial de Tarjeta**: Si la actividad tiene un "Valor Tarjeta" superior al "Valor Base", la diferencia es retenida íntegramente por la organización.
  - *Ejemplo*: Base $1000, Tarjeta $1200, Honorario 30%. El profesional recibe $300 sin importar si se cobró el base o el de tarjeta.

---

## 5. Liquidaciones y Finanzas

### 5.1 Dashboard y Liquidaciones
- Exclusivo para el perfil **Admin**.
- Permite ver por mes/rango: Nombre del profesional, total base generado y monto final a pagar.
- Detalle: Acceso a cada actividad individual que compone el total.

### 5.2 Gestión de Deudores
- Tanto organizaciones como profesionales tienen una vista general de pacientes "Al día" vs "Deudores" basada en el estado de pago de las actividades cargadas.

---

## 6. Reglas de Negocio Críticas
- **Unicidad de Usuario**: Cada usuario debe tener un email único. Se descarta el concepto de usuarios compartidos en multi-contexto (V1).
- **Inmutabilidad de Cobros**: Una actividad marcada como cobrada no puede ser eliminada. Esto garantiza la integridad de los reportes financieros.
- **Asistencia**: Si una actividad está pendiente, se puede marcar asistencia y cobro en un solo paso.
