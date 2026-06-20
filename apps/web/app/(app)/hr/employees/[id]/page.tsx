'use client';
import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { EmployeeDetail } from '@/components/hr/employee-detail';

/** Deep-link / shareable route for one employee. The full HR three-pane workspace lives at /hr; this
 * renders the same detail panel standalone for direct links. */
export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Link href="/hr" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Human Resources</Link>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
        <EmployeeDetail id={id} />
      </div>
    </div>
  );
}
