export class CreatePresetDto {
  name: string;
  baseValue: number;
  cardValue?: number;
  linkedType?: string;
}
