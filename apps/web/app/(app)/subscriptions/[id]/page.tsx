'use client';
import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { SubscriptionDetail } from '@/components/subscriptions/subscription-detail';

/** Deep-link / shareable route for a single subscription. The full three-pane workspace lives at
 * /subscriptions; this renders the same detail panel standalone for direct links and notifications. */
export default function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Link href="/subscriptions" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Subscriptions</Link>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
        <SubscriptionDetail id={id} />
      </div>
    </div>
  );
}
