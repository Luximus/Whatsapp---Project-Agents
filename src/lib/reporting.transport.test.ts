import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  transports: [] as unknown[],
  messages: [] as Array<{ envelope: { to: string[] }; message: Buffer }>
}));
vi.mock("../env.js", () => ({ env: {
  smtpHost: "smtp.example.invalid", smtpPort: 465, smtpSecure: true,
  smtpUser: "sender@example.invalid", smtpPass: "synthetic-fixture-only",
  smtpFrom: "sender@example.invalid", meetingQuoteEmailTo: "sales@example.invalid",
  supportTicketEmailTo: "support@example.invalid", reportTimezone: "UTC",
  reportLogoUrl: "https://example.invalid/logo.png"
} }));
vi.mock("nodemailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nodemailer")>();
  return { default: { ...actual.default, createTransport(options: unknown) {
    fixture.transports.push(options);
    const stream = actual.default.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    return { async sendMail(message: Parameters<typeof stream.sendMail>[0]) {
      const result = await stream.sendMail(message);
      fixture.messages.push(result);
      return result;
    } };
  } } };
});
import { sendMeetingQuoteEmail, sendProjectFollowupEmail, sendSupportTicketEmail } from "./reporting.js";

afterEach(() => {
  fixture.transports.length = 0;
  fixture.messages.length = 0;
  vi.restoreAllMocks();
});

const contact = { projectKey: "fixture", userPhone: "synthetic-contact", contactName: "Fixture Name",
  contactEmail: "contact@example.invalid", company: "Fixture Company" };
const flows = [
  { name: "meeting", recipient: "sales@example.invalid", run: () => sendMeetingQuoteEmail({ ...contact,
    meetingDay: "Monday", meetingDate: "2026-10-19", meetingTime: "10:00", reason: "Synthetic quote", notifiedHuman: false }) },
  { name: "support", recipient: "support@example.invalid", run: () => sendSupportTicketEmail({ ...contact,
    topic: "Synthetic support", summary: "Fixture summary", transcript: ["Synthetic only"] }) },
  { name: "follow-up", recipient: "support@example.invalid", run: () => sendProjectFollowupEmail({ ...contact,
    projectName: "Fixture project", summary: "Fixture summary", urgency: null }) }
];
for (const flow of flows) {
  it(`renders and composes the ${flow.name} email with the configured envelope without SMTP`, async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = await flow.run();
    expect(result).toEqual({ ok: true, sent: true });
    expect(fixture.transports).toEqual([{ host: "smtp.example.invalid", port: 465, secure: true,
      auth: { user: "sender@example.invalid", pass: "synthetic-fixture-only" } }]);
    expect(fixture.messages).toHaveLength(1);
    expect(fixture.messages[0].envelope.to).toEqual([flow.recipient]);
    const message = fixture.messages[0].message.toString();
    expect(message).toContain("Content-Type: multipart/alternative");
    expect(message).toContain("text/html");
    expect(message).toContain("text/plain");
  });
}
