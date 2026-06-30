'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Branch, CostCenter, Employee } from '@/lib/types';
import type { FeatureModule } from '@/lib/nav';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const NONE = '__none__'; // Radix Select can't use '' — sentinel for "unset".
interface Draft { name: string; code: string; city: string; address: string; phone: string; managerId: string; costCenterId: string; isHeadOffice: boolean; active: boolean }
const EMPTY: Draft = { name: '', code: '', city: '', address: '', phone: '', managerId: NONE, costCenterId: NONE, isHeadOffice: false, active: true };

function toBody(d: Draft) {
  return {
    name: d.name, code: d.code || null, city: d.city || null, address: d.address || null, phone: d.phone || null,
    managerId: d.managerId === NONE ? null : d.managerId,
    costCenterId: d.costCenterId === NONE ? null : d.costCenterId,
    isHeadOffice: d.isHeadOffice, active: d.active,
  };
}

/**
 * Company branches CRUD — a table + a New/Edit dialog. Manager (employee) and Cost center pickers are
 * shown only when the HR / Finance modules are enabled for the company (branches themselves are core
 * company infra, available regardless). Rendered in Settings → Branches and the HR → Organization tab.
 */
export function BranchesManager() {
  const qc = useQueryClient();
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => apiGet<Branch[]>('/branches') });
  const features = useQuery({ queryKey: ['features'], queryFn: () => apiGet<FeatureModule[]>('/tenant/features') });
  const hrOn = (features.data ?? []).some((m) => m.key === 'hr' && m.enabled);
  const financeOn = (features.data ?? []).some((m) => m.key === 'finance' && m.enabled);
  const employees = useQuery({ queryKey: ['employees-min'], queryFn: () => apiGet<Employee[]>('/hr/employees?pageSize=200'), enabled: hrOn });
  const costCenters = useQuery({ queryKey: ['cost-centers'], queryFn: () => apiGet<CostCenter[]>('/finance/cost-centers'), enabled: financeOn, retry: false });

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [d, setD] = useState<Draft>(EMPTY);
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));

  const startNew = () => { setEditId(null); setD(EMPTY); setOpen(true); };
  const startEdit = (b: Branch) => {
    setEditId(b.id);
    setD({ name: b.name, code: b.code ?? '', city: b.city ?? '', address: b.address ?? '', phone: b.phone ?? '', managerId: b.managerId ?? NONE, costCenterId: b.costCenterId ?? NONE, isHeadOffice: b.isHeadOffice, active: b.active });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: () => (editId ? apiPatch(`/branches/${editId}`, toBody(d)) : apiPost('/branches', toBody(d))),
    onSuccess: () => { toast.success(editId ? 'Branch updated' : 'Branch added'); void qc.invalidateQueries({ queryKey: ['branches'] }); setOpen(false); },
    onError: (e) => toast.error('Could not save', { description: e instanceof ApiError ? e.message : '' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/branches/${id}`),
    onSuccess: () => { toast.success('Branch removed'); void qc.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (e) => toast.error('Could not remove', { description: e instanceof ApiError ? e.message : '' }),
  });

  const onSubmit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  const rows = branches.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Building2 className="size-4 text-primary" />
        <p className="text-sm font-medium">Branches <span className="text-muted-foreground">({rows.length})</span></p>
        <div className="ml-auto">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" onClick={startNew}><Plus className="size-4" /> New branch</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editId ? 'Edit branch' : 'New branch'}</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1.5"><Label className="text-xs">Name</Label><Input value={d.name} onChange={(e) => set('name')(e.target.value)} placeholder="Lahore HQ" required /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Code</Label><Input value={d.code} onChange={(e) => set('code')(e.target.value)} placeholder="LHR" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="text-xs">City</Label><Input value={d.city} onChange={(e) => set('city')(e.target.value)} placeholder="Lahore" /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input value={d.phone} onChange={(e) => set('phone')(e.target.value)} placeholder="+92…" /></div>
                </div>
                <div className="space-y-1.5"><Label className="text-xs">Address</Label><Input value={d.address} onChange={(e) => set('address')(e.target.value)} placeholder="Street, area" /></div>
                {hrOn ? (
                  <div className="space-y-1.5"><Label className="text-xs">Branch manager</Label>
                    <Select value={d.managerId} onValueChange={set('managerId')}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— None —</SelectItem>
                        {(employees.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {financeOn ? (
                  <div className="space-y-1.5"><Label className="text-xs">Cost center <span className="text-muted-foreground">(branch P&amp;L)</span></Label>
                    <Select value={d.costCenterId} onValueChange={set('costCenterId')}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— None —</SelectItem>
                        {(costCenters.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="flex items-center gap-6 pt-1">
                  <label className="flex items-center gap-2 text-sm"><Switch checked={d.isHeadOffice} onCheckedChange={set('isHeadOffice')} /> Head office</label>
                  <label className="flex items-center gap-2 text-sm"><Switch checked={d.active} onCheckedChange={set('active')} /> Active</label>
                </div>
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={save.isPending || !d.name.trim()}>{save.isPending ? 'Saving…' : editId ? 'Save' : 'Add branch'}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Branch</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">City</th><th className="px-3 py-2">Manager</th><th className="px-3 py-2 text-right">Staff</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
          <tbody className="divide-y">
            {rows.map((b) => (
              <tr key={b.id} className={b.active ? '' : 'opacity-60'}>
                <td className="px-3 py-2 font-medium">{b.name} {b.isHeadOffice ? <Badge variant="secondary" className="ml-1 text-[10px]">HQ</Badge> : null}{!b.active ? <Badge variant="outline" className="ml-1 text-[10px]">inactive</Badge> : null}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{b.code ?? '—'}</td>
                <td className="px-3 py-2">{b.city ?? '—'}</td>
                <td className="px-3 py-2">{b.managerName ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{b.employeeCount}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(b)}><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => { if (confirm(`Delete branch "${b.name}"?`)) remove.mutate(b.id); }}><Trash2 className="size-4" /></Button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No branches yet. Add your first branch.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
