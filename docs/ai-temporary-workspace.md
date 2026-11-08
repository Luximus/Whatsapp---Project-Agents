# Recuperación de carpetas temporales de la IA

El runtime de WhatsApp conservaba TMPDIR=/tmp/claude-1003 del shell usado al
instalarlo. La carpeta había expirado. Codex y Qwen fallaban en mkdtemp antes de
llamar al modelo; Claude también heredaba un cwd inexistente. La cadena acababa
en ai_chat_chain_exhausted y el usuario recibía agent_unavailable.

Cada turno usa ahora un directorio privado y lo elimina al terminar. Si el root
temporal configurado desaparece, no es directorio o rechaza acceso, se crea uno
en ~/.cache/whatsapp-ai. Los hijos reciben TMPDIR/TMP/TEMP del turno y usan ese
mismo cwd. Se conservan modelos, orden de proveedores, sesión autenticada,
permisos readonly, formato JSON, cooldowns y el reintento de capacidad que ya
estaban desplegados. Estas últimas correcciones se sincronizan en main sin
retirarlas del runtime.

Activación: después de publicar y compilar el commit, instalar únicamente
cliChain.js y tempWorkspace.js junto a sus fuentes. Comprobar que no haya jobs
WhatsApp running o pending antes del restart del bridge bajo systemd. Ejecutar
scripts/repair-ai-temp-env.mjs con la ruta absoluta a whatsapp-bridge.env.json
primero sin --apply y después con --apply. Solo cambia TMPDIR a /tmp y conserva
el resto de la configuración; el recibo previo contiene exclusivamente esa clave
no secreta. No restaurar la carpeta efímera de Claude ni reinstalar proveedores.

Verificar una consulta real al agente con el entorno efectivo de systemd, sin
enviar mensajes de WhatsApp ni ejecutar acciones de negocio. Un health 200 no
verifica que la IA responda. No reenviar eventos anteriores ni resetear sus
marcadores de deduplicación. La prueba del directorio eliminado incluye un hijo
Node real que crea sus temporales dentro del workspace recuperado.
