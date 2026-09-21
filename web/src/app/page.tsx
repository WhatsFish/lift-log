import { Dashboard } from "@/components/Dashboard";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, validSession } from "@/lib/auth";

export default async function Page() {
  if (!validSession((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/lift-log/login");
  return <Dashboard />;
}
