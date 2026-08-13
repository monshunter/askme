"use client";

import { BarChart3, Bell, Bot, ChevronDown, Github, House, Menu, Settings, ShieldCheck, UserRoundPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

import { createTranslator, type Locale, type TranslationKey } from "@/i18n/core";

const navigation = [
  { href: "/admin", labelKey: "admin.nav.overview" as TranslationKey, icon: House },
  { href: "/admin/candidates", labelKey: "admin.nav.candidates" as TranslationKey, icon: UsersRound },
  { href: "/admin/agents", labelKey: "admin.nav.agents" as TranslationKey, icon: Bot },
  { href: "/admin/repositories", labelKey: "admin.nav.repositories" as TranslationKey, icon: Github },
  { href: "/admin/reports", labelKey: "admin.nav.reports" as TranslationKey, icon: BarChart3 },
  { href: "/admin/reviews", labelKey: "admin.nav.reviews" as TranslationKey, icon: ShieldCheck },
  { href: "/admin/settings", labelKey: "admin.nav.settings" as TranslationKey, icon: Settings },
];

function AdminNavigation({ pathname, locale, onNavigate, mobile = false }: { pathname: string; locale: Locale; onNavigate?: () => void; mobile?: boolean }) {
  const t = createTranslator(locale);
  return <nav className={mobile ? "admin-nav admin-nav-mobile" : "admin-nav"} aria-label={t("admin.nav.label")}>{navigation.map(({ href, labelKey, icon: Icon }) => {
    const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
    return <Link href={href} key={href} className={active ? "admin-nav-link active" : "admin-nav-link"} aria-current={active ? "page" : undefined} onClick={onNavigate}><Icon size={21} strokeWidth={1.8} /><span>{t(labelKey)}</span></Link>;
  })}</nav>;
}

export function AdminShell({ user, locale, children }: { user: { displayName: string; avatarUrl: string | null }; locale: Locale; children: ReactNode }) {
  const t = createTranslator(locale);
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const initials = user.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <div className="admin-app">
    <a className="skip-link" href="#main-content">{t("shared.skip")}</a>
    <aside className="admin-sidebar">
      <Link className="admin-wordmark" href="/admin" aria-label={t("admin.home")}>Askme <span aria-hidden="true">职问</span></Link>
      <AdminNavigation pathname={pathname} locale={locale} />
      <div className="admin-sidebar-art" aria-hidden="true"><span>知<br />行<br />合<br />一</span></div>
      <Link className="admin-invite-card" href="/admin/settings#invite"><UserRoundPlus size={21} /><span><strong>{t("admin.invite.title")}</strong><small>{t("admin.invite.copy")}</small></span></Link>
    </aside>
    <div className="admin-stage">
      <header className="admin-topbar">
        <details className="admin-mobile-menu" open={mobileNavOpen} onToggle={(event) => setMobileNavOpen(event.currentTarget.open)}>
          <summary aria-label={t("admin.nav.open")}><Menu size={22} /></summary>
          <div className="admin-mobile-popover"><Link className="admin-wordmark compact" href="/admin" onClick={() => setMobileNavOpen(false)}>Askme <span aria-hidden="true">职问</span></Link><AdminNavigation pathname={pathname} locale={locale} mobile onNavigate={() => setMobileNavOpen(false)} /></div>
        </details>
        <div className="admin-topbar-actions">
          <button className="admin-notification" type="button" aria-label={t("admin.notifications")} title={t("admin.notifications.title")}><Bell size={22} /></button>
          <details className="admin-profile"><summary>{user.avatarUrl ? <>
            {/* Admin avatar URLs are user data and may not belong to a configured Next image host. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={user.avatarUrl} alt="" />
          </> : <span>{initials}</span>}<i><strong>{user.displayName}</strong><small>{t("shared.role.admin")}</small></i><ChevronDown size={16} /></summary><div><p>{t("admin.profile.authenticated")}</p><form action="/api/auth/logout" method="post"><button type="submit">{t("admin.signOut")}</button></form></div></details>
        </div>
      </header>
      <main className="admin-main" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
