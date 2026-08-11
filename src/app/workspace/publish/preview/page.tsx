import { ArrowLeft, BookOpen, Bot, FileText, Globe2, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

import { requirePageUser } from "@/server/auth/current";
import { loadCandidatePublicPreview } from "@/server/publication/public-agent-service";

export default async function CandidatePublicPreviewPage() {
  const user = await requirePageUser("candidate");
  const projection = await loadCandidatePublicPreview(user.id);
  return (
    <div className="candidate-page candidate-public-preview-page">
      <div className="preview-toolbar"><Link href="/workspace/publish"><ArrowLeft size={16} /> Back to publishing</Link><span><ShieldCheck size={16} /> Public-permission preview · {projection.agent.status}</span></div>
      <section className="paper-card public-profile-preview">
        <div className="public-preview-identity">
          <span className="public-avatar">
            {/* Candidate avatar URLs are user data and may not belong to a preconfigured Next image host. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {projection.profile.avatarUrl ? <img src={projection.profile.avatarUrl} alt="" /> : projection.profile.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}
          </span>
          <h1>{projection.profile.displayName}</h1><span className="public-agent-badge"><Globe2 size={14} /> Public Agent</span>
          <h2>{projection.profile.headline}</h2>{projection.profile.location ? <p><MapPin size={14} /> {projection.profile.location}</p> : null}
          <div className="public-bio">{projection.profile.bio ?? "Ask this Candidate Agent about authorized experience, projects, and skills."}</div>
        </div>
        <div className="public-preview-content">
          <p className="page-kicker">Interviewer View</p><h2>Don&apos;t browse my resume. <em>Ask my Agent.</em></h2>
          <p>Only published profile fields, public highlights, and evidence allowed for public answers appear here.</p>
          <div className="public-preview-stats"><span><BookOpen size={20} /><strong>{projection.stats.publicKnowledgeItems}</strong><small>Public knowledge items</small></span><span><FileText size={20} /><strong>{projection.stats.publicSources}</strong><small>Answerable sources</small></span><span><Bot size={20} /><strong>{projection.agent.status === "published" ? "Ready" : "Preview"}</strong><small>Agent status</small></span></div>
          <section className="public-highlight-preview"><h3><Sparkles size={18} /> Candidate Highlights</h3>{projection.highlights.length === 0 ? <p>No Public Preview highlights are enabled.</p> : <div>{projection.highlights.map((item) => <article key={item.id}><strong>{item.title}</strong><p>{item.summary}</p>{item.highlights.length > 0 ? <ul>{item.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul> : null}</article>)}</div>}</section>
          <section className="public-question-preview"><h3>Suggested interviewer questions</h3><div>{projection.suggestedQuestions.map((question) => <span key={question}>{question}</span>)}</div></section>
        </div>
      </section>
      <footer className="candidate-footer"><span>© 2026 Askme. All rights reserved.</span><span>Public-permission projection</span><span>English</span></footer>
    </div>
  );
}
