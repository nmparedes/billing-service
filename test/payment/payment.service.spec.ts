import { ConfigService } from "@nestjs/config";
import { Budget } from "../../src/budget/domain/entities/budget.entity";
import type { BudgetRepository } from "../../src/budget/domain/repositories/budget.repository.interface";
import { PaymentService } from "../../src/payment/application/services/payment.service";
import { Payment } from "../../src/payment/domain/entities/payment.entity";
import type { PaymentProvider } from "../../src/payment/domain/providers/payment-provider.interface";
import type { PaymentRepository } from "../../src/payment/domain/repositories/payment.repository.interface";

describe("PaymentService", () => {
  let budgetRepository: jest.Mocked<BudgetRepository>;
  let paymentRepository: jest.Mocked<PaymentRepository>;
  let paymentProvider: jest.Mocked<PaymentProvider>;
  let service: PaymentService;

  beforeEach(() => {
    budgetRepository = {
      findById: jest.fn(),
      findBySagaAndOrder: jest.fn(),
      createIfAbsent: jest.fn(),
      save: jest.fn(),
    };
    paymentRepository = {
      findById: jest.fn(),
      findByBudgetId: jest.fn(),
      findByExternalReference: jest.fn(),
      createIfAbsent: jest.fn(async (payment) => payment),
      tryClaimPreferenceCreation: jest.fn().mockResolvedValue(true),
      releasePreferenceCreation: jest.fn().mockResolvedValue(undefined),
      save: jest.fn(async (payment) => payment),
      claimRefund: jest.fn(),
      completeRefund: jest.fn(),
      releaseRefundClaim: jest.fn(),
      rejectRefund: jest.fn(),
      rejectRefundRequest: jest.fn(),
    };
    paymentProvider = {
      createPreference: jest.fn().mockResolvedValue({
        providerPreferenceId: "preference-1",
        checkoutUrl: "https://sandbox.mercadopago.test/checkout/preference-1",
      }),
      getPayment: jest.fn(),
      refundPayment: jest.fn(),
    };
    service = new PaymentService(
      budgetRepository,
      paymentRepository,
      paymentProvider,
      new ConfigService(paymentEnvironment()),
    );
  });

  it("creates a Checkout Pro preference from an approved local budget", async () => {
    budgetRepository.findById.mockResolvedValue(approvedBudget());

    const response = await service.create({
      budgetId: "budget-1",
    });

    expect(response).toMatchObject({
      budgetId: "budget-1",
      orderId: "order-1",
      sagaId: "saga-1",
      amount: 400,
      currency: "BRL",
      providerPreferenceId: "preference-1",
    });
    expect(paymentProvider.createPreference).toHaveBeenCalledWith(
      expect.objectContaining({
        externalReference: response.id,
        amount: 400,
        currency: "BRL",
        notificationUrl: "https://example.test/webhooks/mercado-pago",
      }),
    );
    expect(paymentRepository.save).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing budget", async () => {
    budgetRepository.findById.mockResolvedValue(null);

    await expect(service.create({ budgetId: "missing" })).rejects.toMatchObject(
      {
        code: "BUDGET_NOT_FOUND",
      },
    );
  });

  it("requires an approved budget", async () => {
    budgetRepository.findById.mockResolvedValue(waitingBudget());

    await expect(
      service.create({ budgetId: "budget-1" }),
    ).rejects.toMatchObject({
      code: "BUDGET_NOT_APPROVED",
    });
    expect(paymentRepository.createIfAbsent).not.toHaveBeenCalled();
  });

  it("reuses an existing payment without creating another preference", async () => {
    budgetRepository.findById.mockResolvedValue(approvedBudget());
    const existing = paymentWithPreference();
    paymentRepository.findByBudgetId.mockResolvedValue(existing);
    paymentRepository.createIfAbsent.mockResolvedValue(existing);

    await expect(
      service.createWithResult({ budgetId: "budget-1" }),
    ).resolves.toMatchObject({
      created: false,
      payment: {
        id: existing.id,
        providerPreferenceId: "preference-1",
      },
    });
    expect(paymentProvider.createPreference).not.toHaveBeenCalled();
    expect(paymentRepository.tryClaimPreferenceCreation).not.toHaveBeenCalled();
  });

  it("returns a completed payment when another request owns preference creation", async () => {
    budgetRepository.findById.mockResolvedValue(approvedBudget());
    const pending = Payment.create({
      id: "payment-1",
      budgetId: "budget-1",
      orderId: "order-1",
      sagaId: "saga-1",
      amount: 400,
    });
    paymentRepository.createIfAbsent.mockResolvedValue(pending);
    paymentRepository.tryClaimPreferenceCreation.mockResolvedValue(false);
    paymentRepository.findById.mockResolvedValue(paymentWithPreference());

    await expect(
      service.create({ budgetId: "budget-1" }),
    ).resolves.toMatchObject({
      providerPreferenceId: "preference-1",
    });
    expect(paymentProvider.createPreference).not.toHaveBeenCalled();
  });

  it("reports an in-progress payment when another request has not completed it", async () => {
    budgetRepository.findById.mockResolvedValue(approvedBudget());
    paymentRepository.tryClaimPreferenceCreation.mockResolvedValue(false);
    paymentRepository.findById.mockResolvedValue(null);

    await expect(
      service.create({ budgetId: "budget-1" }),
    ).rejects.toMatchObject({
      code: "PAYMENT_CREATION_IN_PROGRESS",
    });
  });

  it("releases the claim and exposes a provider error", async () => {
    budgetRepository.findById.mockResolvedValue(approvedBudget());
    paymentProvider.createPreference.mockRejectedValue(
      new Error("unavailable"),
    );

    await expect(
      service.create({ budgetId: "budget-1" }),
    ).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
    });
    expect(paymentRepository.releasePreferenceCreation).toHaveBeenCalledTimes(
      1,
    );
  });

  it("releases the claim when the provider response is incomplete", async () => {
    budgetRepository.findById.mockResolvedValue(approvedBudget());
    paymentProvider.createPreference.mockResolvedValue({
      providerPreferenceId: "",
      checkoutUrl: "",
    });

    await expect(
      service.create({ budgetId: "budget-1" }),
    ).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_INVALID_RESPONSE",
    });
    expect(paymentRepository.releasePreferenceCreation).toHaveBeenCalledTimes(
      1,
    );
  });

  it("returns an existing payment by ID and reports absence", async () => {
    const payment = paymentWithPreference();
    paymentRepository.findById.mockResolvedValueOnce(payment);

    await expect(service.findById(payment.id)).resolves.toMatchObject({
      id: payment.id,
      checkoutUrl: payment.checkoutUrl,
    });

    paymentRepository.findById.mockResolvedValueOnce(null);
    await expect(service.findById("missing")).rejects.toMatchObject({
      code: "PAYMENT_NOT_FOUND",
    });
  });
});

