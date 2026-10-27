# SitePulse — plan de implementación

## Contexto

SitePulse es un proyecto de portfolio: un monitor de disponibilidad HTTP/HTTPS para freelances que gestionan varias webs (spec original: `~/Downloads/03-sitepulse.md`). La carpeta `~/Proyectos/sitepulse` está vacía. Objetivo: que sea **útil de verdad, open source y autoalojable**, con una demo pública que cualquiera pueda abrir, y con algo que **Uptime Kuma, Gatus o Upptime no tengan**.

Decisiones ya tomadas:
- **Distribución:** repo público en GitHub (licencia MIT), se instala con `docker compose up` en un VPS propio (Dokploy) y tendrá una **instancia demo pública de solo lectura**.
- **Alertas en el MVP:** Discord y un webhook genérico firmado con HMAC (vale para Slack, n8n, ntfy…).
- **Stack (el mismo que en Briefly y Fynd):** pnpm, Next.js 16 App Router, React 19, Tailwind 4, shadcn/ui, Recharts, Drizzle + Postgres, better-auth, vitest, Playwright y Docker.

## Lo que lo diferencia: «Anatomía de la caída»

Los competidores te dicen *que* tu web está caída y, como mucho, cuánto tarda en responder. SitePulse te dirá **dónde y por qué falla**:

1. **Tiempos por fase en cada comprobación:** DNS → TCP → TLS → TTFB → descarga. En el detalle de cada comprobación se ve una cascada como la de las DevTools del navegador.
2. **Diagnóstico automático y en lenguaje humano:** cada fallo se clasifica, por ejemplo: «El DNS no resuelve (NXDOMAIN): revisa el registro A del dominio», «El certificado caducó hace 2 días», «El proxy responde 502, así que el servidor está vivo pero el backend no», o «Se conecta, pero el servidor no envía respuesta en 10 s».
3. **Cronología del incidente:** inicio, fallos intermedios, cambios de causa (pasa de DNS a 502, por ejemplo) y recuperación, con la duración exacta.
4. **Detección de degradación:** compara la mediana de latencia de la última hora con la de los 7 días anteriores y avisa cuando una fase se dispara («el TTFB ha subido ×3 desde ayer»). Así lo ves antes de que llegue a caerse.

Esto encaja con la seguridad. El mismo motor que mide cada fase resuelve el DNS por su cuenta, valida la IP y la fija para la conexión, y así frena el SSRF y el DNS rebinding. Además, la fecha de caducidad del certificado TLS sale sin coste extra.

Otros puntos que lo hacen sólido (más que diferenciadores, son calidad):
- **Uptime honesto:** se calcula ponderado por tiempo a partir de los incidentes, no como porcentaje de comprobaciones correctas. La interfaz explica el método en un tooltip y muestra también el ratio de comprobaciones.
- **Vigilancia del propio monitor:** el worker escribe un latido en la BD y el panel avisa si lleva tiempo sin ejecutarse. Además, se puede configurar `HEARTBEAT_URL` (p. ej. healthchecks.io) para recibir un aviso aunque se caiga el VPS. Resuelve la limitación que señala la spec.
- **Versión 1.1, pensada para freelances:** una página de estado pública por cliente y un **informe mensual por cliente** (enlace compartible o PDF con el uptime, los incidentes y la latencia). Ningún competidor autoalojado tiene el informe.

## Arquitectura

Monorepo con pnpm workspaces:

```
apps/web        Next.js: panel, autenticación, CRUD, route handlers y server actions
apps/worker     Proceso Node: planificador, sondas, incidentes, envío de alertas, limpieza
apps/flaky      (solo demo/tests) servidor «caótico»: ok, lento, 502, timeout, TLS roto…
packages/core   Lógica pura y muy testeada: probe, ssrf-guard, diagnóstico, máquina de estados, cálculo de uptime, notificadores
packages/db     Esquema Drizzle, migraciones, seed (demo con 30 días de historial sintético)
```

