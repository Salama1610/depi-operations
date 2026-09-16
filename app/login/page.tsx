import { redirect } from "next/navigation";
import { getSupabaseUser, isSupabaseConfigured } from "@/lib/supabase/server";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSupabaseUser()) redirect("/");
  return <LoginForm configured={isSupabaseConfigured()} />;
}
