import { ActivityResponseDto } from './activity-response.dto';

export class PaginatedActivityResponseDto {
    items: ActivityResponseDto[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}