function approvedBudget(): Budget {
  const budget = waitingBudget();
  budget.approve();
  return budget;
}

function waitingBudget(): Budget {
  const budget = Budget.request({
    id: "budget-1",
    sagaId: "saga-1",
    orderId: "order-1",
    orderNumber: "OS-20260724-0001",
    customer: {
      customerId: "customer-1",
      customerDocument: "52998224725",
      customerName: "Maria Silva",
    },
    serviceItems: [
      {
        serviceId: "service-1",
        serviceName: "Alignment",
        unitPrice: 300,
        quantity: 1,
      },
    ],
    partItems: [
      {
        partId: "part-1",
        partCode: "BRK-001",
        partName: "Brake pad",
        unitPrice: 100,
        quantity: 1,
      },
    ],
    requestedAt: new Date("2099-01-01T00:00:00.000Z"),
    expiresAt: new Date("2099-01-08T00:00:00.000Z"),
  });
  budget.markCreated();
  budget.waitForApproval();
  return budget;
}

function paymentWithPreference(): Payment {
  const payment = Payment.create({
    id: "payment-1",
    budgetId: "budget-1",
    orderId: "order-1",
    sagaId: "saga-1",
    amount: 400,
  });
  payment.assignPreference(
    "preference-1",
    "https://sandbox.mercadopago.test/checkout/preference-1",
  );
  return payment;
}

function paymentEnvironment() {
  return {
    MERCADO_PAGO_NOTIFICATION_URL: "https://example.test/webhooks/mercado-pago",
    MERCADO_PAGO_SUCCESS_URL: "https://example.test/payments/success",
    MERCADO_PAGO_FAILURE_URL: "https://example.test/payments/failure",
    MERCADO_PAGO_PENDING_URL: "https://example.test/payments/pending",
  };
}
