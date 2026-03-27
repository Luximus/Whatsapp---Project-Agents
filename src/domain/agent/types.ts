import { z } from "zod";

// ─── Lead / Meeting profiles ────────────────────────────────────────────────

export type LeadProfile = {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  email: string | null;
  need: string | null;
};

export type MeetingProfile = {
  meetingDay: string | null;
  meetingDate: string | null;
  meetingTime: string | null;
  meetingReason: string | null;
};

// ─── Conversation state ──────────────────────────────────────────────────────

export type SupportOwnership = "luxisoft" | "third_party";
export type ActiveProcessKind =
  | "project_status_name"
  | "support_ownership"
  | "support_data"
  | "meeting_data";

export type ConversationState = {
  projectKey: string;
  projectConfirmed: boolean;
  history: Array<{ role: "user" | "assistant"; text: string; at: number }>;
  contextWindowStartedAt: number;
  lead: LeadProfile;
  pendingLeadField: keyof LeadProfile | null;
  pendingTopicSwitchMessage: string | null;
  pendingTopicSwitchProcess: ActiveProcessKind | null;
  awaitingProjectStatusName: boolean;
  meeting: MeetingProfile;
  supportTopic: string | null;
  supportOwnership: SupportOwnership | null;
  awaitingSupportOwnership: boolean;
  awaitingSupportTicketData: boolean;
  supportClosedAt: number | null;
  projectFollowupClosedAt: number | null;
  projectFollowupProjectName: string | null;
  projectFollowupSummary: string | null;
  awaitingMeetingData: boolean;
  meetingClosedAt: number | null;
  lastReplyStyle: ReplyStyle | null;
  openaiProjectPreviousResponseIds: Record<string, string>;
};

// ─── Reply planning ──────────────────────────────────────────────────────────

export type ReplyStyle = "natural" | "bullets" | "question" | "steps";
export type LinkPolicy = "avoid_links" | "one_link_if_helpful" | "links_if_requested";

export type ReplyPlan = {
  style: ReplyStyle;
  linkPolicy: LinkPolicy;
};

// ─── Knowledge cache ─────────────────────────────────────────────────────────

export type ProjectKnowledgeSource = {
  sourceUrl: string;
  text: string;
  snippets: string[];
  links: string[];
};

export type ProjectKnowledgeDictionary = {
  projectKey: string;
  sources: Record<string, ProjectKnowledgeSource>;
};

export type CachedKnowledge = {
  loadedAt: number;
  text: string;
  dictionary: ProjectKnowledgeDictionary;
};

export type CrawledKnowledgePage = {
  sourceUrl: string;
  raw: string;
  text: string;
  snippets: string[];
  links: string[];
};

// ─── Project status ──────────────────────────────────────────────────────────

export type ConfiguredProjectStatusEntry = {
  name: string;
  aliases: string[];
  statusParagraph: string | null;
};

// ─── Agent result ─────────────────────────────────────────────────────────────

export type ProjectAgentResult = {
  projectKey: string;
  answer: string;
  toolsUsed: string[];
  responseId: string | null;
  turnAnalysis: TurnAnalysis | null;
};

export type AgentReply = {
  handled: boolean;
  projectKey: string;
  reply: string;
  escalated: boolean;
  escalationSent: boolean;
};

// ─── Turn analysis (Zod schema + inferred type) ──────────────────────────────

export const TurnAnalysisSchema = z.object({
  case_type: z.enum([
    "project_status",
    "project_followup",
    "project_status_name_required",
    "support_with_us",
    "support_third_party",
    "support_ownership_required",
    "closed_support",
    "closed_meeting",
    "meeting_request",
    "sales_or_discovery",
    "general"
  ]),
  recommended_action: z.enum([
    "lookup_project_status",
    "register_project_followup",
    "ask_project_name",
    "ask_support_ownership",
    "collect_support_data",
    "register_support_ticket",
    "collect_meeting_data",
    "schedule_meeting_request",
    "reset_case_state",
    "continue_sales_discovery",
    "general_reply",
    "closed_case_notice"
  ]),
  support_ownership: z.enum(["luxisoft", "third_party", "unknown"]),
  matched_project_name: z.string().trim().min(1).max(120).nullable(),
  rationale: z.string().trim().min(1).max(320),
  next_question_goal: z.string().trim().min(1).max(220).nullable()
});

export type TurnAnalysis = z.infer<typeof TurnAnalysisSchema>;

// ─── Conversation case analysis (extended turn analysis) ──────────────────────

export type SupportFieldKey = keyof LeadProfile;
export type MeetingFieldKey = keyof MeetingProfile;

export type ConversationCaseAnalysis = {
  ok: true;
  case_type:
    | "identity_request"
    | "privacy_request"
    | "project_status"
    | "project_followup"
    | "project_status_name_required"
    | "support_with_us"
    | "support_third_party"
    | "support_ownership_required"
    | "closed_support"
    | "closed_meeting"
    | "meeting_request"
    | "sales_or_discovery"
    | "general";
  recommended_action:
    | "answer_identity"
    | "answer_privacy"
    | "lookup_project_status"
    | "register_project_followup"
    | "ask_project_name"
    | "ask_support_ownership"
    | "collect_support_data"
    | "register_support_ticket"
    | "collect_meeting_data"
    | "schedule_meeting_request"
    | "reset_case_state"
    | "continue_sales_discovery"
    | "general_reply"
    | "closed_case_notice";
  support_topic: string | null;
  support_ownership: SupportOwnership | null;
  matched_project_name: string | null;
  project_name_required: boolean;
  support_closed: boolean;
  meeting_closed: boolean;
  reopen_signal: "support" | "meeting" | "general" | null;
  lead_profile: LeadProfile;
  meeting_profile: MeetingProfile;
  support_missing_fields: SupportFieldKey[];
  meeting_missing_lead_fields: SupportFieldKey[];
  meeting_missing_fields: MeetingFieldKey[];
  next_support_field: SupportFieldKey | null;
  next_support_question: string | null;
  next_meeting_field: SupportFieldKey | MeetingFieldKey | null;
  next_meeting_question: string | null;
  notes: string[];
};

// ─── Routing decision ────────────────────────────────────────────────────────

export type RoutingDecision =
  | { kind: "support_project"; projectKey: string }
  | { kind: "support_project_unknown" }
  | { kind: "sales_project"; projectKey: string }
  | { kind: "sales_offer_catalog" }
  | { kind: "meeting_interest" }
  | { kind: "human_scope_check" }
  | { kind: "general" };
