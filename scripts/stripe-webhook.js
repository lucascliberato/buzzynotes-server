// scripts/stripe-webhook.js
const express = require('express'); // ADICIONADO: Import do express
const { activateLicense } = require('./database');

// Função para configurar webhook do Stripe
function setupStripeWebhook(app) {
  // Verificar se Stripe está configurado
  const stripeConfigured = process.env.STRIPE_SECRET_KEY && 
    !process.env.STRIPE_SECRET_KEY.includes('TEMPORARIA');
  
  if (!stripeConfigured) {
    console.log('⚠️  Stripe webhook disabled (not configured)');
    
    // Webhook de teste para desenvolvimento
    app.post('/webhook', (req, res) => {
      res.status(200).json({
        message: 'Stripe webhook endpoint (test mode)',
        note: 'Configure STRIPE_SECRET_KEY to enable real webhooks'
      });
    });
    
    return;
  }

  // Configuração real do Stripe (quando as chaves estiverem disponíveis)
  let stripe;
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('✅ Stripe initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Stripe:', error.message);
    return;
  }

  // Middleware para webhook do Stripe (raw body needed)
  app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      // Verificar assinatura do webhook
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      console.log(`🔔 Webhook received: ${event.type}`);
      
    } catch (err) {
      console.error(`❌ Webhook signature verification failed:`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Processar diferentes tipos de eventos
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object);
          break;
          
        case 'invoice.payment_succeeded':
          await handlePaymentSucceeded(event.data.object);
          break;
          
        case 'customer.subscription.created':
          await handleSubscriptionCreated(event.data.object);
          break;
          
        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object);
          break;
          
        case 'customer.subscription.deleted':
          await handleSubscriptionCanceled(event.data.object);
          break;
          
        default:
          console.log(`🔄 Unhandled event type: ${event.type}`);
      }
      
      res.json({ received: true });
      
    } catch (error) {
      console.error(`❌ Error processing webhook:`, error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  console.log('✅ Stripe webhook configured');
}

// Processar checkout concluído
async function handleCheckoutCompleted(session) {
  try {
    console.log('💳 Processing checkout completion:', session.id);
    
    const customerEmail = session.customer_details?.email;
    const metadata = session.metadata || {};
    
    if (!customerEmail) {
      console.error('❌ No customer email in checkout session');
      return;
    }
    
    // Gerar chave de licença única
    const licenseKey = generateLicenseKey();
    
    // Ativar licença no banco de dados
    await activateLicense(licenseKey, customerEmail);
    
    console.log(`✅ License activated: ${licenseKey.substring(0, 8)}... for ${customerEmail}`);
    
    // TODO: Enviar email com a chave de licença
    // await sendLicenseEmail(customerEmail, licenseKey);
    
  } catch (error) {
    console.error('❌ Error handling checkout completion:', error);
  }
}

// Processar pagamento bem-sucedido
async function handlePaymentSucceeded(invoice) {
  try {
    console.log('💰 Processing payment success:', invoice.id);
    
    // Para assinaturas recorrentes, atualizar status da licença
    if (invoice.subscription) {
      const customerId = invoice.customer;
      // TODO: Atualizar status da licença baseado no customer_id
      console.log(`💰 Recurring payment for customer: ${customerId}`);
    }
    
  } catch (error) {
    console.error('❌ Error handling payment success:', error);
  }
}

// Processar criação de assinatura
async function handleSubscriptionCreated(subscription) {
  try {
    console.log('🔄 Processing subscription creation:', subscription.id);
    
    const customerId = subscription.customer;
    const status = subscription.status;
    
    console.log(`🔄 Subscription ${subscription.id} status: ${status}`);
    
    // TODO: Associar assinatura com licença do usuário
    
  } catch (error) {
    console.error('❌ Error handling subscription creation:', error);
  }
}

// Processar atualização de assinatura
async function handleSubscriptionUpdated(subscription) {
  try {
    console.log('🔄 Processing subscription update:', subscription.id);
    
    const status = subscription.status;
    const customerId = subscription.customer;
    
    // TODO: Atualizar status da licença baseado no status da assinatura
    if (status === 'active') {
      console.log(`✅ Subscription activated for customer: ${customerId}`);
    } else if (status === 'past_due') {
      console.log(`⚠️  Subscription past due for customer: ${customerId}`);
    }
    
  } catch (error) {
    console.error('❌ Error handling subscription update:', error);
  }
}

// Processar cancelamento de assinatura
async function handleSubscriptionCanceled(subscription) {
  try {
    console.log('❌ Processing subscription cancellation:', subscription.id);
    
    const customerId = subscription.customer;
    
    // TODO: Desativar licença ou mover para modo gratuito
    console.log(`❌ Subscription canceled for customer: ${customerId}`);
    
  } catch (error) {
    console.error('❌ Error handling subscription cancellation:', error);
  }
}

// Gerar chave de licença única
function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  
  // Formato: XXXX-XXXX-XXXX-XXXX
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) {
      result += '-';
    }
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
}

// Gerar chave de licença para teste
function generateTestLicense() {
  return generateLicenseKey();
}

module.exports = {
  setupStripeWebhook,
  generateTestLicense
};