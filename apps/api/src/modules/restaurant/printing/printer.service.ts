import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../../common/tenant/tenant-transaction.service';
import type { CreatePrinterDto, ListPrintersQueryDto, UpdatePrinterDto } from '../dto/restaurant.dto';
import { type Row, rowsOf } from '../restaurant.util';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

const TENANT = `current_setting('app.tenant_id')::uuid`;
const isUnique = (e: unknown) => (e as { code?: string })?.code === '23505';

export interface PrinterRow {
  id: string;
  key: string;
  name: string;
  kind: string;
  charsPerLine: number;
  copies: number;
  cut: boolean;
  cashDrawer: boolean;
}

/**
 * The printer registry: one row per physical device, scoped to a branch. The API never opens a socket
 * to a printer — it only records how a device is reached so the local print agent (or the browser/app
 * holding the USB handle) can. Routing lives here too: which device a given document should land on.
 */
@Injectable()
export class RestaurantPrinterService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  async list(query: ListPrintersQueryDto = {}) {
    return this.tenantTx.run(async (m) => {
      const conds = ['p.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (query.branchId) conds.push(`p.branch_id = $${params.push(query.branchId)}`);
      if (query.kind) conds.push(`p.kind = $${params.push(query.kind)}`);
      if (query.active !== undefined) conds.push(`p.active = $${params.push(query.active)}`);
      const rows = (await m.query(
        `SELECT p.id, p.branch_id, p.key, p.name, p.kind, p.connection, p.host, p.port, p.device_path,
                p.station_key, p.chars_per_line, p.codepage, p.copies, p.cut, p.cash_drawer, p.is_default,
                p.active, p.last_seen_at, b.name AS branch_name,
                count(j.id) FILTER (WHERE j.status = 'QUEUED')::int AS queued,
                count(j.id) FILTER (WHERE j.status = 'FAILED')::int AS failed
         FROM restaurant_printer p
         LEFT JOIN branch b ON b.id = p.branch_id
         LEFT JOIN restaurant_print_job j ON j.printer_id = p.id AND j.deleted_at IS NULL
         WHERE ${conds.join(' AND ')}
         GROUP BY p.id, b.name
         ORDER BY p.kind, p.name`,
        params,
      )) as Row[];
      return rows.map(mapPrinter);
    });
  }

