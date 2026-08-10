import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <main className="login-page">
      <section className="login-story" aria-labelledby="login-story-title">
        <Link className="wordmark" href="/" aria-label="Askme home">
          Askme <span aria-hidden="true">问候</span>
        </Link>
        <div className="story-copy">
          <p className="eyebrow">Personal Career Knowledge Agent</p>
          <h1 id="login-story-title">Don&apos;t browse my resume. Ask my Agent.</h1>
          <p>Turn your real career materials into an evidence-based Agent that interviewers can ask.</p>
        </div>
        <p className="trust-line"><ShieldCheck size={18} /> Your source materials stay private until you decide what can be used.</p>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <p className="seal" aria-hidden="true">问候</p>
          <h2 id="login-title">Welcome back</h2>
          <p className="muted">Sign in to manage your career Agent or the Askme platform.</p>

          {error ? <p className="form-error" role="alert">{error}</p> : null}

          <form action="/api/auth/login" method="post">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
            <button type="submit">Sign in <ArrowRight size={18} /></button>
          </form>
          <p className="local-note">Local accounts are configured through Docker environment variables.</p>
        </div>
      </section>
    </main>
  );
}
