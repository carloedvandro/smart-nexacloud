import { cn } from "@/lib/utils";

export function NexaLogo({
  className,
  inverted = false,
}: {
  className?: string;
  inverted?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="bg-brand-gradient flex size-9 items-center justify-center rounded-xl font-bold tracking-tight text-primary-foreground shadow-panel">
        N
      </span>
      <span className="leading-tight">
        <span
          className={cn(
            "block text-[0.98rem] font-semibold tracking-tight",
            inverted ? "text-sidebar-foreground" : "text-foreground",
          )}
        >
          Nexa<span className="text-primary">Atende</span>
          <span className="ml-1 rounded bg-primary/15 px-1 py-0.5 align-middle text-[0.58rem] font-bold uppercase tracking-wider text-primary">
            beta
          </span>
        </span>
        <span
          className={cn(
            "block text-[0.68rem]",
            inverted ? "text-sidebar-foreground/60" : "text-muted-foreground",
          )}
        >
          Atendimento inteligente
        </span>
      </span>
    </div>
  );
}
