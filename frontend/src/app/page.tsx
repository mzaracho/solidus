import { redirect } from 'next/navigation'
import { ROUTES } from '@/lib/constants'
import { getServerSessionIdentity } from '@/services/session.server'

// Inicio: decide el destino segun la identidad de la cookie de sesion (leida en el servidor, sin verificar firma;
// el backend es la autoridad). Sin sesion, login (el middleware ya lo cubre).
export default async function Home() {
  const identity = await getServerSessionIdentity()
  if (!identity.userId) redirect(ROUTES.LOGIN)

  const orgId = identity.organizationId
  if (!orgId) {
    // Sesion valida sin organizacion: pantalla explicativa en lugar del rebote mudo al login.
    redirect(ROUTES.NO_ACCESS)
  }
  if (identity.orgRole === 'MEMBER') {
    const hasProfessionalRole = identity.roles.some((r) => r.code === 'PROFESSIONAL')
    redirect(hasProfessionalRole ? `/${orgId}/pro/atenciones` : `/${orgId}/org/admisiones`)
  }
  redirect(`/${orgId}/dashboard`)
}
