import { redirect } from "next/navigation";
import { getSupabaseUser } from "@/lib/supabase/server";
import PasswordForm from "./password-form";

export const dynamic = "force-dynamic";

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const user = await getSupabaseUser();
  if (!user) redirect("/login");
  const first = (await searchParams).first === "1" && !user.user_metadata?.password_changed_at;
  return <PasswordForm first={first} />;
}