- **Planificación sin Redis:** cada sitio tiene un campo `next_check_at`. El worker reclama los sitios pendientes con `SELECT … FOR UPDATE SKIP LOCKED`, con una concurrencia limitada (p-limit). Admite varias réplicas sin duplicar trabajo y no depende de que nadie tenga el navegador abierto.
- **Motor de sondas** (`packages/core/probe.ts`): usa `node:http`/`https` con un `lookup` propio que resuelve, valida todas las IPs y fija la elegida. Mide las fases con los eventos del socket (`lookup`, `connect`, `secureConnect`, primer byte, fin) y lee el certificado con `getPeerCertificate()`. Sigue las redirecciones a mano (máx. 5) y revalida el esquema y la IP en cada salto. Aplica un timeout total y otro por fase, lee como mucho 256 KB del cuerpo y luego corta, y no guarda nunca el contenido.
- **Guarda SSRF** (`packages/core/ssrf-guard.ts`): bloquea loopback, rangos privados, link-local, CGNAT 100.64/10, 0.0.0.0/8, multicast, IPv6 ULA y link-local, IPv4 mapeada en IPv6, la IP de metadatos 169.254.169.254 y formas de IP raras (decimal, octal o hexadecimal). Para autoalojamiento hay una lista blanca opcional, `ALLOW_PRIVATE_CIDRS`, para quien quiera vigilar su homelab. En la demo está siempre desactivada.
- **Reintentos e incidentes:** cuando una comprobación falla, se repite de inmediato pasados ~30 s. Si vuelve a fallar, el sitio pasa a `suspect` y la siguiente comprobación se adelanta a 1 min. Un segundo fallo confirmado lo pasa a `down`, abre un incidente y genera una alerta. El primer éxito lo devuelve a `up`, cierra el incidente y avisa de la recuperación. Todo transcurre en una transacción.
- **Alertas sin duplicados (patrón outbox):** el incidente y su fila en `notifications` se crean en la misma transacción, con `UNIQUE(incident_id, channel_id, kind)`. Un despachador las envía con backoff exponencial. Los secretos de los canales (URL del webhook de Discord, secreto HMAC) se cifran con AES-256-GCM usando `SITEPULSE_SECRET_KEY` y nunca se envían al cliente.
- **Retención:** las comprobaciones en bruto se guardan 30 días. Una tabla `check_rollups_hourly` (p50/p95 por fase y tasa de éxito) alimenta las gráficas largas. La limpieza la hace un job del worker.
- **Autenticación para autoalojamiento:** better-auth con email y contraseña. En el primer arranque, una pantalla `/setup` crea el usuario administrador; los siguientes usuarios entran por invitación. Todas las consultas filtran por `owner_id`. Hay límites configurables por variables de entorno (número de sitios, intervalo mínimo de 1 min).
- **Modo demo** (`DEMO_MODE=true`): las mutaciones se desactivan en el servidor y se muestra un banner «Datos de demostración». El seed carga los sitios «Portfolio», «API de prueba» y «Tienda de muestra» con 30 días de historial, más un monitor real contra `apps/flaky`, que recorre escenarios de fallo por horario. Así, quien visite la demo ve incidentes reales abrirse y cerrarse.

## Modelo de datos (Drizzle, Postgres)

- `sites`: id, owner_id, name, url, client (agrupación opcional), interval_sec, timeout_ms, expected_status (`"200-399"` por defecto), enabled, state (`unknown|up|suspect|down`), consecutive_failures, next_check_at, last_checked_at, tls_expires_at, created_at
- `checks`: id (bigint), site_id, checked_at, success, http_status, error_code, dns_ms, connect_ms, tls_ms, ttfb_ms, total_ms, resolved_ip, redirect_count. Índice `(site_id, checked_at desc)`
- `check_rollups_hourly`: site_id, hour, total, ok, p50 y p95 de total_ms y de cada fase
- `incidents`: id, site_id, started_at, resolved_at, cause_code, first_error, last_error, failed_checks
- `alert_channels`: id, owner_id, type (`discord|webhook`), name, config_encrypted. Tabla puente `site_alert_channels`
- `notifications` (outbox): id, incident_id, channel_id, kind (`down|up|degraded`), status, attempts, next_attempt_at, sent_at, last_error
- `worker_heartbeats`: worker_id, last_seen_at, version
- Tablas de better-auth (users, sessions, accounts)

