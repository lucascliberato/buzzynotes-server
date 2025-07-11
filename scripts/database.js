const { Pool } = require('pg');

// Configuração específica para PostgreSQL 17 com cliente 15
const pool = new Pool({
  user: 'buzzynotes_user',
  host: 'localhost',
  database: 'buzzynotes', 
  password: 'buzzy2025', // Nova senha mais simples
  port: 5433,
  // Configurações específicas para resolver incompatibilidade de versão
  ssl: false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20, // máximo de conexões
  // Força uso de autenticação mais simples
  options: '--application_name=buzzynotes_app'
});

// Função para testar conexão com diagnóstico detalhado
async function testConnection() {
  let client;
  try {
    console.log('🔗 Attempting database connection...');
    console.log('📊 Connection config:');
    console.log('   - Host: localhost');
    console.log('   - Port: 5433'); 
    console.log('   - Database: buzzynotes');
    console.log('   - User: buzzynotes_user');
    
    client = await pool.connect();
    
    // Teste básico
    const result = await client.query('SELECT version(), current_user, current_database()');
    const info = result.rows[0];
    
    console.log('✅ Database connection successful!');
    console.log(`📈 Server version: ${info.version.split(' ')[1]}`);
    console.log(`👤 Connected as: ${info.current_user}`);
    console.log(`🗄️  Database: ${info.current_database}`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Connection test failed:', error.message);
    console.error('🔍 Error code:', error.code);
    console.error('🔍 Error detail:', error.detail || 'No additional details');
    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Função para inicializar o banco de dados
async function initializeDatabase() {
  let client;
  try {
    console.log('🔧 Initializing database tables...');
    
    client = await pool.connect();
    
    // Verificar se as tabelas já existem
    const checkTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    `);
    
    const existingTables = checkTables.rows.map(row => row.table_name);
    console.log('📋 Existing tables:', existingTables.length > 0 ? existingTables : 'None');
    
    // Criar tabela de usuários
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255),
        status VARCHAR(50) DEFAULT 'active',
        plan_type VARCHAR(50) DEFAULT 'premium',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Criar tabela de dados do usuário
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_data (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(255) NOT NULL,
        data_type VARCHAR(50) NOT NULL DEFAULT 'notes',
        content JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_user_data_license 
          FOREIGN KEY (license_key) 
          REFERENCES users(license_key) 
          ON DELETE CASCADE
      )
    `);
    
    // Criar índices para performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_license_key ON users(license_key);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_data_license_key ON user_data(license_key);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_data_type ON user_data(license_key, data_type);
    `);
    
    // Verificar tabelas criadas
    const finalCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    `);
    
    console.log('✅ Database tables created successfully:');
    finalCheck.rows.forEach(row => {
      console.log(`   📋 ${row.table_name}`);
    });
    
    return true;
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    console.error('🔍 SQL State:', error.code);
    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Função para verificar licença
async function verifyLicense(licenseKey) {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      'SELECT id, email, status, plan_type, created_at FROM users WHERE license_key = $1 AND status = $2',
      [licenseKey, 'active']
    );
    
    if (result.rows.length > 0) {
      console.log(`✅ License verified: ${licenseKey.substring(0, 8)}...`);
      return { valid: true, user: result.rows[0] };
    } else {
      console.log(`❌ License not found or inactive: ${licenseKey.substring(0, 8)}...`);
      return { valid: false, user: null };
    }
    
  } catch (error) {
    console.error('Error verifying license:', error.message);
    return { valid: false, user: null };
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Função para ativar licença
async function activateLicense(licenseKey, email) {
  let client;
  try {
    client = await pool.connect();
    
    // Inserir ou atualizar usuário
    const result = await client.query(`
      INSERT INTO users (license_key, email, status, plan_type) 
      VALUES ($1, $2, 'active', 'premium') 
      ON CONFLICT (license_key) 
      DO UPDATE SET 
        email = EXCLUDED.email,
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [licenseKey, email]);
    
    console.log(`✅ License activated: ${licenseKey.substring(0, 8)}... for ${email}`);
    return result.rows[0];
    
  } catch (error) {
    console.error('Error activating license:', error.message);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Função para salvar dados do usuário
async function saveUserData(licenseKey, dataType = 'notes', content) {
  let client;
  try {
    client = await pool.connect();
    
    // Verificar se licença existe
    const userExists = await client.query(
      'SELECT id FROM users WHERE license_key = $1 AND status = $2',
      [licenseKey, 'active']
    );
    
    if (userExists.rows.length === 0) {
      throw new Error('Invalid or inactive license');
    }
    
    // Salvar ou atualizar dados
    const result = await client.query(`
      INSERT INTO user_data (license_key, data_type, content) 
      VALUES ($1, $2, $3)
      ON CONFLICT (license_key, data_type) 
      DO UPDATE SET 
        content = EXCLUDED.content,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, created_at, updated_at
    `, [licenseKey, dataType, JSON.stringify(content)]);
    
    console.log(`💾 Data saved for license: ${licenseKey.substring(0, 8)}...`);
    return result.rows[0];
    
  } catch (error) {
    console.error('Error saving user data:', error.message);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Função para recuperar dados do usuário
async function getUserData(licenseKey, dataType = 'notes') {
  let client;
  try {
    client = await pool.connect();
    
    const result = await client.query(`
      SELECT content, updated_at 
      FROM user_data 
      WHERE license_key = $1 AND data_type = $2 
      ORDER BY updated_at DESC 
      LIMIT 1
    `, [licenseKey, dataType]);
    
    if (result.rows.length > 0) {
      console.log(`📂 Data retrieved for license: ${licenseKey.substring(0, 8)}...`);
      return {
        content: result.rows[0].content,
        lastModified: result.rows[0].updated_at
      };
    }
    
    return null;
    
  } catch (error) {
    console.error('Error getting user data:', error.message);
    return null;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Função para fechar pool de conexões
async function closePool() {
  try {
    await pool.end();
    console.log('🔌 Database connection pool closed');
  } catch (error) {
    console.error('Error closing pool:', error.message);
  }
}

module.exports = {
  pool,
  testConnection,
  initializeDatabase,
  verifyLicense,
  activateLicense,
  saveUserData,
  getUserData,
  closePool
};