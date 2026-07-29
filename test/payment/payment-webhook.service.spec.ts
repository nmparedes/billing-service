import { createHmac } from "crypto";
import { DomainException } from "../../src/common/exceptions/domain.exception";
import { PaymentWebhookService } from "../../src/payment/application/services/payment-webhook.service";
import { MercadoPagoWebhookDto } from "../../src/payment/application/dto/mercado-pago-webhook.dto";
import { Payment } from "../../src/payment/domain/entities/payment.entity";
import { PaymentWebhookEvent } from "../../src/payment/domain/entities/payment-webhook-event.entity";
import { PaymentStatus } from "../../src/payment/domain/enums/payment-status.enum";
import { PaymentWebhookEventStatus } from "../../src/payment/domain/enums/payment-webhook-event-status.enum";
import type { PaymentProvider } from "../../src/payment/domain/providers/payment-provider.interface";
import type { PaymentRepository } from "../../src/payment/domain/repositories/payment.repository.interface";
import type { PaymentWebhookEventRepository } from "../../src/payment/domain/repositories/payment-webhook-event.repository.interface";
import { BillingEventsService } from "../../src/messaging/billing-events.service";

const secret = "test-webhook-secret";
const requestId = "request-1";
const providerPaymentId = "provider-payment-1";

describe("PaymentWebhookService", () => {
  let paymentRepository: jest.Mocked<PaymentRepository>;
  let eventRepository: jest.Mocked<PaymentWebhookEventRepository>;
  let paymentProvider: jest.Mocked<PaymentProvider>;
  let billingEvents: jest.Mocked<BillingEventsService>;
  let authenticator: { validate: jest.Mock };
  let service: PaymentWebhookService;

  beforeEach(() => {
    paymentRepository = {
      findById: jest.fn(),
      findByBudgetId: jest.fn(),
      findByExternalReference: jest.fn(),
      createIfAbsent: jest.fn(),
      tryClaimPreferenceCreation: jest.fn(),
      releasePreferenceCreation: jest.fn(),
      save: jest.fn(async (payment) => payment),
      claimRefund: jest.fn(),
      completeRefund: jest.fn(),
      releaseRefundClaim: jest.fn(),
      rejectRefund: jest.fn(),
      rejectRefundRequest: jest.fn(),
    };
    eventRepository = {
      findByProviderNotificationId: jest.fn(),
      createIfAbsent: jest.fn(async (event) => event),
      claimForProcessing: jest.fn(async (_providerNotificationId: string) =>
        webhookEvent(),
      ),
      save: jest.fn(async (event) => event),
    };
    paymentProvider = {
      createPreference: jest.fn(),
      getPayment: jest.fn().mockResolvedValue({
        providerPaymentId,
        status: "approved",
        externalReference: "payment-1",
      }),
      refundPayment: jest.fn(),
    };
    billingEvents = {
      publishPaymentApproved: jest.fn(),
      publishPaymentFailed: jest.fn(),
    } as unknown as jest.Mocked<BillingEventsService>;
    authenticator = {
      validate: jest.fn(
        ({ signature, requestId, dataId }) =>
          signature === signatureFor(secret, requestId, dataId),
      ),
    };
    service = new PaymentWebhookService(
      paymentRepository,
      eventRepository,
      paymentProvider,
      authenticator,
      billingEvents,
    );
  });

  it("persists and processes a new approved event from the provider response", async () => {
    const payment = localPayment();
    paymentRepository.findByExternalReference.mockResolvedValue(payment);

    await expect(service.handle(validInput())).resolves.toBeUndefined();

    expect(paymentProvider.getPayment).toHaveBeenCalledWith(providerPaymentId);
    expect(payment.status).toBe(PaymentStatus.APPROVED);
    expect(payment.providerPaymentId).toBe(providerPaymentId);
    expect(payment.providerStatus).toBe("approved");
    expect(paymentRepository.save).toHaveBeenCalledWith(payment);
    expect(billingEvents.publishPaymentApproved).toHaveBeenCalledWith(
      payment,
      "notification-1",
      providerPaymentId,
    );
    expect(eventRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: PaymentWebhookEventStatus.PROCESSED,
        signatureValidation: "VALID",
      }),
    );
  });

  it("maps rejected payments to FAILED", async () => {
    const payment = localPayment();
    paymentRepository.findByExternalReference.mockResolvedValue(payment);
    paymentProvider.getPayment.mockResolvedValue({
      providerPaymentId,
      status: "rejected",
      externalReference: payment.externalReference,
    });

    await service.handle(validInput());

    expect(payment.status).toBe(PaymentStatus.FAILED);
    expect(billingEvents.publishPaymentFailed).toHaveBeenCalledWith(
      payment,
      "notification-1",
      providerPaymentId,
    );
  });

  it("rejects an invalid signature before persisting an event or payment", async () => {
    await expect(
      service.handle({ ...validInput(), signature: "ts=1,v1=invalid" }),
    ).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_UNAUTHORIZED" });

    expect(eventRepository.createIfAbsent).not.toHaveBeenCalled();
    expect(paymentProvider.getPayment).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload before persisting an event", async () => {
    await expect(
      service.handle({ ...validInput(), providerPaymentId: undefined }),
    ).rejects.toMatchObject({ code: "WEBHOOK_INVALID_PAYLOAD" });
    expect(eventRepository.createIfAbsent).not.toHaveBeenCalled();
  });

  it("rejects a missing request ID or query data ID before persisting an event", async () => {
    await expect(
      service.handle({ ...validInput(), requestId: undefined }),
    ).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_UNAUTHORIZED" });

    await expect(
      service.handle({ ...validInput(), providerPaymentId: undefined }),
    ).rejects.toMatchObject({ code: "WEBHOOK_INVALID_PAYLOAD" });
    expect(eventRepository.createIfAbsent).not.toHaveBeenCalled();
  });

  it("does not process an event that is already processed", async () => {
    const event = webhookEvent();
    event.markProcessed("payment-1", providerPaymentId);
    eventRepository.createIfAbsent.mockResolvedValue(event);

    await expect(service.handle(validInput())).resolves.toBeUndefined();

    expect(eventRepository.claimForProcessing).not.toHaveBeenCalled();
    expect(paymentProvider.getPayment).not.toHaveBeenCalled();
  });

  it("retries a failed event safely", async () => {
    const event = webhookEvent();
    event.markFailed("PAYMENT_PROVIDER_UNAVAILABLE");
    const payment = localPayment();
    eventRepository.createIfAbsent.mockResolvedValue(event);
    eventRepository.claimForProcessing.mockResolvedValue(event);
    paymentRepository.findByExternalReference.mockResolvedValue(payment);

    await service.handle(validInput());

    expect(payment.status).toBe(PaymentStatus.APPROVED);
    expect(eventRepository.claimForProcessing).toHaveBeenCalledWith(
      event.providerNotificationId,
    );
  });

  it("re-publishes a persisted approved payment when a failed webhook is retried", async () => {
    const event = webhookEvent();
    event.markFailed("BROKER_UNAVAILABLE");
    const payment = localPayment();
    payment.applyProviderStatus(PaymentStatus.APPROVED);
    payment.updateProviderPayment(providerPaymentId, "approved");
    eventRepository.createIfAbsent.mockResolvedValue(event);
    eventRepository.claimForProcessing.mockResolvedValue(event);
    paymentRepository.findByExternalReference.mockResolvedValue(payment);

    await service.handle(validInput());

    expect(billingEvents.publishPaymentApproved).toHaveBeenCalledWith(
      payment,
      "notification-1",
      providerPaymentId,
    );
  });

  it("does not allow concurrent handlers for the same event", async () => {
    const payment = localPayment();
    let resolveProviderLookup: (() => void) | undefined;
    const providerLookup = new Promise<void>((resolve) => {
      resolveProviderLookup = resolve;
    });
    paymentRepository.findByExternalReference.mockResolvedValue(payment);
    paymentProvider.getPayment.mockImplementation(async () => {
      await providerLookup;
      return {
        providerPaymentId,
        status: "approved",
        externalReference: payment.externalReference,
      };
    });
    eventRepository.claimForProcessing
      .mockResolvedValueOnce(webhookEvent())
      .mockResolvedValueOnce(null);
    eventRepository.findByProviderNotificationId.mockResolvedValue(
      webhookEvent(),
    );

    const processing = service.handle(validInput());
    const concurrent = service.handle(validInput());
    resolveProviderLookup?.();
    const results = await Promise.allSettled([processing, concurrent]);

    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(paymentProvider.getPayment).toHaveBeenCalledTimes(1);
    expect(paymentRepository.save).toHaveBeenCalledTimes(1);
  });

  it("marks failures for missing local payments and unavailable providers", async () => {
    paymentRepository.findByExternalReference.mockResolvedValue(null);

    await expect(service.handle(validInput())).rejects.toMatchObject({
      code: "PAYMENT_NOT_FOUND",
    });
    expect(eventRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: PaymentWebhookEventStatus.FAILED,
        error: "PAYMENT_NOT_FOUND",
      }),
    );

    paymentProvider.getPayment.mockRejectedValue(new Error("unavailable"));
    await expect(service.handle(validInput())).rejects.toMatchObject({
      status: 503,
    });
    expect(eventRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: "PAYMENT_PROVIDER_UNAVAILABLE" }),
    );
  });

  it("does not persist a repeated provider status and rejects invalid transitions", async () => {
    const approved = localPayment();
    approved.applyProviderStatus(PaymentStatus.APPROVED);
    approved.updateProviderPayment(providerPaymentId, "approved");
    paymentRepository.findByExternalReference.mockResolvedValue(approved);

    await service.handle(validInput());
    expect(paymentRepository.save).not.toHaveBeenCalled();
    expect(billingEvents.publishPaymentApproved).not.toHaveBeenCalled();

    paymentProvider.getPayment.mockResolvedValue({
      providerPaymentId,
      status: "pending",
      externalReference: approved.externalReference,
    });
    await expect(service.handle(validInput())).rejects.toBeInstanceOf(
      DomainException,
    );
    expect(eventRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: "PAYMENT_STATUS_TRANSITION_INVALID" }),
    );
  });

  it("fails validation when the webhook authenticator rejects the request", async () => {
    const missingSecretService = new PaymentWebhookService(
      paymentRepository,
      eventRepository,
      paymentProvider,
      { validate: jest.fn().mockReturnValue(false) },
      billingEvents,
    );

    await expect(missingSecretService.handle(validInput())).rejects.toThrow();
    expect(eventRepository.createIfAbsent).not.toHaveBeenCalled();
  });
});

function validInput() {
  const payload: MercadoPagoWebhookDto = {
    id: "notification-1",
    action: "payment.updated",
    type: "payment",
    data: { id: providerPaymentId },
  };
  return {
    signature: signatureFor(secret, requestId, providerPaymentId),
    requestId,
    type: "payment",
    providerNotificationId: payload.id,
    providerPaymentId,
    action: payload.action,
    rawPayload: payload as unknown as Record<string, unknown>,
  };
}

function webhookEvent(): PaymentWebhookEvent {
  return PaymentWebhookEvent.receive({
    id: "event-1",
    providerNotificationId: "notification-1",
    providerPaymentId,
    type: "payment",
    action: "payment.updated",
    rawPayload: validInput().rawPayload,
  });
}

function localPayment(): Payment {
  return Payment.create({
    id: "payment-1",
    budgetId: "budget-1",
    orderId: "order-1",
    sagaId: "saga-1",
    amount: 400,
  });
}

function signatureFor(
  secret: string,
  requestId: string,
  dataId: string,
  timestamp = "1710000000",
): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const signature = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${timestamp},v1=${signature}`;
}
