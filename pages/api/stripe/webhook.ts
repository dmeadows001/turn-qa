
  const userId = await findUserIdByCustomerId(customerId);
  if (!userId) {
    console.warn('[stripe webhook] invoice customer has no profile', customerId);
    return;
  }

  const { data: profile, error: lookupError } = await supa
    .from('profiles')
    .select('stripe_subscription_id')
    .eq('id', userId)
    .single();
  if (lookupError) throw lookupError;

  if (profile?.stripe_subscription_id !== invoiceSubId) {
    console.log('[stripe webhook] invoice is not for current subscription; skipped', {
      invoiceId: invoice.id,
      invoiceSubId,
      profileSubId: profile?.stripe_subscription_id,
    });
    return;
  }

  // Read live Stripe state, not an event that may be delayed or replayed.
  const [latestInvoice, currentSub] = await Promise.all([
    stripe.invoices.retrieve(invoice.id),
    stripe.subscriptions.retrieve(invoiceSubId),
  ]);

  if (getCustomerId(currentSub) !== customerId) {
    console.warn('[stripe webhook] subscription/customer mismatch', invoice.id);
    return;
  }

  if (failed) {
    // An old failed invoice may already have been paid; never revoke access then.
    if (latestInvoice.status === 'paid') {
      console.log('[stripe webhook] old failed invoice now paid; skipped', invoice.id);
      return;
    }

    if (currentSub.status === 'past_due' || currentSub.status === 'unpaid') {
      await applySubscriptionToProfile(currentSub);
      console.log('[stripe webhook] failed payment; access restricted', invoice.id);
    } else {
      console.log('[stripe webhook] failed invoice; subscription not overdue', {
        invoiceId: invoice.id,
        subscriptionStatus: currentSub.status,
      });
    }
    return;
  }

  // Restore access only when Stripe confirms the invoice is paid and the
  // subscription itself is currently active (or trialing).
  if (
    latestInvoice.status === 'paid' &&
    (currentSub.status === 'active' || currentSub.status === 'trialing')
  ) {
    await applySubscriptionToProfile(currentSub);
    console.log('[stripe webhook] paid invoice; subscription synchronized', invoice.id);
  } else {
    console.log('[stripe webhook] paid event did not qualify for restoration', {
      invoiceId: invoice.id,
      invoiceStatus: latestInvoice.status,
      subscriptionStatus: currentSub.status,
    });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'Missing STRIPE_WEBHOOK_SECRET' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig || typeof sig !== 'string') {
    return res.status(400).json({ error: 'Missing stripe-signature' });
  }

  let event: Stripe.Event;
  try {
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('[stripe webhook] signature verify failed', err?.message || err);
    return res.status(400).json({ error: `Webhook Error: ${err?.message || 'bad signature'}` });
  }

  try {
    switch (event.type) {
      case 'invoice.payment_failed':
        await handleInvoiceEvent(event.data.object as Stripe.Invoice, true);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoiceEvent(event.data.object as Stripe.Invoice, false);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const eventSub = event.data.object as Stripe.Subscription;
        const currentSub = await stripe.subscriptions.retrieve(eventSub.id);
        await applySubscriptionToProfile(currentSub);
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log('[stripe webhook] checkout.session.completed', {
          id: session.id,
          customer: session.customer,
          subscription: session.subscription,
        });
        break;
      }

      default:
        break;
