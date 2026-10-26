import { Controller, Get, Query, Inject } from '@nestjs/common';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import {
  GetDailyReportQuery,
  GetDebtorsReportQuery,
  GetMonthlyReportQuery,
} from '@src/application/features/activity/queries/reporting-queries';
import { BaseController } from '../../base/base-controller';

@Controller('work-items/reporting')
export class ReportingController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  // A) Atenciones de todos los dias
  @Get('daily')
  async getDailyReport(@Query() query: GetDailyReportQuery) {
    return this.dispatcher.dispatch(query);
  }

  // B) Pacientes deudores
  @Get('debtors')
  async getDebtorsReport(@Query() query: GetDebtorsReportQuery) {
    return this.dispatcher.dispatch(query);
  }

  // C) Resumen Mensual
  @Get('monthly')
  async getMonthlyReport(@Query() query: GetMonthlyReportQuery) {
    return this.dispatcher.dispatch(query);
  }
}
