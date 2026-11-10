import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "admin" | "bookkeeper" | "viewer";
export type Profile = { id: string; email: string; role: Role };

/** The signed-in user's profile (public.profiles, shared with the ledger app). */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, email, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!data) return null;
  return data as Profile;
}

export async function requireProfile(): Promise<Profile> {
  const p = await getProfile();
  if (!p) redirect("/login");
  return p;
}

/** Admins can do everything; bookkeepers can classify and upload payroll. */
export function canClassify(role: Role) {
  return role === "admin" || role === "bookkeeper";
}
export function isAdmin(role: Role) {
  return role === "admin";
}

export async function requireAdmin(): Promise<Profile> {
  const p = await requireProfile();
  if (!isAdmin(p.role)) redirect("/?denied=admin");
  return p;
}
