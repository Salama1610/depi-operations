import { failure } from "@/lib/errors";
import { actor, rateLimit } from "@/lib/server";
import { ensure } from "@/lib/domain/rules";
import { portalFileCandidates, portalFileHosts } from "@/lib/portal-proof-link";

export const dynamic = "force-dynamic";

// Opens a portal proof wherever the portal holds the file (see
// lib/portal-proof-link): the address the sheet gives first, then the same
// path on the portal's other file server. Only the portal's own file servers
// are tried, so this cannot be pointed at any other site. Nothing is stored.

async function opens(url: string) {
  try {
    const r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, redirect: "manual", signal: AbortSignal.timeout(6000) });
    await r.body?.cancel();
    return r.status === 200 || r.status === 206 || (r.status >= 300 && r.status < 400);
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  let u: any = null;
  try {
    u = await actor();
    await rateLimit("portal-proof:" + u.id, 120, 60);
    const raw = new URL(req.url).searchParams.get("link") || "";
    let link: URL | null = null;
    try {
      link = new URL(raw);
    } catch {
      link = null;
    }
    ensure(link && link.protocol === "https:" && portalFileHosts.includes(link.hostname), "Only a proof on the ministry portal opens here.");
    const candidates = portalFileCandidates(link!.href);
    for (const candidate of candidates)
      if (await opens(candidate)) return new Response(null, { status: 302, headers: { Location: candidate, "Cache-Control": "no-store" } });
    // Neither server has it: the portal's own answer, as the sheet gives it.
    return new Response(null, { status: 302, headers: { Location: candidates[0], "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e, "portal-proof", { user: u });
  }
}
