import type { NextConfig } from "next";

// Sin rewrite /api: el navegador llama a la API de forma directa (cookie de sesion HttpOnly, 018); un proxy de Next
// haria que el backend vea la IP del servidor Next en el rate limit del login (012).
//
// agentUpgrade: false (021): desactiva el aviso de actualizacion de Next (consulta al registro de npm en cada
// `next dev`/`next build`). Con la politica por defecto ('security'), si hay un aviso para la version instalada,
// un agente de IA recibe SecurityFatalError en el primer comando y una persona ve un menu interactivo que puede
// dejar `dev.ps1` esperando una respuesta. Los avisos de seguridad de Next se siguen viendo con `npm audit`.
const nextConfig: NextConfig = {
  experimental: {
    agentUpgrade: false,
  },
};

export default nextConfig;
