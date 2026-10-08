// @ts-nocheck
import { DomainError } from "../../domain/types/errors.ts";
import { maskPhoneNumber } from "./crypto-utils.ts";

export interface NotificationProvider {
  providerName: string;
  isProductionProvider: boolean;
  sendNotification?(phoneNumber: string, message: string, referenceId: string): Promise<{ delivered: boolean; providerName: string; messageId: string }>;
  sendOtp?(phoneNumber: string, code: string, referenceId: string): Promise<{ delivered: boolean; providerName: string; messageId: string }>;
}

class DevelopmentConsoleOtpProvider implements NotificationProvider {
  public providerName = "DevelopmentConsoleOtpProvider";
  public isProductionProvider = false;

  static outboxByPhone = new Map();
  static outboxByReference = new Map();

  async sendOtp(phoneNumber: string, code: string, referenceId: string) {
    if (process.env.NODE_ENV === "production") {
      throw new DomainError(
        "STORAGE_UNAVAILABLE",
        "DevelopmentConsoleOtpProvider is strictly forbidden in production mode. A real SMS provider must be configured."
      );
    }
    const record = { phoneNumber, code, referenceId, dispatchedAt: new Date().toISOString() };
    DevelopmentConsoleOtpProvider.outboxByPhone.set(phoneNumber, record);
    DevelopmentConsoleOtpProvider.outboxByReference.set(referenceId, record);
    return { delivered: true, providerName: this.providerName, messageId: `dev-sms-${referenceId}` };
  }

  async sendNotification(phoneNumber: string, message: string, referenceId: string) {
    if (process.env.NODE_ENV === "production") {
      throw new DomainError(
        "STORAGE_UNAVAILABLE",
        "DevelopmentConsoleOtpProvider is strictly forbidden in production mode. A real SMS provider must be configured."
      );
    }
    const record = { phoneNumber, message, referenceId, dispatchedAt: new Date().toISOString() };
    DevelopmentConsoleOtpProvider.outboxByPhone.set(phoneNumber, record);
    DevelopmentConsoleOtpProvider.outboxByReference.set(referenceId, record);
    return { delivered: true, providerName: this.providerName, messageId: `dev-notif-${referenceId}` };
  }

  static getLastOtpForPhone(phoneNumber: string) {
    if (process.env.NODE_ENV === "production") return null;
    return DevelopmentConsoleOtpProvider.outboxByPhone.get(phoneNumber)?.code || null;
  }

  static getLastNotificationForPhone(phoneNumber: string) {
    if (process.env.NODE_ENV === "production") return null;
    return DevelopmentConsoleOtpProvider.outboxByPhone.get(phoneNumber)?.message || null;
  }

  static getLastOtpForReference(referenceId: string) {
    if (process.env.NODE_ENV === "production") return null;
    return DevelopmentConsoleOtpProvider.outboxByReference.get(referenceId)?.code || null;
  }

  static clearOutbox() {
    DevelopmentConsoleOtpProvider.outboxByPhone.clear();
    DevelopmentConsoleOtpProvider.outboxByReference.clear();
  }
}

class ConfiguredProductionSmsProvider implements NotificationProvider {
  public providerName: string;
  public isProductionProvider = true;
  private gatewayUrl: string;
  private apiKey: string;

  constructor(options: { gatewayUrl: string; apiKey: string; providerName?: string }) {
    if (!options.gatewayUrl || !options.apiKey) {
      throw new Error("Production SMS provider requires both gatewayUrl and apiKey.");
    }
    this.providerName = options.providerName || "ConfiguredProductionSmsProvider";
    this.gatewayUrl = options.gatewayUrl;
    this.apiKey = options.apiKey;
  }

  async sendOtp(phoneNumber: string, code: string, referenceId: string) {
    const res = await fetch(this.gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        to: phoneNumber,
        message: `Your Neravu verification code is ${code}. Valid for 5 minutes. Do not share this code.`,
        referenceId,
      }),
    });
    if (!res.ok) {
      throw new Error(`SMS gateway error (${res.status}) for recipient ${maskPhoneNumber(phoneNumber)}`);
    }
    return { delivered: true, providerName: this.providerName, messageId: `prod-sms-${referenceId}` };
  }

  async sendNotification(phoneNumber: string, message: string, referenceId: string) {
    const res = await fetch(this.gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ to: phoneNumber, message, referenceId }),
    });
    if (!res.ok) {
      throw new Error(`SMS gateway error (${res.status}) for recipient ${maskPhoneNumber(phoneNumber)}`);
    }
    return { delivered: true, providerName: this.providerName, messageId: `prod-notif-${referenceId}` };
  }
}

function resolveSmsOtpProvider(customProvider?: any) {
  const isProduction = process.env.NODE_ENV === "production";
  if (customProvider) {
    if (isProduction && !customProvider.isProductionProvider) {
      return null;
    }
    return customProvider;
  }
  if (process.env.SMS_PROVIDER_URL && process.env.SMS_PROVIDER_API_KEY) {
    return new ConfiguredProductionSmsProvider({
      gatewayUrl: process.env.SMS_PROVIDER_URL,
      apiKey: process.env.SMS_PROVIDER_API_KEY,
      providerName: process.env.SMS_PROVIDER_NAME || "ProductionSmsGateway",
    });
  }
  if (isProduction) {
    return null;
  }
  return new DevelopmentConsoleOtpProvider();
}

export { ConfiguredProductionSmsProvider, DevelopmentConsoleOtpProvider, resolveSmsOtpProvider };

