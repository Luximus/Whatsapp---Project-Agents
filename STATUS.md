# Estado operativo — Meta Messaging Bridge

Última revisión: **2026-08-20** (America/Bogota).

Este documento es una fotografía verificable del despliegue. La arquitectura y
los contratos estables viven en `README.md`; las reglas para agentes, en
`CLAUDE.md`.

## Resumen ejecutivo

| Área             | Estado              | Evidencia de la revisión                                                                          |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| Proceso PM2      | Operativo           | `whatsapp-bridge` online tras reinicio controlado con `--update-env`; Node 22.22.2.               |
| Aplicación local | Operativa           | `GET http://127.0.0.1:4010/health` devuelve `{"ok":true}`.                                        |
| Endpoint público | Operativo           | HTTPS válido; certificado renovado hasta 2026-11-18 y health público correcto.                    |
| Meta Graph API   | Operativo           | Token permanente `SYSTEM_USER`, teléfono/WABA accesibles, app suscrita y callback activo.         |
| Messenger        | Operativo (canal)   | Página LuxiSoft suscrita; conversaciones legibles y endpoint de envío autorizado.                 |
| Instagram        | Deshabilitado       | Flag apagado; sin procesamiento de eventos ni suscripción `instagram` en la App.                  |
| Bandeja humana   | Operativa           | Persistencia PostgreSQL, asignación exclusiva, pausa/reanudación IA y API interna verificadas.    |
| CRM Luxisoft     | Operativo           | Espejo de contactos, etapas, consentimiento, campañas aprobadas y señales a GA4/Meta CAPI.        |
| Agente IA        | Operativo           | Cadena Codex Luna → Qwen 3.7 → Claude Opus 4.8; primario y fallback final verificados.            |
| PostgreSQL       | Operativo           | Existen las tablas de Bridge, memoria del agente, vínculos, autenticación y sesiones de servidor. |
| TypeScript       | Correcto            | `npm run typecheck` finaliza sin errores.                                                         |
| ESLint           | Aceptable con deuda | `npm run lint` finaliza con 0 errores y 99 advertencias.                                          |
| Tests            | **No verde**        | 100/103 pasan; fallan 3 pruebas antiguas del flujo de vínculo de cuentas.                         |

## TLS: incidente resuelto

El certificado anterior venció el 2026-06-19 porque la renovación usaba
`webroot=/var/www/certbot`, pero Nginx enviaba el challenge a Fastify y este
respondía `404`.

- El dry-run con el autenticador `webroot` reprodujo el fallo `unauthorized`.
- Se cambió la renovación de este certificado al autenticador/installer
  `nginx`.
- El dry-run con Nginx pasó y el certificado se renovó correctamente.
- Certificado actual: 2026-08-20 13:42:34 UTC a **2026-11-18 13:42:33 UTC**.
- La configuración de renovación conserva `renew_hook = systemctl reload nginx`.
- `https://whatsapp.luxisoft.com/health` responde `{"ok":true}` con validación
  TLS normal.

## Meta: acceso permanente recuperado

Meta rechaza `WHATSAPP_ACCESS_TOKEN` al consultar el
`WHATSAPP_PHONE_NUMBER_ID` configurado:

- HTTP `401`;
- OAuth error `190`, subcódigo `465`;
- motivo informado: la aplicación no pertenece al negocio del usuario de
  sistema ni al negocio de su agregador.

Esto impide marcar mensajes como leídos, mostrar typing y enviar respuestas.
Además, antes de renovar TLS no había entregas recientes de Meta a
`POST /api/webhooks/whatsapp`. El callback público sí supera el challenge GET
con el verify token y una carga POST firmada de diagnóstico devuelve `200`, por
lo que Nginx, Fastify, la ruta y `WHATSAPP_APP_SECRET` funcionan entre sí.

Primero se recibió y validó una credencial temporal para la App `3905720049672536`, el
Phone Number ID `1263568076840740` (`+1 929-563-6472`) y el WABA
`1582472916616873` (LUXISOFT S.A.S). El Phone Number está verificado, en Cloud
API, con calidad `GREEN`.

Después se sustituyó por la credencial permanente ya administrada por
`luxisoft.com`, sin copiarla a documentación ni logs. Meta la reporta como
`SYSTEM_USER`, válida, asociada a la misma App, con expiración y expiración de
datos en `0` (sin vencimiento programado) y con los permisos de administración y
mensajería requeridos. Se agregó también el WABA ID al entorno del bridge.

Las verificaciones posteriores confirmaron:

- consulta del Phone Number: HTTP `200`, verificado y calidad `GREEN`;
- consulta del WABA: HTTP `200`, `LUXISOFT S.A.S`;
- `POST /1582472916616873/subscribed_apps`: `success:true`;
- la app suscrita es `3905720049672536`;
- el webhook de la app está activo para `messages` y apunta a
  `https://whatsapp.luxisoft.com/api/webhooks/whatsapp`;
- `whatsapp-bridge` reinició con `--update-env`, permanece online y el health
  público devuelve `{"ok":true}`.
