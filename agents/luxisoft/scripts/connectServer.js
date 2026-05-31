/**
 * Tool: conecta el asistente a un servidor del cliente en background. Si hay
 * varios servidores y no se indica `targetId`, devuelve la lista para elegir.
 * Requiere vínculo de 'luxipanel'.
 *
 * Aviso: al conectar a un servidor se empieza a consumir el saldo de datos (MB)
 * del cliente mientras se opera. Infórmaselo si es la primera vez.
 */
export default {
  name: "connectServer",
  description:
    "Conecta el asistente a un servidor del cliente (LUXIPANEL) para poder operarlo por chat. " +
    "Si hay varios servidores y no pasas targetId, devuelve la lista para que la persona elija. " +
    "Operar el servidor consume el saldo de datos (MB) del cliente. Requiere vínculo de luxipanel.",
  parameters: {
    type: "object",
    properties: {
      targetId: { type: "string", description: "ID del servidor a conectar (de listServers). Omitir para que elija si hay varios." }
    },
    additionalProperties: false
  },
  async execute(args, context) {
    const connect = context?.actions?.connectServer;
    if (typeof connect !== "function") return "error: servicios_no_disponibles";
    const targetId = String(args?.targetId ?? "").trim() || undefined;
    const res = await connect({ targetId });
    switch (res?.status) {
      case "connected":
        return `ok: conectado con el usuario "${res.linuxUser}" en ${res.serverName}. Ya puedes pedirle acciones con assistantSend (esto consume MB del cliente).`;
      case "choose": {
        const servers = res.servers ?? [];
        // El diferenciador suele ser el PANEL/servidor, no el usuario SSH (puede
        // haber un mismo usuario en varios paneles). Presenta SERVIDORES y, cuando
        // la persona elija uno, VUELVE A LLAMAR connectServer con SU id. No vuelvas
        // a preguntar lo mismo: cada opción ya trae su id, úsalo.
        const sameUser =
          servers.length > 0 && servers.every((s) => s.linuxUser === servers[0].linuxUser);
        const lines = servers
          .map((s) => {
            const label = s.panel ? `panel ${s.panel}` : s.name;
            return `- ${label} (servidor ${s.name}, usuario ${s.linuxUser}) id=${s.id}`;
          })
          .join("\n");
        const ask = sameUser
          ? "elige_servidor: hay un solo usuario SSH en varios paneles, así que pregúntale A QUÉ PANEL/SERVIDOR desea conectarse (NO le preguntes por el usuario)."
          : "elige_servidor: pregúntale A QUÉ SERVIDOR/PANEL desea conectarse.";
        return `${ask} En cuanto te diga cuál, llama connectServer otra vez con el id de esa opción.\n${lines}`;
      }
      case "disabled":
        return "error: usuario_ssh_desactivado. Ese acceso SSH está desactivado; actívalo (setSshUser) o elige otro.";
      case "auth_required":
        return "auth_required: pídele el código 2FA de su app y usa authenticate; luego reintenta connectServer.";
      case "no_servers":
        return "info: el cliente no tiene usuarios SSH registrados en LUXIPANEL.";
      case "not_linked":
        return "error: cuenta_no_vinculada. Vincula luxipanel con linkAccount primero.";
      default:
        return `error: no_pude_conectar${res?.message ? `: ${res.message}` : ""}`;
    }
  }
};
