export const BRIDGE_FLOWS = ["verification", "login", "register", "recovery"] as const;
export type BridgeFlow = (typeof BRIDGE_FLOWS)[number];

export type BridgeSessionStatus = "pending" | "verified" | "expired" | "cancelled";
export type BridgeEventStatus = "pending" | "processing" | "delivered" | "failed";

export type BridgeSessionRow = {
  id: string;
  project_key: string;
  flow: BridgeFlow;
  user_ref: string | null;
  correlation_id: string | null;
  phone_e164: string;
  code: string;
  otp_ref: string;
  status: BridgeSessionStatus;
  attempts: number;
  expires_at: Date;
  verified_at: Date | null;
  callback_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

export type BridgeEventRow = {
  id: number;
  session_id: string;
  project_key: string;
  event_type: string;
  payload: Record<string, unknown>;
  delivery_status: BridgeEventStatus;
  delivery_attempts: number;
  next_retry_at: Date;
  processing_started_at: Date | null;
  callback_url: string | null;
  delivered_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

export type BridgeProjectConfig = {
  apiKey: string;
  callbackUrl: string | null;
  callbackSecret: string | null;
};
