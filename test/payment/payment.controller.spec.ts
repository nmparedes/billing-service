import { PaymentService } from "../../src/payment/application/services/payment.service";
import { PaymentController } from "../../src/payment/infrastructure/controllers/payment.controller";
import { BillingEventsService } from "../../src/messaging/billing-events.service";

describe("PaymentController", () => {
  const paymentService = {
    createWithResult: jest.fn(),
    findById: jest.fn(),
  } as unknown as jest.Mocked<PaymentService>;
  const billingEvents = {
    publishPaymentCreated: jest.fn(),
  } as unknown as jest.Mocked<BillingEventsService>;
  const controller = new PaymentController(paymentService, billingEvents);

  beforeEach(() => jest.clearAllMocks());

  it("delegates payment creation and lookup to the application service", async () => {
    const response = { id: "payment-1" };
    paymentService.createWithResult.mockResolvedValue({
      payment: response,
      created: true,
    } as never);
    paymentService.findById.mockResolvedValue(response as never);

    await expect(
      controller.create({ budgetId: "2e3fd4bc-8d11-4c35-bc75-85c11938b5a5" }),
    ).resolves.toEqual(response);
    await expect(controller.findById("payment-1")).resolves.toEqual(response);

    expect(paymentService.createWithResult).toHaveBeenCalledWith({
      budgetId: "2e3fd4bc-8d11-4c35-bc75-85c11938b5a5",
    });
    expect(paymentService.findById).toHaveBeenCalledWith("payment-1");
    expect(billingEvents.publishPaymentCreated).toHaveBeenCalledWith(
      response,
      "2e3fd4bc-8d11-4c35-bc75-85c11938b5a5",
    );
  });

  it("re-publishes payment.created when a request retries a persisted payment", async () => {
    const response = { id: "payment-1" };
    paymentService.createWithResult.mockResolvedValue({
      payment: response,
      created: false,
    } as never);

    await expect(
      controller.create({ budgetId: "2e3fd4bc-8d11-4c35-bc75-85c11938b5a5" }),
    ).resolves.toEqual(response);

    expect(billingEvents.publishPaymentCreated).toHaveBeenCalledWith(
      response,
      "2e3fd4bc-8d11-4c35-bc75-85c11938b5a5",
    );
  });
});
