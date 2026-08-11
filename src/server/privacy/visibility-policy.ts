export type MaterialVisibility = "private" | "agent_only" | "citation_allowed" | "public_preview";
export type VisibilityConsumer = "candidate_preview" | "public_answer" | "public_highlight";

const policy = {
  candidate_preview: Object.freeze(["agent_only", "citation_allowed", "public_preview"]),
  public_answer: Object.freeze(["citation_allowed", "public_preview"]),
  public_highlight: Object.freeze(["public_preview"]),
} as const satisfies Record<VisibilityConsumer, readonly MaterialVisibility[]>;

export function allowedVisibilities(consumer: VisibilityConsumer): readonly MaterialVisibility[] {
  return policy[consumer];
}

export function canUseVisibility(consumer: VisibilityConsumer, visibility: MaterialVisibility) {
  return (policy[consumer] as readonly MaterialVisibility[]).includes(visibility);
}
