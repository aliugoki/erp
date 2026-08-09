import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { TenantTransactionService } from '../../../common/tenant/tenant-transaction.service';
import type { ClaimPrintJobDto, CompletePrintJobDto, ListPrintJobsQueryDto, PrintOrderDto } from '../dto/restaurant.dto';
import { type Row, rowsOf } from '../restaurant.util';
import { type ReceiptDoc, renderEscPosBase64, renderText } from './escpos.util';
import { type BillDocInput, type KotDocInput, buildBillDoc, buildKotDoc, buildTestDoc } from './receipt.builder';
import { RestaurantPrinterService } from './printer.service';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

const TENANT = `current_setting('app.tenant_id')::uuid`;
/** A job the agent claimed but never reported on — reclaimed after this long so paper isn't lost. */
const CLAIM_STALE_SECONDS = 120;
const MAX_ATTEMPTS = 5;

/**
 * Print spool. The API renders a device-free document ({@link ReceiptDoc}) and queues it; a print
 * agent on the restaurant LAN claims jobs for its printer and pushes the bytes. Nothing here talks to
 * hardware — which is what lets a cloud API drive a printer sitting behind a domestic router, and what
 * makes an offline printer a *delayed* print rather than a failed order.
 *
 * Enqueue happens inside the caller's transaction (`*InTx`) so a KOT can never exist without its
 * order, mirroring how the outbox writes events.
 */
