# HealthOps Frontend - Component Reuse Guide

## Main Models & DTOs
- Frontend data models mirror backend definitions (e.g., `Patient`, `Activity`, `FeeRule`). These definitions are localized within the application domain directories.
- Zustand slice typings define unified interface standards representing specific data contexts across all views.

## Reusable Services
- **Data Hook Exporters (TanStack Query)**: Encapsulated API fetch calls abstracted behind hooks (e.g., `useGetPatients`, `useCreateActivity`) to reuse caching, retry policies, and automated invalidation keys consistently.

## Available Utilities
- **Styled Primitive components (`src/components/ui`)**: Derived from Radix UI and wrapped with pure Tailwind CSS. Examples include `Button`, `Dialog`, `Select`, `Table`, and `Toast`.
- **Form Helpers & Validations**: Generic data handlers to map values safely.
- **Date Formatting**: Specialized parsers utilizing `date-fns` to reliably showcase timeframes without redundancy.

## How to Adapt for Other Projects
1. **Styling Structure Reusability**: Extracting `src/components/ui/` completely functions safely as a standalone unbranded design-system primitive library. Replace Tailwind configs inside `tailwind-merge` implementations if integrating on another baseline.
2. **Query Refactoring**: Extract standard `react-query` providers keeping identical global caching times limit setups.
3. Replace base API URIs inside centralized Axios configurations / fetch wrappers leaving logic hooks totally intact.
