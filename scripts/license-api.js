// scripts/license-api.js
const { verifyLicense, activateLicense, saveUserData, getUserData } = require('./database');

// Rate limiting para APIs de licença
const licenseRateLimit = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // máximo 10 tentativas por IP
  message: {
    error: 'Too many license requests',
    message: 'Please wait before trying again'
  }
});

// Configurar rotas de licença
function setupLicenseRoutes(app) {
  
  // POST /api/verify-license - Verificar se uma licença é válida
  app.post('/api/verify-license', licenseRateLimit, async (req, res) => {
    try {
      const { licenseKey } = req.body;
      
      // Validação básica
      if (!licenseKey || typeof licenseKey !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Invalid license key format'
        });
      }
      
      // Verificar licença
      const licenseResult = await verifyLicense(licenseKey);
      
      if (licenseResult.valid) {
        res.json({
          success: true,
          message: 'License is valid',
          user: {
            email: licenseResult.user.email,
            plan: licenseResult.user.plan_type,
            status: licenseResult.user.status,
            activated: licenseResult.user.created_at
          }
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'License not found or inactive'
        });
      }
      
    } catch (error) {
      console.error('Error verifying license:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });
  
  // POST /api/activate-license - Ativar uma nova licença
  app.post('/api/activate-license', licenseRateLimit, async (req, res) => {
    try {
      const { licenseKey, email } = req.body;
      
      // Validação
      if (!licenseKey || !email) {
        return res.status(400).json({
          success: false,
          error: 'License key and email are required'
        });
      }
      
      // Validar formato do email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format'
        });
      }
      
      // Ativar licença
      const user = await activateLicense(licenseKey, email);
      
      res.json({
        success: true,
        message: 'License activated successfully',
        user: {
          email: user.email,
          plan: user.plan_type,
          status: user.status,
          activated: user.created_at
        }
      });
      
    } catch (error) {
      console.error('Error activating license:', error);
      
      // Se for erro de constraint (licença já existe)
      if (error.code === '23505') {
        res.status(409).json({
          success: false,
          error: 'License already activated'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to activate license'
        });
      }
    }
  });
  
  // POST /api/sync/upload - Upload de dados do usuário (premium only)
  app.post('/api/sync/upload', async (req, res) => {
    try {
      const { licenseKey, dataType = 'notes', data } = req.body;
      
      // Validação
      if (!licenseKey || !data) {
        return res.status(400).json({
          success: false,
          error: 'License key and data are required'
        });
      }
      
      // Verificar se licença é válida
      const licenseResult = await verifyLicense(licenseKey);
      if (!licenseResult.valid) {
        return res.status(403).json({
          success: false,
          error: 'Invalid or inactive license'
        });
      }
      
      // Salvar dados
      const result = await saveUserData(licenseKey, dataType, data);
      
      res.json({
        success: true,
        message: 'Data uploaded successfully',
        uploaded_at: result.updated_at || result.created_at
      });
      
    } catch (error) {
      console.error('Error uploading data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to upload data'
      });
    }
  });
  
  // GET /api/sync/download/:licenseKey - Download de dados do usuário (premium only)
  app.get('/api/sync/download/:licenseKey', async (req, res) => {
    try {
      const { licenseKey } = req.params;
      const { dataType = 'notes' } = req.query;
      
      // Verificar se licença é válida
      const licenseResult = await verifyLicense(licenseKey);
      if (!licenseResult.valid) {
        return res.status(403).json({
          success: false,
          error: 'Invalid or inactive license'
        });
      }
      
      // Recuperar dados
      const userData = await getUserData(licenseKey, dataType);
      
      if (userData) {
        res.json({
          success: true,
          data: userData.content,
          last_modified: userData.lastModified
        });
      } else {
        res.json({
          success: true,
          data: null,
          message: 'No data found for this license'
        });
      }
      
    } catch (error) {
      console.error('Error downloading data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to download data'
      });
    }
  });
  
  // GET /api/license/:licenseKey/info - Informações detalhadas da licença
  app.get('/api/license/:licenseKey/info', async (req, res) => {
    try {
      const { licenseKey } = req.params;
      
      // Verificar licença
      const licenseResult = await verifyLicense(licenseKey);
      
      if (licenseResult.valid) {
        res.json({
          success: true,
          license: {
            key: licenseKey.substring(0, 8) + '...',
            email: licenseResult.user.email,
            plan: licenseResult.user.plan_type,
            status: licenseResult.user.status,
            activated: licenseResult.user.created_at,
            features: {
              unlimited_notes: true,
              unlimited_folders: true,
              cloud_sync: true,
              premium_support: true
            }
          }
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'License not found'
        });
      }
      
    } catch (error) {
      console.error('Error getting license info:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get license information'
      });
    }
  });

}

module.exports = {
  setupLicenseRoutes
};