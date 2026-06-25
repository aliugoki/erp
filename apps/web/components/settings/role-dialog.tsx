'use client';
import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleChips } from '@/components/settings/toggle-chips';

export interface Capability {
  key: string;
  name: string;
  description: string;
  permissions: string[];
}
export interface CustomRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  memberRoles: string[];
  permissions: string[];
}
interface PermissionGroup {
  domain: string;
  label: string;
  permissions: { key: string; label: string }[];
}

/** Create or edit a custom role: bundle capability presets and/or pick fine-grained permissions. */
export function RoleDialog({
  open,
  onOpenChange,
  capabilities,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  capabilities: Capability[];
  existing: CustomRole | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [perms, setPerms] = useState<Set<string>>(new Set());

  const { data: catalog } = useQuery({
    queryKey: ['permission-catalog'],
    queryFn: () => apiGet<{ catalog: PermissionGroup[]; mine: string[] }>('/tenant/roles/permissions').then((r) => r.catalog),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? '');
      setDescription(existing?.description ?? '');
      setMembers(new Set(existing?.memberRoles ?? []));
      setPerms(new Set(existing?.permissions ?? []));
    }
  }, [open, existing]);

  const valid = name.trim().length >= 2 && (members.size > 0 || perms.size > 0);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, memberRoles: [...members], permissions: [...perms] };
      return existing ? apiPatch(`/tenant/roles/${existing.id}`, body) : apiPost('/tenant/roles', body);
    },
    onSuccess: () => {
      toast.success(existing ? 'Role updated' : 'Role created');
      qc.invalidateQueries({ queryKey: ['custom-roles'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error('Could not save role', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    save.mutate();
  }
  const toggler = (set: typeof setMembers) => (v: string) =>
    set((s) => {
      const next = new Set(s);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit role' : 'New role'}</DialogTitle>
          <DialogDescription>
            Combine capability presets and/or pick individual permissions. Anyone assigned the role gets
            the combined access.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Branch Manager" required minLength={2} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-desc">Description</Label>
            <Input id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Runs a branch: inventory + sales" />
          </div>
          <div className="space-y-2">
            <Label>Capability presets</Label>
            <ToggleChips
              options={capabilities.map((c) => ({ value: c.key, label: c.name, hint: c.description }))}
              selected={members}
              onToggle={toggler(setMembers)}
            />
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <Label>Fine-grained permissions</Label>
            {(catalog ?? []).map((g) => (
              <div key={g.domain} className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{g.label}</p>
                <ToggleChips
                  options={g.permissions.map((p) => ({ value: p.key, label: p.label }))}
                  selected={perms}
                  onToggle={toggler(setPerms)}
                />
              </div>
            ))}
          </div>
          {!valid ? <p className="text-xs text-muted-foreground">Give the role a name and at least one capability or permission.</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending || !valid}>
              {save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Create role'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
