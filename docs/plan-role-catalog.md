# Planes, perfiles y Tokens

La autoridad pública es Luxisoft: `/billing/plans` para suscripciones legacy y
`/billing/packages` para activación, vistas previas y recargas. Cada registro de
plan incluye `customerRole` generado desde la política de acceso vigente, con
revisión y beneficios ES/EN/PT. El caché conserva registros completos; las tools
normalizan dinero antes de mostrarlo al modelo y rechazan snapshots vencidos.

`getServiceCatalog` describe capacidades usando esa metadata y mantiene separados
planes contratables y `previewPackages`. `getPlatformAccountOffer` acepta planCode
para responder sobre un perfil concreto; Negocio puede explicarse como vista
previa sin cotizarlo como disponible. Los perfiles comerciales no asignan roles de
personal ni acceso a Bandeja/Supervisión/Administración de Luxisoft.

`getAiUsagePricing` separa la asignación Free mensual de las recargas. Los Tokens
son saldo de uso, no tokens de texto ni un número fijo de mensajes. Recargar no
cambia modelos, razonamiento, audio o integraciones del perfil. Las recargas únicas
no vencen; los complementos mensuales requieren la disponibilidad del catálogo.
Cada modalidad de suscripción paga su propio período; no representa cuotas de una
anualidad. No se alteran precios, la oferta independiente de páginas a medida,
conexiones, clientes ni el flujo de compra. Pruebas sin mensajes/pagos reales.
