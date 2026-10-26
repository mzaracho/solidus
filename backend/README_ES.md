# HealthOps Backend

## Qué contiene el código y para qué se utiliza
El backend de HealthOps proporciona las APIs principales y la lógica funcional para administrar las operaciones de las clínicas de salud. Gestiona la carga de actividades (sesiones de pacientes), el registro e historial, los honorarios de los profesionales, configuraciones de la organización y la autenticación.

## A quién dirigirse
- Project Leader: [PENDIENTE - actualizar]
- Product Owner: [PENDIENTE - actualizar]
- Canal de comunicación: [PENDIENTE - actualizar]
- Confluence: [PENDIENTE - actualizar]
- Jira: [PENDIENTE - actualizar]
- Developers: [INSERTAR DATO FALTANTE]

## Estado del proyecto
En Desarrollo

## Stack tecnológico
- Framework: NestJS (Node.js)
- Base de datos y ORM: Prisma
- Autenticación: JWT, bcrypt
- Especificaciones de API: Swagger/OpenAPI

## Dependencias principales
- @nestjs/core, @nestjs/common
- @prisma/client
- passport, bcrypt, jsonwebtoken

## Instalación básica
1. Instalar dependencias mediante NPM: `npm install`
2. Configurar las variables de entorno en archivo: `.env`
3. Ejecutar las migraciones a la BD: `npx prisma db push`
4. Iniciar el servidor local: `npm run start:dev`

## Links a documentación adicional
- [Visión General del Sistema](docs/OVERVIEW_ES.md)
- [Documentación de la API](docs/API_DOCUMENTATION_ES.md)
