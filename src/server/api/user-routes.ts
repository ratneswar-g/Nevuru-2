import { Router, Request, Response } from 'express';
import { requireAuth } from './auth-middleware.ts';
import { authorizeAction } from '../../auth/authorization.ts';
import { DomainError } from '../../domain/types/errors.ts';
import { JourneyService } from '../../services/journey-service.ts';
import { AuthUser } from '../../auth/types.ts';

export function createUserRoutes(journeyService: JourneyService): Router {
  const router = Router();

  // 1. Current authenticated user profile
  router.get('/me', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      let profile: any = null;
      if (user.role === 'PATIENT') {
        profile = await journeyService.getPatientProfile(user.id);
      } else if (user.role === 'CARE_PARTNER') {
        profile = await journeyService.getCarePartnerProfile(user.id);
      }
      res.json({ success: true, user, profile });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve user profile' });
    }
  });

  // 2. Patient profile (IDOR protected)
  router.get('/patient/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      const { id } = req.params;
      const profile = await journeyService.getPatientProfile(id);

      if (!profile) {
        res.status(404).json({ error: 'ENTITY_NOT_FOUND', message: `Patient profile '${id}' not found` });
        return;
      }

      const auth = authorizeAction(user, 'VIEW_PATIENT_PROFILE', {
        patientId: id,
        trustedContacts: profile.trustedContacts,
      });

      let partnerAuthorized = false;
      if (!auth.authorized && user.role === 'CARE_PARTNER') {
        const journeys = await journeyService.getAllJourneys();
        const hasActiveJourneyWithPatient = journeys.some(
          (j) =>
            j.patientId === id &&
            j.carePartnerId === user.id &&
            j.currentState !== 'COMPLETED' &&
            j.currentState !== 'CANCELLED'
        );
        if (hasActiveJourneyWithPatient) {
          partnerAuthorized = true;
        }
      }

      let familyAuthorized = false;
      if (!auth.authorized && user.role === 'FAMILY_CONTACT') {
        const isTrusted = profile.trustedContacts?.some((c) => c.contactUserId === user.id);
        if (isTrusted) {
          familyAuthorized = true;
        }
      }

      if (!auth.authorized && !partnerAuthorized && !familyAuthorized) {
        res.status(403).json({
          error: 'IDOR_VIOLATION',
          message: 'You are not authorized to view this patient profile',
        });
        return;
      }

      res.json({ success: true, profile });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve patient profile' });
    }
  });

  // 3. Care Partner profile (with strict patient privacy: documents sanitized for non-admin/non-owner)
  router.get('/care-partner/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      const { id } = req.params;
      const profile = await journeyService.getCarePartnerProfile(id);

      if (!profile) {
        res.status(404).json({ error: 'ENTITY_NOT_FOUND', message: `Care partner profile '${id}' not found` });
        return;
      }

      // PRIVACY INVARIANT:
      // Patients and unauthorized third parties MUST NOT see sensitive Care Partner documents (DL, insurance, FC numbers)
      const isPrivileged = user.role === 'ADMIN' || (user.role === 'CARE_PARTNER' && user.id === id);
      const sanitizedProfile = isPrivileged
        ? profile
        : {
            userId: profile.userId,
            verificationStatus: profile.verificationStatus,
            availabilityStatus: profile.availabilityStatus,
            vehicle: profile.vehicle,
            ratingAverage: profile.ratingAverage,
            totalJourneysCompleted: profile.totalJourneysCompleted,
            firstAidCertified: profile.firstAidCertified,
            backgroundCheckVerifiedDate: profile.backgroundCheckVerifiedDate,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
            // documents intentionally omitted
          };

      res.json({ success: true, profile: sanitizedProfile });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve care partner profile' });
    }
  });

  // 4. Care Partner compliance summary (Admin or owner only)
  router.get('/care-partner/:id/compliance', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      const { id } = req.params;

      if (user.role !== 'ADMIN' && !(user.role === 'CARE_PARTNER' && user.id === id)) {
        res.status(403).json({
          error: 'FORBIDDEN_ROLE',
          message: 'You are not authorized to view compliance documents for this Care Partner.',
        });
        return;
      }

      const summary = await journeyService.getCarePartnerComplianceSummary(user, id);
      res.json({ success: true, compliance: summary });
    } catch (err: any) {
      if (err instanceof DomainError) {
        res.status(err.code === 'ENTITY_NOT_FOUND' ? 404 : 403).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve compliance summary' });
      }
    }
  });

  // 5. Submit or update compliance document (Admin or owner only)
  router.post('/care-partner/:id/documents', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      const { id } = req.params;

      if (user.role !== 'ADMIN' && !(user.role === 'CARE_PARTNER' && user.id === id)) {
        res.status(403).json({
          error: 'FORBIDDEN_ROLE',
          message: 'You are not authorized to submit compliance documents for this Care Partner.',
        });
        return;
      }

      const result = await journeyService.submitComplianceDocument(user, id, req.body);
      res.status(201).json({ success: true, document: result.document, summary: result.summary });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const status = err.code === 'ENTITY_NOT_FOUND' ? 404 : err.code === 'UNAUTHORIZED_ACCESS' ? 403 : 400;
        res.status(status).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to submit compliance document' });
      }
    }
  });

  // 6. Review and verify or reject compliance document (Admin only)
  router.put('/care-partner/:id/documents/:docId/verify', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      const { id, docId } = req.params;

      if (user.role !== 'ADMIN') {
        res.status(403).json({
          error: 'FORBIDDEN_ROLE',
          message: 'Only administrators can review and verify compliance documents.',
        });
        return;
      }

      const result = await journeyService.reviewComplianceDocument(user, id, docId, req.body);
      res.json({ success: true, document: result.document, summary: result.summary });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const status = err.code === 'ENTITY_NOT_FOUND' ? 404 : err.code === 'FORBIDDEN_ROLE' ? 403 : 400;
        res.status(status).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to review compliance document' });
      }
    }
  });

  // 7. Get compliance overview for all Care Partners (Admin only)
  router.get('/care-partners/compliance', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      if (user.role !== 'ADMIN') {
        res.status(403).json({
          error: 'FORBIDDEN_ROLE',
          message: 'Only administrators can view compliance overviews.',
        });
        return;
      }

      const summaries = await journeyService.getAllCarePartnerComplianceSummaries(user);
      res.json({ success: true, carePartners: summaries });
    } catch (err: any) {
      if (err instanceof DomainError) {
        res.status(403).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve compliance overviews' });
      }
    }
  });

  // 8. Care Partner update availability
  router.put('/care-partner/availability', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      if (user.role !== 'CARE_PARTNER') {
        res.status(403).json({
          error: 'FORBIDDEN_ROLE',
          message: 'Only Care Partners can update availability status',
        });
        return;
      }

      const { status } = req.body;
      if (status !== 'AVAILABLE' && status !== 'OFFLINE') {
        res.status(400).json({
          error: 'INVALID_DATA',
          message: "Availability status must be 'AVAILABLE' or 'OFFLINE'",
        });
        return;
      }

      const updated = await journeyService.setPartnerAvailability(user, status);
      res.json({ success: true, profile: updated });
    } catch (err: any) {
      if (err instanceof DomainError) {
        res.status(400).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to update availability status' });
      }
    }
  });

  return router;
}
