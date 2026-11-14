// Rodar com: npm test   (usa o test runner nativo do Node 18+, sem dependências extras)

// Ambiente controlado ANTES de carregar o serviço (dotenv não sobrescreve variáveis já definidas)
process.env.OPENAI_API_KEY = '';              // sem IA: testa só a lógica de regras + checagens
process.env.NEWS_API = 'chave-de-teste';
process.env.GOOGLE_FACTCHECK_API_KEY = 'chave-de-teste';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

// Silencia os logs do serviço para a saída dos testes ficar limpa
console.log = () => {};
console.error = () => {};

const svc = require('../src/services/aiService');

// ── Simulação das APIs externas ───────────────────────────────
let newsArticles = [];
let factClaims = [];
let calls = { news: 0, factCheck: 0 };

axios.get = async (url) => {
  if (url.includes('newsapi.org')) {
    calls.news++;
    return { data: { totalResults: newsArticles.length, articles: newsArticles } };
  }
  if (url.includes('factchecktools')) {
    calls.factCheck++;
    return { data: { claims: factClaims } };
  }
  throw new Error(`URL inesperada no teste: ${url}`);
};

const reset = () => {
  newsArticles = [];
  factClaims = [];
  calls = { news: 0, factCheck: 0 };
  process.env.GOOGLE_FACTCHECK_API_KEY = 'chave-de-teste';
};

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const article = (title, url, sourceName, extra = {}) => ({
  title, url, description: extra.description || title,
  source: { name: sourceName }, publishedAt: extra.publishedAt || daysAgo(1),
});

// ── 1. Classificação de fontes (bugs corrigidos) ──────────────
test('domínio é avaliado pelo hostname, não pela URL inteira', () => {
  // Antes: "whatsapp", "reddit" e "x.com" na URL derrubavam fontes boas
  assert.equal(svc.isUntrustedDomain('https://g1.globo.com/politica/noticia/whatsapp-muda-regras.ghtml'), false);
  assert.equal(svc.isUntrustedDomain('https://www.folha.uol.com.br/mercado/2026/10/reddit-ipo.shtml'), false);
  assert.equal(svc.isUntrustedDomain('https://www.netflix.com/br/noticia'), false);
  // Continua pegando o que realmente é ruim
  assert.equal(svc.isUntrustedDomain('https://x.com/fulano/status/1'), true);
  assert.equal(svc.isUntrustedDomain('https://meublog.blogspot.com/2026/post.html'), true);
  assert.equal(svc.isUntrustedDomain('https://pt.reddit.com/r/brasil'), true);
});

test('fonte desconhecida não herda o peso de uma fonte confiável parecida', () => {
  const terrazul = svc.getSourceInfo({ source: { name: 'Terrazul Notícias' }, url: 'https://terrazul.exemplo.com/a' });
  const bandBlog = svc.getSourceInfo({ source: { name: 'Bandeirantes Blog' }, url: 'https://bandeirantesblog.exemplo.com/a' });
  assert.equal(terrazul.trusted, false);
  assert.equal(bandBlog.trusted, false);
  assert.equal(terrazul.known, false);

  const g1 = svc.getSourceInfo({ source: { name: 'G1' }, url: 'https://g1.globo.com/x' });
  assert.equal(g1.weight, 1);
  assert.equal(g1.trusted, true);
});

test('subdomínio mais específico vence (folha.uol.com.br ≠ uol.com.br)', () => {
  const folha = svc.getSourceInfo({ source: { name: 'Folha' }, url: 'https://www1.folha.uol.com.br/x' });
  const uol = svc.getSourceInfo({ source: { name: 'UOL' }, url: 'https://noticias.uol.com.br/x' });
  assert.equal(folha.weight, 1.0);
  assert.equal(uol.weight, 0.9);
});

test('site que apenas termina parecido com domínio oficial não é confiável', () => {
  const fake = svc.getSourceInfo({ source: { name: 'x' }, url: 'https://gov.br.noticias-falsas.com/a' });
  assert.equal(fake.trusted, false);
});

