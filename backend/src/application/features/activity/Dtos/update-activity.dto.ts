import { PartialType } from '@nestjs/mapped-types'; // Assuming mapped-types available or just manual partial
import { CreateActivityDto } from './create-activity.dto';

// If @nestjs/mapped-types is not installed (check package.json), I'll do manual Partial.
// backend package.json has @nestjs/common etc. but not mapped-types explicitly?
// Standard Nest apps usually have it. I'll check or just use Partial manually.

export class UpdateActivityDto {
  date?: string;
  paymentStatus?: 'PAID' | 'PARTIAL' | 'UNPAID';
  paymentMethod?: string;
  paymentDate?: string;
}
