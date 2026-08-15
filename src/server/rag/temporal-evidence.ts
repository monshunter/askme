import type { RetrievedRagEvidence } from "./hybrid-retriever";
import type { RagQueryPlan } from "./query-planner";

type QueryTimeRange = NonNullable<RagQueryPlan["constraints"]["timeRange"]>;
type EvidenceMonthRange = { start: string; end: string };

export type TemporalEvidenceAnnotation = {
  evidenceId: string;
  status: "overlap" | "outside" | "unknown";
  ranges: EvidenceMonthRange[];
};

function month(year: number, value: number) {
  return `${year}-${String(value).padStart(2, "0")}`;
}

function ordinal(value: string) {
  const [year, monthValue] = value.split("-").map(Number);
  return year! * 12 + monthValue!;
}

function validRange(start: string, end: string) {
  return ordinal(start) <= ordinal(end);
}

function uniqueRanges(ranges: EvidenceMonthRange[]) {
  const byKey = new Map<string, EvidenceMonthRange>();
  for (const range of ranges) {
    if (validRange(range.start, range.end)) byKey.set(`${range.start}:${range.end}`, range);
  }
  return [...byKey.values()].slice(0, 12);
}

export function extractEvidenceMonthRanges(content: string, currentMonth = new Date().toISOString().slice(0, 7)) {
  const normalized = content.normalize("NFKC");
  const ranges: EvidenceMonthRange[] = [];
  const occupied: Array<{ start: number; end: number }> = [];
  const detailed = /((?:19|20)\d{2})(?:[.\/-](\d{1,2})|年\s*(\d{1,2})月)?\s*(?:到|至|~|～|—|–|-)\s*(?:(今|现在|present|current)|((?:19|20)\d{2})(?:[.\/-](\d{1,2})|年\s*(\d{1,2})月)?)/giu;
  for (const match of normalized.matchAll(detailed)) {
    const startYear = Number(match[1]);
    const startMonth = Number(match[2] ?? match[3] ?? 1);
    const endYear = match[4] ? Number(currentMonth.slice(0, 4)) : Number(match[5]);
    const endMonth = match[4] ? Number(currentMonth.slice(5, 7)) : Number(match[6] ?? match[7] ?? 12);
    if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12 || !Number.isFinite(endYear)) continue;
    ranges.push({ start: month(startYear, startMonth), end: month(endYear, endMonth) });
    occupied.push({ start: match.index!, end: match.index! + match[0].length });
  }
  const singleYear = /(?:^|[^\d])((?:19|20)\d{2})\s*年?(?:[^\d]|$)/gu;
  for (const match of normalized.matchAll(singleYear)) {
    const index = match.index! + match[0].indexOf(match[1]!);
    if (occupied.some((span) => span.start <= index && span.end >= index + match[1]!.length)) continue;
    const year = Number(match[1]);
    ranges.push({ start: month(year, 1), end: month(year, 12) });
  }
  return uniqueRanges(ranges);
}

function overlaps(left: EvidenceMonthRange, right: QueryTimeRange) {
  return ordinal(left.start) <= ordinal(right.end) && ordinal(right.start) <= ordinal(left.end);
}

export function annotateTemporalEvidence(
  evidence: RetrievedRagEvidence[],
  queryRange: QueryTimeRange | null,
  currentMonth?: string,
): TemporalEvidenceAnnotation[] {
  return evidence.map((item) => {
    const ranges = extractEvidenceMonthRanges(item.parentContent, currentMonth);
    return {
      evidenceId: item.evidenceId,
      status: !queryRange || ranges.length === 0 ? "unknown" as const : ranges.some((range) => overlaps(range, queryRange)) ? "overlap" as const : "outside" as const,
      ranges,
    };
  });
}
