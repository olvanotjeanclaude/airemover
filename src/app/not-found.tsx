import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          There is only one page here, and it does everything. Head back to the cleaner.
        </p>
        <Button className="mt-8" asChild>
          <Link href="/">Go to the cleaner</Link>
        </Button>
      </div>
    </main>
  );
}
