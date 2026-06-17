import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type {
  AddMemberDto,
  CreateExpenseDto,
  CreateProjectDto,
  CreateTaskDto,
  LogTimeDto,
  UpdateProjectDto,
  UpdateTaskDto,
} from './dto/projects.dto';
import {
  budgetRemaining,
  entryBill,
  entryCost,
  mapExpense,
  mapMember,
  mapProject,
  mapTask,
  mapTimeEntry,
  nextProjectDocNo,
} from './projects.util';

type Row = Record<string, unknown>;
type Mgr = EntityManager;

const PROJ_COLS =
  'id, project_no, name, code, client_id, manager_employee_id, status, billing_type, start_date, end_date, budget_minor, currency, description';
const TASK_COLS = 'id, project_id, name, assignee_employee_id, status, priority, estimate_minutes, due_date, sort, description';
const TIME_COLS = 'id, project_id, task_id, employee_id, entry_date, minutes, billable, status, cost_minor, bill_minor, description';

/**
 * Project Management & Timesheets. Projects carry members (hourly cost/bill rates), tasks, time
 * entries (logged in minutes; costed + billed from the member's rate at approval) and expenses;
 * costing rolls labour + expenses against the budget. Raw SQL via the tenant-scoped tx (RLS); money is
 * integer minor units.
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  // ── Projects ────────────────────────────────────────────────────────────────
  async createProject(dto: CreateProjectDto) {
    return this.tenantTx.run(async (m) => {
      const projectNo = await nextProjectDocNo(m, 'PRJ', 'PRJ');
      try {
        const rows = (await m.query(
          `INSERT INTO project (tenant_id, project_no, name, code, client_id, manager_employee_id, billing_type, start_date, end_date, budget_minor, currency, description)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5, COALESCE($6,'TIME_MATERIALS'),$7,$8, COALESCE($9,0), COALESCE($10,'PKR'),$11) RETURNING id`,
          [projectNo, dto.name, dto.code ?? null, dto.clientId ?? null, dto.managerEmployeeId ?? null, dto.billingType ?? null,
            dto.startDate ?? null, dto.endDate ?? null, dto.budgetMinor ?? null, dto.currency ?? null, dto.description ?? null],
        )) as Row[];
        return this.getProjectWith(m, rows[0]!.id as string);
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown client or manager for this tenant');
        throw err;
      }
    });
  }

  async listProjects(status?: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT p.${PROJ_COLS.split(', ').join(', p.')}, c.company_name AS client_name,
           (e.first_name || ' ' || e.last_name) AS manager_name
         FROM project p
         LEFT JOIN crm_client c ON c.id = p.client_id
         LEFT JOIN hr_employee e ON e.id = p.manager_employee_id
         WHERE p.deleted_at IS NULL ${status ? 'AND p.status = $1' : ''} ORDER BY p.created_at DESC`,
        status ? [status] : [],
      )) as Row[];
      return rows.map(mapProject);
    });
  }

  async getProject(id: string) {
    return this.tenantTx.run((m) => this.getProjectWith(m, id));
  }

  async updateProject(id: string, dto: UpdateProjectDto) {
    return this.tenantTx.run(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (c: string, v: unknown) => { sets.push(`${c}=$${params.length + 1}`); params.push(v); };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.code !== undefined) set('code', dto.code);
      if (dto.clientId !== undefined) set('client_id', dto.clientId);
      if (dto.managerEmployeeId !== undefined) set('manager_employee_id', dto.managerEmployeeId);
      if (dto.billingType !== undefined) set('billing_type', dto.billingType);
      if (dto.startDate !== undefined) set('start_date', dto.startDate);
      if (dto.endDate !== undefined) set('end_date', dto.endDate);
      if (dto.budgetMinor !== undefined) set('budget_minor', dto.budgetMinor);
      if (dto.description !== undefined) set('description', dto.description);
      if (sets.length) {
        const rows = rowsOf(await m.query(`UPDATE project SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, params)) as Row[];
        if (!rows[0]) throw new NotFoundException('Project not found');
      }
      return this.getProjectWith(m, id);
    });
  }

  async setStatus(id: string, status: string) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(`UPDATE project SET status=$2, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id, status])) as Row[];
      if (!rows[0]) throw new NotFoundException('Project not found');
      return this.getProjectWith(m, id);
    });
  }

  async deleteProject(id: string) {
    await this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(`UPDATE project SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id])) as Row[];
      if (!rows[0]) throw new NotFoundException('Project not found');
    });
  }

  // ── Members ─────────────────────────────────────────────────────────────────
  async addMember(projectId: string, dto: AddMemberDto) {
    return this.tenantTx.run(async (m) => {
      await this.assertProject(m, projectId);
      try {
        await m.query(
          `INSERT INTO project_member (tenant_id, project_id, employee_id, role, cost_rate_minor, bill_rate_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3, COALESCE($4,0), COALESCE($5,0))
           ON CONFLICT (tenant_id, project_id, employee_id) WHERE deleted_at IS NULL
           DO UPDATE SET role=EXCLUDED.role, cost_rate_minor=EXCLUDED.cost_rate_minor, bill_rate_minor=EXCLUDED.bill_rate_minor, updated_at=now()`,
          [projectId, dto.employeeId, dto.role ?? null, dto.costRateMinor ?? null, dto.billRateMinor ?? null],
        );
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown employee for this tenant');
        throw err;
      }
      return this.listMembers(projectId);
    });
  }

  async listMembers(projectId: string) {
    return this.tenantTx.run(async (m) => {
      const proj = (await m.query(`SELECT currency FROM project WHERE id=$1 AND deleted_at IS NULL`, [projectId])) as Row[];
      const currency = proj[0]?.currency ?? 'PKR';
      const rows = (await m.query(
        `SELECT mb.id, mb.employee_id, mb.role, mb.cost_rate_minor, mb.bill_rate_minor, (e.first_name || ' ' || e.last_name) AS employee_name
         FROM project_member mb JOIN hr_employee e ON e.id = mb.employee_id
         WHERE mb.project_id=$1 AND mb.deleted_at IS NULL ORDER BY mb.created_at`,
        [projectId],
      )) as Row[];
      return rows.map((r) => mapMember(r, currency));
    });
  }

  async removeMember(projectId: string, memberId: string) {
    await this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(`UPDATE project_member SET deleted_at=now() WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL RETURNING id`, [memberId, projectId])) as Row[];
      if (!rows[0]) throw new NotFoundException('Member not found');
    });
  }

  // ── Tasks ───────────────────────────────────────────────────────────────────
  async createTask(projectId: string, dto: CreateTaskDto) {
    return this.tenantTx.run(async (m) => {
      await this.assertProject(m, projectId);
      try {
        const rows = (await m.query(
          `INSERT INTO project_task (tenant_id, project_id, name, assignee_employee_id, priority, estimate_minutes, due_date, description)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3, COALESCE($4,'NORMAL'), COALESCE($5,0), $6, $7) RETURNING ${TASK_COLS}`,
          [projectId, dto.name, dto.assigneeEmployeeId ?? null, dto.priority ?? null, dto.estimateMinutes ?? null, dto.dueDate ?? null, dto.description ?? null],
        )) as Row[];
        return mapTask(rows[0]!);
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown assignee for this tenant');
        throw err;
      }
    });
  }

  async listTasks(projectId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT t.${TASK_COLS.split(', ').join(', t.')}, (e.first_name || ' ' || e.last_name) AS assignee_name
         FROM project_task t LEFT JOIN hr_employee e ON e.id = t.assignee_employee_id
         WHERE t.project_id=$1 AND t.deleted_at IS NULL ORDER BY t.sort, t.created_at`,
        [projectId],
      )) as Row[];
      return rows.map(mapTask);
    });
  }

  async updateTask(projectId: string, taskId: string, dto: UpdateTaskDto) {
    return this.tenantTx.run(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [taskId, projectId];
      const set = (c: string, v: unknown) => { sets.push(`${c}=$${params.length + 1}`); params.push(v); };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.assigneeEmployeeId !== undefined) set('assignee_employee_id', dto.assigneeEmployeeId);
      if (dto.status !== undefined) set('status', dto.status);
      if (dto.priority !== undefined) set('priority', dto.priority);
      if (dto.estimateMinutes !== undefined) set('estimate_minutes', dto.estimateMinutes);
      if (dto.dueDate !== undefined) set('due_date', dto.dueDate);
      if (dto.sort !== undefined) set('sort', dto.sort);
      if (dto.description !== undefined) set('description', dto.description);
      if (!sets.length) return this.getTask(m, taskId, projectId);
      const rows = rowsOf(await m.query(`UPDATE project_task SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL RETURNING ${TASK_COLS}`, params)) as Row[];
      if (!rows[0]) throw new NotFoundException('Task not found');
      return mapTask(rows[0]);
    });
  }

  async deleteTask(projectId: string, taskId: string) {
    await this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(`UPDATE project_task SET deleted_at=now() WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL RETURNING id`, [taskId, projectId])) as Row[];
      if (!rows[0]) throw new NotFoundException('Task not found');
    });
  }

  // ── Time entries ────────────────────────────────────────────────────────────
  async logTime(projectId: string, dto: LogTimeDto) {
    return this.tenantTx.run(async (m) => {
      await this.assertProject(m, projectId);
      try {
        const rows = (await m.query(
          `INSERT INTO project_time_entry (tenant_id, project_id, task_id, employee_id, entry_date, minutes, billable, description)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3, COALESCE($4::date, current_date), $5, COALESCE($6,true), $7) RETURNING ${TIME_COLS}`,
          [projectId, dto.taskId ?? null, dto.employeeId, dto.entryDate ?? null, dto.minutes, dto.billable ?? null, dto.description ?? null],
        )) as Row[];
        return mapTimeEntry(rows[0]!, await this.currencyOf(m, projectId));
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown employee or task for this tenant');
        throw err;
      }
    });
  }

  async listTime(projectId: string) {
    return this.tenantTx.run(async (m) => {
      const currency = await this.currencyOf(m, projectId);
      const rows = (await m.query(
        `SELECT te.${TIME_COLS.split(', ').join(', te.')}, (e.first_name || ' ' || e.last_name) AS employee_name
         FROM project_time_entry te JOIN hr_employee e ON e.id = te.employee_id
         WHERE te.project_id=$1 AND te.deleted_at IS NULL ORDER BY te.entry_date DESC, te.created_at DESC`,
        [projectId],
      )) as Row[];
      return rows.map((r) => mapTimeEntry(r, currency));
    });
  }

  /** Move a time entry through its workflow. APPROVED costs + bills it from the member's rates. */
  async setTimeStatus(projectId: string, entryId: string, status: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT employee_id, minutes, billable FROM project_time_entry WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL FOR UPDATE`, [entryId, projectId])) as Row[];
      const t = rows[0];
      if (!t) throw new NotFoundException('Time entry not found');
      let cost = 0;
      let bill = 0;
      if (status === 'APPROVED') {
        const mem = (await m.query(`SELECT cost_rate_minor, bill_rate_minor FROM project_member WHERE project_id=$1 AND employee_id=$2 AND deleted_at IS NULL`, [projectId, t.employee_id])) as Row[];
        const costRate = Number(mem[0]?.cost_rate_minor ?? 0);
        const billRate = Number(mem[0]?.bill_rate_minor ?? 0);
        cost = entryCost(Number(t.minutes), costRate);
        bill = entryBill(Number(t.minutes), billRate, Boolean(t.billable));
      }
      await m.query(`UPDATE project_time_entry SET status=$3, cost_minor=$4, bill_minor=$5, updated_at=now() WHERE id=$1 AND project_id=$2`, [entryId, projectId, status, cost, bill]);
      const out = (await m.query(`SELECT ${TIME_COLS} FROM project_time_entry WHERE id=$1`, [entryId])) as Row[];
      return mapTimeEntry(out[0]!, await this.currencyOf(m, projectId));
    });
  }

  async deleteTime(projectId: string, entryId: string) {
    await this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(`UPDATE project_time_entry SET deleted_at=now() WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL RETURNING id`, [entryId, projectId])) as Row[];
      if (!rows[0]) throw new NotFoundException('Time entry not found');
    });
  }

  // ── Expenses ──────────────────────────────────────────────────────────────────
  async addExpense(projectId: string, dto: CreateExpenseDto) {
    return this.tenantTx.run(async (m) => {
      await this.assertProject(m, projectId);
      const rows = (await m.query(
        `INSERT INTO project_expense (tenant_id, project_id, expense_date, category, amount_minor, billable, employee_id, description)
         VALUES (current_setting('app.tenant_id')::uuid, $1, COALESCE($2::date, current_date), $3, $4, COALESCE($5,true), $6, $7)
         RETURNING id, project_id, expense_date, category, amount_minor, billable, employee_id, description`,
        [projectId, dto.expenseDate ?? null, dto.category ?? null, dto.amountMinor, dto.billable ?? null, dto.employeeId ?? null, dto.description ?? null],
      )) as Row[];
      return mapExpense(rows[0]!, await this.currencyOf(m, projectId));
    });
  }

  async listExpenses(projectId: string) {
    return this.tenantTx.run(async (m) => {
      const currency = await this.currencyOf(m, projectId);
      const rows = (await m.query(
        `SELECT id, project_id, expense_date, category, amount_minor, billable, employee_id, description
         FROM project_expense WHERE project_id=$1 AND deleted_at IS NULL ORDER BY expense_date DESC`,
        [projectId],
      )) as Row[];
      return rows.map((r) => mapExpense(r, currency));
    });
  }

  async deleteExpense(projectId: string, expenseId: string) {
    await this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(`UPDATE project_expense SET deleted_at=now() WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL RETURNING id`, [expenseId, projectId])) as Row[];
      if (!rows[0]) throw new NotFoundException('Expense not found');
    });
  }

  // ── Reports ───────────────────────────────────────────────────────────────────
  /** Portfolio: every project with budget vs actual cost + billable + variance. */
  async portfolio() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT p.id, p.project_no, p.name, p.status, p.currency, p.budget_minor,
           COALESCE(t.cost,0) AS cost_minor, COALESCE(t.bill,0) AS bill_minor, COALESCE(x.exp,0) AS expense_minor, COALESCE(t.mins,0) AS minutes
         FROM project p
         LEFT JOIN (SELECT project_id, SUM(cost_minor) cost, SUM(bill_minor) bill, SUM(minutes) mins FROM project_time_entry WHERE status='APPROVED' AND deleted_at IS NULL GROUP BY project_id) t ON t.project_id = p.id
         LEFT JOIN (SELECT project_id, SUM(amount_minor) exp FROM project_expense WHERE deleted_at IS NULL GROUP BY project_id) x ON x.project_id = p.id
         WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC`,
      )) as Row[];
      return rows.map((r) => {
        const cost = Number(r.cost_minor) + Number(r.expense_minor);
        const budget = Number(r.budget_minor);
        const cur = (r.currency as string) ?? 'PKR';
        return {
          id: r.id as string,
          projectNo: r.project_no as string,
          name: r.name as string,
          status: r.status as string,
          budget: { amountMinor: budget, currency: cur },
          cost: { amountMinor: cost, currency: cur },
          billable: { amountMinor: Number(r.bill_minor), currency: cur },
          remaining: { amountMinor: budgetRemaining(budget, cost), currency: cur },
          hours: Math.round((Number(r.minutes) / 60) * 10) / 10,
        };
      });
    });
  }

  /** Timesheet summary by employee (approved minutes + cost + billable) over an optional range. */
  async timesheetSummary(from?: string, to?: string) {
    return this.tenantTx.run(async (m) => {
      const where = ['te.deleted_at IS NULL', "te.status='APPROVED'"];
      const params: unknown[] = [];
      if (from) where.push(`te.entry_date >= $${params.push(from)}`);
      if (to) where.push(`te.entry_date <= $${params.push(to)}`);
      const rows = (await m.query(
        `SELECT te.employee_id, (e.first_name || ' ' || e.last_name) AS employee_name, MIN(p.currency) AS currency,
           SUM(te.minutes) AS minutes, SUM(te.cost_minor) AS cost_minor, SUM(te.bill_minor) AS bill_minor
         FROM project_time_entry te JOIN hr_employee e ON e.id = te.employee_id JOIN project p ON p.id = te.project_id
         WHERE ${where.join(' AND ')} GROUP BY te.employee_id, e.first_name, e.last_name ORDER BY minutes DESC`,
        params,
      )) as Row[];
      return rows.map((r) => ({
        employeeId: r.employee_id as string,
        employeeName: (r.employee_name as string) ?? null,
        hours: Math.round((Number(r.minutes) / 60) * 10) / 10,
        cost: { amountMinor: Number(r.cost_minor), currency: (r.currency as string) ?? 'PKR' },
        billable: { amountMinor: Number(r.bill_minor), currency: (r.currency as string) ?? 'PKR' },
      }));
    });
  }

  // ── internals ───────────────────────────────────────────────────────────────
  private async assertProject(m: Mgr, id: string) {
    const rows = (await m.query(`SELECT 1 FROM project WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Project not found');
  }

  private async currencyOf(m: Mgr, projectId: string): Promise<string> {
    const rows = (await m.query(`SELECT currency FROM project WHERE id=$1`, [projectId])) as Row[];
    return (rows[0]?.currency as string) ?? 'PKR';
  }

  private async getTask(m: Mgr, taskId: string, projectId: string) {
    const rows = (await m.query(`SELECT ${TASK_COLS} FROM project_task WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL`, [taskId, projectId])) as Row[];
    if (!rows[0]) throw new NotFoundException('Task not found');
    return mapTask(rows[0]);
  }

  private async getProjectWith(m: Mgr, id: string) {
    const rows = (await m.query(
      `SELECT p.${PROJ_COLS.split(', ').join(', p.')}, c.company_name AS client_name, (e.first_name || ' ' || e.last_name) AS manager_name
       FROM project p LEFT JOIN crm_client c ON c.id = p.client_id LEFT JOIN hr_employee e ON e.id = p.manager_employee_id
       WHERE p.id=$1 AND p.deleted_at IS NULL`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Project not found');
    const currency = rows[0].currency;
    const members = (await m.query(
      `SELECT mb.id, mb.employee_id, mb.role, mb.cost_rate_minor, mb.bill_rate_minor, (e.first_name || ' ' || e.last_name) AS employee_name
       FROM project_member mb JOIN hr_employee e ON e.id = mb.employee_id WHERE mb.project_id=$1 AND mb.deleted_at IS NULL ORDER BY mb.created_at`,
      [id],
    )) as Row[];
    const tasks = (await m.query(
      `SELECT t.${TASK_COLS.split(', ').join(', t.')}, (e.first_name || ' ' || e.last_name) AS assignee_name
       FROM project_task t LEFT JOIN hr_employee e ON e.id = t.assignee_employee_id WHERE t.project_id=$1 AND t.deleted_at IS NULL ORDER BY t.sort, t.created_at`,
      [id],
    )) as Row[];
    const cost = (await m.query(
      `SELECT COALESCE(SUM(cost_minor),0) AS cost, COALESCE(SUM(bill_minor),0) AS bill, COALESCE(SUM(minutes),0) AS mins
       FROM project_time_entry WHERE project_id=$1 AND status='APPROVED' AND deleted_at IS NULL`,
      [id],
    )) as Row[];
    const exp = (await m.query(`SELECT COALESCE(SUM(amount_minor),0) AS exp FROM project_expense WHERE project_id=$1 AND deleted_at IS NULL`, [id])) as Row[];
    const laborCost = Number(cost[0]!.cost);
    const expense = Number(exp[0]!.exp);
    const totalCost = laborCost + expense;
    const budget = Number(rows[0].budget_minor);
    return {
      ...mapProject(rows[0]),
      members: members.map((r) => mapMember(r, currency)),
      tasks: tasks.map(mapTask),
      costing: {
        budget: { amountMinor: budget, currency: currency as string },
        laborCost: { amountMinor: laborCost, currency: currency as string },
        expenseCost: { amountMinor: expense, currency: currency as string },
        totalCost: { amountMinor: totalCost, currency: currency as string },
        billable: { amountMinor: Number(cost[0]!.bill), currency: currency as string },
        remaining: { amountMinor: budgetRemaining(budget, totalCost), currency: currency as string },
        hours: Math.round((Number(cost[0]!.mins) / 60) * 10) / 10,
      },
    };
  }
}

/** TypeORM returns [rows, affectedCount] for UPDATE…RETURNING; normalize to the rows array. */
function rowsOf(res: unknown): unknown[] {
  if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number') return res[0];
  return (res ?? []) as unknown[];
}
const isFk = (e: unknown) => (e as { code?: string })?.code === '23503';
