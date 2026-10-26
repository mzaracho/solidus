# HealthOps Frontend - Guía de Reutilización

## Modelos / DTOs principales
- Los modelos de datos en el cliente espejan los definidos en el backend (ej: `Patient`, `Activity`, `FeeRule`). Estas definiciones asientan de forma local los estándares del dominio.
- Las definiciones en TypeScript ligadas a la configuración global de Zustand unifican contextos compartidos al largo de múltiples vistas y paneles de la clínica.

## Servicios reutilizables
- **Exportadores Hook Fetch (TanStack Query)**: Llamadas API encapsuladas detrás de hooks (ej: `useGetPatients`, `useCreateActivity`) permitiendo reusabilidad máxima de la política de retrys, cachés e invalidaciones al renderizar.

## Utilidades disponibles
- **Componentes Base de Estilo (`src/components/ui`)**: Derivados de Radix UI y envueltos nativamente con clases tailwind-merge. Incluye utilidades completas como `Button`, `Dialog`, `Select`, `Table` o notificaciones con el componente `Toast`.
- **Validadores de Formularios**: Rutinas limpias que operan sobre la interacción de selectores personalizados.
- **Formato de Fechas**: Analizadores estandarizados alrededor de la librería `date-fns` limitando discrepancias estéticas de hora y fecha.

## Guía de cómo adaptar para otros proyectos
1. **Extracción y Uso de UI Primitiva**: Recuperar íntegramente `src/components/ui/` y emplearlo como capa de primitivas base es completamente seguro al usarlo libremente en otros sistemas; requiere la misma base de soporte (Tailwind/Radix).
2. **Reubicación de Peticiones**: Los proveedores estándar de `react-query` posibilitan refactorizaciones sin alterar la vista manteniendo idénticas duraciones límite en el caché global al iniciar transiciones de cliente.
3. Bastaría alterar las rutas URI en las instancias globales de red para mantener operativos los hooks de estado.
