import type { VoucherType } from '@/lib/types';

/** Voucher types in the order the business uses them, with their full labels. */
export const VOUCHER_TYPES: { value: VoucherType; label: string }[] = [
  { value: 'BRV', label: 'Bank Receipt Voucher' },
  { value: 'BPV', label: 'Bank Payment Voucher' },
  { value: 'CPV', label: 'Cash Payment Voucher' },
  { value: 'CRV', label: 'Cash Receipt Voucher' },
  { value: 'JV', label: 'Journal Voucher' },
];

export const voucherLabel = (t: VoucherType): string =>
  VOUCHER_TYPES.find((v) => v.value === t)?.label ?? t;
