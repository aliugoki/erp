'use client';
import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiPatch, apiPost } from '@/lib/api';
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
}

/** Create or edit a composite custom role (a named bundle of capability roles). */
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

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? '');
      setDescription(existing?.description ?? '');
      setMembers(new Set(existing?.memberRoles ?? []));
    }
  }, [open, existing]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, memberRoles: [...members] };
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
    if (name.trim().length < 2 || members.size === 0) return;
    save.mutate();
  }

  function toggle(v: string) {
    setMembers((s) => {
      const next = new Set(s);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit role' : 'New role'}</DialogTitle>
          <DialogDescription>
            A custom role bundles the capabilities below. Anyone assigned it gets the combined access.
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
            <Label>Capabilities</Label>
            <ToggleChips
              options={capabilities.map((c) => ({ value: c.key, label: c.name, hint: c.description }))}
              selected={members}
              onToggle={toggle}
            />
            {members.size === 0 ? <p className="text-xs text-muted-foreground">Pick at least one capability.</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending || name.trim().length < 2 || members.size === 0}>
              {save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Create role'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
