'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Settings2, Trash2 } from 'lucide-react';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import type { Department, Designation } from '@/lib/types';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** Manage the org lookups the employee form depends on — departments and designations. */
export function ManageOrgDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dept, setDept] = useState('');
  const [desig, setDesig] = useState('');

  const departments = useQuery({ queryKey: ['departments'], queryFn: () => apiGet<Department[]>('/hr/departments') });
  const designations = useQuery({ queryKey: ['designations'], queryFn: () => apiGet<Designation[]>('/hr/designations') });

  const addDept = useMutation({
    mutationFn: () => apiPost('/hr/departments', { name: dept }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); setDept(''); },
    onError: (e) => toast.error('Could not add department', { description: e instanceof ApiError ? e.message : '' }),
  });
  const delDept = useMutation({ mutationFn: (id: string) => apiDelete(`/hr/departments/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }) });
  const addDesig = useMutation({
    mutationFn: () => apiPost('/hr/designations', { name: desig }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['designations'] }); setDesig(''); },
    onError: (e) => toast.error('Could not add designation', { description: e instanceof ApiError ? e.message : '' }),
  });
  const delDesig = useMutation({ mutationFn: (id: string) => apiDelete(`/hr/designations/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['designations'] }) });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Settings2 className="size-4" /> Departments & designations</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Departments & designations</DialogTitle>
          <DialogDescription>Manage the lists the employee form offers as dropdowns.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-medium"><Building2 className="size-4" /> Departments</p>
            <ul className="mb-2 space-y-1">
              {(departments.data ?? []).map((d) => (
                <li key={d.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  {d.name}
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => delDept.mutate(d.id)}><Trash2 className="size-3.5" /></Button>
                </li>
              ))}
            </ul>
            <form className="flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); addDept.mutate(); }}>
              <Input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="New department" />
              <Button type="submit" size="sm" disabled={addDept.isPending || !dept.trim()}><Plus className="size-4" /></Button>
            </form>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-medium"><Settings2 className="size-4" /> Designations</p>
            <ul className="mb-2 space-y-1">
              {(designations.data ?? []).map((d) => (
                <li key={d.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  {d.name}
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => delDesig.mutate(d.id)}><Trash2 className="size-3.5" /></Button>
                </li>
              ))}
            </ul>
            <form className="flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); addDesig.mutate(); }}>
              <Input value={desig} onChange={(e) => setDesig(e.target.value)} placeholder="New designation" />
              <Button type="submit" size="sm" disabled={addDesig.isPending || !desig.trim()}><Plus className="size-4" /></Button>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
