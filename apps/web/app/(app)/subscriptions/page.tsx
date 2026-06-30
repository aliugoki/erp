'use client';
import { ModuleTitle } from '@/components/module-title';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, CreditCard, Layers, Loader2, Play, Plus, Repeat, Search, TrendingUp, Wallet, XCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { SubInvoice, SubMetrics, SubPlan, Subscription } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GlAccountsCard } from '@/components/finance/gl-accounts-card';
import { EmptyDetail, ListRow, Pane, PaneBody, PaneHeader, RailItem, ThreePane } from '@/components/ui/three-pane';
import { NewSubscriptionDialog } from '@/components/subscriptions/new-subscription-dialog';
import { SubscriptionDetail } from '@/components/subscriptions/subscription-detail';
import { PlanDetail } from '@/components/subscriptions/plan-detail';
import { InvoiceStatusBadge, SubStatusBadge, fmtDate, intervalLabel, intervalSuffix } from '@/components/subscriptions/ui';

type Section = 'subscriptions' | 'plans' | 'invoices' | 'accounting';
const SUB_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED'];

export default function SubscriptionsPage() {
  const qc = useQueryClient();
  const [section, setSection] = useState<Section>('subscriptions');
  const [subSel, setSubSel] = useState<string | null>(null);
  const [planSel, setPlanSel] = useState<{ mode: 'new' | 'edit'; id: string | null } | null>(null);
  const [invSel, setInvSel] = useState<SubInvoice | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [invStatus, setInvStatus] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const metrics = useQuery({ queryKey: ['sub-metrics'], queryFn: () => apiGet<SubMetrics>('/subscriptions/metrics') });
  const plans = useQuery({ queryKey: ['sub-plans'], queryFn: () => apiGet<SubPlan[]>('/subscriptions/plans') });
  const subs = useQuery({
    queryKey: ['subs', status, q],
    queryFn: () => {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      if (q) p.set('q', q);
      return apiGet<Subscription[]>(`/subscriptions${p.toString() ? `?${p}` : ''}`);
    },
  });
  const invoices = useQuery({
    queryKey: ['sub-invoices', invStatus],
    queryFn: () => apiGet<SubInvoice[]>(`/subscriptions/invoices/all${invStatus ? `?status=${invStatus}` : ''}`),
    enabled: section === 'invoices',
  });

  const runBilling = useMutation({
    mutationFn: () => apiPost<{ billed: number; dunned: number; canceled: number }>('/subscriptions/run-billing', {}),
    onSuccess: (r) => {
      toast.success(`Billing run: ${r.billed} invoiced, ${r.dunned} dunned, ${r.canceled} cancelled`);
      void qc.invalidateQueries({ queryKey: ['subs'] });
      void qc.invalidateQueries({ queryKey: ['sub-metrics'] });
      void qc.invalidateQueries({ queryKey: ['sub-invoices'] });
      if (subSel) void qc.invalidateQueries({ queryKey: ['sub', subSel] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const m = metrics.data;
  const subList = subs.data ?? [];
  const planList = plans.data ?? [];
  const invList = invoices.data ?? [];
  const activeCount = m ? m.active + m.trialing : undefined;

  const showDetail = (section === 'subscriptions' && !!subSel) || (section === 'plans' && !!planSel) || (section === 'invoices' && !!invSel) || section === 'accounting';
  const clearDetail = () => { setSubSel(null); setPlanSel(null); setInvSel(null); };
  const pick = (s: Section) => { setSection(s); clearDetail(); };

  // ── Rail ────────────────────────────────────────────────────────────────────────
  const rail = (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="space-y-1">
        <RailItem icon={Repeat} label="Subscriptions" count={subList.length || undefined} active={section === 'subscriptions'} onClick={() => pick('subscriptions')} tone="sky" />
        <RailItem icon={Layers} label="Plans" count={planList.length || undefined} active={section === 'plans'} onClick={() => pick('plans')} tone="violet" />
        <RailItem icon={CreditCard} label="Invoices" active={section === 'invoices'} onClick={() => pick('invoices')} tone="emerald" />
        <RailItem icon={Wallet} label="Accounting" active={section === 'accounting'} onClick={() => pick('accounting')} />
      </div>
      <div className="mt-auto space-y-2 pt-3">
        <Button variant="outline" size="sm" className="w-full" onClick={() => runBilling.mutate()} disabled={runBilling.isPending}>
          {runBilling.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />} Run billing now
        </Button>
        {section === 'subscriptions' ? (
          <Button size="sm" className="w-full" onClick={() => setNewOpen(true)} disabled={planList.filter((p) => p.status === 'ACTIVE').length === 0}><Plus className="mr-2 h-4 w-4" /> New subscription</Button>
        ) : (
          <Button size="sm" className="w-full" onClick={() => { setSection('plans'); setPlanSel({ mode: 'new', id: null }); }}><Plus className="mr-2 h-4 w-4" /> New plan</Button>
        )}
      </div>
    </div>
  );

  // ── List ────────────────────────────────────────────────────────────────────────
  const list = (
    <Pane>
      {section === 'subscriptions' ? (
        <>
          <PaneHeader>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search #, customer…" className="h-9 w-full pl-9" />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">All</option>
              {SUB_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </PaneHeader>
          <PaneBody>
            {subs.isLoading ? <Spinner /> : subList.length === 0 ? <Hint>No subscriptions match.</Hint> : (
              <ul className="divide-y">
                {subList.map((s) => (
                  <li key={s.id}>
                    <ListRow active={subSel === s.id} onClick={() => setSubSel(s.id)}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="truncate font-medium">{s.customerName}</span><SubStatusBadge status={s.status} /></div>
                        <div className="truncate text-xs text-muted-foreground">{s.subscriptionNo} · {s.planName}</div>
                      </div>
                      <div className="text-right text-xs"><div className="font-semibold tabular-nums">{formatMoney(s.amount.amountMinor, s.amount.currency)}</div><div className="text-muted-foreground">{intervalSuffix(s.billingInterval, s.intervalCount)}</div></div>
                    </ListRow>
                  </li>
                ))}
              </ul>
            )}
          </PaneBody>
        </>
      ) : section === 'plans' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Plans</span><Button variant="ghost" size="sm" onClick={() => setPlanSel({ mode: 'new', id: null })}><Plus className="mr-1.5 h-4 w-4" /> New</Button></PaneHeader>
          <PaneBody>
            {plans.isLoading ? <Spinner /> : planList.length === 0 ? <Hint>No plans yet.</Hint> : (
              <ul className="divide-y">
                {planList.map((p) => (
                  <li key={p.id}>
                    <ListRow active={planSel?.id === p.id} onClick={() => setPlanSel({ mode: 'edit', id: p.id })}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="truncate font-medium">{p.name}</span>{p.status === 'ARCHIVED' ? <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">ARCHIVED</span> : null}</div>
                        <div className="truncate text-xs text-muted-foreground">{intervalLabel(p.billingInterval, p.intervalCount)}{p.trialDays > 0 ? ` · ${p.trialDays}d trial` : ''} · {p.activeSubscriptions ?? 0} subs</div>
                      </div>
                      <div className="text-right text-xs font-semibold tabular-nums">{formatMoney(p.price.amountMinor, p.price.currency)}</div>
                    </ListRow>
                  </li>
                ))}
              </ul>
            )}
          </PaneBody>
        </>
      ) : section === 'invoices' ? (
        <>
          <PaneHeader>
            <span className="flex-1 text-sm font-medium">Invoices</span>
            <select value={invStatus} onChange={(e) => setInvStatus(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">All</option>
              {['OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </PaneHeader>
          <PaneBody>
            {invoices.isLoading ? <Spinner /> : invList.length === 0 ? <Hint>No invoices yet.</Hint> : (
              <ul className="divide-y">
                {invList.map((i) => (
                  <li key={i.id}>
                    <ListRow active={invSel?.id === i.id} onClick={() => setInvSel(i)}>
                      <div className="min-w-0 flex-1"><div className="truncate font-medium">{i.invoiceNo}</div><div className="truncate text-xs text-muted-foreground">{i.subscriptionNo} · {fmtDate(i.issuedAt)}</div></div>
                      <div className="flex flex-col items-end gap-1"><span className="text-xs font-semibold tabular-nums">{formatMoney(i.total.amountMinor, i.total.currency)}</span><InvoiceStatusBadge status={i.status} /></div>
                    </ListRow>
                  </li>
                ))}
              </ul>
            )}
          </PaneBody>
        </>
      ) : (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Settings</span></PaneHeader>
          <PaneBody><div className="p-2"><ListRow active><Wallet className="h-4 w-4 text-muted-foreground" /><span className="flex-1 font-medium">General ledger</span></ListRow></div></PaneBody>
        </>
      )}
    </Pane>
  );

  // ── Detail ──────────────────────────────────────────────────────────────────────
  const detail = (
    <Pane>
      {section === 'subscriptions' ? (
        subSel ? <SubscriptionDetail id={subSel} onBack={clearDetail} onChanged={() => void qc.invalidateQueries({ queryKey: ['subs'] })} />
          : <EmptyDetail icon={Repeat} title="Select a subscription" hint="Pick a subscriber to view billing, invoices, and lifecycle actions." />
      ) : section === 'plans' ? (
        planSel ? <PlanDetail mode={planSel.mode} plan={planSel.mode === 'edit' ? planList.find((p) => p.id === planSel.id) : null} onBack={clearDetail} onSaved={(p) => setPlanSel({ mode: 'edit', id: p.id })} onDeleted={clearDetail} />
          : <EmptyDetail icon={Layers} title="Select or create a plan" hint="Plans set the price, interval, trial, and tax that subscriptions inherit." />
      ) : section === 'invoices' ? (
        invSel ? <InvoiceDetail invoice={invSel} onBack={clearDetail} /> : <EmptyDetail icon={CreditCard} title="Select an invoice" hint="Review billing periods and collect or void open invoices." />
      ) : (
        <>
          <PaneHeader><span className="font-semibold">Subscriptions → general ledger</span></PaneHeader>
          <PaneBody className="p-5">
            <GlAccountsCard
              title="Subscriptions → general ledger"
              description="When set, each paid subscription invoice posts Dr clearing; Cr revenue (+ tax). Requires background reactions enabled."
              getPath="/subscriptions/gl-config" putPath="/subscriptions/gl-config" queryKey="sub-gl-config"
              slots={[
                { key: 'clearingAccountId', label: 'Clearing / receipts (Dr)', required: true },
                { key: 'revenueAccountId', label: 'Subscription revenue (Cr)', types: ['REVENUE'], required: true },
                { key: 'taxAccountId', label: 'Tax payable (Cr)', types: ['LIABILITY'] },
              ]}
            />
          </PaneBody>
        </>
      )}
    </Pane>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <ModuleTitle>Subscriptions</ModuleTitle>
          <p className="text-sm text-muted-foreground">Recurring billing — plans, automatic invoicing, dunning, and MRR.</p>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="MRR" value={m ? formatMoney(m.mrr.amountMinor, m.mrr.currency) : '—'} icon={TrendingUp} tone="emerald" />
        <Metric label="ARR" value={m ? formatMoney(m.arr.amountMinor, m.arr.currency) : '—'} icon={Wallet} />
        <Metric label="Active" value={activeCount != null ? String(activeCount) : '—'} sub={m ? `${m.trialing} trialing` : ''} icon={Activity} tone="sky" />
        <Metric label="Past due" value={m ? String(m.pastDue) : '—'} sub={m && m.churnRate > 0 ? `${m.churnRate}% churn` : ''} icon={Repeat} tone={m && m.pastDue > 0 ? 'amber' : 'default'} />
      </div>

      <div className="min-h-0 flex-1">
        <ThreePane rail={rail} list={list} detail={detail} showDetail={showDetail} />
      </div>

      {newOpen ? <NewSubscriptionDialog plans={planList} onClose={() => setNewOpen(false)} /> : null}
    </div>
  );
}

function InvoiceDetail({ invoice, onBack }: { invoice: SubInvoice; onBack?: () => void }) {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['sub-invoices'] }); void qc.invalidateQueries({ queryKey: ['subs'] }); void qc.invalidateQueries({ queryKey: ['sub-metrics'] }); };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const pay = useMutation({ mutationFn: () => apiPost(`/subscriptions/invoices/${invoice.id}/pay`, {}), onSuccess: () => { toast.success('Invoice marked paid'); refresh(); onBack?.(); }, onError: onErr });
  const voidInv = useMutation({ mutationFn: () => apiPost(`/subscriptions/invoices/${invoice.id}/void`, {}), onSuccess: () => { toast.success('Invoice voided'); refresh(); onBack?.(); }, onError: onErr });

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><Repeat className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate font-semibold">{invoice.invoiceNo}</span><InvoiceStatusBadge status={invoice.status} /></div>
        {invoice.status === 'OPEN' ? (
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => pay.mutate()} disabled={pay.isPending}><CheckCircle2 className="mr-1.5 h-4 w-4" /> Mark paid</Button>
            <Button variant="outline" size="sm" onClick={() => voidInv.mutate()} disabled={voidInv.isPending}><XCircle className="mr-1.5 h-4 w-4" /> Void</Button>
          </div>
        ) : null}
      </PaneHeader>
      <PaneBody className="p-5">
        <dl className="grid max-w-md grid-cols-2 gap-4 text-sm">
          <Cell label="Subscription" value={invoice.subscriptionNo ?? '—'} />
          <Cell label="Issued" value={fmtDate(invoice.issuedAt)} />
          <Cell label="Billing period" value={`${fmtDate(invoice.periodStart)} – ${fmtDate(invoice.periodEnd)}`} />
          <Cell label="Due" value={fmtDate(invoice.dueDate)} />
          <Cell label="Subtotal" value={formatMoney(invoice.amount.amountMinor, invoice.amount.currency)} />
          <Cell label="Tax" value={formatMoney(invoice.tax.amountMinor, invoice.tax.currency)} />
          <Cell label="Total" value={formatMoney(invoice.total.amountMinor, invoice.total.currency)} />
          {invoice.paidAt ? <Cell label="Paid" value={`${fmtDate(invoice.paidAt)}${invoice.paymentRef ? ` · ${invoice.paymentRef}` : ''}`} /> : null}
          {invoice.attemptCount > 0 ? <Cell label="Attempts" value={String(invoice.attemptCount)} /> : null}
        </dl>
      </PaneBody>
    </>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>;
}
function Spinner() { return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>; }
function Hint({ children }: { children: React.ReactNode }) { return <p className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</p>; }

function Metric({ label, value, sub = '', icon: Icon, tone = 'default' }: { label: string; value: string; sub?: string; icon: typeof Repeat; tone?: 'default' | 'emerald' | 'sky' | 'amber' }) {
  const tones: Record<string, string> = { default: 'text-primary', emerald: 'text-emerald-600', sky: 'text-sky-600', amber: 'text-amber-600' };
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><Icon className={`h-4 w-4 ${tones[tone]}`} /></div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