- una carga de diagnóstico firmada con el App Secret atravesó HTTPS y el webhook
  público respondió HTTP `200` con `{"ok":true}`.

Queda pendiente únicamente repetir una conversación real entrante para confirmar
la entrega de Meta y la respuesta completa del agente después del cambio. Una
ventana de observación de tres minutos posterior al despliegue no registró una
nueva entrega real; esto no es un fallo del servidor porque no hubo un evento de
usuario nuevo durante esa ventana.

## Runtime efectivo

- Puerto `4010`, escucha en `0.0.0.0`; Nginx publica
  `whatsapp.luxisoft.com`.
- `WHATSAPP_AGENT_ENABLED=true`: los mensajes que no son OTP llegan al agente
  `luxisoft`.
- `WHATSAPP_SERVICES_ENABLED=true`: están activas las tools de vínculo,
  consulta de cuenta y operación de servidores.
- `META_MESSENGER_ENABLED=true`: Messenger comparte el agente `luxisoft` con
  WhatsApp, usando memoria aislada por `canal:id`. Solo recibe tools comerciales.
- `META_INSTAGRAM_ENABLED=false`: cualquier evento Instagram se ignora y no
  ejecuta el agente.
- `BRIDGE_STORE` no está definido en producción, por lo que aplica el default
  `memory`: las sesiones/eventos del Bridge no sobreviven un reinicio.
- El chat usa fallback CLI estricto: `codex` (`gpt-5.6-luna`) → `codex-qwen`
  (`qwen3.7-max`) → `claude` (`claude-opus-4-8`). Codex Luna respondió una
  prueba real de texto y otra de tool-calling. Qwen sigue devolviendo `429` por
  cuota, pero ya no bloquea el agente: Claude Opus 4.8 tomó el relevo y respondió
  correctamente en la prueba real de conmutación.
- Tras el despliegue se envió un webhook Messenger local firmado con remitente
  ficticio: devolvió HTTP `200`, Codex generó la respuesta y el flujo alcanzó el
  envío de Meta. Meta lo rechazó únicamente por el PSID deliberadamente inválido
  (`meta_messenger_send_failed:-1:2018012`), confirmando webhook → IA → salida.
- Están presentes (sin exponer valores) las credenciales de WhatsApp, base de
  datos, LP S2S, SMTP y OpenAI.
- LuxiChat no tiene `LUXICHAT_API_BASE_URL` ni `LUXICHAT_S2S_TOKEN`: su connector
  se degrada como no disponible; LP y LUXIPANEL sí tienen la configuración base.

El artefacto `dist/src/server.js` fue reconstruido y desplegado el 2026-08-20;
PM2 ejecuta ese archivo, permanece online sin reinicios inestables y el health
local posterior al reinicio devuelve `{"ok":true}`.

## Bandeja humana y CRM desplegados

- Todo mensaje entrante de WhatsApp o Messenger se guarda en PostgreSQL antes
  de invocar la IA. Una conversación en `waiting_human` o `human_active` pausa
  por completo las respuestas automáticas.
- El agente puede transferir el caso; el bridge avisa a `quote@luxisoft.com` y
  conserva el hilo para que un operador lo tome. Solo un responsable puede
  reclamarlo. Al cerrar, se libera la asignación y vuelve a responder la IA.
- La API interna usa una credencial propia del proyecto `luxisoft`; no reutiliza
  tokens de Meta. La sonda autenticada de listado devolvió HTTP `200`.
- Luxisoft backend sincroniza contactos aunque nadie abra la interfaz. La etapa
  CRM cambia automáticamente ante una señal comercial real, sin pisar etapas
  avanzadas editadas por una persona, y deduplica `generate_lead`/`Lead` para
  Google Analytics 4 y Meta CAPI.
- Las campañas exigen opt-in vigente, plantilla aprobada y aprobación del
  administrador; se revalida el consentimiento antes de cada envío. Los envíos
  masivos por Messenger permanecen bloqueados hasta contar con el mecanismo de
  notificación autorizado por Meta; la atención individual en la ventana activa
  sí está disponible.
- La interfaz `Plataforma → WhatsApp` fue publicada en el servidor frontend por
  despliegue atómico. Incluye cola, hilo, toma/cierre, ficha CRM, consentimiento,
  campañas y altas/bajas de operadores. El health remoto posterior dio HTTP 200.

## Messenger activo; Instagram deshabilitado

Se emitió desde `LuxiAdmin` una credencial permanente `SYSTEM_USER` con scopes
de páginas e Instagram, y se derivó un Page Access Token permanente para la
Página `LuxiSoft` (`478605215328341`). Ningún valor secreto se escribió en docs
o logs. La cuenta profesional vinculada es `@luxisoft_sas`
(`17841437848827630`).

- La App `3905720049672536` conserva suscripciones activas `page` y
  `whatsapp_business_account`; Messenger apunta a
  `https://whatsapp.luxisoft.com/api/webhooks/meta`.
