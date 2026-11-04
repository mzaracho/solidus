import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  Param,
  Inject,
  HttpCode,
} from '@nestjs/common';
import { CreatePatientDto } from '@src/application/features/patients/dtos/create-patient.dto';
import { PatientResponseDto } from '@src/application/features/patients/dtos/patient-response.dto';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '@src/infrastructure.bootstrap/config/core/authentication/current-user-decorator';
import { BaseController } from '../../base/base-controller';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MergePatientRequestDto } from '@src/application/features/patients/dtos/merge-patient-request.dto';
import {
  ApiPaginatedOkResponse,
  PaginatedArrayDto,
} from '@src/domain/seed-work/paginated-array';
import { FindAllPatientsQuery } from '@src/application/features/patients/queries/find-all-patients-query';
import { GetDebtQuery } from '@src/application/features/patients/queries/get-debt-query';
import { GetPatientSummaryQuery } from '@src/application/features/patients/queries/get-patient-summary-query';
import { CreatePatientCommand } from '@src/application/features/patients/commands/create-patient-command';
import { UpdatePatientCommand } from '@src/application/features/patients/commands/update-patient-command';
import { MergePatientCommand } from '@src/application/features/patients/commands/merge-patient-command';
import { CurrentOrgId } from '@src/infrastructure.bootstrap/config/core/authentication/current-org-decorator';
import { UsesViewMode } from '@src/infrastructure.bootstrap/config/core/authentication/view-mode-decorator';
@ApiTags('Patients')
@Controller('v1/patients')
export class PatientsController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Get()
  @UsesViewMode()
  @ApiOperation({ summary: 'Find all patients' })
  @ApiPaginatedOkResponse({
    description: 'List of patients',
    type: PatientResponseDto,
  })
  async findAll(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Query() query: FindAllPatientsQuery,
  ): Promise<PaginatedArrayDto<PatientResponseDto>> {
    query.organizationId = orgId;
    query.userId = userId;
    return await this.dispatcher.dispatch(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new patient' })
  @ApiResponse({
    status: 201,
    description: 'Patient created successfully',
    type: CreatePatientDto,
  })
  async create(
    @CurrentOrgId() orgId: string,
    @Body() body: CreatePatientCommand,
  ): Promise<CreatePatientDto> {
    body.organizationId = orgId;
    return await this.dispatcher.dispatch(body);
  }

  @Get(':id/debt')
  @ApiOperation({ summary: 'Get patient debt total' })
  @ApiResponse({ status: 200, description: 'Patient debt total' })
  async getDebt(@Param('id') id: string) {
    return await this.dispatcher.dispatch(new GetDebtQuery(id));
  }

  @Get(':id/summary')
  @ApiOperation({ summary: 'Get patient pending items summary' })
  @ApiResponse({ status: 200, description: 'Patient debt summary with pending work items' })
  async getSummary(@Param('id') id: string) {
    return await this.dispatcher.dispatch(new GetPatientSummaryQuery(id));
  }

  @Post(':id/merge')
  @HttpCode(200)
  @ApiOperation({ summary: 'Merge source patient into target (source is deleted, its work items reassigned)' })
  @ApiResponse({ status: 200, description: 'Patient merged successfully' })
  async merge(
    @Param('id') sourceId: string,
    @Body() body: MergePatientRequestDto,
  ): Promise<void> {
    const command = new MergePatientCommand();
    command.sourceId = sourceId;
    command.targetId = body.targetId;
    return await this.dispatcher.dispatch(command);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update patient' })
  @ApiResponse({
    status: 200,
    description: 'Patient updated',
    type: PatientResponseDto,
  })
  async update(
    @Param('id') id: string,
    @Body() body: UpdatePatientCommand,
  ): Promise<PatientResponseDto> {
    body.id = id;
    return await this.dispatcher.dispatch(body);
  }
}
