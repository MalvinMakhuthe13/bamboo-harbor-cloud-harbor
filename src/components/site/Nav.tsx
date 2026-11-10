import { Link } from "@tanstack/react-router";

export function Nav({ tone = "paper" }: { tone?: "paper" | "ink" }) {
  const bar = tone === "ink" ? "bg-ink text-paper" : "bg-paper text-ink";
  const quiet = tone === "ink" ? "text-muted" : "text-ink-muted";
  return (
    <header className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 ${bar}`}>
      <Link to="/" className="flex min-h-11 items-center gap-3">
        <img src="/favicon.svg" alt="" className="h-9 w-9" />
        <span className="font-display text-xl leading-none tracking-tight">Isibuko</span>
      </Link>
      <nav className={`flex flex-wrap items-center gap-1 text-sm ${quiet}`}>
        <Link to="/rail" className="inline-flex min-h-11 items-center rounded-full px-3">
          Rail
        </Link>
        <Link to="/mirror" className="inline-flex min-h-11 items-center rounded-full px-3">
          Mirror
        </Link>
        <Link to="/studio" className="inline-flex min-h-11 items-center rounded-full px-3">
          Studio
        </Link>
        <Link to="/science" className="inline-flex min-h-11 items-center rounded-full px-3">
          Fit math
        </Link>
        <Link to="/bench" className="inline-flex min-h-11 items-center rounded-full px-3">
          Engine
        </Link>
        <Link to="/lab" className="inline-flex min-h-11 items-center rounded-full px-3">
          Lab
        </Link>
      </nav>
    </header>
  );
}