  async get(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT p.*, b.name AS branch_name, 0 AS queued, 0 AS failed FROM restaurant_printer p
         LEFT JOIN branch b ON b.id = p.branch_id WHERE p.id=$1 AND p.deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Printer not found');
      return mapPrinter(rows[0]);
    });
  }

  async create(dto: CreatePrinterDto) {
    return this.tenantTx.run(async (m) => {
      this.validateReachability(dto);
      let id: string;
      try {
        const rows = (await m.query(
          `INSERT INTO restaurant_printer
             (tenant_id, branch_id, key, name, kind, connection, host, port, device_path, station_key,
              chars_per_line, codepage, copies, cut, cash_drawer, is_default, active)
           VALUES (${TENANT}, $1,$2,$3,COALESCE($4,'RECEIPT'),COALESCE($5,'NETWORK'),$6,COALESCE($7,9100),$8,$9,
                   COALESCE($10,42),COALESCE($11,'CP437'),COALESCE($12,1),COALESCE($13,true),COALESCE($14,false),
                   COALESCE($15,false),true)
           RETURNING id`,
          [
            dto.branchId ?? null, dto.key, dto.name, dto.kind ?? null, dto.connection ?? null, dto.host ?? null,
            dto.port ?? null, dto.devicePath ?? null, dto.stationKey ?? null, dto.charsPerLine ?? null,
            dto.codepage ?? null, dto.copies ?? null, dto.cut ?? null, dto.cashDrawer ?? null, dto.isDefault ?? null,
          ],
        )) as Row[];
        id = rows[0]!.id as string;
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`A printer with key "${dto.key}" already exists at this branch`);
        throw err;
      }
      if (dto.isDefault) await this.clearOtherDefaults(m, id, dto.branchId ?? null, dto.kind ?? 'RECEIPT');
      return this.getInTx(m, id);
    });
  }

  async update(id: string, dto: UpdatePrinterDto) {
    return this.tenantTx.run(async (m) => {
      const current = await this.getInTx(m, id);
      // Merge field by field, NOT by spreading the DTO: a class-validator DTO instance carries every
      // declared optional property as an own `undefined`, so `{...current, ...dto}` would erase the
      // stored host and reject a request that only changes the port.
      const err = reachabilityError(
        dto.connection ?? current.connection,
        dto.host ?? current.host,
        dto.devicePath ?? current.devicePath,
      );
      if (err) throw new BadRequestException(err);
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (col: string, val: unknown) => {
        if (val !== undefined) sets.push(`${col}=$${params.push(val)}`);
      };
      set('name', dto.name);
      set('kind', dto.kind);
      set('connection', dto.connection);
      set('host', dto.host);
      set('port', dto.port);
      set('device_path', dto.devicePath);
      set('station_key', dto.stationKey);
      set('chars_per_line', dto.charsPerLine);
      set('codepage', dto.codepage);
      set('copies', dto.copies);
      set('cut', dto.cut);
      set('cash_drawer', dto.cashDrawer);
      set('is_default', dto.isDefault);
      set('active', dto.active);
      if (sets.length) {
        const res = rowsOf(await m.query(
          `UPDATE restaurant_printer SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
          params,
        ));
        if (!res[0]) throw new NotFoundException('Printer not found');
      }
      if (dto.isDefault) await this.clearOtherDefaults(m, id, current.branchId, dto.kind ?? current.kind);
      return this.getInTx(m, id);
    });
  }

  async remove(id: string) {
    return this.tenantTx.run(async (m) => {
      const res = rowsOf(await m.query(
        `UPDATE restaurant_printer SET deleted_at=now(), updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [id],
      ));
      if (!res[0]) throw new NotFoundException('Printer not found');
      // Queued work for a removed device would sit forever — cancel it explicitly.
      await m.query(
        `UPDATE restaurant_print_job SET status='CANCELLED', error='Printer removed', updated_at=now()
         WHERE printer_id=$1 AND status IN ('QUEUED','CLAIMED')`,
        [id],
      );
      return { id, deleted: true };
    });
  }

  /**
   * Choose the device a document belongs on: a KOT goes to the KITCHEN printer bound to its station
   * (falling back to any kitchen printer at the branch), a bill to the branch's default RECEIPT
   * printer. Branch-specific devices win over tenant-wide ones. Returns null when nothing is
   * configured — the job is still queued (unassigned) so nothing is silently lost.
   */
  async routeInTx(m: Mgr, opts: { branchId: string | null; kind: string; stationKey?: string | null }): Promise<PrinterRow | null> {
    const rows = (await m.query(
      `SELECT id, key, name, kind, chars_per_line, copies, cut, cash_drawer
       FROM restaurant_printer
       WHERE deleted_at IS NULL AND active = true AND kind = $1
         AND (branch_id IS NOT DISTINCT FROM $2 OR branch_id IS NULL)
         AND ($3::text IS NULL OR station_key IS NULL OR station_key = $3::text)
       ORDER BY (branch_id IS NOT DISTINCT FROM $2) DESC,
                (station_key = $3::text) DESC NULLS LAST,
                is_default DESC, created_at
       LIMIT 1`,
      [opts.kind, opts.branchId, opts.stationKey ?? null],
    )) as Row[];
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id as string, key: r.key as string, name: r.name as string, kind: r.kind as string,
      charsPerLine: Number(r.chars_per_line), copies: Number(r.copies), cut: Boolean(r.cut), cashDrawer: Boolean(r.cash_drawer),
    };
  }

  /** Heartbeat — the agent proves the device is alive each time it claims or finishes a job. */
  async touch(m: Mgr, printerId: string) {
    await m.query(`UPDATE restaurant_printer SET last_seen_at=now() WHERE id=$1`, [printerId]);
  }

  async findByKeyInTx(m: Mgr, key: string): Promise<PrinterRow | null> {
    const rows = (await m.query(
      `SELECT id, key, name, kind, chars_per_line, copies, cut, cash_drawer FROM restaurant_printer
       WHERE lower(key)=lower($1) AND deleted_at IS NULL AND active = true LIMIT 1`,
      [key],
    )) as Row[];
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id as string, key: r.key as string, name: r.name as string, kind: r.kind as string,
      charsPerLine: Number(r.chars_per_line), copies: Number(r.copies), cut: Boolean(r.cut), cashDrawer: Boolean(r.cash_drawer),
    };
  }

  private async getInTx(m: Mgr, id: string) {
    const rows = (await m.query(
      `SELECT p.*, b.name AS branch_name, 0 AS queued, 0 AS failed FROM restaurant_printer p
       LEFT JOIN branch b ON b.id = p.branch_id WHERE p.id=$1 AND p.deleted_at IS NULL`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Printer not found');
    return mapPrinter(rows[0]);
  }

  private async clearOtherDefaults(m: Mgr, keepId: string, branchId: string | null, kind: string) {
    await m.query(
      `UPDATE restaurant_printer SET is_default=false, updated_at=now()
       WHERE id <> $1 AND kind=$3 AND branch_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL AND is_default = true`,
      [keepId, branchId, kind],
    );
  }

  private validateReachability(dto: CreatePrinterDto) {
    const err = reachabilityError(dto.connection ?? 'NETWORK', dto.host, dto.devicePath);
    if (err) throw new BadRequestException(err);
  }
}

/**
 * A device the agent cannot reach is a support ticket later, so the address is validated at
 * configuration time. Pure so it can be exercised directly: returns the complaint, or null when the
 * connection details are sufficient for the agent to find the printer.
 */
export function reachabilityError(
  connection: string | null | undefined,
  host: string | null | undefined,
  devicePath: string | null | undefined,
): string | null {
  const conn = connection ?? 'NETWORK';
  if (conn === 'NETWORK' && !host) return 'A NETWORK printer needs a host (IP or hostname)';
  if ((conn === 'USB' || conn === 'BLUETOOTH') && !devicePath) {
    return `A ${conn} printer needs a device path (e.g. /dev/usb/lp0 or the MAC address)`;
  }
  return null;
}

function mapPrinter(r: Row) {
  return {
    id: r.id as string,
    branchId: (r.branch_id as string) ?? null,
    branchName: (r.branch_name as string) ?? null,
    key: r.key as string,
    name: r.name as string,
    kind: r.kind as string,
    connection: r.connection as string,
    host: (r.host as string) ?? null,
    port: Number(r.port ?? 9100),
    devicePath: (r.device_path as string) ?? null,
    stationKey: (r.station_key as string) ?? null,
    charsPerLine: Number(r.chars_per_line ?? 42),
    codepage: (r.codepage as string) ?? 'CP437',
    copies: Number(r.copies ?? 1),
    cut: Boolean(r.cut),
    cashDrawer: Boolean(r.cash_drawer),
    isDefault: Boolean(r.is_default),
    active: Boolean(r.active),
    lastSeenAt: r.last_seen_at ?? null,
    queued: Number(r.queued ?? 0),
    failed: Number(r.failed ?? 0),
  };
}
