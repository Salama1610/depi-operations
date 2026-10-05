import Operations from './operations';
import StudentServicesPage from './student/page';
import { redirect } from 'next/navigation';
import { getSupabaseUser } from '@/lib/supabase/server';
import { actor, identity, stmt, studentByIdentity } from '@/lib/server';
import { getT } from '@/lib/i18n/server';
import { LanguageToggle } from '@/lib/i18n/context';
export const dynamic = "force-dynamic";

async function AccessGate({ email }: { email?: string }) {
  const t = await getT();
  const signedIn = Boolean(email);
  return (
    <main className="student-shell">
      <header className="student-header">
        <span className="student-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static local logo; the Worker build does not run the image optimizer */}
          <img className="brand-mark-img" src="/brand/mark.png" alt="" width={34} height={34} />
          <span><strong>DEPI</strong><small>{t("Round 5 operations")}</small></span>
        </span>
        <LanguageToggle />
      </header>
      <section className="student-card student-error auth-gate" role="status">
        <div>
          <span className="student-kicker">{t("SECURE WORKSPACE")}</span>
          <h1>{signedIn ? t("Account access is not configured") : t("Sign in to continue")}</h1>
          <p>
            {signedIn
              ? t("{v0} is signed in, but it is not linked to an active student or staff record. Ask the program administrator to add this exact email.", { v0: email })
              : t("Use the Supabase account whose email is registered in the DEPI student or staff roster.")}
          </p>
        </div>
        <div className="student-actions">
          {signedIn ? (
            <a className="student-secondary" href="/api/auth/logout">{t("Use another account")}</a>
          ) : (
            <a className="student-primary" href="/login">{t("Sign in")}</a>
          )}
        </div>
      </section>
    </main>
  );
}

export default async function Page(){
  const authUser = await getSupabaseUser();
  if (!authUser) redirect("/login");

  let destination: "student" | "staff" | "denied" = "denied";
  try {
    const i = await identity();
    const userCount = await stmt(
      "SELECT count(*) n FROM users WHERE id NOT LIKE 'system-unassigned-%'",
    ).first<{ n: number }>();
    if (!userCount?.n) destination = "staff";
    else {
      try {
        await actor();
        destination = "staff";
      } catch {
        if (await studentByIdentity(i)) destination = "student";
      }
    }
  } catch {}

  if (destination === "student") return <StudentServicesPage />;
  if (destination === "staff") return <Operations module="home"/>;
  return <AccessGate email={authUser.email} />;
}
