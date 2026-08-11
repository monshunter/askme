import { ShieldX } from "lucide-react";
import Link from "next/link";

export default function PublicAgentNotFound() {
  return <main className="public-unavailable"><Link className="public-wordmark" href="/">Askme <span aria-hidden="true">问候</span></Link><section><span><ShieldX size={34} /></span><h1>This Agent is unavailable</h1><p>The link may be unpublished, revoked, paused, expired, or incorrect. No private Candidate information has been exposed.</p><Link href="/">Return to Askme</Link></section></main>;
}
