import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { EVENT_TYPES, type ProductionOrderCompletedV1 } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { InventoryDocsService } from '../inventory/inventory-docs.service';
import { OutboxService } from '../outbox/outbox.service';
import type {
  AttributeValueDto,
  BomOperationDto,
  BomLineDto,
  CompleteOrderDto,
  CreateAttributeDto,
  CreateBomDto,
  CreateOrderDto,
  CreateWorkCenterDto,
  IssueMaterialsDto,
  UpdateBomDto,
  UpdateOrderDto,
  UpdateWorkCenterDto,
} from './dto/production.dto';
import {
  type ProductionGlAccounts,
  mapAttribute,
  mapBom,
  mapBomLine,
  mapBomOperation,
  mapOrder,
  mapOrderMaterial,
  mapOrderOperation,
  mapWorkCenter,
  nextProdDocNo,
  operationCostMinor,
  rollUpCost,
  scaledRequiredQty,
} from './production.util';

type Row = Record<string, unknown>;
type Mgr = EntityManager;

const WC_COLS = 'id, name, code, cost_per_hour_minor, currency, status, notes';
const BOM_COLS = 'id, bom_no, product_id, name, output_qty, version, status, overhead_pct, notes';
const ORDER_COLS =
  'id, order_no, product_id, bom_id, warehouse_id, planned_qty, produced_qty, status, priority, overhead_pct, planned_start, planned_end, actual_start, actual_end, material_cost_minor, operation_cost_minor, overhead_minor, total_cost_minor, unit_cost_minor, currency, notes';
const ATTR_COLS = 'id, attr_key, label, data_type, options, required, sort';

/**
 * Manufacturing. Work centers + BOMs define how a finished good is made; a production order executes
 * it — materials are issued OUT of stock through the inventory valued ledger (actual WAVG cost
 * captured), operation + overhead cost is added, and the finished good is received IN at the computed
 * unit cost. Raw SQL via the tenant-scoped tx (RLS); money is integer minor units.
 */
