import Operations from './operations';
import StudentServicesPage from './student/page';
import { redirect } from 'next/navigation';
import { getSupabaseUser } from '@/lib/supabase/server';
import { actor, identity, stmt, studentByIdentity } from '@/lib/server';
export const dynamic = "force-dynamic";

function AccessGate({ email }: { email?: string }) {
  const signedIn = Boolean(email);
  return (
    <main className="student-shell">
      <header className="student-header">
        <span className="student-brand">
          <span className="brand-mark">D↗</span>
          <span><strong>DEPI</strong><small>Round 5 operations</small></span>
        </span>
      </header>
      <section className="student-card student-error auth-gate" role="status">
        <div>
          <span className="student-kicker">SECURE WORKSPACE</span>
          <h1>{signedIn ? "Account access is not configured" : "Sign in to continue"}</h1>
          <p>
            {signedIn
              ? `${email} is signed in, but it is not linked to an active student or staff record. Ask the program administrator to add this exact email.`
              : "Use the Supabase account whose email is registered in the DEPI student or staff roster."}
          </p>
        </div>
        <div className="student-actions">
          {signedIn ? (
            <a className="student-secondary" href="/api/auth/logout">Use another account</a>
          ) : (
            <a className="student-primary" href="/login">Sign in</a>
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
    if (await studentByIdentity(i)) destination = "student";
    else {
      const userCount = await stmt("SELECT count(*) n FROM users").first<{ n: number }>();
      if (userCount?.n) await actor();
      destination = "staff";
    }
  } catch {}

  if (destination === "student") return <StudentServicesPage />;
  if (destination === "staff") return <Operations module="home"/>;
  return <AccessGate email={authUser.email} />;
}
