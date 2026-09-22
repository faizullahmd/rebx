import { PublicNav } from "@/components/nav/PublicNav";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-gray-200 py-6 text-center text-sm text-gray-500">
        REBX — Real Estate Broker Exchange
      </footer>
    </>
  );
}
