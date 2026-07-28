import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "../../src/auth/guards/jwt-auth.guard";

describe("JwtAuthGuard", () => {
  it("allows routes marked as public", () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);

    expect(guard.canActivate(createExecutionContext())).toBe(true);
  });

  it("delegates to Passport for business routes that are not public", () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const parentGuard = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
      canActivate: (context: ExecutionContext) => boolean;
    };
    const canActivate = jest
      .spyOn(parentGuard, "canActivate")
      .mockReturnValue(true);

    expect(guard.canActivate(createExecutionContext())).toBe(true);
    expect(canActivate).toHaveBeenCalledTimes(1);

    canActivate.mockRestore();
  });
});

function createExecutionContext(): ExecutionContext {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as unknown as ExecutionContext;
}
