// @ts-nocheck
import { Router } from "express";
import { requireAuth } from "./auth-middleware.ts";
import { authorizeAction, getFamilyAccessScope } from "../../auth/authorization.ts";
import { DomainError } from "../../domain/types/errors.ts";

function createJourneyRoutes(journeyService) {
  const router = Router();

  router.get("/", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const statusFilter = req.query.status;
      let journeys = await journeyService.getAllJourneys();

      if (user.role === "PATIENT") {
        journeys = journeys.filter(j => j.patientId === user.id);
      } else if (user.role === "CARE_PARTNER") {
        if (statusFilter === "MATCHING") {
          journeys = journeys.filter(j => j.currentState === "MATCHING");
        } else {
          journeys = journeys.filter(j => j.carePartnerId === user.id || j.currentState === "MATCHING");
        }
      } else if (user.role === "FAMILY_CONTACT") {
        const profilesRepo = journeyService.store.patientProfiles;
        const profiles = typeof profilesRepo.findAll === "function" ? await profilesRepo.findAll() : [];
        const authorizedPatientIds = profiles
          .filter(p => p.trustedContacts?.some(c => c.contactUserId === user.id))
          .map(p => p.userId);
        journeys = journeys.filter(j => authorizedPatientIds.includes(j.patientId));
      }

      if (statusFilter && user.role !== "CARE_PARTNER") {
        journeys = journeys.filter(j => j.currentState === statusFilter);
      }

      // Redact pickup PIN from Care Partner before verification and from Family Contacts
      journeys = journeys.map(j => {
        if (user.role === "CARE_PARTNER" && !j.pickupPinVerified) {
          const { pickupPin, ...rest } = j;
          return rest;
        }
        if (user.role === "FAMILY_CONTACT") {
          const { pickupPin, ...rest } = j;
          return rest;
        }
        return j;
      });

      res.json({ success: true, count: journeys.length, journeys });
    } catch (err) {
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to retrieve journeys" });
    }
  });

  router.get("/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const { id } = req.params;
      const journey = await journeyService.getJourneyById(id);
      if (!journey) {
        res.status(404).json({ error: "ENTITY_NOT_FOUND", message: `Journey '${id}' not found` });
        return;
      }

      const patientProfile = await journeyService.getPatientProfile(journey.patientId);
      const auth = authorizeAction(user, "VIEW_JOURNEY", { journey, trustedContacts: patientProfile?.trustedContacts });
      if (!auth.authorized) {
        res.status(403).json({ error: auth.code || "IDOR_VIOLATION", message: auth.reason || "You are not authorized to view this journey" });
        return;
      }

      if (user.role === "FAMILY_CONTACT") {
        const trustedContacts = patientProfile?.trustedContacts || [];
        const scope = getFamilyAccessScope(user, journey, trustedContacts);
        if (scope.permissionLevel === "EMERGENCY_ONLY") {
          const redacted = {
            id: journey.id,
            patientId: journey.patientId,
            currentState: journey.currentState,
            bookingType: journey.bookingType,
            emergencyLogs: journey.emergencyLogs,
            isEmergencyActive: journey.currentState === "EMERGENCY_ACTIVE",
            permissionLevel: "EMERGENCY_ONLY",
            pickupLocation: journey.currentState === "EMERGENCY_ACTIVE" ? journey.pickupLocation : void 0,
            hospitalDestination: journey.currentState === "EMERGENCY_ACTIVE" ? journey.hospitalDestination : void 0,
            specialAssistanceNotes: void 0,
            initialFareEstimate: void 0,
            fareEstimate: void 0,
          };
          res.json({ success: true, journey: redacted, scope });
          return;
        } else if (scope.permissionLevel === "LIVE_LOCATION") {
          const redacted = {
            ...journey,
            specialAssistanceNotes: void 0,
            initialFareEstimate: void 0,
            fareEstimate: void 0,
            permissionLevel: "LIVE_LOCATION",
            pickupPin: void 0,
          };
          res.json({ success: true, journey: redacted, scope });
          return;
        }
      }

      const responseJourney = { ...journey };
      // Redact pickup PIN from Care Partner before verification
      if (user.role === "CARE_PARTNER" && !responseJourney.pickupPinVerified) {
        delete responseJourney.pickupPin;
      }
      if (user.role === "FAMILY_CONTACT") {
        delete responseJourney.pickupPin;
      }

      // Handle live location staleness & termination in single journey view
      if (responseJourney.liveLocation) {
        if (["COMPLETED", "CANCELLED", "PARTNER_CANCELLED"].includes(responseJourney.currentState)) {
          responseJourney.liveLocation = null;
        } else {
          const ageMs = Date.now() - new Date(responseJourney.liveLocation.updatedAt).getTime();
          responseJourney.liveLocation = {
            ...responseJourney.liveLocation,
            isStale: ageMs > 60 * 1000,
          };
        }
      }

      res.json({ success: true, journey: responseJourney });
    } catch (err) {
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to retrieve journey" });
    }
  });

  router.post("/", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const idempotencyKey =
        req.headers["idempotency-key"]?.trim() ||
        req.headers["x-idempotency-key"]?.trim() ||
        (typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey.trim() : void 0);

      const { pickupLocation, hospitalDestination, returnDropoffLocation, bookingType, specialAssistanceNotes } = req.body;
      if (!pickupLocation || !hospitalDestination) {
        res.status(400).json({ error: "INVALID_DATA", message: "Both pickupLocation and hospitalDestination are required" });
        return;
      }

      const auth = authorizeAction(user, "CREATE_JOURNEY");
      if (!auth.authorized) {
        res.status(403).json({ error: auth.code || "UNAUTHORIZED_ACTION", message: auth.reason });
        return;
      }

      const result = await journeyService.createBookingWithIdempotency(
        user,
        {
          pickupLocation,
          hospitalDestination,
          returnDropoffLocation,
          bookingType: bookingType || "ON_DEMAND",
          specialAssistanceNotes,
        },
        idempotencyKey
      );

      if (result.isIdempotentReplay) {
        res.status(200).json({ success: true, journey: result.journey, isIdempotentReplay: true });
        return;
      }

      res.status(201).json({ success: true, journey: result.journey });
    } catch (err) {
      if (err instanceof DomainError) {
        if (err.code === "ACTIVE_JOURNEY_EXISTS") {
          res.status(409).json({ error: "ACTIVE_JOURNEY_EXISTS", message: err.message });
          return;
        }
        res.status(400).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: "PERSISTENCE_ERROR", message: "Failed to create journey" });
      }
    }
  });

  router.post("/:id/accept", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const { id } = req.params;
      const updated = await journeyService.acceptJourney(user, id);
      const resJourney = { ...updated };
      if (!resJourney.pickupPinVerified) {
        delete resJourney.pickupPin;
      }
      res.json({ success: true, journey: resJourney });
    } catch (err) {
      if (err instanceof DomainError) {
        const statusCode = err.code === "UNAUTHORIZED_TRANSITION" ? 403 : 400;
        res.status(statusCode).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to accept journey" });
      }
    }
  });

  router.post("/:id/verify-pickup-pin", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const { id } = req.params;
      const { pin } = req.body;
      if (!pin || typeof pin !== "string") {
        res.status(400).json({ error: "INVALID_DATA", message: "4-digit pickup PIN is required." });
        return;
      }
      const updated = await journeyService.verifyPickupPin(user, id, pin);
      res.json({ success: true, verified: true, journey: updated });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const statusCode =
          err.code === "UNAUTHORIZED_ACTION" || err.code === "UNAUTHORIZED_TRANSITION"
            ? 403
            : err.code === "PICKUP_PIN_RATE_LIMITED"
            ? 429
            : 400;
        res.status(statusCode).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to verify pickup PIN" });
      }
    }
  });

  router.post("/:id/location", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const { id } = req.params;
      const { latitude, longitude, heading, speed, accuracy } = req.body;
      if (typeof latitude !== "number" || typeof longitude !== "number") {
        res.status(400).json({
          error: "INVALID_DATA",
          message: "latitude and longitude are required numbers.",
        });
        return;
      }
      const liveLocation = await journeyService.updateLiveLocation(user, id, {
        latitude,
        longitude,
        heading,
        speed,
        accuracy,
      });
      res.json({ success: true, liveLocation });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const statusCode =
          err.code === "UNAUTHORIZED_ACTION"
            ? 403
            : err.code === "INVALID_STATE_FOR_LOCATION_TRACKING" || err.code === "BOOKING_ALREADY_TERMINATED"
            ? 409
            : 400;
        res.status(statusCode).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to update location" });
      }
    }
  });

  router.get("/:id/location", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const { id } = req.params;
      const result = await journeyService.getLiveLocation(user, id);
      res.json({ success: true, ...result });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const statusCode =
          err.code === "UNAUTHORIZED_ACTION"
            ? 403
            : err.code === "ENTITY_NOT_FOUND"
            ? 404
            : 400;
        res.status(statusCode).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to get live location" });
      }
    }
  });

  router.put("/:id/milestones", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const { id } = req.params;
      const { targetState, metadata, pin } = req.body;
      if (!targetState) {
        res.status(400).json({ error: "INVALID_DATA", message: "targetState is required" });
        return;
      }

      if (targetState === "PARTNER_ASSIGNED") {
        const updated2 = await journeyService.acceptJourney(user, id);
        res.json({ success: true, journey: updated2 });
        return;
      }

      // If pin is provided for PATIENT_PICKED_UP, verify through verifyPickupPin
      const pinValue = pin || (typeof metadata === "object" ? metadata?.pin : void 0);
      if (targetState === "PATIENT_PICKED_UP" && pinValue) {
        const updated = await journeyService.verifyPickupPin(user, id, String(pinValue));
        res.json({ success: true, journey: updated });
        return;
      }

      const note = typeof metadata === "object" && metadata?.note ? String(metadata.note) : void 0;
      const updated = await journeyService.advanceMilestone(user, id, targetState, note, typeof metadata === "object" ? metadata : void 0);
      res.json({ success: true, journey: updated });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const statusCode =
          err.code === "UNAUTHORIZED_TRANSITION" || err.code === "UNAUTHORIZED_ACTION"
            ? 403
            : err.code === "PICKUP_PIN_RATE_LIMITED"
            ? 429
            : 400;
        res.status(statusCode).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to update milestone" });
      }
    }
  });

  router.post("/:id/emergency", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const { id } = req.params;
      const { category, reason, locationSnapshot } = req.body;
      const updated = await journeyService.triggerEmergency(user, id, { category, reason, locationSnapshot });
      res.json({ success: true, journey: updated });
    } catch (err) {
      if (err instanceof DomainError) {
        res.status(400).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to trigger emergency" });
      }
    }
  });

  router.post("/:id/emergency/resolve", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const { id } = req.params;
      const { operationalResolutionNotes } = req.body;
      if (!operationalResolutionNotes || typeof operationalResolutionNotes !== "string") {
        res.status(400).json({ error: "INVALID_DATA", message: "Operational resolution notes are required to resolve emergency" });
        return;
      }
      const updated = await journeyService.resolveEmergency(user, id, operationalResolutionNotes);
      res.json({ success: true, journey: updated });
    } catch (err) {
      if (err instanceof DomainError) {
        const statusCode = err.code === "UNAUTHORIZED_ACTION" || err.code === "UNAUTHORIZED_TRANSITION" ? 403 : 400;
        res.status(statusCode).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to resolve emergency" });
      }
    }
  });

  return router;
}

export { createJourneyRoutes };
