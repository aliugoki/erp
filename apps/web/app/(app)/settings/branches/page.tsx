'use client';
import { BranchesManager } from '@/components/branches/branches-manager';

/** Company branches — the canonical management page. Branches are core company config (available to
 * any company), referenced by HR / Inventory / POS / Finance. */
export default function BranchesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Branches</h2>
        <p className="text-muted-foreground">
          Your company&apos;s physical sites / offices. Map employees, warehouses and registers to a branch,
          and (with Finance) tie a branch to a cost center for branch P&amp;L.
        </p>
      </div>
      <BranchesManager />
    </div>
  );
}
