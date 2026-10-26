import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  Param,
  UseGuards,
  Inject,
  Headers,
  HttpCode,
} from '@nestjs/common';
import { CreatePatientDto } from '@src/application/features/patients/dtos/create-patient.dto';
import { PatientResponseDto } from '@src/application/features/patients/dtos/patient-response.dto';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@src/infrastructure.bootstrap/config/providers/auth-guard-provider';
import { BaseController } from '../../base/base-controller';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
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
import { Public } from '@src/infrastructure.bootstrap/config/core/authentication/public-decorator';
@ApiTags('Patients')
@UseGuards(AuthGuard)
@Controller('v1/patients')
export class PatientsController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Get()
  @ApiOperation({ summary: 'Find all patients' })
  @ApiPaginatedOkResponse({
    description: 'List of patients',
    type: PatientResponseDto,
  })
  async findAll(
    @Headers('x-org-id') orgId: string,
    @Headers('x-user-id') userId: string,
    @Query('mode') modeQuery: string,
    @Query() query: FindAllPatientsQuery,
  ): Promise<PaginatedArrayDto<PatientResponseDto>> {
    query.organizationId = orgId;
    query.userId = userId;
    query.mode = modeQuery;
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
    @Headers('x-org-id') orgId: string,
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
    @Body() body: { targetId: string },
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
