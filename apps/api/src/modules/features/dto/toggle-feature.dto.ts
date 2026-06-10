import { IsBoolean } from 'class-validator';

export class ToggleFeatureDto {
  @IsBoolean()
  enabled!: boolean;
}
