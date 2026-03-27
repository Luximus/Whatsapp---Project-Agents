export type WebhookMessage = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  reaction?: {
    emoji?: string;
    message_id?: string;
  };
  audio?: {
    id?: string;
    mime_type?: string;
    voice?: boolean;
  };
};

export type WebhookStatus = {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};
