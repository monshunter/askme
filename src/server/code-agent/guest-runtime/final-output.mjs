export function parseFinalJson(text) {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("model output does not contain a JSON object");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

export function selectFinalAssistantText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
    if (text.trim().length > 0) return { message, text };
  }
  return null;
}
