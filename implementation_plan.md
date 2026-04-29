# Implementation Plan - Panel Multi-Instancia + Versiones Dinamicas + Endpoint Publico (Docker/Tailscale)

## Objetivo
Construir un panel "padre" que gestione multiples instancias (mundos/servidores), con catalogo de versiones actualizado automaticamente y deteccion correcta del endpoint publico cuando se ejecuta en Docker con Tailscale.

---

## Alcance funcional
1. Gestion de multiples instancias desde una sola UI.
2. Contexto activo por instancia en todas las paginas actuales.
3. Creacion de nuevos mundos sin borrar los existentes.
4. Selector de versiones dinamico (fuentes oficiales + cache).
5. Endpoint publico real (host/puerto externo), separado del interno.

---

## Fase 0 - Preparacion y baseline (3h)

### Tareas
- Congelar baseline (ramas, backup de `data/servers`).
- Añadir feature flags basicas para rollout parcial (`MULTI_INSTANCE_ENABLED`, `DYNAMIC_CATALOG_ENABLED`).
- Definir contrato de `instanceId` en API (query/header/path).

### Archivos
- `src/config/config.js`
- `src/server.js`
- `README.md`

### Entregables
- Flags de activacion documentadas.
- Compatibilidad con flujo actual si flags desactivadas.

---

## Fase 1 - Modelo de datos multi-instancia (8h)

### Tareas
- Crear repositorio de instancias (JSON persistente).
- Estructura recomendada:
  - `data/instances/registry.json`
  - `data/instances/<instanceId>/...`
- Migracion inicial:
  - Detectar `data/servers/world` y registrarla como `default`.
- Utilidades de acceso:
  - `getInstance(instanceId)`
  - `listInstances()`
  - `getInstancePath(instanceId)`

### Archivos
- `src/services/instanceRegistryService.js` (nuevo)
- `src/server.js`
- `src/config/config.js`

### API nueva
- `GET /api/instances`
- `POST /api/instances`
- `GET /api/instances/:id`
- `PATCH /api/instances/:id`
- `DELETE /api/instances/:id`

---

## Fase 2 - Refactor backend por `instanceId` (16h)

### Tareas
- Sustituir dependencias de "primer servidor" por contexto de instancia.
- Refactor de endpoints existentes para aceptar `instanceId`:
  - status/start/stop/restart
  - players/player detail/ban/op/whitelist
  - properties
  - files/upload/download/edit
  - create-world
- Aislar estado runtime por instancia:
  - `mcProcess` por instancia (mapa)
  - `serverState` por instancia (mapa)
  - caches de jugadores por instancia

### Archivos
- `src/server.js` (principal)
- `src/services/runtimeStateService.js` (nuevo)
- `src/services/playerStateService.js` (nuevo opcional)

### Riesgo tecnico
- Evitar que comandos de una instancia impacten otra.

---

## Fase 3 - Panel padre de instancias (14h)

### Tareas
- Nueva pantalla de instancias (cards con estado y acciones).
- Seleccion de instancia activa global.
- Navegacion al panel actual con contexto (`?instanceId=`).
- Acciones por instancia:
  - iniciar/parar/reiniciar
  - abrir panel
  - duplicar
  - eliminar

### Archivos
- `instances.html` (nuevo)
- `js/instances.js` (nuevo)
- `css/instances.css` (nuevo)
- `index.html` (enlace al panel de instancias)
- `js/global-controls.js` (propagacion de `instanceId`)

### UX minima
- Badge Online/Offline.
- Version, software, jugadores online, endpoint publico.

---

## Fase 4 - Adaptacion de paginas actuales al contexto (10h)

### Tareas
- Añadir lectura de `instanceId` en frontend actual.
- Todas las llamadas `fetch` deben incluir instancia activa.
- Mantener fallback a `default` si no se envia `instanceId`.

