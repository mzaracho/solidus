import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
    private readonly logger = new Logger(LoggingInterceptor.name);

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const req = context.switchToHttp().getRequest();
        const method = req.method;
        const url = req.url;
        const body = req.body;
        const query = req.query;
        const params = req.params;
        const headers = req.headers;

        this.logger.log(`Incoming Request: ${method} ${url}`);
        this.logger.debug(`Headers: ${JSON.stringify(headers)}`);
        this.logger.debug(`Body: ${JSON.stringify(body)}`);
        this.logger.debug(`Query: ${JSON.stringify(query)}`);
        this.logger.debug(`Params: ${JSON.stringify(params)}`);

        const now = Date.now();
        return next.handle().pipe(
            tap((data) => {
                this.logger.log(`Response Time: ${Date.now() - now}ms`);
                this.logger.debug(`Response Data: ${JSON.stringify(data)}`);
            }),
        );
    }
}
