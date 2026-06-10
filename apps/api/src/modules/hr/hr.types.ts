import type { Money } from '@metaxperts/shared';

export type EmployeeStatus = 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';

export interface EmployeeView {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  departmentId: string | null;
  positionId: string | null;
  joinDate: string | null;
  salary: Money | null;
  status: EmployeeStatus;
}

export interface DepartmentView {
  id: string;
  name: string;
  managerId: string | null;
  parentDepartmentId: string | null;
}

export interface PositionView {
  id: string;
  title: string;
  description: string | null;
}

/** Raw DB row shape for an employee (snake_case columns). */
export interface EmployeeRow {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  department_id: string | null;
  position_id: string | null;
  join_date: string | null;
  salary_amount_minor: string | number | null; // bigint comes back as string from pg
  salary_currency: string;
  status: EmployeeStatus;
}
