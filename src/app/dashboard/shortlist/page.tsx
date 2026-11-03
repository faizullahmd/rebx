import { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getShortlistForCustomer } from "@/lib/data/shortlist";
import { ShortlistView } from "./ShortlistView";

export const metadata: Metadata = {
  title: "Shortlist | REBX",
  description: "View and manage your shortlisted properties.",
};

export default async function ShortlistPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=" + encodeURIComponent("/dashboard/shortlist"));
  }

  if (session.user.role !== "CUSTOMER") {
    redirect("/unauthorized");
  }

  const initialItems = await getShortlistForCustomer(Number(session.user.id));

  return <ShortlistView initialItems={initialItems} />;
}
