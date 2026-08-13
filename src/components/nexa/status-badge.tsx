import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CONVERSATION_STATUS_LABEL,
  LEAD_STATUS_LABEL,
  type ConversationStatus,
  type LeadStatus,
} from "@/lib/nexa/domain";

const CONVERSATION_TONE: Record<ConversationStatus, string> = {
  AI_ACTIVE: "bg-primary/10 text-primary border-primary/20",
  WAITING_HUMAN: "bg-destructive/10 text-destructive border-destructive/20",
  QUEUED: "bg-destructive/10 text-destructive border-destructive/20",
  ASSIGNED: "bg-accent/15 text-accent-foreground border-accent/30",
  HUMAN_ACTIVE: "bg-accent/15 text-accent-foreground border-accent/30",
  WAITING_CUSTOMER: "bg-muted text-muted-foreground border-border",
  CLOSED: "bg-muted text-muted-foreground border-border",
  PAUSED: "bg-muted text-muted-foreground border-border",
};

const LEAD_TONE: Record<LeadStatus, string> = {
  NEW: "bg-primary/10 text-primary border-primary/20",
  AI_QUALIFYING: "bg-primary/10 text-primary border-primary/20",
  QUALIFIED: "bg-accent/15 text-accent-foreground border-accent/30",
  WAITING_HUMAN: "bg-destructive/10 text-destructive border-destructive/20",
  IN_SERVICE: "bg-accent/15 text-accent-foreground border-accent/30",
  WAITING_CUSTOMER: "bg-muted text-muted-foreground border-border",
  WON: "bg-accent/20 text-accent-foreground border-accent/40",
  LOST: "bg-destructive/10 text-destructive border-destructive/20",
  ARCHIVED: "bg-muted text-muted-foreground border-border",
};

export function ConversationStatusBadge({ status }: { status: ConversationStatus }) {
  return (
    <Badge variant="outline" className={cn("font-medium", CONVERSATION_TONE[status])}>
      {CONVERSATION_STATUS_LABEL[status]}
    </Badge>
  );
}

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge variant="outline" className={cn("font-medium", LEAD_TONE[status])}>
      {LEAD_STATUS_LABEL[status]}
    </Badge>
  );
}
