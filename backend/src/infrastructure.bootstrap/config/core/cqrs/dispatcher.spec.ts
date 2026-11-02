/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { randomUUID } from 'crypto';
import { Dispatcher } from './dispatcher';
import { REQUEST_HANDLER_METADATA_KEY } from './constant';

class FakeCommand {}

describe('Dispatcher', () => {
  it('el handler recibe (command, contexto) con el usuario y el scope del request', async () => {
    const userId = randomUUID();
    const orgId = randomUUID();
    const execute = jest.fn().mockResolvedValue('ok');
    class FakeHandler {}
    const request: any = {
      auth: { userId },
      orgAccess: {
        organizationIds: [orgId],
        primaryOrgId: orgId,
        roles: { [orgId]: 'MEMBER' },
      },
    };
    const moduleRef: any = {
      resolve: jest.fn().mockResolvedValue({ execute }),
    };
    const reflector: any = {
      get: jest.fn((key: unknown, target: unknown) =>
        key === REQUEST_HANDLER_METADATA_KEY && target === FakeCommand
          ? FakeHandler
          : undefined,
      ),
    };
    const dispatcher = new Dispatcher(request, moduleRef, reflector);
    const command = new FakeCommand();
    await expect(dispatcher.dispatch(command as any)).resolves.toBe('ok');
    expect(execute).toHaveBeenCalledTimes(1);
    const [cmd, ctx] = execute.mock.calls[0];
    expect(cmd).toBe(command);
    expect(ctx.userId).toBe(userId);
    expect(ctx.org.primaryOrgId).toBe(orgId);
    expect(ctx.org.roles[orgId]).toBe('MEMBER');
  });
});
