import { Router, Request, Response } from 'express';
import { requireAuth } from './auth-middleware.ts';
import { PaymentService } from '../../services/payment-service.ts';
import { DomainError } from '../../domain/types/errors.ts';
import { AuthUser } from '../../auth/types.ts';

export function createPaymentRoutes(paymentService: PaymentService): Router {
  const router = Router();

  // 1. Get Payment Gateway Public Configuration (Safe, No secrets)
  router.get('/config', (_req: Request, res: Response) => {
    try {
      const config = paymentService.getGatewayConfig();
      res.json({ success: true, config });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve gateway configuration.' });
    }
  });

  // 2. Create Payment Order for Journey (Server-authoritative amount)
  router.post('/orders', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      const { journeyId, idempotencyKey } = req.body;

      if (!journeyId) {
        res.status(400).json({ error: 'INVALID_DATA', message: 'journeyId is required to create a payment order.' });
        return;
      }

      const clientKey = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string) || idempotencyKey;

      const payment = await paymentService.createPaymentOrder(user, journeyId, {
        idempotencyKey: clientKey,
      });

      res.status(201).json({ success: true, payment });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const status =
          err.code === 'ENTITY_NOT_FOUND'
            ? 404
            : err.code === 'UNAUTHORIZED_ACTION' || err.code === 'FORBIDDEN_ROLE'
            ? 403
            : err.code === 'PAYMENT_ALREADY_COMPLETED'
            ? 409
            : 400;
        res.status(status).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create payment order.' });
      }
    }
  });

  // 3. Confirm Payment Transaction (Cryptographic signature validation)
  router.post('/orders/:id/confirm', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      const { id } = req.params;
      const { providerPaymentId, providerSignature } = req.body;

      if (!providerPaymentId || !providerSignature) {
        res.status(400).json({
          error: 'INVALID_DATA',
          message: 'providerPaymentId and providerSignature are required to confirm payment.',
        });
        return;
      }

      const payment = await paymentService.confirmPayment(user, id, {
        providerPaymentId,
        providerSignature,
      });

      res.json({ success: true, payment });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const status =
          err.code === 'ENTITY_NOT_FOUND'
            ? 404
            : err.code === 'UNAUTHORIZED_ACTION' || err.code === 'FORBIDDEN_ROLE'
            ? 403
            : 400;
        res.status(status).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to confirm payment.' });
      }
    }
  });

  // 4. Get Payment Order by ID
  router.get('/orders/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      const { id } = req.params;
      const payment = await paymentService.getPaymentById(user, id);
      res.json({ success: true, payment });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const status = err.code === 'ENTITY_NOT_FOUND' ? 404 : 403;
        res.status(status).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve payment order.' });
      }
    }
  });

  // 5. Get Official Patient Invoice / Receipt
  router.get('/orders/:id/invoice', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      const { id } = req.params;
      const invoice = await paymentService.getInvoice(user, id);
      res.json({ success: true, invoice });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const status = err.code === 'ENTITY_NOT_FOUND' ? 404 : 403;
        res.status(status).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve invoice.' });
      }
    }
  });

  // 6. Get All Payments for Journey
  router.get('/journey/:journeyId', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      const { journeyId } = req.params;
      const payments = await paymentService.getJourneyPayments(user, journeyId);
      res.json({ success: true, payments });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const status = err.code === 'ENTITY_NOT_FOUND' ? 404 : 403;
        res.status(status).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve journey payments.' });
      }
    }
  });

  // 7. Admin Overview of All Payments
  router.get('/admin/all', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as AuthUser;
      const payments = await paymentService.getAllPaymentsAdmin(user);
      res.json({ success: true, payments });
    } catch (err: any) {
      if (err instanceof DomainError) {
        res.status(403).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve all payments.' });
      }
    }
  });

  // 8. Payment Gateway Webhook Endpoint
  router.post('/webhook', async (req: Request, res: Response) => {
    try {
      const signature =
        (req.headers['x-razorpay-signature'] as string) ||
        (req.headers['x-hub-signature-256'] as string) ||
        (req.headers['x-payment-signature'] as string) ||
        '';

      const rawBody = (req as any).rawBody || JSON.stringify(req.body);

      const result = await paymentService.handleWebhook(rawBody, signature);
      res.json({ success: true, ...result });
    } catch (err: any) {
      if (err instanceof DomainError && err.code === 'PAYMENT_SIGNATURE_INVALID') {
        res.status(400).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Webhook processing failed.' });
      }
    }
  });

  return router;
}
