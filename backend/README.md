# HealthOps Backend

## What it contains and what it is used for
The HealthOps backend provides the core APIs and business logic for managing health clinic operations. It handles activities (sessions, admissions), patient records, professional fees, organization configurations, and user authentication.

## Team Contacts
- Project Leader: [PENDIENTE - actualizar]
- Product Owner: [PENDIENTE - actualizar]
- Communication Channel: [PENDIENTE - actualizar]
- Confluence: [PENDIENTE - actualizar]
- Jira: [PENDIENTE - actualizar]
- Developers: [INSERTAR DATO FALTANTE]

## Project Status
In Development

## Tech Stack
- Framework: NestJS (Node.js)
- Database ORM: Prisma
- Authentication: JWT, bcrypt
- API Specs: Swagger/OpenAPI

## Main Dependencies
- @nestjs/core, @nestjs/common
- @prisma/client
- passport, bcrypt, jsonwebtoken

## Basic Installation
1. Install dependencies: `npm install`
2. Setup environment variables (`.env`)
3. Run database migrations: `npx prisma db push`
4. Start dev server: `npm run start:dev`

## Additional Documentation
- [System Overview](docs/OVERVIEW.md)
- [API Documentation](docs/API_DOCUMENTATION.md)
