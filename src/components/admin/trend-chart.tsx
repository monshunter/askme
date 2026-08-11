"use client";

export type AdminTrendPoint = { date: string; candidates: number; publishedAgents: number; activeInterviews: number; citationUsage: number; flaggedContent: number };
export type TrendKey = Exclude<keyof AdminTrendPoint, "date">;

export const trendLabels: Record<TrendKey, string> = {
  candidates: "Candidates",
  publishedAgents: "Published Agents",
  activeInterviews: "Active Interviews",
  citationUsage: "Citation Usage",
  flaggedContent: "Flagged Content",
};

export function AdminTrendChart({ points, series }: { points: AdminTrendPoint[]; series: TrendKey }) {
  const values = points.map((point) => point[series]);
  const maximum = Math.max(1, ...values);
  const width = 700;
  const height = 220;
  const coordinates = values.map((value, index) => ({
    x: points.length <= 1 ? width / 2 : (index / (points.length - 1)) * width,
    y: height - (value / maximum) * (height - 28) - 12,
  }));
  const path = coordinates.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return <div className="admin-chart" aria-label={`${trendLabels[series]} trend`}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img">
      {[0.25, 0.5, 0.75, 1].map((fraction) => <line key={fraction} x1="0" x2={width} y1={height * fraction} y2={height * fraction} />)}
      {path ? <><path className="admin-chart-area" d={`${path} L${coordinates.at(-1)?.x ?? 0},${height} L0,${height} Z`} /><path className="admin-chart-line" d={path} />{coordinates.map((point, index) => <circle key={points[index]!.date} cx={point.x} cy={point.y} r="4"><title>{`${points[index]!.date}: ${values[index]}`}</title></circle>)}</> : null}
    </svg>
    <div className="admin-chart-labels">{points.map((point, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.floor(points.length / 5)) === 0 ? <span key={point.date}>{new Date(`${point.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span> : null)}</div>
  </div>;
}
