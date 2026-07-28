export interface CustomerJwtPayload {
  sub: string;
  cpf: string;
  customerStatus: "ACTIVE" | string;
  iss?: string;
  aud?: string | string[];
  iat?: number;
  exp?: number;
}
