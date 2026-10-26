# HealthOps API Documentation

## Base URLs by Environment
- Development: `http://localhost:3000/`
- Production: [INSERTAR DATO FALTANTE]

## Authentication
APIs are secured using JWT (JSON Web Tokens). A Bearer token must be included in the `Authorization` header for protected endpoints.

## Main Endpoints Grouped by Category

### Authentication
- `POST /v1/auth/login`: Authenticate users and return access tokens.

### Activity & Reporting
- `GET/POST /activity`: Manage professional load assignments (sessions, admissions).
- `GET /my-production`: Retrieve activity metrics and production reporting for a connected professional.
- `GET /work-items/reporting`: Deliver summarized outcome variations of business work items.

### Patients
- `GET /v1/patients`: Retrieve a list of active patients.
- `POST /v1/patients`: Register new patient details.
- `GET /v1/patients/:id`: Retrieve specific patient details in depth.

### Fee Engine & Settlements
- `GET/POST /fee-rules`: Manage the financial rules applying strictly to organization services.
- `GET/POST /fee-engine/professional-categories`: Manage grouping categories for tracking professional fees.
- `GET /settlements`: Access settlement billing and generated payment cycles.

### Configuration & Profiles
- `GET /profile`: Obtain the authenticated user internal profile attributes.
- `GET/POST /org`: Manage overall configuration details for the global organization entity.
- `GET/POST /config` & `/system`: Handle application-wide settings and administrative enumerations.
- `GET/POST /pro`: Administer professional user directories and access settings.
