import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CategoryManager } from "@/components/domain/settings/CategoryManager"
import { ActivityTypesManager } from "@/components/domain/settings/ActivityTypesManager"

export default function CategoriesPage() {
    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">Configuración General</h2>
            </div>

            <Tabs defaultValue="prestaciones" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="prestaciones">Prestaciones</TabsTrigger>
                    <TabsTrigger value="categories">Categorías</TabsTrigger>
                </TabsList>
                <TabsContent value="prestaciones" className="space-y-4">
                    <div className="rounded-md border p-6">
                        <h3 className="text-lg font-medium mb-4">Tipos de Prestaciones</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            Configura las prestaciones con sus roles de profesionales y estrategias de honorarios.
                        </p>
                        <ActivityTypesManager />
                    </div>
                </TabsContent>
                <TabsContent value="categories" className="space-y-4">
                    <div className="rounded-md border p-6">
                        <h3 className="text-lg font-medium mb-4">Gestión de Categorías</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            Define las categorías y el porcentaje por defecto que recibe el profesional.
                        </p>
                        <CategoryManager />
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    )
}
