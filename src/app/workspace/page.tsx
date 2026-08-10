import { ArrowRight, BookOpen, Bot, Check, CircleAlert, FileText, MessageSquareText, Quote, ShieldCheck, UploadCloud } from "lucide-react";
import Link from "next/link";

import { requirePageUser } from "@/server/auth/current";
import { getCandidateDashboard } from "@/server/dashboard/dashboard-service";

const actionContent: Record<string, { title: string; copy: string; href: string; icon: typeof ShieldCheck }> = {
  configure_ai: { title: "Configure AI", copy: "Add a valid DeepSeek API key to organize materials.", href: "/workspace/materials", icon: Bot },
  review_failed_materials: { title: "Review failed materials", copy: "Read the error and retry after correcting the source.", href: "/workspace/materials", icon: CircleAlert },
  upload_materials: { title: "Upload career materials", copy: "Add resumes, projects, writing, and evidence.", href: "/workspace/materials", icon: UploadCloud },
  wait_for_processing: { title: "Materials are processing", copy: "The worker is extracting and organizing your evidence.", href: "/workspace/materials", icon: Bot },
  configure_privacy: { title: "Review Privacy Settings", copy: "Choose what your Agent may read and cite.", href: "/workspace/privacy", icon: ShieldCheck },
  preview_agent: { title: "Preview Your Agent", copy: "See how your Agent answers grounded questions.", href: "/workspace/agent", icon: Bot },
};

function prettyStatus(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(value));
}

export default async function WorkspacePage() {
  const user = await requirePageUser("candidate");
  const dashboard = await getCandidateDashboard(user.id);
  const metricCards = [
    { label: "Source Materials", value: dashboard.metrics.sourceMaterials, icon: FileText, tone: "teal" },
    { label: "Knowledge Items Indexed", value: dashboard.metrics.knowledgeItems, icon: BookOpen, tone: "green" },
    { label: "Public Citations", value: `${dashboard.citationRatio}%`, icon: Quote, tone: "blue" },
    { label: "Agent Status", value: prettyStatus(dashboard.agentStatus), icon: Bot, tone: "orange" },
  ];
  const workflowCopy: Record<string, { title: string; copy: string; icon: typeof UploadCloud }> = {
    materials: { title: "Upload Materials", copy: "Add resumes, projects, certificates, and more.", icon: UploadCloud },
    knowledge: { title: "Career Knowledge Base", copy: "We index and organize your knowledge with citations.", icon: BookOpen },
    agent: { title: "Candidate Agent", copy: "Your AI Agent learns from allowed career evidence.", icon: Bot },
    interviewer_chat: { title: "Interviewer Chat", copy: "Interviewers ask questions. Your Agent answers with citations.", icon: MessageSquareText },
  };

  return (
    <div className="candidate-page dashboard-page">
      <section className="page-hero dashboard-hero">
        <p className="page-kicker">Candidate Workspace</p>
        <h1>Don&apos;t browse my resume.<br /><em>Ask my Agent.</em> <span className="title-seal" aria-hidden="true">问候</span></h1>
        <p>Your career knowledge. Organized, verified, and ready for any question.<br />Let interviewers ask. Your Agent answers with evidence.</p>
      </section>

      <section className="metric-grid" aria-label="Workspace metrics">
        {metricCards.map(({ label, value, icon: Icon, tone }) => (
          <article className="metric-card" key={label}>
            <span className={`metric-icon ${tone}`}><Icon size={30} /></span>
            <span><small>{label}</small><strong>{value}</strong><span className="metric-note">From current workspace data</span></span>
          </article>
        ))}
      </section>

      <section className="paper-card workflow-card">
        <h2>Your Career Agent Workflow</h2>
        <div className="workflow-steps">
          {dashboard.workflow.map((step, index) => {
            const content = workflowCopy[step.id]!;
            const Icon = content.icon;
            return (
              <div className="workflow-fragment" key={step.id}>
                <article className={`workflow-step ${step.status}`}>
                  <span className="workflow-icon"><Icon size={28} /></span>
                  <h3><span>{index + 1}</span>{content.title}</h3>
                  <p>{content.copy}</p>
                  <small><Check size={13} /> {prettyStatus(step.status)}</small>
                </article>
                {index < dashboard.workflow.length - 1 ? <ArrowRight className="workflow-arrow" aria-hidden="true" /> : null}
              </div>
            );
          })}
        </div>
      </section>

      <div className="dashboard-lower-grid">
        <section className="paper-card recent-card">
          <div className="section-heading"><h2>Recent Materials</h2><Link href="/workspace/materials">View all</Link></div>
          {dashboard.recentMaterials.length === 0 ? (
            <div className="empty-state"><UploadCloud size={28} /><p>No materials yet.</p><Link className="text-link" href="/workspace/materials">Upload your first material</Link></div>
          ) : (
            <ul className="material-list compact-list">
              {dashboard.recentMaterials.map((material) => (
                <li key={String(material.id)}>
                  <span className="file-tile"><FileText size={18} /></span>
                  <span className="list-main"><strong>{String(material.title)}</strong><small>{String(material.kind).toUpperCase()} · {formatDate(material.createdAt as string)}</small></span>
                  <span className={`status-pill ${String(material.status)}`}>{prettyStatus(String(material.status))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="paper-card actions-card">
          <h2>Recommended Next Actions</h2>
          {dashboard.nextActions.length === 0 ? <div className="empty-state"><Check size={28} /><p>Your workspace is ready for the next stage.</p></div> : null}
          <div className="action-list">
            {dashboard.nextActions.map((action) => {
              const content = actionContent[action];
              if (!content) return null;
              const Icon = content.icon;
              return <Link href={content.href} key={action}><span className="round-icon"><Icon size={20} /></span><span><strong>{content.title}</strong><small>{content.copy}</small></span><ArrowRight size={17} /></Link>;
            })}
          </div>
          <p className="calligraphy-line" aria-hidden="true">其 料 实 料　自 信 应 答 <span>问</span></p>
        </section>
      </div>
      <footer className="candidate-footer"><span>© 2026 Askme. All rights reserved.</span><span>Privacy · Terms · Support</span><span>English</span></footer>
    </div>
  );
}
