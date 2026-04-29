@echo off
title MARCTERNOS Panel
echo ===============================================
echo      MARCTERNOS MINECRAFT PANEL - START
echo ===============================================
echo.

:: Verificar si node_modules existe, si no, instalar dependencias
if not exist node_modules (
    echo [INFO] No se encontro la carpeta node_modules. Instalando dependencias...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Hubo un problema instalando las dependencias.
        pause
        exit /b %errorlevel%
    )
)

echo [INFO] Iniciando el servidor de la API...
node src/server.js

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] El servidor se ha detenido de forma inesperada.
    pause
)
