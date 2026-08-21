export type LearningDb = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};

export type LearningActor = { userId: string; email: string };

export type LearningMessage = {
  id: string;
  actor: "contact" | "ai" | "human" | "system";
  direction: "inbound" | "outbound";
  kind: string;
  content: string;
  deliveryStatus: string;
  createdAt: string;
};

export type DailyConversation = {
  id: string;
  channel: "whatsapp" | "messenger";
  messages: LearningMessage[];
};

export type LearningCheck = {
  name: string;
  ok: boolean;
  output: string;
  durationMs: number;
};

export type LearningLogger = Pick<Console, "info" | "warn" | "error">;