## Pantallas

Dashboard (totales, operativos, con incidencia, última ejecución del worker, sitios más lentos y uptime de 7 días) · Lista de sitios · Detalle (gráfica de 24 h / 7 d / 30 d apilada por fase, barra de uptime, últimas comprobaciones con su cascada al hacer clic, incidentes) · Alta y edición (con un botón «Probar ahora» que lanza una comprobación en el servidor, con límite de frecuencia y pasando por la guarda) · Incidentes (cronología y diagnóstico) · Canales de alerta (con botón «Enviar prueba») · Ajustes · `/setup`.

## Hitos (se mantienen los IDs de la spec y se añaden algunos)

**MVP**
1. SP-01: monorepo, Next.js, shadcn y layout responsive con datos simulados. CI en GitHub Actions (lint, typecheck, tests, build).
2. SP-02: `packages/db` (esquema, migraciones, seed), better-auth, `/setup` y filtrado por `owner_id`.
3. SP-07 + SP-04: `ssrf-guard` y `probe` con tiempos por fase. Tests en tabla con todos los casos límite de IP y redirecciones, y con un resolver falso para el DNS rebinding.
4. SP-03: formulario de alta con validación zod compartida y «Probar ahora».
5. SP-05 + SP-06: worker con `SKIP LOCKED`, persistencia de las comprobaciones, latido y `HEARTBEAT_URL`.
6. SP-10: máquina de estados de incidentes y diagnóstico (`error_code` → texto y pista).
7. SP-11: outbox, notificadores Discord y webhook HMAC, y botón «Enviar prueba».
8. SP-08 + SP-09: dashboard, detalle con gráficas, cascada por comprobación y uptime ponderado.
9. SP-12: `apps/flaky` y test e2e (Playwright + compose) que simula una caída y una recuperación y comprueba que se envía exactamente una alerta de cada tipo.

**Pulido**

10. Rollups, retención y detección de degradación.
11. Docker: imágenes de web y worker publicadas en GHCR al etiquetar una versión, `docker-compose.yml` listo para usar y `.env.example`.
12. SP-13: README en inglés con GIF, diagrama mermaid, sección de seguridad (el SSRF explicado), sección de limitaciones honestas y comparativa con Kuma, Gatus y Upptime. También README.es.md, SECURITY.md, CONTRIBUTING.md, plantillas de issues y release-please.
13. Demo pública en Dokploy (`DEMO_MODE`).

**Futuro (v1.1+)**: página de estado pública por cliente, informe mensual por cliente, alertas de caducidad TLS a 30/14/7 días, comprobación de palabra clave, correo SMTP, i18n en/es de la interfaz.

Estimación: el MVP en unas 2 semanas de trabajo concentrado y el pulido con la demo en 3–5 días más.

## Verificación

- `pnpm test`: tests unitarios de `packages/core` (guarda SSRF, clasificador de errores, máquina de estados, cálculo de uptime, firma HMAC, idempotencia de la outbox).
- Integración: Postgres efímero en Docker y servidores HTTP/TLS locales (con `ALLOW_PRIVATE_CIDRS` solo en tests) para medir fases, timeouts, límite de tamaño y redirecciones hacia IPs privadas, que deben bloquearse.
- E2E: `docker compose -f docker-compose.test.yml up`. Se añaden dos sitios y se ve cómo se registran comprobaciones programadas con el navegador cerrado. Se pone `apps/flaky` en modo 502 y debe abrirse un incidente con una sola alerta. Se vuelve a modo ok y debe cerrarse con una sola alerta de recuperación, todo visible en la gráfica. Es el criterio de terminado de la spec.
- Manual: webhook real de Discord en un canal de pruebas, y revisión visual del panel en móvil y en escritorio con el navegador integrado.
