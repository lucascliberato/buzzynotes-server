require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Importar nossos módulos
const { initializeDatabase, testConnection } = require('./scripts/database');
const { setupLicenseRoutes } = require('./scripts/license-api');
const { setupStripeWebhook } = require('./scripts/stripe-webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar CORS
app.use(cors({
  origin: ['chrome-extension://*', 'http://localhost:*'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por IP
  message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

// Middleware para parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Variável global para status do banco
let databaseConnected = false;

// Função para inicializar o servidor
async function startServer() {
  console.log('🚀 Starting BuzzyNotes Server...');
  
  // Verificar configurações
  console.log('🔧 Checking configuration...');
  
  // Verificar Stripe
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('TEMPORARIA')) {
    console.log('⚠️  Stripe not configured - webhook will not work');
    console.log('   Add your Stripe keys to .env to enable webhook functionality');
  } else {
    console.log('✅ Stripe configured');
  }
  
  // Verificar e inicializar banco de dados
  console.log('🔧 Initializing database...');
  
  try {
    // Primeiro, testar conexão simples
    const connectionTest = await testConnection();
    if (connectionTest) {
      console.log('✅ Database connection test passed');
      
      // Agora inicializar as tabelas
      databaseConnected = await initializeDatabase();
      if (databaseConnected) {
        console.log('✅ Database initialized successfully');
      } else {
        console.log('❌ Database table initialization failed');
      }
    } else {
      console.log('❌ Database connection test failed');
    }
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    console.log('⚠️  Server will run without database functionality');
    databaseConnected = false;
  }
  
  // Configurar rotas
  setupRoutes();
  
  // Iniciar servidor
  app.listen(PORT, () => {
    console.log(`🚀 BuzzyNotes API running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`📋 API docs: http://localhost:${PORT}/`);
    console.log('✅ Server started successfully!');
  });
}

// Configurar todas as rotas
function setupRoutes() {
  // Rota raiz - documentação
  app.get('/', (req, res) => {
    res.json({
      name: 'BuzzyNotes API',
      version: '1.0.0',
      status: 'running',
      database: databaseConnected ? '✅ Connected' : '❌ Disconnected',
      stripe: process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('TEMPORARIA') ? '✅ Configured' : '⚠️ Not configured',
      endpoints: [
        'GET /health - Health check',
        'POST /api/verify-license - Verify premium license',
        'POST /api/activate-license - Activate premium license',
        'POST /api/sync/upload - Upload user data (premium only)',
        'GET /api/sync/download/:licenseKey - Download user data (premium only)',
        'POST /webhook - Stripe webhook'
      ]
    });
  });
  
  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: databaseConnected ? 'connected' : 'disconnected',
      stripe: process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('TEMPORARIA') ? 'configured' : 'not_configured'
    });
  });
  
  // Configurar rotas de licença (apenas se banco conectado)
  if (databaseConnected) {
    setupLicenseRoutes(app);
    console.log('✅ License API routes configured');
  } else {
    // Rotas de fallback para quando não há banco
    app.post('/api/verify-license', (req, res) => {
      res.status(503).json({ 
        error: 'Database not available',
        message: 'License verification temporarily unavailable'
      });
    });
    
    app.post('/api/activate-license', (req, res) => {
      res.status(503).json({ 
        error: 'Database not available',
        message: 'License activation temporarily unavailable'
      });
    });
    
    console.log('⚠️  License API routes disabled (no database)');
  }
  
  // Configurar webhook do Stripe
  setupStripeWebhook(app);
  
  // Rota 404
  app.use('*', (req, res) => {
    res.status(404).json({
      error: 'Endpoint not found',
      message: `The endpoint ${req.method} ${req.originalUrl} does not exist`,
      availableEndpoints: [
        'GET /',
        'GET /health',
        'POST /api/verify-license',
        'POST /api/activate-license',
        'POST /webhook'
      ]
    });
  });
  
  // Error handler
  app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Something went wrong on our end'
    });
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT. Graceful shutdown...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM. Graceful shutdown...');
  process.exit(0);
});

// Iniciar servidor
startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});