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

// Função para gerar licença baseada no email (determinística)
function generateEmailBasedLicense(email) {
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
  
  // Converter primeiros 16 caracteres em formato de licença
  const chars = hash.toUpperCase().substring(0, 16);
  
  // Formato: XXXX-XXXX-XXXX-XXXX
  return chars.match(/.{1,4}/g).join('-');
}

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

  // ===== SISTEMA DE LICENÇA INDIVIDUAL SIMPLES (OPÇÃO C) =====

  // POST /api/generate-license - Gerar licença para email (após pagamento)
  app.post('/api/generate-license', async (req, res) => {
    try {
      const { email, paymentConfirmation } = req.body;
      
      // Validação básica
      if (!email || typeof email !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Email is required'
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
      
      // Verificar se email já tem licença
      const { pool } = require('./database');
      
      const client = await pool.connect();
      const existingUser = await client.query(
        'SELECT license_key, status FROM users WHERE email = $1',
        [email]
      );
      
      if (existingUser.rows.length > 0) {
        const user = existingUser.rows[0];
        
        if (user.status === 'active') {
          client.release();
          // Retornar licença existente
          return res.json({
            success: true,
            message: 'License already exists for this email',
            licenseKey: user.license_key,
            action: 'existing'
          });
        } else {
          // Reativar licença existente
          await client.query(
            'UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2',
            ['active', email]
          );
          
          client.release();
          return res.json({
            success: true,
            message: 'License reactivated',
            licenseKey: user.license_key,
            action: 'reactivated'
          });
        }
      }
      
      // Gerar nova licença baseada no email
      const licenseKey = generateEmailBasedLicense(email);
      
      // Criar usuário com licença
      const newUser = await client.query(`
        INSERT INTO users (license_key, email, status, plan_type) 
        VALUES ($1, $2, 'active', 'premium') 
        RETURNING *
      `, [licenseKey, email]);
      
      client.release();
      
      console.log(`✅ License generated: ${licenseKey.substring(0, 8)}... for ${email}`);
      
      res.json({
        success: true,
        message: 'License generated successfully',
        licenseKey: licenseKey,
        action: 'created',
        user: {
          email: email,
          plan: 'premium',
          status: 'active',
          created: newUser.rows[0].created_at
        }
      });
      
    } catch (error) {
      console.error('Error generating license:', error.message);
      
      if (error.code === '23505') {
        res.status(409).json({
          success: false,
          error: 'License generation conflict. Please try again.'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to generate license'
        });
      }
    }
  });

  // POST /api/request-license - Endpoint público para solicitar licença
  app.post('/api/request-license', async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Email is required'
        });
      }
      
      // Validar email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format'
        });
      }
      
      const { pool } = require('./database');
      
      // Verificar se já existe
      const client = await pool.connect();
      const existingUser = await client.query(
        'SELECT license_key, status, created_at FROM users WHERE email = $1',
        [email]
      );
      
      if (existingUser.rows.length > 0) {
        const user = existingUser.rows[0];
        client.release();
        return res.json({
          success: true,
          message: 'License found for this email',
          licenseKey: user.license_key,
          status: user.status,
          created: user.created_at
        });
      }
      
      // Se não existe, gerar nova licença
      const licenseKey = generateEmailBasedLicense(email);
      
      const newUser = await client.query(`
        INSERT INTO users (license_key, email, status, plan_type) 
        VALUES ($1, $2, 'active', 'premium') 
        RETURNING *
      `, [licenseKey, email]);
      
      client.release();
      
      console.log(`🆕 New license created: ${licenseKey.substring(0, 8)}... for ${email}`);
      
      res.json({
        success: true,
        message: 'License created successfully',
        licenseKey: licenseKey,
        user: {
          email: email,
          plan: 'premium',
          status: 'active',
          created: newUser.rows[0].created_at
        }
      });
      
    } catch (error) {
      console.error('Error requesting license:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to process license request'
      });
    }
  });

  // GET /api/check-email/:email - Verificar se email tem licença
  app.get('/api/check-email/:email', async (req, res) => {
    try {
      const { email } = req.params;
      
      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Email is required'
        });
      }
      
      const { pool } = require('./database');
      const client = await pool.connect();
      
      const user = await client.query(
        'SELECT license_key, status, plan_type, created_at FROM users WHERE email = $1',
        [email]
      );
      
      client.release();
      
      if (user.rows.length > 0) {
        res.json({
          success: true,
          hasLicense: true,
          licenseKey: user.rows[0].license_key,
          status: user.rows[0].status,
          plan: user.rows[0].plan_type,
          created: user.rows[0].created_at
        });
      } else {
        res.json({
          success: true,
          hasLicense: false
        });
      }
      
    } catch (error) {
      console.error('Error checking email:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to check email'
      });
    }
  });

  // POST /api/dev/reset-email - Reset email para testes
  app.post('/api/dev/reset-email', async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Email is required'
        });
      }
      
      const { pool } = require('./database');
      const client = await pool.connect();
      
      await client.query('DELETE FROM users WHERE email = $1', [email]);
      client.release();
      
      res.json({
        success: true,
        message: `Email ${email} reset successfully`
      });
      
    } catch (error) {
      console.error('Error resetting email:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to reset email'
      });
    }
  });

  // GET /generate - Página para gerar licença
  app.get('/generate', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Generate BuzzyNotes License</title>
          <style>
              body { font-family: Arial, sans-serif; max-width: 500px; margin: 50px auto; padding: 20px; }
              .form { background: #f5f5f5; padding: 20px; border-radius: 8px; }
              input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
              button { background: #007cba; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; width: 100%; }
              .result { background: #e7f3ff; padding: 15px; margin: 15px 0; border-radius: 4px; }
              .license { font-family: monospace; font-size: 18px; font-weight: bold; color: #333; }
          </style>
      </head>
      <body>
          <h1>🚀 BuzzyNotes License Generator</h1>
          <div class="form">
              <h3>Enter your email to get your premium license:</h3>
              <input type="email" id="email" placeholder="your@email.com" required>
              <button onclick="generateLicense()">Generate My License</button>
              <div id="result"></div>
          </div>
          
          <script>
              async function generateLicense() {
                  const email = document.getElementById('email').value;
                  if (!email) {
                      alert('Please enter your email');
                      return;
                  }
                  
                  try {
                      const response = await fetch('/api/request-license', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ email })
                      });
                      
                      const data = await response.json();
                      
                      if (data.success) {
                          document.getElementById('result').innerHTML = \`
                              <div class="result">
                                  <h4>✅ Your Premium License:</h4>
                                  <div class="license">\${data.licenseKey}</div>
                                  <p><strong>Email:</strong> \${email}</p>
                                  <p><strong>Status:</strong> Active Premium</p>
                                  <hr>
                                  <p><strong>Next Steps:</strong></p>
                                  <ol>
                                      <li>Copy your license key above</li>
                                      <li>Open BuzzyNotes extension (Ctrl+Shift+U)</li>
                                      <li>Click "Already have a license?"</li>
                                      <li>Enter your license and email</li>
                                      <li>Enjoy unlimited notes and folders!</li>
                                  </ol>
                              </div>
                          \`;
                      } else {
                          document.getElementById('result').innerHTML = \`
                              <div class="result" style="background: #ffe7e7;">
                                  <h4>❌ Error:</h4>
                                  <p>\${data.error}</p>
                              </div>
                          \`;
                      }
                  } catch (error) {
                      document.getElementById('result').innerHTML = \`
                          <div class="result" style="background: #ffe7e7;">
                              <h4>❌ Network Error:</h4>
                              <p>Failed to generate license. Please try again.</p>
                          </div>
                      \`;
                  }
              }
          </script>
      </body>
      </html>
    `);
  });

  // ===== FIM DO CÓDIGO DA OPÇÃO C =====

}

module.exports = {
  setupLicenseRoutes
};