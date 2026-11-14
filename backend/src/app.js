const path = require('path');
// Lê backend/.env (e também um .env na raiz, se existir)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
 
const app = express();

// Atrás do proxy da Vercel/Render: necessário para o rate limit ver o IP real
app.set('trust proxy', 1);
 
// ── Middlewares de segurança ──
app.use(helmet());
// CORS: no deploy tudo roda no mesmo domínio (não precisa de CORS).
// Se o frontend ficar em outro domínio, defina FRONTEND_URL no ambiente.
app.use(cors({
  origin: process.env.FRONTEND_URL || '*'
}));
 
// ── Rate Limit ──
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Muitas requisições. Tente em 15 minutos.' }
});
app.use('/api/check', limiter);
 
// ── Body Parser ──
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
 
// ── Health Check (também mostra o estado do banco, útil para diagnosticar o deploy) ──
app.get('/api/health', async (req, res) => {
  let database = 'não configurado (defina MONGODB_URI)';
  if (process.env.MONGODB_URI) {
    try {
      await connectDB();
      database = mongoose.connection.readyState === 1 ? 'conectado' : 'desconectado';
    } catch (err) {
      database = 'erro de conexão (verifique MONGODB_URI e o Network Access do Atlas)';
    }
  }
  res.json({
    status: 'OK',
    message: 'Fato Real API rodando!',
    database,
    newsApi: process.env.NEWS_API ? 'configurada' : 'ausente',
    factCheck: process.env.GOOGLE_FACTCHECK_API_KEY ? 'configurada' : 'ausente',
    openai: process.env.OPENAI_API_KEY ? 'configurada' : 'ausente (opcional)'
  });
});

// ── Conexão com MongoDB (reaproveitada entre requisições) ──
// Sem banco conectado, as operações falham na hora em vez de ficarem presas esperando.
mongoose.set('bufferCommands', false);

let connecting = null;
let lastFailure = 0;
const RETRY_AFTER_MS = 30 * 1000;

async function connectDB() {
  if (mongoose.connection.readyState === 1 || !process.env.MONGODB_URI) return;
  // Se falhou há pouco, não trava cada requisição esperando de novo
  if (lastFailure && Date.now() - lastFailure < RETRY_AFTER_MS) {
    throw new Error('MongoDB indisponível (nova tentativa em instantes)');
  }
  if (!connecting) {
    connecting = mongoose
      .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
      .then(() => { lastFailure = 0; console.log('✅ MongoDB conectado!'); })
      .catch(err => { lastFailure = Date.now(); throw err; })
      .finally(() => { connecting = null; });
  }
  await connecting;
}

// Garante o banco conectado antes das rotas que dependem dele
app.use('/api', async (req, res, next) => {
  if (req.path === '/health') return next();
  try {
    await connectDB();
  } catch (err) {
    console.error('❌ Erro MongoDB:', err.message);
    // segue sem banco: a verificação funciona, login/histórico não
  }
  next();
});

// ── Rotas ──
const authRoutes    = require('./routes/auth');
const checkRoutes   = require('./routes/check');
const historyRoutes = require('./routes/history');
 
app.use('/api/auth',    authRoutes);
app.use('/api/check',   checkRoutes);
app.use('/api/history', historyRoutes);
 
// ── Error Handler ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erro interno do servidor' });
});
 
// ── Inicia o servidor só quando rodado localmente (node src/app.js) ──
// Na Vercel o app é exportado e executado como função serverless (api/index.js).
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  connectDB()
    .catch(err => {
      console.error('❌ Erro MongoDB:', err.message);
      console.log('⚠️  Iniciando sem banco de dados...');
    })
    .finally(() => {
      app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
    });
}

module.exports = app;
