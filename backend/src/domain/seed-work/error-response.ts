import { ApiProperty } from '@nestjs/swagger';

export class MessageError {
  constructor(message: string) {
    this.message = message;
  }
  @ApiProperty()
  message: string;
}

export class ErrorResponse {
  constructor(code: string, errors: Array<MessageError>) {
    this.code = code;
    this.errors = errors;
  }
  @ApiProperty()
  code: string;
  @ApiProperty()
  errors: Array<MessageError>;
}
