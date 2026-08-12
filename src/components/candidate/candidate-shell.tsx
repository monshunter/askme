"use client";

import { Bell, BookOpen, ChevronDown, House, Menu, Monitor, Search, ShieldCheck, UploadCloud } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

import { useSearchShortcut } from "@/components/use-search-shortcut";
import { createTranslator, type Locale, type TranslationKey } from "@/i18n/core";

type CandidateShellProps = {
  user: { displayName: string; headline: string | null; avatarUrl: string | null };
  locale: Locale;
  children: ReactNode;
};

const navigation = [
  { href: "/workspace", labelKey: "candidate.nav.dashboard" as TranslationKey, icon: House },
  { href: "/workspace/materials", labelKey: "candidate.nav.materials" as TranslationKey, icon: UploadCloud },
  { href: "/workspace/knowledge", labelKey: "candidate.nav.knowledge" as TranslationKey, icon: BookOpen },
  { href: "/workspace/privacy", labelKey: "candidate.nav.privacy" as TranslationKey, icon: ShieldCheck },
  { href: "/workspace/agent", labelKey: "candidate.nav.agent" as TranslationKey, icon: Monitor },
];

function Navigation({ pathname, locale, mobile = false, onNavigate }: { pathname: string; locale: Locale; mobile?: boolean; onNavigate?: () => void }) {
  const t = createTranslator(locale);
  return (
    <nav className={mobile ? "candidate-nav candidate-nav-mobile" : "candidate-nav"} aria-label={t("candidate.nav.label")}>
      {navigation.map(({ href, labelKey, icon: Icon }) => {
        const active = href === "/workspace" ? pathname === href : pathname.startsWith(href);
        return (
          <Link key={href} className={active ? "candidate-nav-link active" : "candidate-nav-link"} href={href} aria-current={active ? "page" : undefined} onClick={onNavigate}>
            <Icon aria-hidden="true" size={21} strokeWidth={1.8} />
            <span>{t(labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function CandidateShell({ user, locale, children }: CandidateShellProps) {
  const t = createTranslator(locale);
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const searchRef = useSearchShortcut();
  const initials = user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="candidate-app">
      <a className="skip-link" href="#main-content">{t("shared.skip")}</a>
      <aside className="candidate-sidebar">
        <Link className="candidate-wordmark" href="/workspace" aria-label={t("candidate.home")}>
          Askme <span aria-hidden="true">职问</span>
        </Link>
        <Navigation pathname={pathname} locale={locale} />
        <div className="sidebar-art" aria-hidden="true"><span>知<br />行<br />合<br />一</span></div>
      </aside>

      <div className="candidate-stage">
        <header className="candidate-topbar">
          <details className="mobile-nav-menu" open={mobileNavOpen} onToggle={(event) => setMobileNavOpen(event.currentTarget.open)}>
            <summary aria-label={t("candidate.nav.open")}><Menu size={22} /></summary>
            <div className="mobile-nav-popover">
              <Link className="candidate-wordmark compact" href="/workspace" onClick={() => setMobileNavOpen(false)}>Askme <span aria-hidden="true">职问</span></Link>
              <Navigation pathname={pathname} locale={locale} mobile onNavigate={() => setMobileNavOpen(false)} />
            </div>
          </details>
          <form className="global-search" action="/workspace/knowledge" method="get" role="search">
            <Search size={20} aria-hidden="true" />
            <label className="sr-only" htmlFor="global-search">{t("candidate.search.label")}</label>
            <input ref={searchRef} id="global-search" name="search" placeholder={t("candidate.search.placeholder")} />
            <kbd>⌘ K</kbd>
          </form>
          <div className="topbar-actions">
            <button className="icon-button notification-button" type="button" aria-label={t("candidate.notifications")} title={t("candidate.notifications.empty")}>
              <Bell size={22} /><span aria-hidden="true" />
            </button>
            <details className="profile-menu">
              <summary>
                {/* Candidate avatar URLs are user data and may not belong to a preconfigured Next image host. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="avatar-fallback">{initials}</span>}
                <span className="profile-copy"><strong>{user.displayName}</strong><small>{t("shared.role.candidate")}</small></span>
                <ChevronDown size={16} />
              </summary>
              <div className="profile-popover">
                <p>{user.headline ?? t("candidate.profile.fallback")}</p>
                <form action="/api/auth/logout" method="post"><button type="submit">{t("candidate.signOut")}</button></form>
              </div>
            </details>
          </div>
        </header>
        <main className="candidate-main" id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
