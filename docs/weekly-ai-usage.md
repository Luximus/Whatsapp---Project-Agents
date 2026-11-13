# Uso semanal de IA

La activación `billing_ai_usage_program.enabled` sustituye los saldos monetarios
incluidos anteriores por un cupo de IA independiente de compras y facturación.
Free x1=4.000, Plus x5=20.000, Premium x10=40.000, Negocio x15=60.000 unidades
internas actuales (10 centavos COP por unidad). No son tokens técnicos.

La primera reserva aceptada inicia un anclaje de 168 horas. Cada período conserva
reservado y consumido; los períodos inactivos no acumulan cupo. Los cambios de plan
ajustan la capacidad efectiva sin borrar uso ni cambiar el anclaje. Se consume
primero el cupo y después fondos comprados. Cada reserva conserva el ID del
período y el reparto de financiación. Reintentos no vuelven a gastar; liberar
una reserva antigua no repone un período nuevo. Cargos de infraestructura y
Zadarma no consumen el cupo. Se conserva la exención por operación patrocinada.

La migración de cuenta se hace bajo su bloqueo habitual: expira fondos incluidos
anteriores mediante ledger, sin tocar compras, reservas ni su historial. No se
vuelve a emitir Free mensual ni bienvenida monetaria. Las compras únicas y
complementos pagados conservan sus condiciones. No habilitar paquetes comerciales
ni cambiar sus precios como parte de esta activación.

API pública: `aiUsage` versión 1 por plan y dentro de `customerRole`; multiplicador,
rolling_week, 604800 segundos, sin acumulación y topupsOptional. freeAllowance y
tokenAllowance pasan a null. API privada: copBalance.aiUsage, porcentaje restante,
inicio/renovación y estado; los datos COP internos sirven para reserva, nunca para
unir el medidor con compras. copBalance.prepaidCopCents sigue siendo saldo comprado.
Las interfaces anteriores se mantienen mientras la activación esté apagada.

Despliegue: migración incremental y backend preparados con activación apagada;
interfaz y herramientas WhatsApp; activar y refrescar solo caché de catálogo de
Luxisoft. Verificar saldos comprados y reservas por hash antes/después. Si hay un
fallo, detener nuevas operaciones y reconciliar los períodos y fondos antes de
revertir; nunca restaurar una DB antigua sobre compras nuevas.
