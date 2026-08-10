"use client";

import { Bell, BookOpen, Bot, ChevronDown, Globe2, House, Menu, Monitor, Plus, Search, ShieldCheck, UploadCloud } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

type CandidateShellProps = {
  user: { displayName: string; headline: string | null; avatarUrl: string | null };
  children: ReactNode;
};

const navigation = [
  { href: "/workspace", label: "Dashboard", icon: House },
  { href: "/workspace/materials", label: "Upload Materials", icon: UploadCloud },
  { href: "/workspace/knowledge", label: "Knowledge Base", icon: BookOpen },
  { href: "/workspace/privacy", label: "Privacy Control", icon: ShieldCheck },
  { href: "/workspace/agent", label: "Agent Preview", icon: Monitor },
  { href: "/workspace/publish", label: "Publish Agent", icon: Globe2 },
];

function Navigation({ pathname, mobile = false, onNavigate }: { pathname: string; mobile?: boolean; onNavigate?: () => void }) {
  return (
    <nav className={mobile ? "candidate-nav candidate-nav-mobile" : "candidate-nav"} aria-label="Candidate navigation">
      {navigation.map(({ href, label, icon: Icon }) => {
        const active = href === "/workspace" ? pathname === href : pathname.startsWith(href);
        return (
          <Link key={href} className={active ? "candidate-nav-link active" : "candidate-nav-link"} href={href} aria-current={active ? "page" : undefined} onClick={onNavigate}>
            <Icon aria-hidden="true" size={21} strokeWidth={1.8} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function CandidateShell({ user, children }: CandidateShellProps) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const initials = user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="candidate-app">
      <aside className="candidate-sidebar">
        <Link className="candidate-wordmark" href="/workspace" aria-label="Askme Candidate Dashboard">
          Askme <span aria-hidden="true">问候</span>
        </Link>
        <Navigation pathname={pathname} />
        <div className="sidebar-art" aria-hidden="true"><span>知<br />行<br />合<br />一</span></div>
        <Link className="invite-card" href="/workspace/publish">
          <span className="round-icon"><Globe2 size={22} /></span>
          <span><strong>Invite Interviewers</strong><small>Share your Agent link with interviewers.</small></span>
          <ChevronDown className="side-chevron" size={17} />
        </Link>
      </aside>

      <div className="candidate-stage">
        <header className="candidate-topbar">
          <details className="mobile-nav-menu" open={mobileNavOpen} onToggle={(event) => setMobileNavOpen(event.currentTarget.open)}>
            <summary aria-label="Open navigation"><Menu size={22} /></summary>
            <div className="mobile-nav-popover">
              <Link className="candidate-wordmark compact" href="/workspace" onClick={() => setMobileNavOpen(false)}>Askme <span aria-hidden="true">问候</span></Link>
              <Navigation pathname={pathname} mobile onNavigate={() => setMobileNavOpen(false)} />
            </div>
          </details>
          <form className="global-search" action="/workspace/knowledge" method="get" role="search">
            <Search size={20} aria-hidden="true" />
            <label className="sr-only" htmlFor="global-search">Search your knowledge base</label>
            <input id="global-search" name="search" placeholder="Search your knowledge base..." />
            <kbd>⌘ K</kbd>
          </form>
          <div className="topbar-actions">
            <details className="quick-actions">
              <summary><Plus size={19} /> Quick Action <ChevronDown size={16} /></summary>
              <div className="quick-actions-menu">
                <Link href="/workspace/materials"><UploadCloud size={17} /> Upload material</Link>
                <Link href="/workspace/knowledge"><BookOpen size={17} /> Browse knowledge</Link>
                <Link href="/workspace/agent"><Bot size={17} /> Preview Agent</Link>
              </div>
            </details>
            <button className="icon-button notification-button" type="button" aria-label="Notifications are not configured" title="No new notifications">
              <Bell size={22} /><span aria-hidden="true" />
            </button>
            <details className="profile-menu">
              <summary>
                {/* Candidate avatar URLs are user data and may not belong to a preconfigured Next image host. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="avatar-fallback">{initials}</span>}
                <span className="profile-copy"><strong>{user.displayName}</strong><small>Candidate</small></span>
                <ChevronDown size={16} />
              </summary>
              <div className="profile-popover">
                <p>{user.headline ?? "Candidate"}</p>
                <form action="/api/auth/logout" method="post"><button type="submit">Sign out</button></form>
              </div>
            </details>
          </div>
        </header>
        <main className="candidate-main" id="main-content">{children}</main>
      </div>
    </div>
  );
}
