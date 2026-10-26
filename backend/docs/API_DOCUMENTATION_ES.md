# Documentación de la API de HealthOps

## URLs base por ambiente
- Desarrollo: `http://localhost:3000/`
- Producción: [INSERTAR DATO FALTANTE]

## Autenticación
Las APIs están aseguradas utilizando JWT (JSON Web Tokens). Se debe incluir un Bearer Token dentro del encabezado `Authorization` HTTP.

## Endpoints principales agrupados por categoría

### Autenticación
- `POST /v1/auth/login`: Autentica al usuario ingresado en el sistema y retorna sus tokens de acceso temporal.

### Actividad y Reporting
- `GET/POST /activity`: Gestiona la administración de servicios provistos (sesiones y admisiones).
- `GET /my-production`: Obtiene las métricas en torno a la actividad y producción realizada por un profesional.
- `GET /work-items/reporting`: Entrega información tabulada sobre los artículos de trabajo completados en forma condensada.

### Pacientes
- `GET /v1/patients`: Obtiene un listado de perfiles de pacientes de la clínica.
- `POST /v1/patients`: Realiza la alta o registro de un paciente sin antecedentes.
- `GET /v1/patients/:id`: Recupera información estructurada para un paciente en concreto.

### Motor de Honorarios y Liquidaciones
- `GET/POST /fee-rules`: Administra la información configurada que inflige variaciones de costos a los referidos servicios.
- `GET/POST /fee-engine/professional-categories`: Gestión sobre agrupadores en relación a los profesionales.
- `GET /settlements`: Carga los perfiles monetarios emitidos en ciclos de facturación o cobros.

### Configuración y Perfiles
- `GET /profile`: Captura todos los datos funcionales y asignaciones que identifican al propio operador logueado.
- `GET/POST /org`: Expande la gestión estructural frente a datos referentes a toda la organización del servicio.
- `GET/POST /config` y `/system`: Manipulan opciones administrativas fundamentales y listas maestras usadas globalmente.
- `GET/POST /pro`: Expone funciones para la creación y manipulación de los perfiles de profesionales activos y pasivos.
