import { BadRequestException } from "@nestjs/common";
import { DomainException } from "../../src/common/exceptions/domain.exception";
import { DomainExceptionFilter } from "../../src/common/filters/domain-exception.filter";
import { HttpExceptionFilter } from "../../src/common/filters/http-exception.filter";

describe("DomainExceptionFilter", () => {
  it("maps domain exceptions to structured responses", () => {
    const response = createResponse();
    const host = createHost(response);
    const filter = new DomainExceptionFilter();

    filter.catch(
      new DomainException("CUSTOMER_NOT_FOUND", "Customer was not found.", {
        customerId: "1",
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "CUSTOMER_NOT_FOUND",
        message: "Customer was not found.",
        correlationId: "correlation-1",
      }),
    );
  });

  it("maps conflicts and validation errors", () => {
    const filter = new DomainExceptionFilter();

    expectMapStatus(filter, "CUSTOMER_ALREADY_EXISTS", 409);
    expectMapStatus(filter, "CUSTOMER_CONFLICT", 409);
    expectMapStatus(filter, "CUSTOMER_UNAUTHORIZED", 401);
    expectMapStatus(filter, "CUSTOMER_FORBIDDEN", 403);
    expectMapStatus(filter, "INVALID_DOCUMENT", 400);
  });
});

describe("HttpExceptionFilter", () => {
  it("maps Nest HTTP exceptions to structured responses", () => {
    const response = createResponse();
    const host = createHost(response);
    const filter = new HttpExceptionFilter();

    filter.catch(new BadRequestException(["invalid field"]), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: ["invalid field"],
        path: "/customers",
        correlationId: "correlation-1",
      }),
    );
  });
});

function expectMapStatus(
  filter: DomainExceptionFilter,
  code: string,
  status: number,
): void {
  const response = createResponse();
  filter.catch(new DomainException(code, code), createHost(response));
  expect(response.status).toHaveBeenCalledWith(status);
}

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function createHost(response: ReturnType<typeof createResponse>) {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        url: "/customers",
        correlationId: "correlation-1",
      }),
    }),
  } as never;
}
