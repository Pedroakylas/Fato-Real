const mongoose = require('mongoose');
 
const sourceSchema = new mongoose.Schema({
  title: String,
  url: String,
  snippet: String,
  source: String,
  publishedAt: Date,
  trusted: Boolean,
  debunking: Boolean,
  factCheck: Boolean,   // true quando a fonte é uma checagem de agência
  rating: String,       // classificação da agência, ex.: "Falso"
  ratingKind: String    // 'false' | 'mixed' | 'true' | 'unknown'
}, { _id: false });
 
const checkSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  inputType: {
    type: String,
    enum: ['text', 'url'],
    required: true
  },
  inputContent: {
    type: String,
    required: true
  },
  verdict: {
    type: String,
    // 'FALSO / NÃO VERIFICADO' é o valor que o aiService realmente gera;
    // 'FALSO' é mantido para registros antigos.
    enum: ['VERDADEIRO', 'FALSO', 'FALSO / NÃO VERIFICADO', 'PARCIALMENTE VERDADEIRO', 'INCONCLUSIVO'],
    required: true
  },
  confidenceScore: {
    type: Number,
    min: 0,
    max: 100
  },
  explanation: {
    type: String,
    required: true
  },
  summary: String,
  keyPoints: [String],
  sources: [sourceSchema],
  articleTitle: String,
  articleContent: String,
  shareId: {
    type: String,
    unique: true,
    default: () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36)
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});
 
module.exports = mongoose.model('Check', checkSchema);