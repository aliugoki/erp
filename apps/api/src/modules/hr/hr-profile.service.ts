import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { returningRows } from './hr.util';
import type {
  CreateEducationDto,
  CreateExperienceDto,
  UpdateEmployeeProfileDto,
} from './dto/hr.dto';

type Row = Record<string, unknown>;

const PROFILE_COLS =
  'id, employee_code, first_name, last_name, email, phone, department_id, position_id, join_date, ' +
  'salary_amount_minor, salary_currency, status, date_of_birth, gender, marital_status, national_id, ' +
  'blood_group, nationality, address, city, country, emergency_contact_name, emergency_contact_phone, ' +
  'designation, employment_type, reporting_to, confirmation_date, work_location, photo_ref';

/** Maps the profile UpdateEmployeeProfileDto camelCase keys to their snake_case columns. */
const PROFILE_FIELD_MAP: Record<string, string> = {
  dateOfBirth: 'date_of_birth', gender: 'gender', maritalStatus: 'marital_status', nationalId: 'national_id',
  bloodGroup: 'blood_group', nationality: 'nationality', address: 'address', city: 'city', country: 'country',
  emergencyContactName: 'emergency_contact_name', emergencyContactPhone: 'emergency_contact_phone',
  designation: 'designation', employmentType: 'employment_type', reportingTo: 'reporting_to',
  confirmationDate: 'confirmation_date', workLocation: 'work_location',
};

/** The complete employee record: personal + contact + job profile plus academic history and prior
 * work experience. The lean list/CRUD stays in {@link HrService}; this serves the full profile view. */
@Injectable()
export class HrProfileService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  async getProfile(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${PROFILE_COLS} FROM hr_employee WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Employee not found');
      const education = (await m.query(
        `SELECT id, degree, institution, field_of_study, start_year, end_year, grade
         FROM hr_employee_education WHERE employee_id=$1 AND deleted_at IS NULL ORDER BY end_year DESC NULLS LAST, start_year DESC`,
        [id],
      )) as Row[];
      const experience = (await m.query(
        `SELECT id, company, title, start_date, end_date, description
         FROM hr_employee_experience WHERE employee_id=$1 AND deleted_at IS NULL ORDER BY start_date DESC NULLS LAST`,
        [id],
      )) as Row[];
      return {
        ...mapProfile(rows[0]),
        education: education.map(mapEducation),
        experience: experience.map(mapExperience),
      };
    });
  }

  async updateProfile(id: string, dto: UpdateEmployeeProfileDto) {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, col] of Object.entries(PROFILE_FIELD_MAP)) {
      const val = (dto as Record<string, unknown>)[key];
      if (val !== undefined) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.getProfile(id);
    sets.push('updated_at = now()');
    params.push(id);
    return this.tenantTx.run(async (m) => {
      try {
        const rows = returningRows<Row>(
          await m.query(
            `UPDATE hr_employee SET ${sets.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING id`,
            params,
          ),
        );
        if (!rows[0]) throw new NotFoundException('Employee not found');
      } catch (err) {
        if ((err as { code?: string })?.code === '23503') throw new BadRequestException('Unknown reporting manager for this tenant');
        throw err;
      }
      return this.getProfile(id);
    });
  }

  // ── Education ───────────────────────────────────────────────────────────────
  async addEducation(employeeId: string, dto: CreateEducationDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO hr_employee_education (tenant_id, employee_id, degree, institution, field_of_study, start_year, end_year, grade)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7)
           RETURNING id, degree, institution, field_of_study, start_year, end_year, grade`,
          [employeeId, dto.degree, dto.institution ?? null, dto.fieldOfStudy ?? null, dto.startYear ?? null, dto.endYear ?? null, dto.grade ?? null],
        )) as Row[];
        return mapEducation(rows[0]!);
      } catch (err) {
        if ((err as { code?: string })?.code === '23503') throw new BadRequestException('Unknown employee for this tenant');
        throw err;
      }
    });
  }

  async deleteEducation(id: string) {
    await this.softDelete('hr_employee_education', id);
  }

  // ── Experience ──────────────────────────────────────────────────────────────
  async addExperience(employeeId: string, dto: CreateExperienceDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO hr_employee_experience (tenant_id, employee_id, company, title, start_date, end_date, description)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6)
           RETURNING id, company, title, start_date, end_date, description`,
          [employeeId, dto.company, dto.title ?? null, dto.startDate ?? null, dto.endDate ?? null, dto.description ?? null],
        )) as Row[];
        return mapExperience(rows[0]!);
      } catch (err) {
        if ((err as { code?: string })?.code === '23503') throw new BadRequestException('Unknown employee for this tenant');
        throw err;
      }
    });
  }

  async deleteExperience(id: string) {
    await this.softDelete('hr_employee_experience', id);
  }

  private async softDelete(table: string, id: string) {
    await this.tenantTx.run(async (m) => {
      const rows = returningRows(
        await m.query(`UPDATE ${table} SET deleted_at = now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id]),
      );
      if (rows.length === 0) throw new NotFoundException('Not found');
    });
  }
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const dateStr = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : str(v));

function mapProfile(r: Row) {
  return {
    id: r.id as string,
    employeeCode: r.employee_code as string,
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    email: str(r.email),
    phone: str(r.phone),
    departmentId: str(r.department_id),
    positionId: str(r.position_id),
    joinDate: dateStr(r.join_date),
    salary: r.salary_amount_minor === null || r.salary_amount_minor === undefined
      ? null
      : { amountMinor: Number(r.salary_amount_minor), currency: r.salary_currency as string },
    status: r.status as string,
    dateOfBirth: dateStr(r.date_of_birth),
    gender: str(r.gender),
    maritalStatus: str(r.marital_status),
    nationalId: str(r.national_id),
    bloodGroup: str(r.blood_group),
    nationality: str(r.nationality),
    address: str(r.address),
    city: str(r.city),
    country: str(r.country),
    emergencyContactName: str(r.emergency_contact_name),
    emergencyContactPhone: str(r.emergency_contact_phone),
    designation: str(r.designation),
    employmentType: str(r.employment_type),
    reportingTo: str(r.reporting_to),
    confirmationDate: dateStr(r.confirmation_date),
    workLocation: str(r.work_location),
  };
}
function mapEducation(r: Row) {
  return {
    id: r.id as string, degree: r.degree as string, institution: str(r.institution),
    fieldOfStudy: str(r.field_of_study), startYear: numOrNull(r.start_year), endYear: numOrNull(r.end_year),
    grade: str(r.grade),
  };
}
function mapExperience(r: Row) {
  return {
    id: r.id as string, company: r.company as string, title: str(r.title),
    startDate: dateStr(r.start_date), endDate: dateStr(r.end_date), description: str(r.description),
  };
}
