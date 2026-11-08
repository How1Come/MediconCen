import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { setupDocumentation } from '../../src/documentation/swagger';
import { bootstrap } from '../../src/main';

jest.mock('../../src/app.module', () => ({ AppModule: class AppModule {} }));
jest.mock('../../src/documentation/swagger', () => ({
  setupDocumentation: jest.fn(),
}));

function application() {
  return {
    get: jest.fn().mockReturnValue(new ConfigService({ PORT: 3000 })),
    enableShutdownHooks: jest.fn(),
    listen: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

describe('Application bootstrap', () => {
  let app: ReturnType<typeof application>;
  let create: jest.SpiedFunction<typeof NestFactory.create>;

  beforeEach(() => {
    app = application();
    jest.mocked(setupDocumentation).mockReset();
    create = jest.spyOn(NestFactory, 'create');
    create.mockResolvedValue(app as unknown as INestApplication);
  });

  it('starts the configured application without closing it', async () => {
    await expect(bootstrap()).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledWith(AppModule, { abortOnError: false });
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(setupDocumentation).toHaveBeenCalledWith(app);
    expect(app.listen).toHaveBeenCalledWith(3000);
    expect(app.close).not.toHaveBeenCalled();
  });

  it('closes initialized resources before propagating a listen failure', async () => {
    const error = Object.assign(new Error('Address already in use'), {
      code: 'EADDRINUSE',
    });
    app.listen.mockRejectedValueOnce(error);
    await expect(bootstrap()).rejects.toBe(error);
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it('closes initialized resources when documentation setup fails', async () => {
    const error = new Error('Documentation setup failed');
    jest.mocked(setupDocumentation).mockImplementationOnce(() => {
      throw error;
    });
    await expect(bootstrap()).rejects.toBe(error);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(app.listen).not.toHaveBeenCalled();
  });

  it('closes initialized resources when configuration access fails', async () => {
    const error = new Error('Configuration access failed');
    app.get.mockImplementationOnce(() => {
      throw error;
    });
    await expect(bootstrap()).rejects.toBe(error);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(app.listen).not.toHaveBeenCalled();
  });

  it('propagates application creation failures without attempting startup', async () => {
    const error = new Error('Application creation failed');
    create.mockRejectedValueOnce(error);
    await expect(bootstrap()).rejects.toBe(error);
    expect(setupDocumentation).not.toHaveBeenCalled();
    expect(app.listen).not.toHaveBeenCalled();
    expect(app.close).not.toHaveBeenCalled();
  });

  it('preserves startup and cleanup failures when resource cleanup rejects', async () => {
    const startup = new Error('Startup failed');
    const cleanup = new Error('Cleanup failed');
    app.listen.mockRejectedValueOnce(startup);
    app.close.mockRejectedValueOnce(cleanup);

    await expect(bootstrap()).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [startup, cleanup],
      cause: cleanup,
    });
    expect(app.close).toHaveBeenCalledTimes(1);
  });
});