### Archivos
- `js/app.js`
- `js/players.js`
- `js/player.js`
- `js/properties.js`
- `js/creation.js`
- `js/gamerules.js`
- `js/addons.js`
- `js/files.js` (si aplica)

---

## Fase 5 - Catalogo dinamico de versiones (12h)

### Tareas
- Servicio de catalogo con TTL y cache en disco.
- Fuentes por software:
  - Vanilla
  - Paper
  - Fabric
  - Forge
- Politica de resiliencia:
  - si falla red -> devolver cache previa
- Endpoint manual de refresco.

### Archivos
- `src/services/versionCatalogService.js` (nuevo)
- `src/services/jarService.js` (refactor para consumir catalogo)
- `src/server.js`
- `create-world.html`
- `js/creation.js`

### API nueva
- `GET /api/catalog/software`
- `GET /api/catalog/versions?software=...`
- `POST /api/catalog/refresh`

---

## Fase 6 - Endpoint publico real (Docker + Tailscale) (10h)

### Tareas
- Separar direccion interna y publica en backend.
- Resolver endpoint publico en orden:
  1. `PUBLIC_HOST` + `PUBLIC_PORT`
  2. `TAILSCALE_IP` + `PUBLIC_PORT`
  3. fallback interno (diagnostico)
- Endpoint dedicado:
  - `GET /api/server/public-endpoint?instanceId=...`
- Mostrar en UI ambos valores:
  - interno (contenedor)
  - publico (externo real)

### Archivos
- `src/server.js`
- `src/config/config.js`
- `docker-compose.yml`
- `Dockerfile` (variables por defecto)
- `index.html`
- `js/app.js`

### Nota Tailscale
- En Docker no se debe inferir automaticamente el puerto publicado externo.
- La configuracion explicita (`PUBLIC_PORT`) es obligatoria para precision.

---

## Fase 7 - Observabilidad, seguridad y limites (8h)

### Tareas
- Logging por instancia (prefijo `instanceId`).
- Locks para operaciones start/stop/restart por instancia.
- Limites de memoria por instancia (si se parametriza `JAVA_ARGS`).
- Validaciones de paths para evitar escape de directorios.

### Archivos
- `src/server.js`
- `src/services/runtimeStateService.js`
- `src/services/filesService.js` (nuevo opcional)

---

## Fase 8 - Testing y rollout (12h)

### Tareas
- Tests backend:
  - CRUD instancias
  - aislamiento de comandos
  - catalogo con cache
  - endpoint publico
- Tests manuales E2E:
  - crear 3 mundos
  - operar cada uno en paralelo
  - verificar UI de jugadores/OP/whitelist por instancia
- Rollout por fases con flags.

### Archivos
- `tests/instanceRegistry.test.js` (nuevo)
- `tests/catalog.test.js` (nuevo)
- `tests/publicEndpoint.test.js` (nuevo)
- `README.md`

---

## Estimacion total
- Fase 0: 3h
- Fase 1: 8h
- Fase 2: 16h
- Fase 3: 14h
- Fase 4: 10h
- Fase 5: 12h
- Fase 6: 10h
- Fase 7: 8h
- Fase 8: 12h

**Total estimado: 93h**

Rango realista con contingencias: **85h a 110h**.

---

## Hitos de entrega recomendados
1. Hito A (MVP multi-instancia): Fases 0-4 (51h)
2. Hito B (versiones dinamicas): Fase 5 (12h)
3. Hito C (Docker/Tailscale endpoint publico): Fase 6 (10h)
4. Hito D (hardening + tests): Fases 7-8 (20h)

---

## Criterios de aceptacion
1. Se pueden crear y visualizar multiples instancias en el panel padre.
2. Cada accion (start/stop/op/whitelist/files) aplica solo a su `instanceId`.
3. El selector de versiones se actualiza sin tocar codigo.
4. La UI muestra endpoint publico real (IP/puerto externos) y el interno por separado.
5. El comportamiento actual no se rompe para la instancia `default`.
