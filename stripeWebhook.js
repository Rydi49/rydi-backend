/**
 * STRIPE WEBHOOK HANDLER
 * 
 * This endpoint receives events directly from Stripe when a payment succeeds.
 * It is the ONLY authoritative way to confirm a payment — not the frontend.
 * 
 * STRIPE DASHBOARD SETUP:
 * 1. Go to https://dashboard.stripe.com/webhooks
 * 2. Click "Add endpoint"
 * 3. Endpoint URL: https://rydi-api.onrender.com/api/stripe/webhook
 * 4. Select events: payment_intent.succeeded
 * 5. Copy the "Signing secret" (whsec_...)
 * 6. Add to Render environment: STRIPE_WEBHOOK_SECRET=whsec_...
 */

// ============ STRIPE WEBHOOK (raw body needed for signature verification) ============
// NOTE: This must be placed BEFORE express.json() middleware, or the raw body will be parsed
// The actual endpoint is registered at the TOP of server.js before app.use(express.json())

const stripeWebhookHandler = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!endpointSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object;
      const bookingId = paymentIntent.metadata?.bookingId;
      const bikeId = paymentIntent.metadata?.bikeId;
      
      console.log('PaymentIntent succeeded:', paymentIntent.id, 'for booking:', bookingId);
      
      if (bookingId) {
        try {
          const booking = await Booking.findById(bookingId);
          if (booking && booking.status === 'pending_payment') {
            booking.status = 'pending';
            booking.paymentIntentId = paymentIntent.id;
            booking.paidAt = new Date().toISOString();
            await booking.save();
            console.log('Booking', bookingId, 'confirmed after payment');
            
            // Send confirmation email to renter and owner
            if (SENDGRID_API_KEY) {
              const bike = await Bike.findById(bikeId);
              const renter = await User.findById(booking.renter);
              const owner = await User.findById(bike?.ownerId);
              
              if (renter) {
                await emailService.bookingConfirmation({
                  to: renter.email,
                  renterName: renter.firstName,
                  bikeName: bike ? `${bike.year} ${bike.make} ${bike.model}` : 'your bike',
                  startDate: booking.startDate,
                  endDate: booking.endDate,
                  totalPrice: booking.totalPrice
                });
              }
              if (owner) {
                await emailService.ownerBookingNotification({
                  to: owner.email,
                  ownerName: owner.firstName,
                  bikeName: bike ? `${bike.year} ${bike.make} ${bike.model}` : 'your bike',
                  renterName: renter ? `${renter.firstName} ${renter.lastName}` : 'A rider',
                  startDate: booking.startDate,
                  endDate: booking.endDate,
                  totalPrice: booking.totalPrice
                });
              }
            }
          }
        } catch (err) {
          console.error('Error updating booking after payment:', err.message);
        }
      }
      break;
    }
    
    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object;
      const bookingId = paymentIntent.metadata?.bookingId;
      
      console.log('PaymentIntent failed:', paymentIntent.id, 'for booking:', bookingId);
      
      if (bookingId) {
        try {
          const booking = await Booking.findById(bookingId);
          if (booking) {
            booking.status = 'cancelled';
            booking.cancellationReason = 'Payment failed';
            await booking.save();
          }
        } catch (err) {
          console.error('Error cancelling failed booking:', err.message);
        }
      }
      break;
    }
    
    default:
      console.log(`Unhandled Stripe event type: ${event.type}`);
  }

  res.json({ received: true });
};

module.exports = stripeWebhookHandler;
