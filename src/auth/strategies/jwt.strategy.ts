import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { AuthenticatedCustomer } from "../interfaces/authenticated-customer.interface";
import type { CustomerJwtPayload } from "../interfaces/jwt-payload.interface";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const secret = configService.get<string>("JWT_SECRET");
    if (!secret) {
      throw new Error("JWT_SECRET must be configured for billing-service.");
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      issuer: configService.get<string>("JWT_ISSUER"),
      audience: configService.get<string>("JWT_AUDIENCE"),
    });

    this.requiredCustomerStatus = configService.get<string>(
      "JWT_REQUIRED_CUSTOMER_STATUS",
      "ACTIVE",
    );
  }

  private readonly requiredCustomerStatus: string;

  validate(payload: CustomerJwtPayload): AuthenticatedCustomer {
    if (!payload.sub || !payload.cpf || !payload.customerStatus) {
      throw new UnauthorizedException("Invalid customer token payload.");
    }

    if (payload.customerStatus !== this.requiredCustomerStatus) {
      throw new UnauthorizedException("Customer token is not active.");
    }

    return {
      customerId: payload.sub,
      cpf: payload.cpf,
      customerStatus: payload.customerStatus,
    };
  }
}
