export interface PricingPolicy {
  version: string;
  currency: string;
  baseServiceFee: number;
  perDistanceRatePerKm: number;
  perAccompanimentRatePerHour: number;
  platformFee: number;
  taxRate: number;
  minimumFare: number;
  defaultEstimatedAccompanimentMinutes: number;
}

export interface FareCalculationInput {
  outboundDistanceMeters: number;
  returnDistanceMeters: number;
  estimatedAccompanimentMinutes: number;
  trafficMultiplier?: number;
  specialAssistanceFee?: number;
}
