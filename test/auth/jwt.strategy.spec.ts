import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtStrategy } from "../../src/auth/strategies/jwt.strategy";

describe("JwtStrategy", () => {
  const configService = new ConfigService({
    JWT_SECRET: "test-secret",
    JWT_ISSUER: "fiap-tech-challenge-auth-function",
    JWT_AUDIENCE: "fiap-tech-challenge-api",
    JWT_REQUIRED_CUSTOMER_STATUS: "ACTIVE",
  });

  it("maps CPF auth function claims to an authenticated request principal", () => {
    const strategy = new JwtStrategy(configService);

    expect(
      strategy.validate({
        sub: "customer-1",
        cpf: "52998224725",
        customerStatus: "ACTIVE",
      }),
    ).toEqual({
      customerId: "customer-1",
      cpf: "52998224725",
      customerStatus: "ACTIVE",
    });
  });

  it("rejects incomplete claims", () => {
    const strategy = new JwtStrategy(configService);

    expect(() =>
      strategy.validate({
        sub: "customer-1",
        cpf: "",
        customerStatus: "ACTIVE",
      }),
    ).toThrow(UnauthorizedException);
  });

  it("rejects inactive customer tokens", () => {
    const strategy = new JwtStrategy(configService);

    expect(() =>
      strategy.validate({
        sub: "customer-1",
        cpf: "52998224725",
        customerStatus: "INACTIVE",
      }),
    ).toThrow(UnauthorizedException);
  });

  it("requires a configured JWT secret", () => {
    expect(() => new JwtStrategy(new ConfigService({}))).toThrow(
      "JWT_SECRET must be configured",
    );
  });
});
