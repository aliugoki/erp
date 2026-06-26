import { IsDefined } from 'class-validator';

export class SetPolicyDto {
  /** The policy value (boolean | number | string) — validated/coerced against the registry server-side. */
  @IsDefined()
  value!: unknown;
}