// ── 2. Detecção de desmentido ─────────────────────────────────
test('matérias SOBRE fake news não são tratadas como desmentido', () => {
  const nao = [
    'Governo lança campanha contra fake news nas eleições',
    'Lula sanciona lei de combate a fake news',
    'Estudo mostra como boato se espalha no WhatsApp',
    'Empresa engana consumidores com taxa escondida, diz Procon',
    'Presidente morre aos 80 anos',
  ];
  for (const title of nao) {
    assert.equal(svc.isDebunkingArticle({ title, url: 'https://g1.globo.com/x', source: { name: 'G1' } }), false, title);
  }
});

test('desmentidos reais são reconhecidos', () => {
  const sim = [
    { title: 'É falso que Fulano morreu em acidente', url: 'https://www.estadao.com.br/x' },
    { title: 'Ministério desmente demissão de ministro', url: 'https://g1.globo.com/x' },
    { title: 'Não, vídeo não mostra urna fraudada', url: 'https://www.aosfatos.org/noticias/x' },
    { title: 'Mensagem sobre vacina é boato', url: 'https://www.boatos.org/x' },
  ];
  for (const a of sim) assert.equal(svc.isDebunkingArticle(a), true, a.title);
});

test('"Não," no início do título só conta quando vem de agência de checagem', () => {
  assert.equal(svc.isDebunkingArticle({ title: 'Não, obrigado: empresa recusa proposta', url: 'https://www.exame.com/x' }), false);
  assert.equal(svc.isDebunkingArticle({ title: 'Não, obrigado: empresa recusa proposta', url: 'https://lupa.news/x' }), true);
});

// ── 3. Classificação das agências ─────────────────────────────
test('classifyRating entende as classificações em português', () => {
  const casos = {
    'Falso': 'false', 'Fake': 'false', 'Enganoso': 'false', 'Não é verdade': 'false', 'Boato': 'false',
    'Verdadeiro': 'true', 'Fato': 'true', 'Verdade': 'true', 'Comprovado': 'true',
    'Parcialmente falso': 'mixed', 'Distorcido': 'mixed', 'Exagerado': 'mixed',
    'Verdadeiro, mas sem contexto': 'mixed', 'Impreciso': 'mixed',
    'Sátira': 'unknown', '': 'unknown', 'Não verificável': 'unknown',
  };
  for (const [texto, esperado] of Object.entries(casos)) {
    assert.equal(svc.classifyRating(texto), esperado, texto);
  }
});

test('determineFactCheckVerdict resume várias agências', () => {
  const r = (kind, rating) => ({ publisher: 'Agência', rating, kind, claimText: 'alegação' });
  assert.equal(svc.determineFactCheckVerdict([r('false', 'Falso')]).verdict, 'FALSO / NÃO VERIFICADO');
  assert.equal(svc.determineFactCheckVerdict([r('true', 'Verdadeiro')]).verdict, 'VERDADEIRO');
  assert.equal(svc.determineFactCheckVerdict([r('mixed', 'Distorcido')]).verdict, 'PARCIALMENTE VERDADEIRO');
  assert.equal(svc.determineFactCheckVerdict([r('false', 'Falso'), r('true', 'Verdadeiro')]).verdict, 'INCONCLUSIVO');
  assert.equal(svc.determineFactCheckVerdict([r('unknown', 'Sátira')]), null);
  assert.equal(svc.determineFactCheckVerdict([]), null);
});

// ── 4. Fluxo completo (APIs simuladas) ────────────────────────
const checkClaim = {
  text: 'Vacina da gripe causa autismo em crianças',
  claimant: 'Posts em redes sociais',
  claimReview: [{
    publisher: { name: 'Aos Fatos', site: 'aosfatos.org' },
    url: 'https://www.aosfatos.org/noticias/vacina-gripe-autismo/',
    title: 'É falso que vacina da gripe cause autismo',
    reviewDate: '2026-09-01T00:00:00Z',
    textualRating: 'Falso',
    languageCode: 'pt',
  }],
};

