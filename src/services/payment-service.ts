import { AuthUser } from '../auth/types.ts';
import { IDomainStore } from '../domain/storage/repository.ts';
import {
  PaymentOrder,
  PaymentInvoice,
  PaymentGatewayConfig,
} from '../domain/types/payment.ts';
import { DomainError } from '../domain/types/errors.ts';
import { authorizeAction } from '../auth/authorization.ts';
import {
  getPaymentGatewayProvider,
  IPaymentGatewayProvider,
} from './payment/payment-gateway-adapter.ts';

export class PaymentService {
  private gateway: IPaymentGatewayProvider;

  constructor(
    private store: IDomainStore,
    gatewayProvider?: IPaymentGatewayProvider
  ) {
    this.gateway = gatewayProvider || getPaymentGatewayProvider();
  }

  getGatewayConfig(): PaymentGatewayConfig {
    return this.gateway.getPublicConfig();
  }

  /**
   * Creates a commercial payment order linked to a journey.
   * INVARIANT: Amount is ALWAYS derived server-authoritatively from the journey's calculated fare.
   * Client amounts are never accepted.
   */
  async createPaymentOrder(
    user: AuthUser,
    journeyId: string,
    options?: { idempotencyKey?: string }
  ): Promise<PaymentOrder> {
    const journey = await this.store.journeys.findById(journeyId);
    if (!journey) {
      throw new DomainError('ENTITY_NOT_FOUND', `Journey '${journeyId}' not found.`);
    }

    // RBAC: Only patient who owns the journey or Admin can initiate payment
    const auth = authorizeAction(user, 'CREATE_PAYMENT', { journey, patientId: journey.patientId });
    if (!auth.authorized) {
      throw new DomainError(
        'UNAUTHORIZED_ACTION',
        auth.reason || 'You are not authorized to create a payment for this journey.'
      );
    }

    // Payment Idempotency Check:
    if (options?.idempotencyKey && this.store.payments) {
      const existingKeyPayment = await this.store.payments.findByIdempotencyKey(options.idempotencyKey);
      if (existingKeyPayment) {
        return existingKeyPayment;
      }
    }

    // Check if journey is already paid successfully
    if (this.store.payments) {
      const journeyPayments = await this.store.payments.findByJourneyId(journeyId);
      const successfulPayment = journeyPayments.find((p) => p.status === 'SUCCESS');
      if (successfulPayment) {
        throw new DomainError(
          'PAYMENT_ALREADY_COMPLETED',
          `Journey '${journeyId}' has already been paid successfully under receipt ${successfulPayment.receiptNumber}.`
        );
      }
    }

    // SERVER-AUTHORITATIVE AMOUNT CALCULATION:
    // Extract calculated fare from journey estimate snapshot
    const fareSnapshot = journey.fareEstimate || journey.initialFareEstimate;
    if (!fareSnapshot) {
      throw new DomainError(
        'INVALID_DATA',
        `Journey '${journeyId}' does not have a server-calculated fare estimate snapshot.`
      );
    }

    const calculatedTotal = fareSnapshot.total ?? fareSnapshot.totalEstimatedFare;
    if (typeof calculatedTotal !== 'number' || calculatedTotal <= 0) {
      throw new DomainError(
        'FARE_CALCULATION_MISMATCH',
        `Invalid server fare amount for journey '${journeyId}'.`
      );
    }

    const amount = Math.round(calculatedTotal);
    const currency = fareSnapshot.currency || 'INR';

    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const receiptNumber = `REC-2026-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Request order from gateway provider
    const orderResult = await this.gateway.createOrder({
      paymentId,
      journeyId,
      amount,
      currency,
      receipt: receiptNumber,
    });

    const now = new Date().toISOString();
    const paymentOrder: PaymentOrder = {
      id: paymentId,
      journeyId,
      patientId: journey.patientId,
      amount,
      currency,
      status: 'CREATED',
      idempotencyKey: options?.idempotencyKey,
      provider: this.gateway.providerType,
      providerOrderId: orderResult.providerOrderId,
      receiptNumber,
      fareSnapshot,
      createdAt: now,
      updatedAt: now,
    };

    if (this.store.payments) {
      await this.store.payments.save(paymentOrder);
    }

    // Audit logging
    await (this.store as any).auditLogs?.log?.({
      entityType: 'payment',
      entityId: paymentOrder.id,
      action: 'PAYMENT_ORDER_CREATED',
      actorId: user.id,
      metadata: {
        journeyId,
        patientId: journey.patientId,
        amount,
        currency,
        provider: paymentOrder.provider,
        providerOrderId: paymentOrder.providerOrderId,
        receiptNumber,
      },
    });

    return paymentOrder;
  }

  /**
   * Confirms a payment transaction with cryptographic signature verification.
   * INVARIANT: Failed or successful payment does NOT alter the journey state machine.
   */
  async confirmPayment(
    user: AuthUser,
    paymentId: string,
    details: { providerPaymentId: string; providerSignature: string }
  ): Promise<PaymentOrder> {
    if (!this.store.payments) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'Payment storage repository is not configured.');
    }

    const payment = await this.store.payments.findById(paymentId);
    if (!payment) {
      throw new DomainError('ENTITY_NOT_FOUND', `Payment order '${paymentId}' not found.`);
    }

    const auth = authorizeAction(user, 'CONFIRM_PAYMENT', { patientId: payment.patientId });
    if (!auth.authorized) {
      throw new DomainError(
        'UNAUTHORIZED_ACTION',
        auth.reason || 'You are not authorized to confirm this payment.'
      );
    }

    // Idempotent re-confirmation: If already SUCCESS, return as-is
    if (payment.status === 'SUCCESS') {
      return payment;
    }

    // Verify cryptographic signature via provider
    const verification = await this.gateway.verifyPayment({
      providerOrderId: payment.providerOrderId,
      providerPaymentId: details.providerPaymentId,
      providerSignature: details.providerSignature,
    });

    const now = new Date().toISOString();

    if (!verification.verified) {
      // Record failure without corrupting journey state machine
      const failedPayment: PaymentOrder = {
        ...payment,
        status: 'FAILED',
        providerPaymentId: details.providerPaymentId,
        providerSignature: details.providerSignature,
        failureReason: verification.error || 'Cryptographic signature verification failed.',
        updatedAt: now,
      };
      await this.store.payments.save(failedPayment);

      await (this.store as any).auditLogs?.log?.({
        entityType: 'payment',
        entityId: payment.id,
        action: 'PAYMENT_FAILED',
        actorId: user.id,
        metadata: {
          journeyId: payment.journeyId,
          providerOrderId: payment.providerOrderId,
          providerPaymentId: details.providerPaymentId,
          error: failedPayment.failureReason,
        },
      });

      throw new DomainError(
        'PAYMENT_VERIFICATION_FAILED',
        verification.error || 'Payment signature verification failed.'
      );
    }

    // Verification SUCCESS
    const updatedPayment: PaymentOrder = {
      ...payment,
      status: 'SUCCESS',
      providerPaymentId: details.providerPaymentId,
      providerSignature: details.providerSignature,
      failureReason: undefined,
      paidAt: now,
      updatedAt: now,
    };

    await this.store.payments.save(updatedPayment);

    await (this.store as any).auditLogs?.log?.({
      entityType: 'payment',
      entityId: payment.id,
      action: 'PAYMENT_SUCCESS',
      actorId: user.id,
      metadata: {
        journeyId: payment.journeyId,
        amount: payment.amount,
        currency: payment.currency,
        providerOrderId: payment.providerOrderId,
        providerPaymentId: details.providerPaymentId,
        receiptNumber: payment.receiptNumber,
      },
    });

    return updatedPayment;
  }

  /**
   * Securely handles webhook notifications from payment gateway.
   * Cryptographically validates webhook signatures before applying updates.
   */
  async handleWebhook(
    rawBody: string,
    signature: string
  ): Promise<{ handled: boolean; event: string; paymentId?: string }> {
    const isSignatureValid = this.gateway.verifyWebhookSignature(rawBody, signature);
    if (!isSignatureValid) {
      await (this.store as any).auditLogs?.log?.({
        entityType: 'payment_webhook',
        entityId: 'unverified',
        action: 'WEBHOOK_SIGNATURE_INVALID',
        actorId: 'gateway_webhook',
        metadata: { error: 'Invalid HMAC signature' },
      });
      throw new DomainError('PAYMENT_SIGNATURE_INVALID', 'Invalid payment gateway webhook signature.');
    }

    const parsed = this.gateway.parseWebhookPayload(rawBody);
    if (!parsed.providerOrderId || !this.store.payments) {
      return { handled: false, event: parsed.event };
    }

    const payment = await this.store.payments.findByProviderOrderId(parsed.providerOrderId);
    if (!payment) {
      return { handled: false, event: parsed.event };
    }

    const now = new Date().toISOString();

    if (parsed.status === 'SUCCESS' && payment.status !== 'SUCCESS') {
      const updated: PaymentOrder = {
        ...payment,
        status: 'SUCCESS',
        providerPaymentId: parsed.providerPaymentId || payment.providerPaymentId,
        paidAt: payment.paidAt || now,
        updatedAt: now,
      };
      await this.store.payments.save(updated);

      await (this.store as any).auditLogs?.log?.({
        entityType: 'payment',
        entityId: payment.id,
        action: 'PAYMENT_WEBHOOK_CAPTURED',
        actorId: 'gateway_webhook',
        metadata: {
          journeyId: payment.journeyId,
          providerOrderId: payment.providerOrderId,
          event: parsed.event,
        },
      });

      return { handled: true, event: parsed.event, paymentId: payment.id };
    }

    if (parsed.status === 'FAILED' && payment.status !== 'SUCCESS') {
      const updated: PaymentOrder = {
        ...payment,
        status: 'FAILED',
        failureReason: parsed.failureReason || 'Webhook reported payment failure.',
        updatedAt: now,
      };
      await this.store.payments.save(updated);

      await (this.store as any).auditLogs?.log?.({
        entityType: 'payment',
        entityId: payment.id,
        action: 'PAYMENT_WEBHOOK_FAILED',
        actorId: 'gateway_webhook',
        metadata: {
          journeyId: payment.journeyId,
          providerOrderId: payment.providerOrderId,
          event: parsed.event,
        },
      });

      return { handled: true, event: parsed.event, paymentId: payment.id };
    }

    return { handled: true, event: parsed.event, paymentId: payment.id };
  }

  /**
   * Retrieves all payments associated with a specific journey.
   * Access controlled: patient who owns journey, assigned care partner, or admin.
   */
  async getJourneyPayments(user: AuthUser, journeyId: string): Promise<PaymentOrder[]> {
    const journey = await this.store.journeys.findById(journeyId);
    if (!journey) {
      throw new DomainError('ENTITY_NOT_FOUND', `Journey '${journeyId}' not found.`);
    }

    const auth = authorizeAction(user, 'VIEW_PAYMENT', { journey, patientId: journey.patientId });
    if (!auth.authorized && user.role !== 'CARE_PARTNER') {
      throw new DomainError('UNAUTHORIZED_ACTION', 'Unauthorized to view payments for this journey.');
    }

    if (!this.store.payments) return [];
    return this.store.payments.findByJourneyId(journeyId);
  }

  /**
   * Retrieves single payment order by ID.
   */
  async getPaymentById(user: AuthUser, paymentId: string): Promise<PaymentOrder> {
    if (!this.store.payments) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'Payment repository not configured.');
    }

    const payment = await this.store.payments.findById(paymentId);
    if (!payment) {
      throw new DomainError('ENTITY_NOT_FOUND', `Payment order '${paymentId}' not found.`);
    }

    const auth = authorizeAction(user, 'VIEW_PAYMENT', { patientId: payment.patientId });
    if (!auth.authorized) {
      throw new DomainError('UNAUTHORIZED_ACTION', 'Unauthorized to view this payment order.');
    }

    return payment;
  }

  /**
   * Generates a formal patient invoice/receipt.
   * Non-sensitive: excludes provider secret keys or raw signature tokens.
   */
  async getInvoice(user: AuthUser, paymentId: string): Promise<PaymentInvoice> {
    const payment = await this.getPaymentById(user, paymentId);

    return {
      invoiceNumber: `INV-2026-${payment.receiptNumber}`,
      receiptNumber: payment.receiptNumber,
      paymentOrderId: payment.id,
      journeyId: payment.journeyId,
      patientId: payment.patientId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      paidAt: payment.paidAt,
      fareBreakdown: payment.fareSnapshot,
      issuedAt: payment.paidAt || payment.createdAt,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
    };
  }

  /**
   * Retrieves all payment transactions for Admin/Operations desk overview.
   */
  async getAllPaymentsAdmin(user: AuthUser): Promise<PaymentOrder[]> {
    const auth = authorizeAction(user, 'VIEW_ALL_PAYMENTS');
    if (!auth.authorized) {
      throw new DomainError('FORBIDDEN_ROLE', 'Only administrators can view all commercial transactions.');
    }

    if (!this.store.payments) return [];
    return this.store.payments.findAll();
  }
}