@Injectable()
export class RestaurantPrintService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly printers: RestaurantPrinterService,
  ) {}

  // ── Document building (reads only; used by preview and by enqueue) ───────────────

  /** Build the guest bill for an order, resolving branding, fiscal stamp and paper width. */
  async buildBill(m: Mgr, orderId: string, opts: { charsPerLine?: number; copyLabel?: string | null; cashDrawer?: boolean } = {}): Promise<ReceiptDoc> {
    const rows = (await m.query(
      `SELECT o.id, o.order_no, o.branch_id, o.channel, o.status, o.guest_count, o.currency, o.notes,
              o.subtotal_minor, o.discount_minor, o.service_charge_minor, o.tax_minor, o.tip_minor,
              o.rounding_minor, o.total_minor, o.paid_minor, o.placed_at, o.settled_at,
              o.fiscal_authority, o.fiscal_invoice_no, o.fiscal_qr, o.fiscal_status,
              t.code AS table_code, b.name AS branch_name, b.address AS branch_address, b.phone AS branch_phone,
              e.first_name, e.last_name
       FROM restaurant_order o
       LEFT JOIN restaurant_table t ON t.id = o.table_id
       LEFT JOIN branch b ON b.id = o.branch_id
       LEFT JOIN hr_employee e ON e.id = o.waiter_employee_id
       WHERE o.id=$1 AND o.deleted_at IS NULL`,
      [orderId],
    )) as Row[];
    const o = rows[0];
    if (!o) throw new NotFoundException('Order not found');

    const cfg = await this.brandConfig(m, (o.branch_id as string) ?? null);
    const items = (await m.query(
      `SELECT id, name, qty, unit_price_minor, modifier_total_minor, discount_minor, line_total_minor, kitchen_notes
       FROM restaurant_order_item WHERE order_id=$1 AND status <> 'VOID' ORDER BY created_at`,
      [orderId],
    )) as Row[];
    const mods = (await m.query(
      `SELECT order_item_id, name, price_delta_minor, qty FROM restaurant_order_item_modifier
       WHERE order_item_id IN (SELECT id FROM restaurant_order_item WHERE order_id=$1 AND status <> 'VOID')`,
      [orderId],
    )) as Row[];
    const payments = (await m.query(
      `SELECT method, amount_minor, tip_minor, reference FROM restaurant_payment
       WHERE order_id=$1 AND status='CAPTURED' ORDER BY created_at`,
      [orderId],
    )) as Row[];

    const modsByItem = new Map<string, Row[]>();
    for (const md of mods) {
      const k = md.order_item_id as string;
      (modsByItem.get(k) ?? modsByItem.set(k, []).get(k)!).push(md);
    }

    const waiter = o.first_name ? `${o.first_name as string} ${(o.last_name as string) ?? ''}`.trim() : null;
    // An unsettled order prints as a pro-forma — a request for payment, never a tax invoice.
    const settled = o.status === 'SETTLED';
    const input: BillDocInput = {
      charsPerLine: opts.charsPerLine ?? 42,
      timeZone: cfg.timezone,
      brand: cfg.brand,
      order: {
        orderNo: o.order_no as string,
        channel: o.channel as string,
        status: o.status as string,
        table: (o.table_code as string) ?? null,
        guestCount: Number(o.guest_count ?? 0),
        waiter,
        placedAt: (o.placed_at as string) ?? null,
        settledAt: (o.settled_at as string) ?? null,
        currency: o.currency as string,
      },
      lines: items.map((i) => ({
        name: i.name as string,
        qty: Number(i.qty),
        unitPriceMinor: Number(i.unit_price_minor),
        // The printed line amount is the GROSS (qty × unit + modifiers), matching how the order's
        // subtotal is aggregated. `line_total_minor` includes that line's tax, so printing it beside a
        // tax-exclusive Subtotal makes the slip fail to add up — the classic receipt-arithmetic
        // complaint. Tax appears once, in the totals block.
        lineTotalMinor: Number(i.unit_price_minor) * Number(i.qty) + Number(i.modifier_total_minor ?? 0),
        discountMinor: Number(i.discount_minor ?? 0),
        notes: (i.kitchen_notes as string) ?? null,
        modifiers: (modsByItem.get(i.id as string) ?? []).map((md) => ({
          name: md.name as string,
          priceDeltaMinor: Number(md.price_delta_minor ?? 0),
          qty: Number(md.qty ?? 1),
        })),
      })),
      totals: {
        subtotalMinor: Number(o.subtotal_minor), discountMinor: Number(o.discount_minor),
        serviceChargeMinor: Number(o.service_charge_minor), taxMinor: Number(o.tax_minor),
        tipMinor: Number(o.tip_minor), roundingMinor: Number(o.rounding_minor),
        totalMinor: Number(o.total_minor), paidMinor: Number(o.paid_minor),
      },
      payments: payments.map((p) => ({
        method: p.method as string, amountMinor: Number(p.amount_minor),
        tipMinor: Number(p.tip_minor ?? 0), reference: (p.reference as string) ?? null,
      })),
      fiscal: o.fiscal_status === 'REPORTED'
        ? { authority: (o.fiscal_authority as string) ?? null, invoiceNo: (o.fiscal_invoice_no as string) ?? null, qr: (o.fiscal_qr as string) ?? null }
        : null,
      showQr: cfg.showQr,
      copyLabel: opts.copyLabel ?? (settled ? null : 'PRO-FORMA - NOT A TAX INVOICE'),
      cashDrawer: opts.cashDrawer ?? payments.some((p) => p.method === 'CASH'),
    };
    return buildBillDoc(input);
  }

  /** Build the station ticket for one KDS ticket. */
  async buildKot(m: Mgr, ticketId: string, opts: { charsPerLine?: number; isReprint?: boolean } = {}): Promise<ReceiptDoc & { stationKey: string; branchId: string | null; ticketNo: string }> {
    const rows = (await m.query(
      `SELECT t.id, t.order_id, t.branch_id, t.station_key, t.ticket_no, t.priority, t.status,
              t.target_minutes, t.fired_at, t.created_at,
              o.order_no, o.channel, o.guest_count, tb.code AS table_code, e.first_name, e.last_name,
              s.name AS station_name
       FROM restaurant_kds_ticket t
       JOIN restaurant_order o ON o.id = t.order_id
       LEFT JOIN restaurant_table tb ON tb.id = o.table_id
       LEFT JOIN hr_employee e ON e.id = o.waiter_employee_id
       LEFT JOIN restaurant_station s ON s.key = t.station_key AND s.branch_id IS NOT DISTINCT FROM t.branch_id AND s.deleted_at IS NULL
       WHERE t.id=$1 AND t.deleted_at IS NULL`,
      [ticketId],
    )) as Row[];
    const t = rows[0];
    if (!t) throw new NotFoundException('Kitchen ticket not found');
    const cfg = await this.brandConfig(m, (t.branch_id as string) ?? null);
    const items = (await m.query(
      `SELECT ki.name, ki.qty, ki.modifiers_text, oi.kitchen_notes, oi.course
       FROM restaurant_kds_ticket_item ki
       LEFT JOIN restaurant_order_item oi ON oi.id = ki.order_item_id
       WHERE ki.ticket_id=$1 ORDER BY ki.created_at`,
      [ticketId],
    )) as Row[];

    const input: KotDocInput = {
      charsPerLine: opts.charsPerLine ?? 42,
      timeZone: cfg.timezone,
      stationName: ((t.station_name as string) ?? (t.station_key as string) ?? 'KITCHEN').toUpperCase(),
      ticketNo: t.ticket_no as string,
      orderNo: t.order_no as string,
      channel: t.channel as string,
      table: (t.table_code as string) ?? null,
      guestCount: Number(t.guest_count ?? 0),
      waiter: t.first_name ? `${t.first_name as string} ${(t.last_name as string) ?? ''}`.trim() : null,
      priority: (t.priority as string) ?? null,
      firedAt: (t.fired_at as string) ?? (t.created_at as string),
      targetMinutes: t.target_minutes == null ? null : Number(t.target_minutes),
      items: items.map((i) => ({
        name: i.name as string, qty: Number(i.qty),
        modifiers: (i.modifiers_text as string) ?? null,
        notes: (i.kitchen_notes as string) ?? null,
        course: i.course == null ? null : Number(i.course),
      })),
      isReprint: opts.isReprint ?? false,
    };
    return Object.assign(buildKotDoc(input), {
      stationKey: (t.station_key as string) ?? '',
      branchId: (t.branch_id as string) ?? null,
      ticketNo: t.ticket_no as string,
    });
  }

  // ── Enqueue (inside the caller's transaction) ────────────────────────────────────

  /**
   * Queue the station tickets for an order that has just fired. Called from the order service inside
   * the confirm transaction, so a kitchen ticket can never exist on screen without its paper job.
   * Silently does nothing when the branch has auto-print off.
   */
  async enqueueKotsInTx(m: Mgr, orderId: string, opts: { force?: boolean; ticketIds?: string[] } = {}): Promise<number> {
    const branchId = await this.orderBranch(m, orderId);
    if (!opts.force && !(await this.autoPrint(m, branchId, 'kot'))) return 0;
    const tickets = (await m.query(
      opts.ticketIds?.length
        ? `SELECT id FROM restaurant_kds_ticket WHERE order_id=$1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`
        : `SELECT id FROM restaurant_kds_ticket WHERE order_id=$1 AND status='QUEUED' AND deleted_at IS NULL`,
      opts.ticketIds?.length ? [orderId, opts.ticketIds] : [orderId],
    )) as Row[];
    let queued = 0;
    for (const t of tickets) {
      // A KOT already on the spool for this ticket means we're re-firing; don't double-print.
      const dupe = (await m.query(
        `SELECT id FROM restaurant_print_job WHERE doc_type='KDS_TICKET' AND doc_id=$1 AND kind='KOT' AND status <> 'CANCELLED' LIMIT 1`,
        [t.id],
      )) as Row[];
      if (dupe[0]) continue;
      await this.enqueueKotInTx(m, t.id as string);
      queued++;
    }
    return queued;
  }

  /** Queue one station ticket (also the "reprint KOT" path from the KDS board). */
  async enqueueKotInTx(m: Mgr, ticketId: string, opts: { isReprint?: boolean } = {}) {
    const meta = (await m.query(
      `SELECT branch_id, station_key, ticket_no FROM restaurant_kds_ticket WHERE id=$1 AND deleted_at IS NULL`,
      [ticketId],
    )) as Row[];
    if (!meta[0]) throw new NotFoundException('Kitchen ticket not found');
    const branchId = (meta[0].branch_id as string) ?? null;
    const stationKey = (meta[0].station_key as string) ?? null;
    const printer = await this.printers.routeInTx(m, { branchId, kind: 'KITCHEN', stationKey });
    const doc = await this.buildKot(m, ticketId, { charsPerLine: printer?.charsPerLine, isReprint: opts.isReprint });
    return this.insertJob(m, {
      branchId, printerId: printer?.id ?? null, kind: 'KOT', docType: 'KDS_TICKET', docId: ticketId,
      docNo: meta[0].ticket_no as string, stationKey, copies: printer?.copies ?? 1, doc,
    });
  }

  /** Queue the guest bill for an order (auto on settlement, or on demand from the till). */
  async enqueueBillInTx(m: Mgr, orderId: string, opts: { force?: boolean; copyLabel?: string | null; printerId?: string } = {}) {
    const branchId = await this.orderBranch(m, orderId);
    if (!opts.force && !(await this.autoPrint(m, branchId, 'bill'))) return null;
    const printer = opts.printerId
      ? await this.printerById(m, opts.printerId)
      : await this.printers.routeInTx(m, { branchId, kind: 'RECEIPT' });
    const doc = await this.buildBill(m, orderId, {
      charsPerLine: printer?.charsPerLine,
      copyLabel: opts.copyLabel,
      cashDrawer: printer?.cashDrawer,
    });
    const orderNo = (await m.query(`SELECT order_no FROM restaurant_order WHERE id=$1`, [orderId])) as Row[];
    return this.insertJob(m, {
      branchId, printerId: printer?.id ?? null, kind: 'RECEIPT', docType: 'ORDER', docId: orderId,
      docNo: (orderNo[0]?.order_no as string) ?? null, stationKey: null, copies: printer?.copies ?? 1, doc,
    });
  }

  // ── Public (transaction-owning) operations ──────────────────────────────────────

  /** Render a bill without printing it — the on-screen preview and the browser-print fallback. */
  async previewBill(orderId: string, charsPerLine?: number) {
    return this.tenantTx.run(async (m) => {
      const doc = await this.buildBill(m, orderId, { charsPerLine });
      return { doc, text: renderText(doc), escposBase64: renderEscPosBase64(doc) };
    });
  }

  async previewKot(ticketId: string, charsPerLine?: number) {
    return this.tenantTx.run(async (m) => {
      const doc = await this.buildKot(m, ticketId, { charsPerLine });
      return { doc, text: renderText(doc), escposBase64: renderEscPosBase64(doc) };
    });
  }

  /** Explicit "Print bill" from the till — always queues, regardless of the auto-print setting. */
  async printOrder(orderId: string, dto: PrintOrderDto = {}) {
    return this.tenantTx.run(async (m) => {
      const job = await this.enqueueBillInTx(m, orderId, {
        force: true,
        copyLabel: dto.copyLabel ?? (dto.reprint ? 'REPRINT' : undefined),
        printerId: dto.printerId,
      });
      return job;
    });
  }

  async printKot(ticketId: string, dto: PrintOrderDto = {}) {
    return this.tenantTx.run((m) => this.enqueueKotInTx(m, ticketId, { isReprint: dto.reprint ?? true }));
  }

  /** Queue a test page so an installer can prove the device and paper width before service. */
  async testPrint(printerId: string) {
    return this.tenantTx.run(async (m) => {
      const p = await this.printerById(m, printerId);
      if (!p) throw new NotFoundException('Printer not found');
      const doc = buildTestDoc(p.name, p.charsPerLine, new Date());
      return this.insertJob(m, {
        branchId: null, printerId: p.id, kind: 'TEST', docType: null, docId: null, docNo: null,
        stationKey: null, copies: 1, doc,
      });
    });
  }

  /**
   * The agent's poll: hand out the oldest queued job for this printer and mark it CLAIMED. Jobs stuck
   * in CLAIMED past {@link CLAIM_STALE_SECONDS} (agent crashed mid-print) are re-offered — a duplicate
   * slip is a far smaller problem than a bill that never printed.
   */
  async claim(dto: ClaimPrintJobDto) {
    return this.tenantTx.run(async (m) => {
      const printer = dto.printerId
        ? await this.printerById(m, dto.printerId)
        : dto.printerKey
          ? await this.printers.findByKeyInTx(m, dto.printerKey)
          : null;
      if (!printer) throw new NotFoundException('Printer not found — pass a known printerId or printerKey');
      await this.printers.touch(m, printer.id);

      // Unassigned jobs (queued before any printer existed, or for a removed device) are adopted by a
      // matching device so they eventually print instead of rotting in the spool.
      await m.query(
        `UPDATE restaurant_print_job SET printer_id=$1, updated_at=now()
         WHERE printer_id IS NULL AND status='QUEUED' AND deleted_at IS NULL
           AND CASE WHEN $2::text = 'KITCHEN' THEN kind = 'KOT' ELSE kind <> 'KOT' END`,
        [printer.id, printer.kind],
      );

      const rows = rowsOf(await m.query(
        `UPDATE restaurant_print_job SET status='CLAIMED', claimed_at=now(), claimed_by=$2,
                attempts = attempts + 1, updated_at=now()
         WHERE id = (
           SELECT id FROM restaurant_print_job
           WHERE printer_id=$1 AND deleted_at IS NULL
             AND (status='QUEUED'
                  OR (status='CLAIMED' AND claimed_at < now() - interval '${CLAIM_STALE_SECONDS} seconds'))
             AND attempts < ${MAX_ATTEMPTS}
           ORDER BY created_at
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id, kind, doc_type, doc_id, doc_no, copies, attempts, doc`,
        [printer.id, dto.agent ?? 'agent'],
      ));
      const j = rows[0];
      if (!j) return null;
      const doc = j.doc as ReceiptDoc;
      return {
        id: j.id, kind: j.kind, docType: j.doc_type ?? null, docId: j.doc_id ?? null, docNo: j.doc_no ?? null,
        copies: Number(j.copies), attempts: Number(j.attempts),
        printer: { id: printer.id, key: printer.key, name: printer.name },
        text: renderText(doc), escposBase64: renderEscPosBase64(doc), doc,
      };
    });
  }

  /** The agent reports the outcome. A failure stays retryable until MAX_ATTEMPTS. */
  async complete(jobId: string, dto: CompletePrintJobDto) {
    return this.tenantTx.run(async (m) => {
      const cur = (await m.query(`SELECT status, attempts, printer_id FROM restaurant_print_job WHERE id=$1 AND deleted_at IS NULL`, [jobId])) as Row[];
      if (!cur[0]) throw new NotFoundException('Print job not found');
      const ok = dto.ok !== false;
      const attempts = Number(cur[0].attempts);
      const status = ok ? 'PRINTED' : attempts >= MAX_ATTEMPTS ? 'FAILED' : 'QUEUED';
      await m.query(
        `UPDATE restaurant_print_job SET status=$2, printed_at = CASE WHEN $2='PRINTED' THEN now() ELSE printed_at END,
                error=$3, updated_at=now() WHERE id=$1`,
        [jobId, status, ok ? null : (dto.error ?? 'Print failed').slice(0, 500)],
      );
      if (ok && cur[0].printer_id) await this.printers.touch(m, cur[0].printer_id as string);
      return { id: jobId, status, attempts };
    });
  }

  /** Put a failed job back on the queue (the "Retry" button on the spool screen). */
  async retry(jobId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(
        `UPDATE restaurant_print_job SET status='QUEUED', attempts=0, error=NULL, claimed_at=NULL, claimed_by=NULL, updated_at=now()
         WHERE id=$1 AND deleted_at IS NULL AND status IN ('FAILED','CANCELLED','CLAIMED') RETURNING id, status`,
        [jobId],
      ));
      if (!rows[0]) throw new UnprocessableEntityException('Only a failed, cancelled or stuck job can be retried');
      return { id: rows[0].id, status: rows[0].status };
    });
  }

  async cancel(jobId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(
        `UPDATE restaurant_print_job SET status='CANCELLED', updated_at=now()
         WHERE id=$1 AND deleted_at IS NULL AND status IN ('QUEUED','CLAIMED','FAILED') RETURNING id, status`,
        [jobId],
      ));
      if (!rows[0]) throw new UnprocessableEntityException('Only a pending job can be cancelled');
      return { id: rows[0].id, status: rows[0].status };
    });
  }

  async listJobs(query: ListPrintJobsQueryDto = {}) {
    return this.tenantTx.run(async (m) => {
      const conds = ['j.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (query.branchId) conds.push(`j.branch_id = $${params.push(query.branchId)}`);
      if (query.printerId) conds.push(`j.printer_id = $${params.push(query.printerId)}`);
      if (query.status) conds.push(`j.status = $${params.push(query.status)}`);
      if (query.kind) conds.push(`j.kind = $${params.push(query.kind)}`);
      const rows = (await m.query(
        `SELECT j.id, j.kind, j.doc_type, j.doc_id, j.doc_no, j.station_key, j.status, j.copies, j.attempts,
                j.error, j.created_at, j.printed_at, p.name AS printer_name, p.key AS printer_key
         FROM restaurant_print_job j LEFT JOIN restaurant_printer p ON p.id = j.printer_id
         WHERE ${conds.join(' AND ')} ORDER BY j.created_at DESC LIMIT ${Math.min(200, Number(query.limit ?? 100))}`,
        params,
      )) as Row[];
      return rows.map((r) => ({
        id: r.id, kind: r.kind, docType: r.doc_type ?? null, docId: r.doc_id ?? null, docNo: r.doc_no ?? null,
        stationKey: r.station_key ?? null, status: r.status, copies: Number(r.copies), attempts: Number(r.attempts),
        error: r.error ?? null, printerName: r.printer_name ?? null, printerKey: r.printer_key ?? null,
        createdAt: r.created_at, printedAt: r.printed_at ?? null,
      }));
    });
  }

  /** One job with its rendered payload — the preview/download path for a queued document. */
  async getJob(jobId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT j.*, p.name AS printer_name, p.key AS printer_key FROM restaurant_print_job j
         LEFT JOIN restaurant_printer p ON p.id = j.printer_id WHERE j.id=$1 AND j.deleted_at IS NULL`,
        [jobId],
      )) as Row[];
      const j = rows[0];
      if (!j) throw new NotFoundException('Print job not found');
      const doc = j.doc as ReceiptDoc;
      return {
        id: j.id, kind: j.kind, docType: j.doc_type ?? null, docId: j.doc_id ?? null, docNo: j.doc_no ?? null,
        status: j.status, copies: Number(j.copies), attempts: Number(j.attempts), error: j.error ?? null,
        printerName: j.printer_name ?? null, printerKey: j.printer_key ?? null,
        createdAt: j.created_at, printedAt: j.printed_at ?? null,
        text: renderText(doc), escposBase64: renderEscPosBase64(doc), doc,
      };
    });
  }

  /**
   * Queue an already-built document. The escape hatch for documents this service doesn't compose
   * itself (labels, reports) — they still travel the same spool, so one agent prints everything.
   */
  async enqueueDocInTx(
    m: Mgr,
    j: { branchId: string | null; printerId: string | null; kind: string; docType: string | null; docId: string | null; docNo: string | null; copies: number; doc: ReceiptDoc },
  ) {
    return this.insertJob(m, { ...j, stationKey: null });
  }

  // ── Internals ───────────────────────────────────────────────────────────────────

  private async insertJob(
    m: Mgr,
    j: { branchId: string | null; printerId: string | null; kind: string; docType: string | null; docId: string | null; docNo: string | null; stationKey: string | null; copies: number; doc: ReceiptDoc },
  ) {
    const rows = (await m.query(
      `INSERT INTO restaurant_print_job
         (tenant_id, branch_id, printer_id, kind, doc_type, doc_id, doc_no, station_key, status, copies, doc)
       VALUES (${TENANT}, $1,$2,$3,$4,$5,$6,$7,'QUEUED',COALESCE($8,1),$9::jsonb)
       RETURNING id, status, kind, doc_no, copies`,
      [j.branchId, j.printerId, j.kind, j.docType, j.docId, j.docNo, j.stationKey, j.copies, JSON.stringify(j.doc)],
    )) as Row[];
    const r = rows[0]!;
    return {
      id: r.id as string, status: r.status as string, kind: r.kind as string,
      docNo: (r.doc_no as string) ?? null, copies: Number(r.copies),
      printerId: j.printerId,
      /** True when nothing is configured yet: the job waits for the first matching printer to poll. */
      unassigned: j.printerId === null,
    };
  }

  private async orderBranch(m: Mgr, orderId: string): Promise<string | null> {
    const rows = (await m.query(`SELECT branch_id FROM restaurant_order WHERE id=$1 AND deleted_at IS NULL`, [orderId])) as Row[];
    if (!rows[0]) throw new NotFoundException('Order not found');
    return (rows[0].branch_id as string) ?? null;
  }

  private async autoPrint(m: Mgr, branchId: string | null, what: 'kot' | 'bill'): Promise<boolean> {
    const col = what === 'kot' ? 'auto_print_kot' : 'auto_print_bill';
    const rows = (await m.query(
      `SELECT ${col} AS v FROM restaurant_config WHERE deleted_at IS NULL AND branch_id IS NOT DISTINCT FROM $1 LIMIT 1`,
      [branchId],
    )) as Row[];
    // Unconfigured branch: KOTs default on (a kitchen without tickets cannot work), bills default off.
    if (!rows[0]) return what === 'kot';
    return Boolean(rows[0].v);
  }

  private async printerById(m: Mgr, id: string) {
    const rows = (await m.query(
      `SELECT id, key, name, kind, chars_per_line, copies, cut, cash_drawer FROM restaurant_printer
       WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    )) as Row[];
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id as string, key: r.key as string, name: r.name as string, kind: r.kind as string,
      charsPerLine: Number(r.chars_per_line), copies: Number(r.copies), cut: Boolean(r.cut), cashDrawer: Boolean(r.cash_drawer),
    };
  }

  /**
   * Receipt branding: the tenant-wide POS brand (reused, never duplicated) overlaid with the branch's
   * own name/address/phone and the restaurant config's header/footer/tax number.
   */
  private async brandConfig(m: Mgr, branchId: string | null) {
    const cfg = (await m.query(
      `SELECT currency, timezone, receipt_header, receipt_footer, receipt_show_qr, tax_number
       FROM restaurant_config WHERE deleted_at IS NULL AND branch_id IS NOT DISTINCT FROM $1 LIMIT 1`,
      [branchId],
    )) as Row[];
    const brandRows = (await m.query(`SELECT store_name, address, phone, receipt_footer FROM pos_branding WHERE deleted_at IS NULL LIMIT 1`, [])) as Row[];
    const branchRows = branchId
      ? ((await m.query(`SELECT name, address, city, phone FROM branch WHERE id=$1 AND deleted_at IS NULL`, [branchId])) as Row[])
      : [];
    const c = cfg[0];
    const pb = brandRows[0];
    const br = branchRows[0];
    const address = [br?.address, br?.city].filter(Boolean).join(', ') || ((pb?.address as string) ?? null);
    return {
      timezone: (c?.timezone as string) ?? 'Asia/Karachi',
      showQr: c?.receipt_show_qr === undefined ? true : Boolean(c.receipt_show_qr),
      brand: {
        name: ((pb?.store_name as string) || (br?.name as string) || 'Restaurant').trim(),
        branchName: pb?.store_name && br?.name ? (br.name as string) : null,
        address: address || null,
        phone: ((br?.phone as string) ?? (pb?.phone as string)) || null,
        taxNumber: (c?.tax_number as string) ?? null,
        header: (c?.receipt_header as string) ?? null,
        footer: ((c?.receipt_footer as string) ?? (pb?.receipt_footer as string)) || null,
      },
    };
  }
}
