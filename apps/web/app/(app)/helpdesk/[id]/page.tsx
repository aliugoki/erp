'use client';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { TicketDetail } from '@/components/helpdesk/ticket-detail';

/** Deep-link / shareable route for a single ticket. The full agent console lives at /helpdesk; this
 * renders the same conversation panel standalone for direct links and notifications. */
export default function TicketDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Link href="/helpdesk" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" /> All tickets</Link>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
        <TicketDetail id={params.id} />
      </div>
    </div>
  );
}
