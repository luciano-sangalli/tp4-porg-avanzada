import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentSessionDto } from './dto/payment-session.dto';

@Injectable()
export class PaymentsService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(PaymentsService.name);

  constructor() {
    const stripeSecret = process.env.STRIPE_SECRET;
    if (!stripeSecret) {
      throw new Error('STRIPE_SECRET no está configurado');
    }
    this.stripe = new Stripe(stripeSecret);
  }

  async createPaymentSession(paymentSessionDto: PaymentSessionDto) {
    const { orderId, currency, items } = paymentSessionDto;

    const line_items = items.map((item) => ({
      price_data: {
        currency: currency.toLowerCase(),
        product_data: {
          name: item.name,
        },
        unit_amount: Math.round(item.price * 100), // Stripe trabaja en centavos
      },
      quantity: item.quantity,
    }));

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      payment_intent_data: {
        metadata: {
          orderId, // Guarda el orderId para recuperarlo en el webhook
        },
      },
      success_url: process.env.STRIPE_SUCCESS_URL || 'http://localhost:3003/payments/success',
      cancel_url: process.env.STRIPE_CANCEL_URL || 'http://localhost:3003/payments/cancel',
    });

    return {
      id: session.id,
      url: session.url,
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string) {
    const endpointSecret = process.env.STRIPE_ENDPOINT_SECRET;
    if (!endpointSecret) {
      throw new Error('STRIPE_ENDPOINT_SECRET no está configurado');
    }

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        endpointSecret,
      );
    } catch (err: any) {
      this.logger.error(`Error verificando firma: ${err.message}`);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case 'charge.succeeded': {
        const charge = event.data.object as Stripe.Charge;
        const orderId = charge.metadata?.orderId;
        this.logger.log(`Cobro exitoso para la orden: ${orderId}`);
        break;
      }
      default:
        this.logger.log(`Evento no manejado: ${event.type}`);
        break;
    }

    return { received: true };
  }
}