import { jest } from '@jest/globals';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { ApiExceptionFilter } from '../../src/common/filters/api-exception.filter';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

const errorLog = jest.fn<(...args: unknown[]) => void>();

function harness() {
  const response = {};
  const adapter = {
    isHeadersSent: jest
      .fn<(response: unknown) => boolean>()
      .mockReturnValue(false),
    end: jest.fn<(response: unknown) => void>(),
    reply:
      jest.fn<(response: unknown, body: ErrorBody, status: number) => void>(),
  };
  const adapterHost = { httpAdapter: adapter } as unknown as HttpAdapterHost;
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  return {
    filter: new ApiExceptionFilter(adapterHost),
    host,
    response,
    adapter,
  };
}

describe('ApiExceptionFilter', () => {
  beforeEach(() => {
    errorLog.mockClear();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(errorLog);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    {
      exception: new Error('private request value'),
      status: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    },
    {
      exception: new QueryFailedError(
        'SELECT userID FROM private_table WHERE id1 = ?',
        ['private request value'],
        Object.assign(new Error('private SQL details'), {
          code: 'ER_NO_SUCH_TABLE',
        }),
      ),
      status: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    },
    {
      exception: Object.assign(new Error('private connection details'), {
        code: 'ECONNREFUSED',
      }),
      status: 503,
      error: 'Service Unavailable',
      message: 'Service temporarily unavailable',
    },
    {
      exception: new QueryFailedError(
        'INSERT INTO private_table VALUES (?)',
        ['private request value'],
        Object.assign(new Error('private deadlock details'), {
          code: 'ER_LOCK_DEADLOCK',
        }),
      ),
      status: 503,
      error: 'Service Unavailable',
      message: 'Service temporarily unavailable',
    },
  ])('sanitizes a server failure to HTTP $status', (expected) => {
    const { filter, host, response, adapter } = harness();

    filter.catch(expected.exception, host);

    expect(adapter.reply).toHaveBeenCalledWith(
      response,
      {
        statusCode: expected.status,
        error: expected.error,
        message: expected.message,
      },
      expected.status,
    );
    expect(errorLog).toHaveBeenCalledWith(
      `Request failed with HTTP ${expected.status}`,
    );
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('preserves controlled validation messages', () => {
    const { filter, host, response, adapter } = harness();
    const messages = [
      'id1 must be a string',
      'Request contains unsupported properties',
    ];

    filter.catch(new BadRequestException(messages), host);

    expect(adapter.reply).toHaveBeenCalledWith(
      response,
      { statusCode: 400, error: 'Bad Request', message: messages },
      400,
    );
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each([
    new BadRequestException('Unexpected token in private request value'),
    new BadRequestException({ message: ['private request value', 123] }),
    Object.assign(new Error('private parser body'), {
      type: 'entity.parse.failed',
      status: 400,
    }),
  ])(
    'does not expose parser text or malformed validation details',
    (exception) => {
      const { filter, host, response, adapter } = harness();

      filter.catch(exception, host);

      expect(adapter.reply).toHaveBeenCalledWith(
        response,
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid request body',
        },
        400,
      );
    },
  );

  it.each([
    { type: 'entity.too.large', status: 413, message: 'Payload Too Large' },
    {
      type: 'encoding.unsupported',
      status: 415,
      message: 'Unsupported Media Type',
    },
    {
      type: 'charset.unsupported',
      status: 415,
      message: 'Unsupported Media Type',
    },
  ])(
    'recognizes a raw $type parser error without exposing its message',
    (expected) => {
      const { filter, host, response, adapter } = harness();
      const exception = Object.assign(new Error('private parser details'), {
        type: expected.type,
        status: expected.status,
      });

      filter.catch(exception, host);

      expect(adapter.reply).toHaveBeenCalledWith(
        response,
        {
          statusCode: expected.status,
          error: expected.message,
          message: expected.message,
        },
        expected.status,
      );
    },
  );

  it.each([
    { status: 400, statusCode: 400, message: 'private error details' },
    Object.assign(new Error('private error details'), { statusCode: 400 }),
    Object.assign(new Error('private parser details'), {
      type: 'entity.too.large',
      status: 400,
    }),
  ])('does not trust an arbitrary status property', (exception) => {
    const { filter, host, response, adapter } = harness();

    filter.catch(exception, host);

    expect(adapter.reply).toHaveBeenCalledWith(
      response,
      {
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Internal server error',
      },
      500,
    );
  });

  it('does not reflect the URL of an unknown route', () => {
    const { filter, host, response, adapter } = harness();

    filter.catch(
      new NotFoundException('Cannot GET /private?token=value'),
      host,
    );

    expect(adapter.reply).toHaveBeenCalledWith(
      response,
      { statusCode: 404, error: 'Not Found', message: 'Not Found' },
      404,
    );
  });

  it('ends an already-started response without writing another body', () => {
    const { filter, host, response, adapter } = harness();
    adapter.isHeadersSent.mockReturnValue(true);

    filter.catch(new NotFoundException(), host);

    expect(adapter.end).toHaveBeenCalledWith(response);
    expect(adapter.reply).not.toHaveBeenCalled();
  });
});
