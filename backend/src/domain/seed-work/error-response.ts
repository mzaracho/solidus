import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MessageError {
  constructor(message: string) {
    this.message = message;
  }
  @ApiProperty()
  message: string;
}

export class ErrorResponse {
  constructor(code: string, errors: Array<MessageError>, details?: string) {
    this.code = code;
    this.details = details;
    this.errors = errors;
  }
  @ApiProperty()
  code: string;
  @ApiPropertyOptional()
  details?: string;
  @ApiProperty()
  errors: Array<MessageError>;
}

export const isErrorResponse = (value: any): value is ErrorResponse =>
  value && value.code && value.errors;
