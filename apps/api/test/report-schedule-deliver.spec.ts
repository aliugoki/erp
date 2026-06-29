import { describe, expect, it, vi } from 'vitest';
import { ReportScheduleService } from '../src/modules/reporting/report-schedule.service';
import type { EmailMessage } from '../src/modules/notifications/mailer.service';

/** Proves runNow renders the schedule's report and enqueues an email with a correct attachment. */
describe('ReportScheduleService.runNow → email composition', () => {
  it('renders the preset and enqueues a CSV attachment to all recipients', async () => {
    const scheduleRow = {
      id: 's1',
      name: 'Weekly stock',
      preset_key: 'inv-products-list',
      report_id: null,
      format: 'csv',
      recipients: ['ops@acme.test', 'cfo@acme.test'],
      frequency: 'weekly',
      hour: 9,
      minute: 0,
      day_of_week: 1,
      day_of_month: null,
      enabled: true,
      last_run_at: null,
      next_run_at: '2026-06-29T09:00:00.000Z',
    };
    const manager = { query: vi.fn().mockResolvedValueOnce([scheduleRow]).mockResolvedValue([]) };
    const tenantTx = { run: (fn: (m: unknown) => unknown) => Promise.resolve(fn(manager)) } as never;

    const builder = {
      runPreset: vi.fn().mockResolvedValue({
        title: 'Products list',
        columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Name' }],
        rows: [{ sku: 'A-1', name: 'Widget' }, { sku: 'B-2', name: 'Gadget' }],
      }),
    } as never;

    let captured: EmailMessage | undefined;
    const email = { enqueue: vi.fn(async (m: EmailMessage) => { captured = m; }) } as never;

    const svc = new ReportScheduleService(tenantTx, {} as never, builder, email);
    const out = await svc.runNow('s1', new Date('2026-06-25T10:00:00Z'));

    expect(out).toEqual({ delivered: 2, bytes: expect.any(Number), format: 'csv' });
    expect(captured).toBeDefined();
    expect(captured!.to).toBe('ops@acme.test, cfo@acme.test');
    expect(captured!.subject).toContain('Products list');
    const att = captured!.attachments?.[0];
    expect(att?.filename).toBe('products-list.csv');
    expect(att?.contentType).toContain('text/csv');
    // The base64 attachment decodes to the rendered CSV.
    const csv = Buffer.from(att!.contentBase64, 'base64').toString('utf-8');
    expect(csv).toContain('SKU,Name');
    expect(csv).toContain('A-1,Widget');
    // next_run_at advanced (an UPDATE ran after delivery).
    expect(manager.query).toHaveBeenCalledTimes(2);
  });

  it('rejects a schedule targeting neither/both a preset and a saved report', async () => {
    const svc = new ReportScheduleService({} as never, {} as never, {} as never, {} as never);
    await expect(svc.create({ name: 'x', format: 'pdf', recipients: ['a@b.c'], frequency: 'daily', hour: 8, minute: 0 } as never)).rejects.toThrow();
  });
});
