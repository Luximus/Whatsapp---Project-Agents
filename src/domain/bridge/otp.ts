import { createHmac, randomInt, randomUUID } from "node:crypto";
import type { BridgeFlow, BridgeSessionRow } from "./types.js";

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function generateOtpReference(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function extractBridgeReference(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/(?:ref|referencia|session|sesion|id)\s*[:#-]?\s*([a-zA-Z0-9]{4,16})/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function flowDisplayName(flow: BridgeFlow): string {
  switch (flow) {
    case "verification": return "verificacion";
    case "login": return "inicio de sesion";
    case "register": return "registro";
    case "recovery": return "recuperacion";
  }
}

export function buildBridgeMessage(flow: BridgeFlow, code: string, otpRef: string): string {
  return `Tu codigo de ${flowDisplayName(flow)} es ${code}. REF ${otpRef}`;
}

export function resolveBridgeSessionStatus(
  session: Pick<BridgeSessionRow, "status" | "expires_at">
): BridgeSessionRow["status"] {
  if (session.status === "pending" && session.expires_at <= new Date()) {
    return "expired";
  }
  return session.status;
}

export function buildBridgeSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}
