import { STATUS_CODES } from 'node:http';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { isDatabaseUnavailableError } from '../../database/database-errors';

const parserStatuses = new Map([
  ['entity.too.large', HttpStatus.PAYLOAD_TOO_LARGE],
  ['parameters.too.many', HttpStatus.PAYLOAD_TOO_LARGE],
  ['entity.parse.failed', HttpStatus.BAD_REQUEST],
  ['request.aborted', HttpStatus.BAD_REQUEST],
  ['request.size.invalid', HttpStatus.BAD_REQUEST],
  ['querystring.parse.rangeError', HttpStatus.BAD_REQUEST],
  ['charset.unsupported', HttpStatus.UNSUPPORTED_MEDIA_TYPE],
  ['encoding.unsupported', HttpStatus.UNSUPPORTED_MEDIA_TYPE],
]);

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const status = this.statusCode(exception);
    const error = STATUS_CODES[status] ?? 'Error';
    let message: string | string[] = error;

    if (status === HttpStatus.BAD_REQUEST) {
      message = this.validationMessages(exception);
    } else if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      message = 'Internal server error';
    } else if (status === HttpStatus.SERVICE_UNAVAILABLE) {
      message = 'Service temporarily unavailable';
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`Request failed with HTTP ${status}`);
    }

    const adapter = this.adapterHost.httpAdapter;
    const response = host.switchToHttp().getResponse<unknown>();

    if (adapter.isHeadersSent(response)) {
      adapter.end(response);
      return;
    }

    adapter.reply(response, { statusCode: status, error, message }, status);
  }

  private statusCode(exception: unknown): HttpStatus {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    if (
      exception instanceof Error &&
      'type' in exception &&
      typeof exception.type === 'string' &&
      'status' in exception
    ) {
      const status = parserStatuses.get(exception.type);

      if (status !== undefined && exception.status === status) {
        return status;
      }
    }

    return isDatabaseUnavailableError(exception)
      ? HttpStatus.SERVICE_UNAVAILABLE
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private validationMessages(exception: unknown): string | string[] {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();

      if (
        typeof body === 'object' &&
        body !== null &&
        'message' in body &&
        Array.isArray(body.message) &&
        body.message.every((message: unknown) => typeof message === 'string')
      ) {
        return body.message;
      }
    }

    return 'Invalid request body';
  }
}
