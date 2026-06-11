export interface Money {
  amountMinor: number;
  currency: string;
}

export interface Employee {
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
  status: 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
}

export interface Invoice {
  id: string;
  number: string;
  clientId: string | null;
  subtotal: Money;
  tax: Money;
  total: Money;
  status: 'DRAFT' | 'SENT' | 'PAID' | 'VOID';
  dueDate: string | null;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  costPrice: Money;
  sellPrice: Money;
  minStock: number;
  onHand: number;
}
