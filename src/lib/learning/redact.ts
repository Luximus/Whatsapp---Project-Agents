const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]"],
  [/(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/g, "[TELEFONO]"],
  [/\b\d{6}\b/g, "[CODIGO]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[ID]"],
  [/\b(?:bearer|token|api[_ -]?key|secret|password|contrase(?:ña|na))\s*[:=]\s*\S+/gi, "[SECRETO]"],
  [/([?&](?:token|key|secret|code|signature)=)[^&#\s]+/gi, "$1[REDACTADO]"]
];

export function redactLearningText(value: string): string {
  // eslint-disable-next-line no-control-regex
  let output = String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
  for (const [pattern, replacement] of REPLACEMENTS) output = output.replace(pattern, replacement);
  return output.trim();
}

export function isLearningEligibleMessage(input: {
  actor: string;
  content: string;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if (input.metadata?.learningEligible === false || input.metadata?.sensitiveFlow === true) return false;
  const text = input.content.trim();
  if (!text) return false;
  if (/^SOLICITAR\s+CODIGO\s+LUXISOFT\s+REF\b/i.test(text)) return false;
  if (/^(?:tu\s+)?c[oó]digo\b/i.test(text) && /\b\d{6}\b/.test(text)) return false;
  return ["contact", "ai", "human"].includes(input.actor);
}
