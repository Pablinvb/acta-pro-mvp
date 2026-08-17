import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/meeting-state";
import type { MeetingStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: MeetingStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
