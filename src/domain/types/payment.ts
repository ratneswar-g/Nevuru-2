import { FareBreakdown } from './journey.ts';

export type PaymentStatus = 'CREATED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';

export type PaymentProviderType = 'RAZORPAY' | 'STRIPE' | 'MOCK_SANDBOX';

export interface PaymentOrder {
  id: string;
  journeyId: string;
  patientId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  idempotencyKey?: string;
  provider: PaymentProviderType;
  providerOrderId: string;
  providerPaymentId?: string;
  providerSignature?: string;
  failureReason?: string;
  receiptNumber: string;
  fareSnapshot: FareBreakdown;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
}

export interface PaymentGatewayConfig {
  provider: string;
  isProduction: boolean;
  isConfigured: boolean;
  keyId?: string;
}

export interface PaymentInvoice {
  invoiceNumber: string;
  receiptNumber: string;
  paymentOrderId: string;
  journeyId: string;
  patientId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paidAt?: string;
  fareBreakdown: FareBreakdown;
  issuedAt: string;
  provider: PaymentProviderType;
  providerPaymentId?: string;
}
