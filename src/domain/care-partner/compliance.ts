import {
  CarePartnerProfile,
  ComplianceDocument,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  CarePartnerComplianceSummary,
  MANDATORY_COMPLIANCE_DOCUMENTS,
} from '../types/care-partner.ts';

/**
 * Checks whether a compliance document has reached or passed its expiration date.
 */
export function isDocumentExpired(doc: ComplianceDocument, referenceDate?: Date): boolean {
  if (!doc.expiryDate) return false;
  const expiryTime = new Date(doc.expiryDate).getTime();
  if (isNaN(expiryTime)) return true;
  const refTime = referenceDate ? referenceDate.getTime() : Date.now();
  return expiryTime < refTime;
}

/**
 * Resolves the effective status of a document, marking it EXPIRED if past expiry date.
 */
export function getEffectiveDocumentStatus(
  doc: ComplianceDocument,
  referenceDate?: Date
): ComplianceDocumentStatus {
  if (isDocumentExpired(doc, referenceDate)) {
    return 'EXPIRED';
  }
  return doc.status;
}

/**
 * Validates document input format and dates.
 */
export function validateComplianceDocumentInput(
  input: Partial<ComplianceDocument>
): { valid: boolean; error?: string } {
  if (!input.type || !MANDATORY_COMPLIANCE_DOCUMENTS.includes(input.type as ComplianceDocumentType)) {
    return {
      valid: false,
      error: `Invalid document type. Allowed types: ${MANDATORY_COMPLIANCE_DOCUMENTS.join(', ')}`,
    };
  }

  if (!input.documentNumber || typeof input.documentNumber !== 'string' || input.documentNumber.trim().length < 3) {
    return {
      valid: false,
      error: 'Document number/reference must be at least 3 characters.',
    };
  }

  if (!input.expiryDate || typeof input.expiryDate !== 'string') {
    return {
      valid: false,
      error: 'Valid expiry date (YYYY-MM-DD or ISO string) is required.',
    };
  }

  const expiryTime = new Date(input.expiryDate).getTime();
  if (isNaN(expiryTime)) {
    return {
      valid: false,
      error: 'Invalid expiry date format.',
    };
  }

  if (input.issueDate) {
    const issueTime = new Date(input.issueDate).getTime();
    if (isNaN(issueTime)) {
      return {
        valid: false,
        error: 'Invalid issue date format.',
      };
    }
    if (issueTime > expiryTime) {
      return {
        valid: false,
        error: 'Issue date cannot be later than expiry date.',
      };
    }
  }

  return { valid: true };
}

/**
 * Evaluates the full compliance summary for a Care Partner profile.
 */
export function evaluateCarePartnerCompliance(
  profile: CarePartnerProfile,
  referenceDate?: Date
): CarePartnerComplianceSummary {
  const docs = profile.documents || [];
  const processedDocs: ComplianceDocument[] = docs.map((d) => ({
    ...d,
    status: getEffectiveDocumentStatus(d, referenceDate),
  }));

  const missingDocumentTypes: ComplianceDocumentType[] = [];
  const expiredDocumentTypes: ComplianceDocumentType[] = [];
  const pendingDocumentTypes: ComplianceDocumentType[] = [];
  const rejectedDocumentTypes: ComplianceDocumentType[] = [];

  for (const requiredType of MANDATORY_COMPLIANCE_DOCUMENTS) {
    const doc = processedDocs.find((d) => d.type === requiredType);
    if (!doc) {
      missingDocumentTypes.push(requiredType);
      continue;
    }

    if (doc.status === 'EXPIRED') {
      expiredDocumentTypes.push(requiredType);
    } else if (doc.status === 'PENDING') {
      pendingDocumentTypes.push(requiredType);
    } else if (doc.status === 'REJECTED') {
      rejectedDocumentTypes.push(requiredType);
    }
  }

  const isCompliant =
    missingDocumentTypes.length === 0 &&
    expiredDocumentTypes.length === 0 &&
    pendingDocumentTypes.length === 0 &&
    rejectedDocumentTypes.length === 0 &&
    profile.verificationStatus === 'VERIFIED';

  let overallStatus: 'COMPLIANT' | 'NON_COMPLIANT' | 'PENDING_REVIEW' = 'PENDING_REVIEW';
  if (isCompliant) {
    overallStatus = 'COMPLIANT';
  } else if (expiredDocumentTypes.length > 0 || rejectedDocumentTypes.length > 0) {
    overallStatus = 'NON_COMPLIANT';
  }

  return {
    carePartnerId: profile.userId,
    isCompliant,
    overallStatus,
    missingDocumentTypes,
    expiredDocumentTypes,
    pendingDocumentTypes,
    rejectedDocumentTypes,
    documents: processedDocs,
  };
}
