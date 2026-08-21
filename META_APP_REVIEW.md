# Guion de revisión Meta — Instagram Messaging

> **Estado: deshabilitado.** Este documento se conserva únicamente como
> referencia histórica para una posible reactivación. Producción mantiene
> `META_INSTAGRAM_ENABLED=false` y no debe tener una suscripción `instagram`
> activa en la App de Meta.

Última actualización: **2026-08-20**.

## Objetivo

Demostrar a Meta que la App `3905720049672536` usa
`instagram_manage_messages` para recibir un mensaje iniciado por una persona y
responder desde el mismo agente de soporte/comercial de LUXISOFT. La cuenta
profesional de prueba es `@luxisoft_sas` (`17841437848827630`), vinculada a la
Página `LuxiSoft` (`478605215328341`).

El backend y el webhook ya están desplegados en:

- challenge: `GET https://whatsapp.luxisoft.com/api/webhooks/meta`;
- eventos: `POST https://whatsapp.luxisoft.com/api/webhooks/meta`.

## Antes de grabar

1. En Meta App Dashboard, agregar/habilitar el producto o caso de uso de
   **Instagram Messaging** para la App. Tener el scope en un token no sustituye
   esta capability; mientras falte, Graph API responde código `3`.
2. Mantener la App en modo desarrollo para la demostración.
3. Agregar la cuenta personal que hará la prueba como tester/desarrollador de la
   App y aceptar la invitación.
4. Dar a esa persona un rol sobre la Página LuxiSoft y la cuenta profesional
   `@luxisoft_sas`. Meta exige que los testers tengan rol tanto en la App como en
   el activo profesional durante las pruebas con acceso estándar.
5. En Instagram, permitir que las herramientas conectadas accedan a los mensajes
   de la cuenta profesional.
6. Recuperar la cuota del proveedor IA. Al 2026-08-20 el proveedor efectivo está
   sin cuota hasta **2026-08-22 16:40 UTC (11:40 Bogotá)** y la llave OpenAI de
   `luxisoft` tampoco tiene saldo. Sin esto el webhook recibe, pero no genera la
   respuesta que debe verse en el video.
7. Confirmar antes de grabar:

   ```bash
   curl -fsS https://whatsapp.luxisoft.com/health
   pm2 describe whatsapp-bridge
   pm2 logs whatsapp-bridge --lines 80 --nostream
   ```

## Guion del video (2–3 minutos)

Aunque Meta no indica que todos los videos deban estar obligatoriamente en
inglés, se recomienda grabar la narración, los mensajes y los textos visibles en
inglés para que el equipo de revisión pueda seguir el caso sin traducción. Los
textos siguientes están listos para usar literalmente.

### 1. Identificar los activos (15–20 segundos)

- Mostrar Meta App Dashboard con el nombre de la App y el ID
  `3905720049672536`.
- Mostrar que `@luxisoft_sas` es una cuenta profesional vinculada a LuxiSoft.
- No mostrar tokens, App Secret, `.env`, cookies ni datos de terceros.

Narración sugerida:

> This is the LUXISOFT Meta application, App ID 3905720049672536, and this is our
> connected professional Instagram account, @luxisoft_sas. We use the Instagram
> messaging permission only to receive and respond to conversations initiated by
> Instagram users.

### 2. Iniciar la conversación como tester (30 segundos)

- Desde una cuenta tester distinta, abrir `@luxisoft_sas` y enviar:

  > Hello, which LUXISOFT service can help me manage my servers?

- Dejar visible que la conversación fue iniciada por la persona, no por la App.

Narración sugerida:

> I am now using a separate Instagram tester account. The tester opens the
> @luxisoft_sas profile and initiates the conversation. Our application does not
> initiate this conversation and does not send unsolicited messages.

### 3. Mostrar recepción y respuesta (45–60 segundos)

- Mostrar brevemente los logs del bridge con el evento de canal `instagram`, sin
  exponer IDs completos de personas.
- Volver a Instagram y mostrar la respuesta del agente sobre LUXIPANEL.
- La respuesta puede variar ligeramente, pero debería ser equivalente a:

  > LUXIPANEL is LUXISOFT's server management panel. It helps you manage files,
  > DNS, SSL certificates, email, backups, security, monitoring, and other server
  > tasks from a web interface. Would you like help evaluating it for your
  > servers?

- Enviar una segunda pregunta corta para demostrar contexto:

  > Yes. Can I schedule a meeting with a specialist?

- Mostrar la respuesta solicitando los datos mínimos antes de agendar.
- Respuesta esperada aproximada:

  > Of course. Please share your name, email address, preferred date or day, and
  > the service you are interested in. Once I have those details, I can send the
  > meeting request to our team.

Narración sugerida:

> The signed webhook receives the Instagram message and routes it to the LUXISOFT
> support assistant. The assistant generates a relevant reply and sends it back
> to the same user-initiated thread. The application does not send bulk messages
> and does not start conversations with Instagram users.

### 4. Mostrar controles y cierre (30 segundos)

