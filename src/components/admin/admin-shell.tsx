"use client";

import { BarChart3, Bell, Bot, ChevronDown, FileSearch, House, Menu, Plus, Search, Settings, ShieldCheck, UserRoundPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

const navigation = [
  { href: "/admin", label: "Overview", icon: House },
  { href: "/admin/candidates", label: "Candidates", icon: UsersRound },
  { href: "/admin/agents", label: "Published Agents", icon: Bot },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/reviews", label: "Content Review", icon: ShieldCheck },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

function AdminNavigation({ pathname, onNavigate, mobile = false }: { pathname: string; onNavigate?: () => void; mobile?: boolean }) {
  return <nav className={mobile ? "admin-nav admin-nav-mobile" : "admin-nav"} aria-label="Platform Admin navigation">{navigation.map(({ href, label, icon: Icon }) => {
    const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
    return <Link href={href} key={href} className={active ? "admin-nav-link active" : "admin-nav-link"} aria-current={active ? "page" : undefined} onClick={onNavigate}><Icon size={21} strokeWidth={1.8} /><span>{label}</span></Link>;
  })}</nav>;
}

export function AdminShell({ user, children }: { user: { displayName: string; avatarUrl: string | null }; children: ReactNode }) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const initials = user.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <div className="admin-app">
    <aside className="admin-sidebar">
      <Link className="admin-wordmark" href="/admin">Askme <span aria-hidden="true">问候</span></Link>
      <AdminNavigation pathname={pathname} />
      <div className="admin-sidebar-art" aria-hidden="true"><span>知<br />行<br />合<br />一</span></div>
      <Link className="admin-invite-card" href="/admin/settings#invite"><UserRoundPlus size={21} /><span><strong>Invite Admin</strong><small>Add team members when mail is configured.</small></span></Link>
    </aside>
    <div className="admin-stage">
      <header className="admin-topbar">
        <details className="admin-mobile-menu" open={mobileNavOpen} onToggle={(event) => setMobileNavOpen(event.currentTarget.open)}>
          <summary aria-label="Open Admin navigation"><Menu size={22} /></summary>
          <div className="admin-mobile-popover"><Link className="admin-wordmark compact" href="/admin" onClick={() => setMobileNavOpen(false)}>Askme <span aria-hidden="true">问候</span></Link><AdminNavigation pathname={pathname} mobile onNavigate={() => setMobileNavOpen(false)} /></div>
        </details>
        <form className="admin-global-search" action="/admin/search" method="get" role="search"><Search size={20} /><label className="sr-only" htmlFor="admin-global-search">Search candidates, Agents, and safe review summaries</label><input id="admin-global-search" name="q" minLength={2} maxLength={120} placeholder="Search candidates, agents, reviews..." /><kbd>⌘ K</kbd></form>
        <div className="admin-topbar-actions">
          <details className="admin-quick-actions"><summary><Plus size={19} /> Quick Action <ChevronDown size={16} /></summary><div><Link href="/admin/reviews"><FileSearch size={17} /> Review content queue</Link><Link href="/admin/agents"><Bot size={17} /> Manage Agents</Link><Link href="/admin/settings#invite"><UserRoundPlus size={17} /> Invite Admin</Link></div></details>
          <button className="admin-notification" type="button" aria-label="Admin notifications are not configured" title="Notifications are not configured"><Bell size={22} /></button>
          <details className="admin-profile"><summary>{user.avatarUrl ? <>
            {/* Admin avatar URLs are user data and may not belong to a configured Next image host. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={user.avatarUrl} alt="" />
          </> : <span>{initials}</span>}<i><strong>{user.displayName}</strong><small>Platform Admin</small></i><ChevronDown size={16} /></summary><div><p>Authenticated Platform Admin</p><form action="/api/auth/logout" method="post"><button type="submit">Sign out</button></form></div></details>
        </div>
      </header>
      <main className="admin-main" id="main-content">{children}</main>
    </div>
  </div>;
}
