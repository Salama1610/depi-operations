import { redirect } from "next/navigation";
import { getSupabaseUser } from "@/lib/supabase/server";
import PasswordForm from "./password-form";

export const dynamic = "force-dynamic";

export default async function UpdatePasswordPage() {
  if (!await getSupabaseUser()) redirect("/login");
  return <PasswordForm />;
}
