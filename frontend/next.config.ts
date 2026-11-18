import type { NextConfig } from "next";

// Sin rewrite /api: el navegador llama a la API de forma directa (cookie de sesion HttpOnly, 018); un proxy de Next
// haria que el backend vea la IP del servidor Next en el rate limit del login (012).
const nextConfig: NextConfig = {};

export default nextConfig;
