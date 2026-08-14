import type { SettingsInput } from "./admin-input";

export type PlatformPolicies = {
  publicSessionHourlyLimit: number;
  publicChatMinuteLimit: number;
  negativeFeedbackAutoFlag: boolean;
};

export const DEFAULT_PLATFORM_POLICIES: PlatformPolicies = {
  publicSessionHourlyLimit: 20,
  publicChatMinuteLimit: 10,
  negativeFeedbackAutoFlag: true,
};

type PolicyRow = { key: string; value: unknown };

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

export function resolvePlatformPolicies(rows: PolicyRow[]): PlatformPolicies {
  const resolved = { ...DEFAULT_PLATFORM_POLICIES };
  for (const row of rows) {
    if (row.key === "public_session_hourly_limit") resolved.publicSessionHourlyLimit = boundedInteger(row.value, 1, 100) ?? resolved.publicSessionHourlyLimit;
    if (row.key === "public_chat_minute_limit") resolved.publicChatMinuteLimit = boundedInteger(row.value, 1, 60) ?? resolved.publicChatMinuteLimit;
    if (row.key === "negative_feedback_auto_flag" && typeof row.value === "boolean") resolved.negativeFeedbackAutoFlag = row.value;
  }
  return resolved;
}

export function policyEntries(input: SettingsInput): PolicyRow[] {
  const rows: PolicyRow[] = [];
  if (input.publicSessionHourlyLimit !== undefined) rows.push({ key: "public_session_hourly_limit", value: input.publicSessionHourlyLimit });
  if (input.publicChatMinuteLimit !== undefined) rows.push({ key: "public_chat_minute_limit", value: input.publicChatMinuteLimit });
  if (input.negativeFeedbackAutoFlag !== undefined) rows.push({ key: "negative_feedback_auto_flag", value: input.negativeFeedbackAutoFlag });
  return rows;
}
