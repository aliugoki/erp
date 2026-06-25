import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class SetRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  roles!: string[];
}
