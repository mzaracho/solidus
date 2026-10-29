# Cargador de la biblioteca de dev.ps1: carga los modulos de scripts/ en el ambito de quien lo invoca (dot-source).
# Uso: . .\scripts\dev-lib.ps1  (lo usan dev.ps1 y dev-lib.tests.ps1). Sin efectos al cargarse (solo define funciones).
# Compatible con Windows PowerShell 5.1 y PowerShell 7.
#
# Modulos (el orden solo importa para las constantes de arriba de cada archivo):
#   dev-lib.core.ps1     constantes, mensajes y errores, procesos nativos, HTTP
#   dev-lib.dotenv.ps1   lectura de .env (sin dependencias; es lo unico que carga el hook pre-commit)
#   dev-lib.env.ps1      escritura segura de .env, permisos (ACL), .env de la raiz y backend/.env, BIND_ADDRESS
#   dev-lib.docker.ps1   compose, daemon local, prerrequisitos
#   dev-lib.process.ps1  puertos, npm install, ventanas y PIDs, prueba de humo
#   dev-lib.db.ps1       Postgres, seeds, usuario de humo, rotaciones
#   dev-lib.ca.ps1       CA extra para los builds y -ExportCa
#   dev-lib.hooks.ps1    activacion del hook pre-commit

foreach ($devLibModule in 'core', 'dotenv', 'env', 'docker', 'process', 'db', 'ca', 'hooks') {
    . (Join-Path $PSScriptRoot ('dev-lib.{0}.ps1' -f $devLibModule))
}
Remove-Variable -Name devLibModule -ErrorAction SilentlyContinue
