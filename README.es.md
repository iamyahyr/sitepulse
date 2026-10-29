# SitePulse

**Monitorización de disponibilidad autoalojada que te dice _dónde_ y _por qué_ falla una web, no solo que está caída.**

[English](README.md)

![Panel de SitePulse con dos incidentes abiertos, su anatomía por fases, un aviso de lentitud e historial de 48 horas](docs/screenshots/dashboard.png)

La mayoría de los monitores te dicen que una web está caída y cuánto tardó en responder. Cuando algo se rompe a las 3 de la mañana, la siguiente pregunta siempre es la misma: *¿es el DNS, la red, el certificado, el proxy o la aplicación?* SitePulse la responde en cada comprobación:

- **Anatomía de cada petición.** Cada comprobación se cronometra por fases (DNS → conexión TCP → TLS → respuesta del servidor → descarga) y se dibuja como una cascada al estilo de las DevTools. Cuando una petición falla, la cascada muestra en qué fase.
- **Diagnóstico en lenguaje claro.** Cada fallo se clasifica y se explica: *«Bad gateway: el proxy funciona, la aplicación no»*, *«Certificado caducado»*, *«El servidor aceptó la conexión pero nunca respondió: revisa consultas lentas, workers agotados o bloqueos»*.
- **Avisos antes de la caída.** Si una web sigue en pie pero su tiempo de respuesta se ha triplicado respecto a su propia media de 7 días, recibe un aviso de «más lenta de lo habitual» que indica qué fase se ha ralentizado.
- **Alertas que no saturan.** Un mensaje cuando se abre un incidente, otro cuando se resuelve y otro cuando una web empieza a degradarse. Por Discord o por webhook firmado (Slack, n8n, ntfy, Zapier…). Nunca uno por cada comprobación fallida.
- **Uptime honesto.** Calculado por tiempo a partir de incidentes confirmados, nunca como «comprobaciones correctas ÷ totales», y nunca redondeado al 100 % si hubo una caída.
- **Sin falsas alarmas cuando el caído eres tú.** Si el propio servidor del monitor pierde la red o el DNS, lo detecta y no marca todas las webs como caídas.
- **Informes mensuales para tus clientes.** Uptime, incidentes con su diagnóstico, tiempo caído y tiempo de respuesta por fase de todas las webs de un cliente, como enlace de solo lectura revocable o en PDF.

## Puesta en marcha

Necesitas un servidor con Docker y Docker Compose.

```bash
git clone https://github.com/iamyahyr/sitepulse.git && cd sitepulse
cp .env.example .env
# Rellena POSTGRES_PASSWORD, BETTER_AUTH_SECRET y SITEPULSE_SECRET_KEY (openssl rand -hex 32 cada uno)
# y pon en APP_URL la dirección que vas a usar, p. ej. https://status.example.com
docker compose up -d --build
```

Abre el enlace de configuración que la web imprime al arrancar (`docker compose logs web`), crea la cuenta de administrador (el registro se cierra justo después) y añade tus webs. El enlace lleva un token, así que nadie puede quedarse la instancia solo por llegar antes. Para monitorizar servicios de tu red interna, permite rangos concretos con `ALLOW_PRIVATE_CIDRS=192.168.1.0/24`. Para que te avisen si el propio monitor se cae, configura `HEARTBEAT_URL` con un servicio como [healthchecks.io](https://healthchecks.io).

## Más información

El [README en inglés](README.md) tiene el detalle completo:

- [cómo funciona](README.md#how-it-works), con el diagrama de arquitectura;
- [la verificación de webhooks firmados](README.md#webhooks);
- [las medidas de seguridad contra SSRF](README.md#security);
- [la demo pública](README.md#public-demo);
- [cuándo elegir otra herramienta](README.md#sitepulse-or-something-else) (Uptime Kuma, Gatus, Upptime);
- [las limitaciones conocidas](README.md#limitations) y la [hoja de ruta](README.md#roadmap).

## Licencia

[MIT](LICENSE)