test('checagem de agência define o veredito e aparece primeiro nas fontes', async () => {
  reset();
  factClaims = [checkClaim];
  const r = await svc.checkWithAI('A vacina da gripe causa autismo em crianças', 'text');

  assert.equal(r.verdict, 'FALSO / NÃO VERIFICADO');
  assert.ok(r.confidenceScore >= 88);
  assert.equal(r.sources[0].factCheck, true);
  assert.equal(r.sources[0].rating, 'Falso');
  assert.equal(r.sources[0].ratingKind, 'false');
  assert.match(r.explanation, /Aos Fatos/);
  assert.equal(r.factCheckCount, 1);
});

test('checagem de OUTRO assunto é ignorada (filtro de relevância)', async () => {
  reset();
  factClaims = [{
    text: 'Eleição municipal será adiada por decisão do TSE',
    claimReview: [{ publisher: { name: 'Lupa', site: 'lupa.news' }, url: 'https://lupa.news/x', title: 'Falso', textualRating: 'Falso' }],
  }];
  const r = await svc.checkWithAI('A vacina da gripe causa autismo em crianças', 'text');
  assert.equal(r.factCheckCount, 0);
  assert.notEqual(r.verdict, 'FALSO / NÃO VERIFICADO');
});

test('sem nenhuma evidência o resultado é INCONCLUSIVO, nunca FALSO', async () => {
  reset();
  const r = await svc.checkWithAI('Prefeito de Cidadezinha inaugurou a nova praça municipal ontem', 'text');
  assert.equal(r.verdict, 'INCONCLUSIVO');
  assert.ok(r.confidenceScore <= 60);
  assert.match(r.explanation, /NÃO significa/);
  assert.equal(r.sources.length, 0);
});

test('só fontes de baixa credibilidade não bastam para VERDADEIRO', async () => {
  reset();
  newsArticles = [
    article('Prefeito de Cidadezinha inaugurou nova praça municipal', 'https://meublog.blogspot.com/a', 'Meu Blog'),
    article('Prefeito de Cidadezinha inaugurou nova praça municipal hoje', 'https://x.com/user/status/1', 'X'),
  ];
  const r = await svc.checkWithAI('Prefeito de Cidadezinha inaugurou nova praça municipal', 'text');
  assert.equal(r.verdict, 'INCONCLUSIVO');
  assert.equal(r.sources.length, 0, 'fontes de baixa credibilidade não são exibidas');
});

test('boa cobertura por 2+ veículos confiáveis → VERDADEIRO', async () => {
  reset();
  newsArticles = [
    article('Banco Central mantém taxa Selic em reunião do Copom', 'https://g1.globo.com/economia/selic.ghtml', 'G1'),
    article('Copom mantém Selic e Banco Central sinaliza cautela', 'https://www1.folha.uol.com.br/mercado/selic.shtml', 'Folha de S.Paulo'),
    article('Selic: Banco Central mantém taxa, decide Copom', 'https://www.estadao.com.br/economia/selic', 'Estadão'),
  ];
  const r = await svc.checkWithAI('Banco Central mantém taxa Selic no Copom', 'text');
  assert.equal(r.verdict, 'VERDADEIRO');
  assert.ok(r.confidenceScore <= 85);
  assert.ok(r.sources.length >= 3);
});

test('um único veículo confiável desmentindo penaliza, mas não força FALSO', async () => {
  reset();
  newsArticles = [
    article('Ministério desmente demissão de ministro da Saúde', 'https://g1.globo.com/politica/x.ghtml', 'G1'),
  ];
  const r = await svc.checkWithAI('Ministro da Saúde foi demitido hoje do governo', 'text');
  assert.notEqual(r.verdict, 'VERDADEIRO');
  assert.notEqual(r.confidenceScore, 90, 'sem agência de checagem não há desmentido forçado');
});

