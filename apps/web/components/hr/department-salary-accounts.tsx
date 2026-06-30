'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPut } from '@/lib/api';
import type { Account, DepartmentSalaryAccount } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DEFAULT = '__default__'; // Radix Select can't use an empty-string value → sentinel for "use default".

/**
 * Per-department salary-expense account overrides. Each department's payroll gross debits its own
 * expense account; "Use default" falls back to the tenant-level salary-expense account from the card
 * above. Reuses `GET /finance/accounts` (EXPENSE leaves) + `GET/PUT /hr/payroll/department-accounts`.
 */
export function DepartmentSalaryAccounts() {
  const qc = useQueryClient();
  const depts = useQuery({ queryKey: ['hr-department-accounts'], queryFn: () => apiGet<DepartmentSalaryAccount[]>('/hr/payroll/department-accounts') });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts'), retry: false });
  const expenseLeaves = (accounts.data ?? []).filter((a) => !a.isGroup && a.type === 'EXPENSE');

  const save = useMutation({
    mutationFn: ({ departmentId, value }: { departmentId: string; value: string }) =>
      apiPut(`/hr/payroll/department-accounts/${departmentId}`, { salaryExpenseAccountId: value === DEFAULT ? null : value }),
    onSuccess: () => { toast.success('Department account saved'); void qc.invalidateQueries({ queryKey: ['hr-department-accounts'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save'),
  });

  const rows = depts.data ?? [];

  return (
    <div className="rounded-xl border p-4">
      <p className="mb-1 flex items-center gap-2 text-sm font-medium"><Building2 className="h-4 w-4" /> Per-department salary expense</p>
      <p className="mb-3 text-xs text-muted-foreground">
        Override the default salary-expense account per department — each department&apos;s payroll gross debits its own account. Leave on &ldquo;Use default&rdquo; to use the account mapped above.
      </p>
      {accounts.isError ? (
        <p className="text-sm text-muted-foreground">Enable the Finance module to map departments to expense accounts.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No departments yet. Add departments under the Org tab.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Department</th><th className="px-3 py-2">Salary expense account</th></tr></thead>
            <tbody className="divide-y">
              {rows.map((d) => (
                <tr key={d.departmentId}>
                  <td className="px-3 py-2 font-medium">{d.departmentName}</td>
                  <td className="px-3 py-2">
                    <Select
                      value={d.salaryExpenseAccountId ?? DEFAULT}
                      onValueChange={(v) => save.mutate({ departmentId: d.departmentId, value: v })}
                    >
                      <SelectTrigger className="h-8 w-64"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT}>Use default</SelectItem>
                        {expenseLeaves.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
