/**
 * Tool: lista los servidores del cliente vinculado a LUXIPANEL, para elegir a
 * cuál conectarse. Requiere vínculo de 'luxipanel'.
 */
export default {
  name: "listServers",
  description:
    "Lista los accesos/usuarios SSH del cliente: usuario SSH, host, puerto, panel relacionado y si está activo o desactivado. " +
    "Úsala para ver qué usuarios SSH existen y a qué panel pertenecen. Requiere vínculo de luxipanel.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(_args, context) {
    const list = context?.actions?.listServers;
    if (typeof list !== "function") return "error: servicios_no_disponibles";
    const res = await list();
    switch (res?.status) {
      case "ok": {
        const servers = res.servers ?? [];
        if (!servers.length) return "info: el cliente no tiene usuarios SSH registrados en LUXIPANEL.";
        return (
          "usuarios_ssh:\n" +
          servers
            .map(
              (s) =>
                `- usuario "${s.linuxUser}" en ${s.host}${s.port ? `:${s.port}` : ""}` +
                `${s.panel ? ` · panel: ${s.panel}` : ""} · ${s.enabled ? "ACTIVO" : "DESACTIVADO"}` +
                `${s.status ? ` · ${s.status}` : ""} · id=${s.id}`
            )
            .join("\n")
        );
      }
      case "auth_required":
        return "auth_required: pídele el código 2FA de su app y usa authenticate; luego reintenta.";
      case "not_linked":
        return "error: cuenta_no_vinculada. Vincula luxipanel con linkAccount primero.";
      default:
        return `error: no_pude_listar${res?.message ? `: ${res.message}` : ""}`;
    }
  }
};
