import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  getSchemaPath,
} from '@nestjs/swagger';

export class PaginatedArrayDto<T> {
  constructor(items: Array<T>, totalItems: number) {
    this.items = items;
    this.totalItems = totalItems;
  }
  @ApiProperty()
  items: Array<T>;
  @ApiProperty()
  totalItems: number;
}

export const ApiPaginatedOkResponse = <TModel extends Type<any>>(options: {
  description: string;
  type: TModel;
}) =>
  applyDecorators(
    ApiOkResponse({
      description: options.description,
      schema: {
        title: `PaginatedArrayOf${options.type.name}`,
        allOf: [
          { $ref: getSchemaPath(PaginatedArrayDto) },
          {
            properties: {
              items: {
                type: 'array',
                items: { $ref: getSchemaPath(options.type) },
              },
            },
          },
        ],
      },
    }),
    ApiExtraModels(PaginatedArrayDto),
  );