@Injectable()
export class ProductionService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly inventoryDocs: InventoryDocsService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Work centers ────────────────────────────────────────────────────────────
  async createWorkCenter(dto: CreateWorkCenterDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO production_work_center (tenant_id, name, code, cost_per_hour_minor, currency, notes)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3, COALESCE($4,'PKR'),$5) RETURNING ${WC_COLS}`,
        [dto.name, dto.code ?? null, dto.costPerHourMinor ?? 0, dto.currency ?? null, dto.notes ?? null],
      )) as Row[];
      return mapWorkCenter(rows[0]!);
    });
  }

  async listWorkCenters() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT ${WC_COLS} FROM production_work_center WHERE deleted_at IS NULL ORDER BY name`)) as Row[];
      return rows.map(mapWorkCenter);
    });
  }

  async updateWorkCenter(id: string, dto: UpdateWorkCenterDto) {
    return this.tenantTx.run(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (c: string, v: unknown) => { sets.push(`${c}=$${params.length + 1}`); params.push(v); };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.code !== undefined) set('code', dto.code);
      if (dto.costPerHourMinor !== undefined) set('cost_per_hour_minor', dto.costPerHourMinor);
      if (dto.status !== undefined) set('status', dto.status);
      if (dto.notes !== undefined) set('notes', dto.notes);
      if (!sets.length) return this.getWorkCenterWith(m, id);
      const rows = rowsOf(await m.query(
        `UPDATE production_work_center SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING ${WC_COLS}`,
        params,
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Work center not found');
      return mapWorkCenter(rows[0]);
    });
  }

  async deleteWorkCenter(id: string) {
    await this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(
        `UPDATE production_work_center SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Work center not found');
    });
  }

  // ── Bills of materials ──────────────────────────────────────────────────────
  async createBom(dto: CreateBomDto) {
    return this.tenantTx.run(async (m) => {
      const bomNo = await nextProdDocNo(m, 'BOM', 'BOM');
      let bomId: string;
      try {
        const rows = (await m.query(
          `INSERT INTO production_bom (tenant_id, bom_no, product_id, name, output_qty, overhead_pct, notes)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3, COALESCE($4,1), COALESCE($5,0), $6) RETURNING id`,
          [bomNo, dto.productId, dto.name, dto.outputQty ?? null, dto.overheadPct ?? null, dto.notes ?? null],
        )) as Row[];
        bomId = rows[0]!.id as string;
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown product for this tenant');
        throw err;
      }
      await this.replaceBomLines(m, bomId, dto.lines);
      await this.replaceBomOperations(m, bomId, dto.operations ?? []);
      return this.getBomWith(m, bomId);
    });
  }

  async listBoms() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT b.${BOM_COLS.split(', ').join(', b.')}, p.name AS product_name
         FROM production_bom b JOIN inventory_product p ON p.id = b.product_id
         WHERE b.deleted_at IS NULL ORDER BY b.created_at DESC`,
      )) as Row[];
      return rows.map((r) => ({ ...mapBom(r), productName: (r.product_name as string) ?? null }));
    });
  }

  async getBom(id: string) {
    return this.tenantTx.run((m) => this.getBomWith(m, id));
  }

  async updateBom(id: string, dto: UpdateBomDto) {
    return this.tenantTx.run(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (c: string, v: unknown) => { sets.push(`${c}=$${params.length + 1}`); params.push(v); };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.outputQty !== undefined) set('output_qty', dto.outputQty);
      if (dto.overheadPct !== undefined) set('overhead_pct', dto.overheadPct);
      if (dto.notes !== undefined) set('notes', dto.notes);
      if (sets.length) {
        const rows = rowsOf(await m.query(
          `UPDATE production_bom SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, params,
        )) as Row[];
        if (!rows[0]) throw new NotFoundException('BOM not found');
      }
      if (dto.lines) await this.replaceBomLines(m, id, dto.lines);
      if (dto.operations) await this.replaceBomOperations(m, id, dto.operations);
      return this.getBomWith(m, id);
    });
  }

  async setBomStatus(id: string, status: string) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = rowsOf(await m.query(
          `UPDATE production_bom SET status=$2, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id, status],
        )) as Row[];
        if (!rows[0]) throw new NotFoundException('BOM not found');
      } catch (err) {
        if (isUnique(err)) throw new ConflictException('Another active BOM already exists for this product');
        throw err;
      }
      return this.getBomWith(m, id);
    });
  }

  async deleteBom(id: string) {
    await this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(
        `UPDATE production_bom SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('BOM not found');
    });
  }

  // ── Custom attributes ───────────────────────────────────────────────────────
  async createAttribute(dto: CreateAttributeDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO production_attribute (tenant_id, attr_key, label, data_type, options, required, sort)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2, COALESCE($3,'TEXT'),$4, COALESCE($5,false), COALESCE($6,0)) RETURNING ${ATTR_COLS}`,
          [dto.attrKey, dto.label, dto.dataType ?? null, dto.options ?? null, dto.required ?? null, dto.sort ?? null],
        )) as Row[];
        return mapAttribute(rows[0]!);
      } catch (err) {
        if (isUnique(err)) throw new ConflictException(`Attribute "${dto.attrKey}" already exists`);
        throw err;
      }
    });
  }

  async listAttributes() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT ${ATTR_COLS} FROM production_attribute WHERE deleted_at IS NULL ORDER BY sort, label`)) as Row[];
      return rows.map(mapAttribute);
    });
  }

  async deleteAttribute(id: string) {
    await this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(
        `UPDATE production_attribute SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Attribute not found');
    });
  }

  // ── Production orders ───────────────────────────────────────────────────────
  async createOrder(dto: CreateOrderDto) {
    return this.tenantTx.run(async (m) => {
      const orderNo = await nextProdDocNo(m, 'MO', 'MO');
      let overheadPct = dto.overheadPct ?? 0;
      let materials: { componentProductId: string; requiredQty: number; unitCostMinor: number }[] = [];
      let operations: { workCenterId: string | null; sequence: number; name: string; plannedMinutes: number; rateMinor: number }[] = [];

      if (dto.bomId) {
        const bom = (await m.query(`SELECT ${BOM_COLS} FROM production_bom WHERE id=$1 AND deleted_at IS NULL`, [dto.bomId])) as Row[];
        if (!bom[0]) throw new BadRequestException('BOM not found');
        if (bom[0].product_id !== dto.productId) throw new BadRequestException('BOM is for a different product');
        if (dto.overheadPct === undefined) overheadPct = Number(bom[0].overhead_pct);
        const outputQty = Number(bom[0].output_qty);
        const lines = (await m.query(
          `SELECT l.component_product_id, l.quantity, l.scrap_pct, p.cost_price_minor
           FROM production_bom_line l JOIN inventory_product p ON p.id = l.component_product_id
           WHERE l.bom_id=$1 AND l.deleted_at IS NULL ORDER BY l.created_at`, [dto.bomId],
        )) as Row[];
        materials = lines.map((l) => ({
          componentProductId: l.component_product_id as string,
          requiredQty: scaledRequiredQty(Number(l.quantity), Number(l.scrap_pct), dto.plannedQty, outputQty),
          unitCostMinor: Number(l.cost_price_minor ?? 0),
        }));
        const ops = (await m.query(
          `SELECT o.work_center_id, o.sequence, o.name, o.run_minutes, w.cost_per_hour_minor
           FROM production_bom_operation o LEFT JOIN production_work_center w ON w.id = o.work_center_id
           WHERE o.bom_id=$1 AND o.deleted_at IS NULL ORDER BY o.sequence`, [dto.bomId],
        )) as Row[];
        operations = ops.map((o) => ({
          workCenterId: (o.work_center_id as string) ?? null,
          sequence: Number(o.sequence),
          name: o.name as string,
          plannedMinutes: Math.round((Number(o.run_minutes) * dto.plannedQty) / Math.max(outputQty, 1)),
          rateMinor: Number(o.cost_per_hour_minor ?? 0),
        }));
      } else if (dto.materials?.length) {
        const ids = dto.materials.map((mt) => mt.componentProductId);
        const costRows = (await m.query(
          `SELECT id, cost_price_minor FROM inventory_product WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [ids],
        )) as Row[];
        const costById = new Map(costRows.map((r) => [r.id as string, Number(r.cost_price_minor ?? 0)]));
        materials = dto.materials.map((mt) => ({
          componentProductId: mt.componentProductId,
          requiredQty: mt.requiredQty,
          unitCostMinor: costById.get(mt.componentProductId) ?? 0,
        }));
      }

      let orderId: string;
      try {
        const rows = (await m.query(
          `INSERT INTO production_order (tenant_id, order_no, product_id, bom_id, warehouse_id, planned_qty, priority, overhead_pct, planned_start, planned_end, notes)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5, COALESCE($6,'NORMAL'),$7,$8,$9,$10) RETURNING id`,
          [orderNo, dto.productId, dto.bomId ?? null, dto.warehouseId ?? null, dto.plannedQty,
            dto.priority ?? null, overheadPct, dto.plannedStart ?? null, dto.plannedEnd ?? null, dto.notes ?? null],
        )) as Row[];
        orderId = rows[0]!.id as string;
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown product, BOM, or warehouse for this tenant');
        throw err;
      }

      for (const mt of materials) {
        await m.query(
          `INSERT INTO production_order_material (tenant_id, order_id, component_product_id, required_qty, unit_cost_minor, cost_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5)`,
          [orderId, mt.componentProductId, mt.requiredQty, mt.unitCostMinor, mt.requiredQty * mt.unitCostMinor],
        );
      }
      for (const op of operations) {
        await m.query(
          `INSERT INTO production_order_operation (tenant_id, order_id, work_center_id, sequence, name, planned_minutes, cost_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6)`,
          [orderId, op.workCenterId, op.sequence, op.name, op.plannedMinutes, operationCostMinor(op.plannedMinutes, op.rateMinor)],
        );
      }
      await this.setAttributeValues(m, orderId, dto.attributes ?? []);
      await this.recomputeOrderCost(m, orderId, dto.plannedQty);
      return this.getOrderWith(m, orderId);
    });
  }

  async listOrders(status?: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT o.${ORDER_COLS.split(', ').join(', o.')}, p.name AS product_name
         FROM production_order o JOIN inventory_product p ON p.id = o.product_id
         WHERE o.deleted_at IS NULL ${status ? 'AND o.status = $1' : ''} ORDER BY o.created_at DESC`,
        status ? [status] : [],
      )) as Row[];
      return rows.map(mapOrder);
    });
  }

  async getOrder(id: string) {
    return this.tenantTx.run((m) => this.getOrderWith(m, id));
  }

  async updateOrder(id: string, dto: UpdateOrderDto) {
    return this.tenantTx.run(async (m) => {
      const cur = (await m.query(`SELECT status, planned_qty FROM production_order WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])) as Row[];
      if (!cur[0]) throw new NotFoundException('Order not found');
      if (['COMPLETED', 'CANCELLED'].includes(cur[0].status as string)) throw new UnprocessableEntityException('Order is closed');
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (c: string, v: unknown) => { sets.push(`${c}=$${params.length + 1}`); params.push(v); };
      if (dto.priority !== undefined) set('priority', dto.priority);
      if (dto.overheadPct !== undefined) set('overhead_pct', dto.overheadPct);
      if (dto.plannedStart !== undefined) set('planned_start', dto.plannedStart);
      if (dto.plannedEnd !== undefined) set('planned_end', dto.plannedEnd);
      if (dto.notes !== undefined) set('notes', dto.notes);
      if (sets.length) await m.query(`UPDATE production_order SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, params);
      if (dto.attributes) await this.setAttributeValues(m, id, dto.attributes);
      if (dto.overheadPct !== undefined) await this.recomputeOrderCost(m, id, Number(cur[0].planned_qty));
      return this.getOrderWith(m, id);
    });
  }

  async setStatus(id: string, target: 'PLANNED' | 'RELEASED') {
    return this.tenantTx.run(async (m) => {
      const cur = (await m.query(`SELECT status FROM production_order WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])) as Row[];
      if (!cur[0]) throw new NotFoundException('Order not found');
      const from = cur[0].status as string;
      const ok = target === 'PLANNED' ? from === 'DRAFT' : ['DRAFT', 'PLANNED'].includes(from);
      if (!ok) throw new UnprocessableEntityException(`Cannot move a ${from} order to ${target}`);
      await m.query(`UPDATE production_order SET status=$2, updated_at=now() WHERE id=$1`, [id, target]);
      return this.getOrderWith(m, id);
    });
  }

  /** Issue (consume) materials from stock through the inventory ledger, capturing actual WAVG cost. */
  async issueMaterials(id: string, dto: IssueMaterialsDto) {
    return this.tenantTx.run(async (m) => {
      const order = await this.lockOrder(m, id);
      if (!['RELEASED', 'IN_PROGRESS'].includes(order.status as string)) {
        throw new UnprocessableEntityException('Issue materials only on a released order');
      }
      const mats = (await m.query(
        `SELECT id, component_product_id, required_qty, issued_qty FROM production_order_material WHERE order_id=$1 AND deleted_at IS NULL`, [id],
      )) as Row[];
      const wanted = new Map(dto.materials?.map((x) => [x.materialId, x.quantity]) ?? []);
      const explicit = !!dto.materials?.length;
      for (const mat of mats) {
        const remaining = Number(mat.required_qty) - Number(mat.issued_qty);
        const qty = explicit ? (wanted.get(mat.id as string) ?? 0) : remaining;
        if (qty <= 0) continue;
        if (qty > remaining) throw new UnprocessableEntityException(`Cannot issue ${qty}; only ${remaining} remaining`);
        await this.consume(m, order, mat, qty);
      }
      await m.query(
        `UPDATE production_order SET status='IN_PROGRESS', actual_start=COALESCE(actual_start, now()), updated_at=now() WHERE id=$1`, [id],
      );
      await this.recomputeOrderCost(m, id, Number(order.planned_qty));
      return this.getOrderWith(m, id);
    });
  }

  /** Complete the order: backflush any un-issued materials, cost the operations, and receive the
   * finished good into stock at the computed unit cost. Emits `production.order_completed`. */
  async completeOrder(id: string, dto: CompleteOrderDto) {
    return this.tenantTx.run(async (m) => {
      const order = await this.lockOrder(m, id);
      if (!['RELEASED', 'IN_PROGRESS'].includes(order.status as string)) {
        throw new UnprocessableEntityException(`Cannot complete a ${String(order.status)} order`);
      }
      const producedQty = dto.producedQty ?? Number(order.planned_qty);

      // Backflush remaining materials.
      const mats = (await m.query(
        `SELECT id, component_product_id, required_qty, issued_qty FROM production_order_material WHERE order_id=$1 AND deleted_at IS NULL`, [id],
      )) as Row[];
      for (const mat of mats) {
        const remaining = Number(mat.required_qty) - Number(mat.issued_qty);
        if (remaining > 0) await this.consume(m, order, mat, remaining);
      }

      // Cost operations (actuals override planned).
      const actualBy = new Map(dto.operations?.map((o) => [o.operationId, o.actualMinutes]) ?? []);
      const ops = (await m.query(
        `SELECT o.id, o.planned_minutes, o.actual_minutes, w.cost_per_hour_minor
         FROM production_order_operation o LEFT JOIN production_work_center w ON w.id = o.work_center_id
         WHERE o.order_id=$1 AND o.deleted_at IS NULL`, [id],
      )) as Row[];
      for (const op of ops) {
        const minutes = actualBy.has(op.id as string) ? actualBy.get(op.id as string)! : Number(op.actual_minutes) || Number(op.planned_minutes);
        await m.query(
          `UPDATE production_order_operation SET actual_minutes=$2, cost_minor=$3, status='DONE', updated_at=now() WHERE id=$1`,
          [op.id, minutes, operationCostMinor(minutes, Number(op.cost_per_hour_minor ?? 0))],
        );
      }

      const cost = await this.recomputeOrderCost(m, id, producedQty);

      // Receive the finished good into stock at the computed unit cost.
      await this.inventoryDocs.applyStockMovement(m, {
        productId: order.product_id as string,
        warehouseId: (order.warehouse_id as string) ?? null,
        docType: 'PROD_RECEIPT',
        docId: id,
        docNo: order.order_no as string,
        qtyIn: producedQty,
        unitCostMinor: cost.unitMinor,
        narration: `Production receipt ${String(order.order_no)}`,
      });

      await m.query(
        `UPDATE production_order SET status='COMPLETED', produced_qty=$2, actual_end=now(), updated_at=now() WHERE id=$1`, [id, producedQty],
      );
      const payload: ProductionOrderCompletedV1 = {
        orderId: id,
        orderNo: order.order_no as string,
        productId: order.product_id as string,
        producedQty,
        materialCostMinor: cost.materialMinor,
        operationCostMinor: cost.operationMinor,
        overheadMinor: cost.overheadMinor,
        totalCostMinor: cost.totalMinor,
        unitCostMinor: cost.unitMinor,
        currency: (order.currency as string) ?? 'PKR',
      };
      await this.outbox.write(m, EVENT_TYPES.PRODUCTION_ORDER_COMPLETED, payload);
      return this.getOrderWith(m, id);
    });
  }

  async cancelOrder(id: string) {
    return this.tenantTx.run(async (m) => {
      const order = await this.lockOrder(m, id);
      if (['COMPLETED', 'CANCELLED'].includes(order.status as string)) {
        throw new UnprocessableEntityException(`Cannot cancel a ${String(order.status)} order`);
      }
      // Restore any already-issued materials to stock.
      const mats = (await m.query(
        `SELECT component_product_id, issued_qty, unit_cost_minor FROM production_order_material WHERE order_id=$1 AND issued_qty > 0 AND deleted_at IS NULL`, [id],
      )) as Row[];
      for (const mat of mats) {
        await this.inventoryDocs.applyStockMovement(m, {
          productId: mat.component_product_id as string,
          warehouseId: (order.warehouse_id as string) ?? null,
          docType: 'PROD_CANCEL',
          docId: id,
          docNo: order.order_no as string,
          qtyIn: Number(mat.issued_qty),
          unitCostMinor: Number(mat.unit_cost_minor),
          narration: `Cancel production ${String(order.order_no)}`,
        });
      }
      await m.query(`UPDATE production_order SET status='CANCELLED', updated_at=now() WHERE id=$1`, [id]);
      return this.getOrderWith(m, id);
    });
  }

  // ── Reports ───────────────────────────────────────────────────────────────────
  /** Work-in-progress: open orders with their current cost. */
  async wipReport() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT o.${ORDER_COLS.split(', ').join(', o.')}, p.name AS product_name
         FROM production_order o JOIN inventory_product p ON p.id = o.product_id
         WHERE o.deleted_at IS NULL AND o.status IN ('PLANNED','RELEASED','IN_PROGRESS')
         ORDER BY o.priority DESC, o.created_at`,
      )) as Row[];
      return rows.map(mapOrder);
    });
  }

  /** Output + cost by finished good (completed orders). */
  async outputReport() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT o.product_id, p.name AS product_name, COUNT(*) AS orders,
           COALESCE(SUM(o.produced_qty),0) AS produced_qty, COALESCE(SUM(o.total_cost_minor),0) AS total_cost_minor, MIN(o.currency) AS currency
         FROM production_order o JOIN inventory_product p ON p.id = o.product_id
         WHERE o.deleted_at IS NULL AND o.status='COMPLETED'
         GROUP BY o.product_id, p.name ORDER BY produced_qty DESC`,
      )) as Row[];
      return rows.map((r) => ({
        productId: r.product_id as string,
        productName: (r.product_name as string) ?? null,
        orders: Number(r.orders),
        producedQty: Number(r.produced_qty),
        totalCost: { amountMinor: Number(r.total_cost_minor), currency: (r.currency as string) ?? 'PKR' },
      }));
    });
  }

  /** Material shortages across open orders: required-but-unissued vs on-hand. */
  async materialShortages() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT mt.component_product_id, p.name AS component_name, p.on_hand,
           COALESCE(SUM(mt.required_qty - mt.issued_qty),0) AS needed
         FROM production_order_material mt
         JOIN production_order o ON o.id = mt.order_id
         JOIN inventory_product p ON p.id = mt.component_product_id
         WHERE mt.deleted_at IS NULL AND o.deleted_at IS NULL AND o.status IN ('PLANNED','RELEASED','IN_PROGRESS')
         GROUP BY mt.component_product_id, p.name, p.on_hand
         HAVING COALESCE(SUM(mt.required_qty - mt.issued_qty),0) > p.on_hand
         ORDER BY (COALESCE(SUM(mt.required_qty - mt.issued_qty),0) - p.on_hand) DESC`,
      )) as Row[];
      return rows.map((r) => ({
        componentProductId: r.component_product_id as string,
        componentName: (r.component_name as string) ?? null,
        needed: Number(r.needed),
        onHand: Number(r.on_hand),
        shortBy: Number(r.needed) - Number(r.on_hand),
      }));
    });
  }

  // ── GL posting config ─────────────────────────────────────────────────────────
  async getGlConfig(): Promise<ProductionGlAccounts> {
    return this.tenantTx.run((m) => this.glConfigInTx(m));
  }

  async setGlConfig(dto: Partial<Record<keyof ProductionGlAccounts, string>>): Promise<ProductionGlAccounts> {
    return this.tenantTx.run(async (m) => {
      try {
        await m.query(
          `INSERT INTO production_gl_config (tenant_id, fg_inventory_account_id, raw_materials_account_id, labor_account_id, overhead_account_id)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4)
           ON CONFLICT (tenant_id) DO UPDATE SET fg_inventory_account_id=EXCLUDED.fg_inventory_account_id, raw_materials_account_id=EXCLUDED.raw_materials_account_id,
             labor_account_id=EXCLUDED.labor_account_id, overhead_account_id=EXCLUDED.overhead_account_id, updated_at=now()`,
          [dto.fgInventoryAccountId ?? null, dto.rawMaterialsAccountId ?? null, dto.laborAccountId ?? null, dto.overheadAccountId ?? null],
        );
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown finance account for this tenant');
        throw err;
      }
      return this.glConfigInTx(m);
    });
  }

  /** Read the production GL config inside an existing tenant transaction (used by the GL consumer). */
  async glConfigInTx(m: Mgr): Promise<ProductionGlAccounts> {
    const rows = (await m.query(
      `SELECT fg_inventory_account_id, raw_materials_account_id, labor_account_id, overhead_account_id
       FROM production_gl_config WHERE deleted_at IS NULL LIMIT 1`,
    )) as Row[];
    const r = rows[0] ?? {};
    return {
      fgInventoryAccountId: (r.fg_inventory_account_id as string) ?? null,
      rawMaterialsAccountId: (r.raw_materials_account_id as string) ?? null,
      laborAccountId: (r.labor_account_id as string) ?? null,
      overheadAccountId: (r.overhead_account_id as string) ?? null,
    };
  }

  /** The order's completion date (for the voucher), read inside the consumer's tenant transaction. */
  async producedAtInTx(m: Mgr, orderId: string): Promise<string | null> {
    const rows = (await m.query(`SELECT COALESCE(actual_end::date, current_date) AS d FROM production_order WHERE id=$1 AND deleted_at IS NULL`, [orderId])) as Row[];
    const d = rows[0]?.d;
    if (!d) return null;
    return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  }

  // ── Internals ───────────────────────────────────────────────────────────────
  private async consume(m: Mgr, order: Row, mat: Row, qty: number) {
    const res = await this.inventoryDocs.applyStockMovement(m, {
      productId: mat.component_product_id as string,
      warehouseId: (order.warehouse_id as string) ?? null,
      docType: 'PROD_ISSUE',
      docId: order.id as string,
      docNo: order.order_no as string,
      qtyOut: qty,
      narration: `Issue to ${String(order.order_no)}`,
    });
    const issued = Number(mat.issued_qty) + qty;
    await m.query(
      `UPDATE production_order_material SET issued_qty=$2, unit_cost_minor=$3, cost_minor=$4, updated_at=now() WHERE id=$1`,
      [mat.id, issued, res.unitCostMinor, Number(mat.required_qty) * res.unitCostMinor],
    );
    mat.issued_qty = issued; // keep the in-memory row current for callers iterating
  }

  /** Recompute material/operation/overhead/total/unit cost from the order's child rows. */
  private async recomputeOrderCost(m: Mgr, id: string, qtyForUnit: number) {
    const matRow = (await m.query(`SELECT COALESCE(SUM(cost_minor),0) AS v FROM production_order_material WHERE order_id=$1 AND deleted_at IS NULL`, [id])) as Row[];
    const opRow = (await m.query(`SELECT COALESCE(SUM(cost_minor),0) AS v FROM production_order_operation WHERE order_id=$1 AND deleted_at IS NULL`, [id])) as Row[];
    const pct = (await m.query(`SELECT overhead_pct FROM production_order WHERE id=$1`, [id])) as Row[];
    const cost = rollUpCost(Number(matRow[0]!.v), Number(opRow[0]!.v), Number(pct[0]!.overhead_pct), qtyForUnit);
    await m.query(
      `UPDATE production_order SET material_cost_minor=$2, operation_cost_minor=$3, overhead_minor=$4, total_cost_minor=$5, unit_cost_minor=$6, updated_at=now() WHERE id=$1`,
      [id, cost.materialMinor, cost.operationMinor, cost.overheadMinor, cost.totalMinor, cost.unitMinor],
    );
    return cost;
  }

  private async setAttributeValues(m: Mgr, orderId: string, values: AttributeValueDto[]) {
    for (const v of values) {
      await m.query(
        `INSERT INTO production_attribute_value (tenant_id, attribute_id, order_id, value)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3)
         ON CONFLICT (tenant_id, attribute_id, order_id) DO UPDATE SET value = EXCLUDED.value, updated_at=now()`,
        [v.attributeId, orderId, v.value ?? null],
      );
    }
  }

  private async replaceBomLines(m: Mgr, bomId: string, lines: BomLineDto[]) {
    await m.query(`DELETE FROM production_bom_line WHERE bom_id=$1`, [bomId]);
    for (const l of lines) {
      try {
        await m.query(
          `INSERT INTO production_bom_line (tenant_id, bom_id, component_product_id, quantity, scrap_pct, notes)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3, COALESCE($4,0), $5)`,
          [bomId, l.componentProductId, l.quantity, l.scrapPct ?? null, l.notes ?? null],
        );
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown component product for this tenant');
        throw err;
      }
    }
  }

  private async replaceBomOperations(m: Mgr, bomId: string, operations: BomOperationDto[]) {
    await m.query(`DELETE FROM production_bom_operation WHERE bom_id=$1`, [bomId]);
    let seq = 1;
    for (const o of operations) {
      await m.query(
        `INSERT INTO production_bom_operation (tenant_id, bom_id, work_center_id, sequence, name, run_minutes, notes)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4, COALESCE($5,0), $6)`,
        [bomId, o.workCenterId ?? null, o.sequence ?? seq++, o.name, o.runMinutes ?? null, o.notes ?? null],
      );
    }
  }

  private async lockOrder(m: Mgr, id: string): Promise<Row> {
    const rows = (await m.query(`SELECT ${ORDER_COLS} FROM production_order WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Order not found');
    return rows[0];
  }

  private async getWorkCenterWith(m: Mgr, id: string) {
    const rows = (await m.query(`SELECT ${WC_COLS} FROM production_work_center WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Work center not found');
    return mapWorkCenter(rows[0]);
  }

  private async getBomWith(m: Mgr, id: string) {
    const rows = (await m.query(`SELECT ${BOM_COLS} FROM production_bom WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('BOM not found');
    const lines = (await m.query(
      `SELECT l.id, l.component_product_id, l.quantity, l.scrap_pct, l.notes, p.name AS component_name, p.cost_price_minor AS component_cost_minor, p.currency
       FROM production_bom_line l JOIN inventory_product p ON p.id = l.component_product_id
       WHERE l.bom_id=$1 AND l.deleted_at IS NULL ORDER BY l.created_at`, [id],
    )) as Row[];
    const operations = (await m.query(
      `SELECT o.id, o.work_center_id, o.sequence, o.name, o.run_minutes, o.notes, w.name AS work_center_name
       FROM production_bom_operation o LEFT JOIN production_work_center w ON w.id = o.work_center_id
       WHERE o.bom_id=$1 AND o.deleted_at IS NULL ORDER BY o.sequence`, [id],
    )) as Row[];
    return {
      ...mapBom(rows[0]),
      lines: lines.map((l) => mapBomLine(l, l.currency)),
      operations: operations.map(mapBomOperation),
    };
  }

  private async getOrderWith(m: Mgr, id: string) {
    const rows = (await m.query(
      `SELECT o.${ORDER_COLS.split(', ').join(', o.')}, p.name AS product_name
       FROM production_order o JOIN inventory_product p ON p.id = o.product_id WHERE o.id=$1 AND o.deleted_at IS NULL`, [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Order not found');
    const currency = rows[0].currency;
    const materials = (await m.query(
      `SELECT mt.id, mt.component_product_id, mt.required_qty, mt.issued_qty, mt.unit_cost_minor, mt.cost_minor, p.name AS component_name, p.on_hand
       FROM production_order_material mt JOIN inventory_product p ON p.id = mt.component_product_id
       WHERE mt.order_id=$1 AND mt.deleted_at IS NULL ORDER BY mt.created_at`, [id],
    )) as Row[];
    const operations = (await m.query(
      `SELECT o.id, o.work_center_id, o.sequence, o.name, o.planned_minutes, o.actual_minutes, o.cost_minor, o.status, w.name AS work_center_name
       FROM production_order_operation o LEFT JOIN production_work_center w ON w.id = o.work_center_id
       WHERE o.order_id=$1 AND o.deleted_at IS NULL ORDER BY o.sequence`, [id],
    )) as Row[];
    const attributes = (await m.query(
      `SELECT a.id AS attribute_id, a.attr_key, a.label, a.data_type, a.options, a.required, v.value
       FROM production_attribute a
       LEFT JOIN production_attribute_value v ON v.attribute_id = a.id AND v.order_id = $1 AND v.deleted_at IS NULL
       WHERE a.deleted_at IS NULL ORDER BY a.sort, a.label`, [id],
    )) as Row[];
    return {
      ...mapOrder(rows[0]),
      materials: materials.map((mt) => mapOrderMaterial(mt, currency)),
      operations: operations.map((o) => mapOrderOperation(o, currency)),
      attributes: attributes.map((a) => ({
        attributeId: a.attribute_id as string,
        attrKey: a.attr_key as string,
        label: a.label as string,
        dataType: a.data_type as string,
        options: (a.options as string) ?? null,
        required: Boolean(a.required),
        value: (a.value as string) ?? null,
      })),
    };
  }
}

/** TypeORM returns [rows, affectedCount] for UPDATE…RETURNING; normalize to the rows array. */
function rowsOf(res: unknown): unknown[] {
  if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number') return res[0];
  return (res ?? []) as unknown[];
}
const isFk = (e: unknown) => (e as { code?: string })?.code === '23503';
const isUnique = (e: unknown) => (e as { code?: string })?.code === '23505';
