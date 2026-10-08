import { IDomainStore } from '../domain/storage/repository.ts';
import { Journey, JourneyState } from '../domain/types/journey.ts';
import { resolveSmsOtpProvider, NotificationProvider } from '../server/auth/sms-provider.ts';
import { maskPhoneNumber } from '../server/auth/crypto-utils.ts';

export class NotificationService {
  private provider: NotificationProvider;
  private sentMilestones = new Set<string>(); // journeyId:state cache for idempotency / de-duplication

  constructor(private store: IDomainStore, notificationProvider?: NotificationProvider) {
    this.provider = notificationProvider || resolveSmsOtpProvider();
  }

  async notifyJourneyMilestone(
    journey: Journey,
    state: JourneyState,
    triggeredByUserId?: string
  ): Promise<number> {
    if (!this.provider || !this.provider.sendNotification) return 0;

    const dedupKey = `${journey.id}:${state}`;
    if (this.sentMilestones.has(dedupKey)) {
      return 0; // Prevent duplicate notifications for the same milestone event
    }
    this.sentMilestones.add(dedupKey);

    let notifiedCount = 0;
    const patient = await this.store.users.findById(journey.patientId);
    const patientName = patient?.name || 'Patient';
    const patientPhone = patient?.phone;

    const hospitalName = journey.hospitalDestination?.name || 'Hospital Destination';

    let message = '';
    switch (state) {
      case 'REQUESTED':
      case 'MATCHING':
        message = `[NERAVU] Your round-trip medical journey to ${hospitalName} has been confirmed and is matching with a verified Care Partner.`;
        break;
      case 'PARTNER_ASSIGNED':
        message = `[NERAVU] Care Partner assigned for your journey to ${hospitalName}. They will be en route shortly.`;
        break;
      case 'PARTNER_EN_ROUTE':
        message = `[NERAVU] Your Care Partner is now en route to your pickup location.`;
        break;
      case 'PARTNER_ARRIVED':
        message = `[NERAVU] Your Care Partner has arrived at your pickup location. Please have your pickup PIN ready.`;
        break;
      case 'PATIENT_PICKED_UP':
        message = `[NERAVU] Patient picked up successfully. Transit to ${hospitalName} is underway.`;
        break;
      case 'ARRIVED_AT_HOSPITAL':
        message = `[NERAVU] Journey arrived at ${hospitalName}. Hospital visit accompaniment in progress.`;
        break;
      case 'HOSPITAL_VISIT':
        message = `[NERAVU] Hospital visit in progress at ${hospitalName}.`;
        break;
      case 'RETURN_STARTED':
        message = `[NERAVU] Hospital visit concluded. Return transport home has started.`;
        break;
      case 'IN_TRANSIT_TO_HOME':
        message = `[NERAVU] Return journey in progress. Heading back to your home address.`;
        break;
      case 'PATIENT_RETURNED_HOME':
      case 'COMPLETED':
        message = `[NERAVU] You have been safely returned home. Your round-trip medical journey is now completed. Thank you for using Neravu.`;
        break;
      default:
        message = `[NERAVU] Journey status update: ${state}.`;
        break;
    }

    const referenceId = `notif_${journey.id}_${state}_${Date.now()}`;

    // 1. Notify Patient
    if (patientPhone) {
      try {
        await this.provider.sendNotification(patientPhone, message, referenceId);
        notifiedCount++;
      } catch (err) {
        console.warn(`[NotificationService] Failed to notify patient ${maskPhoneNumber(patientPhone)}:`, err);
      }
    }

    // 2. Notify Authorized Family / Trusted Contacts respecting permission level
    try {
      const patientProfile = await this.store.patientProfiles.findByUserId(journey.patientId);
      const trustedContacts = patientProfile?.trustedContacts || [];
      for (const contact of trustedContacts) {
        const contactPhone = contact.contactPhone || contact.phone;
        if (contactPhone) {
          const perm = contact.permissionLevel;
          // FULL_STATUS, FULL_ACCESS, or TRACKING_ONLY can receive general milestone updates
          if (perm === 'FULL_STATUS' || perm === 'FULL_ACCESS' || perm === 'TRACKING_ONLY') {
            try {
              const contactMsg = `[NERAVU UPDATE] Journey update for ${patientName} -> ${state}. Hospital: ${hospitalName}.`;
              await this.provider.sendNotification(contactPhone, contactMsg, `${referenceId}_fc_${contact.id}`);
              notifiedCount++;
            } catch (err) {
              console.warn(`[NotificationService] Failed to notify trusted contact ${maskPhoneNumber(contactPhone)}:`, err);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[NotificationService] Error notifying trusted contacts:`, err);
    }

    // 3. Notify Care Partner if assigned
    if (journey.carePartnerId) {
      const partnerUser = await this.store.users.findById(journey.carePartnerId);
      if (partnerUser?.phone) {
        try {
          const partnerMsg = `[NERAVU PARTNER] Journey ${journey.id} updated to ${state}. Destination: ${hospitalName}.`;
          await this.provider.sendNotification(partnerUser.phone, partnerMsg, `${referenceId}_cp`);
          notifiedCount++;
        } catch (err) {
          console.warn(`[NotificationService] Failed to notify care partner:`, err);
        }
      }
    }

    // Audit log
    if ((this.store as any).auditLogs) {
      await (this.store as any).auditLogs.log({
        entityType: 'notification',
        entityId: journey.id,
        action: 'MILESTONE_NOTIFICATION_DISPATCHED',
        actorId: triggeredByUserId || 'system',
        metadata: {
          journeyId: journey.id,
          state,
          notifiedCount,
          referenceId,
        },
      });
    }

    return notifiedCount;
  }
}
