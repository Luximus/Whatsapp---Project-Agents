import type {
  ConversationState,
  LeadProfile,
  MeetingProfile
} from "./types.js";

const MAX_HISTORY_ITEMS = 12;
const STATE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const conversations = new Map<string, ConversationState>();

function emptyLeadProfile(): LeadProfile {
  return { firstName: null, lastName: null, company: null, email: null, need: null };
}

function emptyMeetingProfile(): MeetingProfile {
  return { meetingDay: null, meetingDate: null, meetingTime: null, meetingReason: null };
}

function createInitialState(phoneE164: string, projectKey: string): ConversationState {
  const now = Date.now();
  return {
    projectKey,
    projectConfirmed: false,
    history: [],
    contextWindowStartedAt: now,
    lead: emptyLeadProfile(),
    pendingLeadField: null,
    pendingTopicSwitchMessage: null,
    pendingTopicSwitchProcess: null,
    awaitingProjectStatusName: false,
    meeting: emptyMeetingProfile(),
    supportTopic: null,
    supportOwnership: null,
    awaitingSupportOwnership: false,
    awaitingSupportTicketData: false,
    supportClosedAt: null,
    projectFollowupClosedAt: null,
    projectFollowupProjectName: null,
    projectFollowupSummary: null,
    awaitingMeetingData: false,
    meetingClosedAt: null,
    lastReplyStyle: null,
    openaiProjectPreviousResponseIds: {}
  };
}

export function getOrCreateState(phoneE164: string, projectKey: string): ConversationState {
  const existing = conversations.get(phoneE164);
  if (existing) return existing;

  const created = createInitialState(phoneE164, projectKey);
  conversations.set(phoneE164, created);
  return created;
}

export function getState(phoneE164: string): ConversationState | null {
  return conversations.get(phoneE164) ?? null;
}

export function updateState(phoneE164: string, partial: Partial<ConversationState>): void {
  const existing = conversations.get(phoneE164);
  if (!existing) return;
  Object.assign(existing, partial);
}

export function appendToHistory(
  phoneE164: string,
  entry: { role: "user" | "assistant"; text: string }
): void {
  const state = conversations.get(phoneE164);
  if (!state) return;
  state.history.push({ ...entry, at: Date.now() });
  if (state.history.length > MAX_HISTORY_ITEMS) {
    state.history = state.history.slice(-MAX_HISTORY_ITEMS);
  }
}

export function pruneExpiredStates(): void {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [phoneE164, state] of conversations.entries()) {
    const lastActivity = state.history.at(-1)?.at ?? state.contextWindowStartedAt;
    if (lastActivity < cutoff) {
      conversations.delete(phoneE164);
    }
  }
}

export function clearState(phoneE164: string): void {
  conversations.delete(phoneE164);
}