- La Página quedó suscrita a `messages` y `messaging_postbacks`.
- Messenger lista conversaciones con HTTP `200`; una sonda con destinatario
  deliberadamente inválido llegó al endpoint de envío y fue rechazada por el ID,
  no por token/permisos. No se contactó a usuarios reales.
- Prueba real del 2026-08-20 a las 11:48:35 America/Bogota: Meta entregó el
  mensaje de Facebook al webhook y este respondió HTTP `200`. El agente no
  produjo respuesta porque el proveedor IA devolvió HTTP `429
insufficient_quota`; por tanto, no se ejecutó el envío de salida. El problema
  no está en Messenger, la suscripción ni el servidor.
- Los POST firmados de diagnóstico para `object=page` y `object=instagram`
  atravesaron HTTPS y respondieron `200`.
- Instagram fue retirado de operación: flag apagado, eventos ignorados y
  suscripción de App eliminada. El adaptador y `META_APP_REVIEW.md` se conservan
  únicamente como referencia si se decide reactivarlo en el futuro.

## Datos y persistencia

Se verificó en PostgreSQL la existencia de:

- `whatsapp_agent_messages`;
- `whatsapp_account_links`;
- `whatsapp_link_otps` (compatibilidad con el flujo TOTP anterior);
- `whatsapp_auth_sessions`;
- `whatsapp_server_sessions`;
- `whatsapp_bridge_sessions` y `whatsapp_bridge_events`.
- `whatsapp_inbox_conversations`, `whatsapp_inbox_messages` y
  `whatsapp_inbox_events`.

Las estadísticas de PostgreSQL reportaron aproximadamente 0 filas en estas
tablas durante la revisión. Es un estimado de `pg_stat_user_tables`, no un
conteo transaccional.

## Arquitectura funcional vigente

1. El webhook valida `X-Hub-Signature-256` sobre el cuerpo crudo.
2. Texto/audio se normaliza; el audio puede transcribirse mediante la capa IA.
3. Un código OTP se intenta consumir en este orden: Bridge, verificación de
   cuenta, vínculo pendiente legado/reautenticación; si no aplica, lo interpreta
   el agente.
4. Los mensajes sin OTP pasan al runtime multi-agente cuando el flag está
   activo.
5. La capa de servicios permite vincular LP/LUXIPANEL por teléfono. El flujo
   vigente exige que el teléfono ya esté verificado por WhatsApp en la cuenta;
   al cumplirlo, crea el vínculo directamente y abre una sesión de chat.
6. Las acciones sensibles posteriores requieren una sesión autenticada. Tras
   expirar, se renueva con TOTP; la sesión tiene TTL deslizante y se purga cada
   cinco minutos.
7. Para operar servidores, el bridge pide a LP una sesión SSO, la canjea en
   LUXIPANEL y conduce su asistente en background. No persiste el bearer corto.

## Deuda y riesgos priorizados

### Mejora continua IA (2026-08-20)

- Conversaciones útiles de WhatsApp y Messenger se conservan 30 días y se
  analizan cada noche a las 00:10, hora de Bogotá.
- OTP, secretos y datos de contacto se excluyen o redactan antes de invocar la
  cadena Codex → Codex-Qwen → Claude.
- El administrador decide en Plataforma → WhatsApp → Mejoras IA. Generar y
  publicar son aprobaciones distintas; el segundo paso muestra diff y checks.
- Migración `20260821_conversation_learning.sql` aplicada y suite en 108/108.

1. **P0 — prueba real del flujo humano.** Enviar un mensaje nuevo a WhatsApp y
   Messenger, transferirlo desde la IA, tomarlo en Plataforma → WhatsApp,
   responder y cerrar para comprobar el retorno automático de control.
2. **P0 — prueba real de canales activos.** Enviar un mensaje nuevo al WhatsApp y
   a la Página LuxiSoft después del despliegue de la cadena CLI. Ya no depende de
   recuperar la cuota Qwen porque Codex Luna es primario y Claude Opus 4.8 es el
   tercer respaldo operativo.
3. **P1 — vigilar cuota de Qwen.** Su `429` actual no interrumpe el servicio, pero
   deja temporalmente dos motores efectivos en vez de tres.
4. **P1 — decidir persistencia del Bridge.** Producción usa el store en memoria;
   un reinicio pierde sesiones y eventos pendientes.
5. **P2 — limpiar documentación interna legado.** Algunos comentarios y tipos
   todavía describen la creación de OTP/TOTP de vínculo, aunque `startLink`
   enlaza directamente cuando `whatsappVerified=true`.
6. **P2 — reducir deuda de lint.** Hay advertencias, sobre todo usos de
   `any`, más dos símbolos/parámetros sin uso.
7. **P2 — mejorar observabilidad.** El health actual solo confirma que Fastify
   responde; no prueba PostgreSQL, WhatsApp Cloud API, LP, LUXIPANEL, SMTP ni el
   proveedor de IA.

## Comandos de verificación

```bash
npm run typecheck
npm run lint
npm test
curl -fsS http://127.0.0.1:4010/health
pm2 describe whatsapp-bridge
pm2 logs whatsapp-bridge --lines 120 --nostream
```