- Explicar que Messenger e Instagram usan memoria separada por canal.
- Explicar que las operaciones privadas de cuenta y servidores no se habilitan
  en Instagram porque requieren un teléfono WhatsApp verificado.
- Mostrar que la respuesta aparece en el mismo hilo y cerrar la grabación.

Narración sugerida:

> Instagram and Messenger conversations are isolated by channel and user ID. On
> Instagram, the assistant can answer product questions, request a meeting, or
> escalate a support case. Private customer account and server operations remain
> disabled because those actions require a separately verified WhatsApp phone
> number. This concludes the demonstration of the requested Instagram messaging
> permission.

## Texto sugerido para App Review

Los bloques siguientes pueden copiarse en los campos de justificación e
instrucciones para el revisor.

### Feature description

> LUXISOFT provides first-level customer support and sales assistance through its
> professional Instagram account. When an Instagram user sends a direct message
> to @luxisoft_sas, Meta delivers the event to our signed webhook. Our support
> assistant processes the user's request and sends a relevant reply to the same
> Instagram conversation. Users can ask about LUXISOFT products, request a sales
> meeting, or ask for their case to be escalated to the support team.

### Uso del permiso

> LUXISOFT uses `instagram_manage_messages` to receive messages initiated by
> Instagram users and provide first-level product support and sales assistance
> for LUXISOFT services. The app replies only inside the user-initiated
> conversation. It does not send unsolicited or bulk messages.

### Why this permission is necessary

> The `instagram_manage_messages` permission is required because the core feature
> cannot operate without reading the user's incoming Instagram Direct message and
> sending the requested support response back to that same conversation. The
> permission is not used for advertising, audience profiling, unsolicited
> outreach, or bulk messaging.

### Instrucciones para el revisor

> 1. Sign in with the provided Instagram test account.
> 2. Open the professional account `@luxisoft_sas`.
> 3. Tap **Message** and send: “Hello, which LUXISOFT service can help me manage
>    my servers?”
> 4. Wait for the LUXISOFT support assistant's reply in the same thread.
> 5. Send: “Yes. Can I schedule a meeting with a specialist?”
> 6. Confirm that the assistant asks for the contact details required to submit
>    the meeting request.
>
> The conversation must be initiated from the tester account. The application
> does not initiate conversations. Test credentials are supplied only in Meta's
> secure reviewer credential fields and are not included in the screencast or
> public documentation.

### Manejo de datos

> Messages are used to generate the requested support reply and retain short-term
> conversation context. Instagram-scoped user IDs are isolated from WhatsApp and
> Messenger identities. The integration does not use message data for advertising
> and does not expose private account or server operations on Instagram.

### Privacy and retention statement

> We process only the message content and Instagram-scoped identifiers needed to
> provide the requested response and maintain short-term conversational context.
> Channel identities are isolated, access tokens remain server-side, and message
> data is not sold or used to create advertising audiences. Users may request
> human support from the same conversation.

## Texto completo de narración en inglés

Este bloque sirve como teleprompter continuo:

> This is the LUXISOFT Meta application, App ID 3905720049672536, connected to
> our professional Instagram account, @luxisoft_sas. LUXISOFT uses the Instagram
> messaging permission only to receive and respond to conversations initiated by
> Instagram users.
>
> I am now using a separate tester account with the required application and
> business asset roles. From this tester account, I open @luxisoft_sas and send:
> “Hello, which LUXISOFT service can help me manage my servers?” The tester starts
> the conversation; our application does not send unsolicited messages or start
> conversations.
>
> Meta delivers the message to our signed webhook. The webhook validates the
> request, isolates the Instagram user identity from our other messaging
> channels, and routes the text to the LUXISOFT support assistant. The assistant
> responds in the same Instagram thread with information about LUXIPANEL.
>
> I now send a follow-up question: “Yes. Can I schedule a meeting with a
> specialist?” The assistant keeps the context and asks for the minimum contact
> information needed to submit the request to our team.
>
> The Instagram integration is limited to product assistance, meeting requests,
> and support escalation. Private customer account and server operations are not
> available on Instagram because they require a separately verified WhatsApp
> phone number. The application does not use message data for advertising and
> does not send bulk messages. This concludes the demonstration of the
> `instagram_manage_messages` permission.

## Lista de comprobación final

- [ ] Producto/capability Instagram Messaging habilitado en la App.
- [ ] Tester aceptado en la App y con rol sobre el activo profesional.
- [ ] Acceso a mensajes permitido en Instagram.
- [ ] `instagram_manage_messages` aparece concedido al token de prueba.
- [ ] Proveedor IA con cuota disponible.
- [ ] Mensaje entrante real visible en logs.
- [ ] Respuesta real visible en Instagram.
- [ ] Video legible, sin secretos ni conversaciones de terceros.
- [ ] Credenciales e instrucciones de tester incluidas en la solicitud de revisión.

## Estado técnico conocido

El webhook de App para `object=instagram` está activo y los POST firmados de
diagnóstico responden HTTP `200`. El único bloqueo Meta observado antes de la
revisión es código `3` al usar Conversations/Send API, consistente con la
capability de Instagram Messaging aún no habilitada para esta App.