test('artigo de agência de checagem desmentindo força FALSO', async () => {
  reset();
  newsArticles = [
    article('É falso que ministro da Saúde foi demitido', 'https://www.aosfatos.org/noticias/ministro-demitido/', 'Aos Fatos'),
  ];
  const r = await svc.checkWithAI('Ministro da Saúde foi demitido hoje do governo', 'text');
  assert.equal(r.verdict, 'FALSO / NÃO VERIFICADO');
});

test('ao verificar uma URL, a própria matéria não conta como confirmação', async () => {
  reset();
  const inputUrl = 'https://g1.globo.com/economia/noticia/2026/10/01/inflacao-sobe.ghtml';
  newsArticles = [
    article('Inflação sobe em setembro, diz IBGE', inputUrl, 'G1'),
    article('Inflação sobe em setembro, diz IBGE', 'https://www.exame.com/copia-da-mesma-materia', 'Exame'), // cópia (mesmo título)
    article('IBGE: inflação de setembro avança e sobe acima do esperado', 'https://www.folha.uol.com.br/mercado/ipca', 'Folha de S.Paulo'),
  ];
  const content = 'Título: Inflação sobe em setembro, diz IBGE\n\nConteúdo: texto da matéria...';
  const r = await svc.checkWithAI(content, 'url', { sourceUrl: inputUrl });

  const urls = r.sources.map(s => s.url);
  assert.ok(!urls.includes(inputUrl), 'a URL verificada não pode ser fonte de si mesma');
  assert.ok(!urls.includes('https://www.exame.com/copia-da-mesma-materia'), 'cópia com mesmo título também sai');
  assert.ok(urls.includes('https://www.folha.uol.com.br/mercado/ipca'), 'cobertura independente permanece');
});

test('lista de fontes exibidas é curta e priorizada', async () => {
  reset();
  newsArticles = [
    article('Selic mantida pelo Copom em decisão unânime do BC', 'https://blog.exemplo.com/a', 'Blog Qualquer'),
    ...['g1.globo.com', 'www.estadao.com.br', 'www1.folha.uol.com.br', 'www.cnnbrasil.com.br', 'www.r7.com', 'www.exame.com', 'www.terra.com.br', 'www.metropoles.com']
      .map((h, i) => article(`Selic mantida pelo Copom em decisão unânime do BC ${i}`, `https://${h}/selic-${i}`, `Fonte ${i}`)),
  ];
  const r = await svc.checkWithAI('Selic mantida pelo Copom em decisão unânime do BC', 'text');
  assert.ok(r.sources.length <= 6, `exibiu ${r.sources.length} fontes`);
  assert.ok(r.sources.every(s => s.trusted), 'só fontes confiáveis quando há de sobra');
});

test('sem a chave do Fact Check o sistema funciona e não chama a API', async () => {
  reset();
  delete process.env.GOOGLE_FACTCHECK_API_KEY;
  factClaims = [checkClaim];
  const r = await svc.checkWithAI('A vacina da gripe causa autismo em crianças', 'text');
  assert.equal(calls.factCheck, 0);
  assert.equal(r.factCheckCount, 0);
  assert.ok(r.verdict);
});

test('falha na API do Google não derruba a verificação', async () => {
  reset();
  const original = axios.get;
  axios.get = async (url, opts) => {
    if (url.includes('factchecktools')) {
      const err = new Error('forbidden');
      err.response = { status: 403, data: { error: { message: 'API not enabled' } } };
      throw err;
    }
    return original(url, opts);
  };
  try {
    const r = await svc.checkWithAI('A vacina da gripe causa autismo em crianças', 'text');
    assert.equal(r.verdict, 'INCONCLUSIVO');
    assert.equal(r.factCheckCount, 0);
  } finally {
    axios.get = original;
  }
});
