require('dotenv').config();
const axios = require('axios');

let OpenAI = null;
try { OpenAI = require('openai'); } catch { /* pacote não instalado — IA fica desativada */ }

// ─────────────────────────────────────────────
// CONFIGURAÇÕES
// ─────────────────────────────────────────────

/**
 * Fontes confiáveis, identificadas pelo DOMÍNIO (hostname) da URL do artigo, com peso 0–1.
 * Antes a identificação era por substring no nome ("Terrazul" casava com "Terra"),
 * o que promovia fontes desconhecidas. O match agora é exato no domínio ou em subdomínios.
 */
const TRUSTED_DOMAINS = {
  // Grandes portais de notícia
  'g1.globo.com':               { name: 'G1',               weight: 1.0 },
  'oglobo.globo.com':           { name: 'O Globo',          weight: 1.0 },
  'valor.globo.com':            { name: 'Valor Econômico',  weight: 1.0 },
  'globo.com':                  { name: 'Globo',            weight: 0.95 },
  'folha.uol.com.br':           { name: 'Folha de S.Paulo', weight: 1.0 },
  'band.uol.com.br':            { name: 'Band',             weight: 0.85 },
  'uol.com.br':                 { name: 'UOL',              weight: 0.9 },
  'estadao.com.br':             { name: 'Estadão',          weight: 1.0 },
  'r7.com':                     { name: 'R7',               weight: 0.85 },
  'cnnbrasil.com.br':           { name: 'CNN Brasil',       weight: 0.95 },
  'sbtnews.com.br':             { name: 'SBT News',         weight: 0.8 },
  'terra.com.br':               { name: 'Terra',            weight: 0.75 },
  'metropoles.com':             { name: 'Metrópoles',       weight: 0.8 },
  'correiobraziliense.com.br':  { name: 'Correio Braziliense', weight: 0.9 },
  'agenciabrasil.ebc.com.br':   { name: 'Agência Brasil',   weight: 1.0 },
  'exame.com':                  { name: 'Exame',            weight: 0.85 },
  'infomoney.com.br':           { name: 'InfoMoney',        weight: 0.85 },
  'poder360.com.br':            { name: 'Poder360',         weight: 0.85 },
  'veja.abril.com.br':          { name: 'Veja',             weight: 0.85 },
  'nexojornal.com.br':          { name: 'Nexo Jornal',      weight: 0.85 },
  // Agências e veículos internacionais
  'reuters.com':                { name: 'Reuters',          weight: 1.0 },
  'afp.com':                    { name: 'AFP',              weight: 1.0 },
  'apnews.com':                 { name: 'Associated Press', weight: 1.0 },
  'bbc.com':                    { name: 'BBC',              weight: 0.95 },
  'bbc.co.uk':                  { name: 'BBC',              weight: 0.95 },
  'dw.com':                     { name: 'DW',               weight: 0.9 },
  // Fontes oficiais
  'gov.br':                     { name: 'Governo Federal',  weight: 0.9 },
  'jus.br':                     { name: 'Poder Judiciário', weight: 0.9 },
  'leg.br':                     { name: 'Poder Legislativo', weight: 0.9 },
  // Agências de checagem — peso máximo, é o trabalho delas checar fatos
  'lupa.news':                  { name: 'Lupa',             weight: 1.0 },
  'aosfatos.org':               { name: 'Aos Fatos',        weight: 1.0 },
  'projetocomprova.com.br':     { name: 'Comprova',         weight: 1.0 },
  'e-farsas.com':               { name: 'E-farsas',         weight: 0.9 },
  'boatos.org':                 { name: 'Boatos.org',       weight: 0.85 },
};

// Mais específico primeiro: "folha.uol.com.br" precisa ser testado antes de "uol.com.br"
const TRUSTED_DOMAIN_KEYS = Object.keys(TRUSTED_DOMAINS).sort((a, b) => b.length - a.length);

/** Fallback: o nome da fonte (como a News API informa) precisa ser IGUAL — não apenas conter — o nome abaixo. */
const TRUSTED_SOURCE_NAMES = {
  'G1': 1.0, 'Globo.com': 0.95, 'Folha de S.Paulo': 1.0, 'UOL': 0.9, 'O Globo': 1.0, 'Estadão': 1.0,
  'R7': 0.85, 'CNN Brasil': 0.95, 'Band': 0.85, 'SBT News': 0.8, 'Terra': 0.75, 'Metrópoles': 0.8,
  'Correio Braziliense': 0.9, 'Agência Brasil': 1.0, 'Valor Econômico': 1.0, 'Exame': 0.85,
  'InfoMoney': 0.85, 'Reuters': 1.0, 'AFP': 1.0, 'Associated Press': 1.0, 'BBC News Brasil': 0.95,
  'Lupa': 1.0, 'Aos Fatos': 1.0, 'E-farsas': 0.9, 'Boatos.org': 0.85,
};

/** Fontes de baixa confiabilidade (blogs e redes sociais) — comparadas pelo HOSTNAME, nunca pela URL inteira. */
const UNTRUSTED_HOSTS = [
  'blogspot.com', 'wordpress.com', 'medium.com', 'tumblr.com', 'reddit.com', 'twitter.com', 'x.com',
  'facebook.com', 'instagram.com', 'tiktok.com', 'whatsapp.com', 't.me', 'telegram.org',
  'wixsite.com', 'blogger.com',
];

/** Agências de checagem: por domínio inteiro ou por trecho específico de um grande portal. */
const FACT_CHECKER_SITES = [
  { host: 'lupa.news' },
  { host: 'aosfatos.org' },
  { host: 'e-farsas.com' },
  { host: 'boatos.org' },
  { host: 'projetocomprova.com.br' },
  { host: 'checamos.afp.com' },
  { host: 'piaui.folha.uol.com.br', path: '/lupa' },
  { host: 'g1.globo.com', path: '/fato-ou-fake' },
  { host: 'estadao.com.br', path: '/verifica' },
  { host: 'noticias.uol.com.br', path: '/confere' },
  { host: 'reuters.com', path: '/fact-check' },
];
const FACT_CHECKER_NAMES = ['Lupa', 'Aos Fatos', 'E-farsas', 'Boatos.org', 'Comprova', 'Estadão Verifica', 'Fato ou Fake', 'AFP Checamos', 'UOL Confere'];

/**
 * Expressões que indicam que o artigo DESMENTE a alegação. Foram escolhidas para serem específicas:
 * termos soltos como "fake news", "boato" ou "engana" apareciam em qualquer matéria sobre
 * desinformação ("lei de combate a fake news") e disparavam um falso "desmentido".
 */
const STRICT_DEBUNK_PATTERNS = [
  /(?<![\p{L}])é\s+(falso|falsa|fake|mentira|boato)(?![\p{L}])/u,
  /#(fake|falso)(?![\p{L}])/u,
  /não\s+é\s+verdade/u,
  /não\s+procede/u,
  /\b(desmente|desmentem|desmentiu|desmentido|desmentida)\b/u,
  /boato\s+falso/u,
];
/** Termos que só valem como desmentido quando o artigo vem de uma agência de checagem. */
const FACT_CHECKER_DEBUNK_PATTERN = /\b(falso|falsa|fake|enganos[oa]|montagem|manipulad[oa]|boato|mentira|golpe|sem evidencias?)\b/;
const FACT_CHECKER_TITLE_NO_PATTERN = /^\s*não[,:]/u; // "Não, vídeo não mostra..." (padrão de título de checagem)

const UNKNOWN_SOURCE_WEIGHT = 0.25; // fonte desconhecida: contribui pouco e NUNCA conta como "confiável"
const MAX_DISPLAY_SOURCES = 6;

// Janelas de tempo para avaliar recência
const RECENCY_WINDOWS = {
  VERY_RECENT:  7,   // ≤ 7 dias  → boost
  RECENT:       30,  // ≤ 30 dias → boost menor
  OLD:          180, // > 180 dias → penalidade
};

// Google Fact Check Tools API
const FACT_CHECK_ENDPOINT = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';
const getFactCheckKey = () => process.env.GOOGLE_FACTCHECK_API_KEY;

// ─────────────────────────────────────────────
// IA (camada de confirmação — opcional)
// ─────────────────────────────────────────────

const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const openaiClient = (OpenAI && process.env.OPENAI_API_KEY)
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000 })
  : null;

// ─────────────────────────────────────────────
// HELPERS DE TEXTO E URL
// ─────────────────────────────────────────────

/** Remove acentos e caixa para comparação tolerante ("é" == "e", "Sonza" == "sonza"). */
const normalize = (s = '') => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const NAME_LOOKUP = new Map(Object.entries(TRUSTED_SOURCE_NAMES).map(([n, w]) => [normalize(n), w]));
const FACT_CHECKER_NAME_SET = new Set(FACT_CHECKER_NAMES.map(normalize));

/** Extrai hostname (sem "www.") e path de uma URL. Retorna null se inválida. */
const parseUrl = (rawUrl = '') => {
  try {
    const u = new URL(rawUrl);
    return { host: u.hostname.toLowerCase().replace(/^www\./, ''), path: u.pathname.toLowerCase() };
  } catch {
    return null;
  }
};

const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);

// ─────────────────────────────────────────────
// CLASSIFICAÇÃO DE FONTES
// ─────────────────────────────────────────────

/** true se o HOSTNAME é de blog/rede social. Ex.: g1.globo.com/...whatsapp... NÃO é mais marcado como ruim. */
const isUntrustedDomain = (articleUrl = '') => {
  const parsed = parseUrl(articleUrl);
  return !!parsed && UNTRUSTED_HOSTS.some(d => hostMatches(parsed.host, d));
};

const isFactCheckerUrl = (articleUrl = '') => {
  const parsed = parseUrl(articleUrl);
  if (!parsed) return false;
  return FACT_CHECKER_SITES.some(({ host, path }) =>
    hostMatches(parsed.host, host) && (!path || parsed.path.startsWith(path))
  );
};

/**
 * Reúne tudo o que sabemos sobre a fonte de um artigo:
 * { name, host, weight, trusted, untrusted, factChecker, known }
 */
const getSourceInfo = (article = {}) => {
  const parsed = parseUrl(article.url);
  const host = parsed?.host || '';
  const rawName = article.source?.name || '';

  const untrusted = isUntrustedDomain(article.url);
  const domainKey = host ? TRUSTED_DOMAIN_KEYS.find(d => hostMatches(host, d)) : null;
  const domainEntry = domainKey ? TRUSTED_DOMAINS[domainKey] : null;
  const nameWeight = NAME_LOOKUP.get(normalize(rawName));
  const factChecker = isFactCheckerUrl(article.url) || FACT_CHECKER_NAME_SET.has(normalize(rawName));

  let weight;
  let known = true;
  if (untrusted)                   weight = 0;
  else if (domainEntry)            weight = domainEntry.weight;
  else if (nameWeight !== undefined) weight = nameWeight;
  else { weight = UNKNOWN_SOURCE_WEIGHT; known = false; }

  return {
    name: rawName || domainEntry?.name || host || 'Desconhecido',
    host,
    weight,
    trusted: weight >= 0.7,
    untrusted,
    factChecker,
    known,
  };
};

/** Compatível com a assinatura antiga: peso de confiança (0 a 1) a partir do nome e da URL. */
const getSourceWeight = (sourceName = '', articleUrl = '') =>
  getSourceInfo({ source: { name: sourceName }, url: articleUrl }).weight;

/** true se o próprio artigo parece estar desmentindo a alegação. */
const isDebunkingArticle = (article = {}) => {
  const title = String(article.title || '').toLowerCase();
  const text = `${title} ${String(article.description || '').toLowerCase()}`;

  if (STRICT_DEBUNK_PATTERNS.some(r => r.test(text))) return true;

  // Termos mais amplos só valem para agências de checagem, cujo trabalho é desmentir.
  if (getSourceInfo(article).factChecker) {
    return FACT_CHECKER_TITLE_NO_PATTERN.test(title) || FACT_CHECKER_DEBUNK_PATTERN.test(normalize(text));
  }
  return false;
};

// ─────────────────────────────────────────────
// PALAVRAS-CHAVE, SINÔNIMOS E RELEVÂNCIA
// ─────────────────────────────────────────────

/**
 * Grupos de sinônimos para os tipos de alegação mais comuns em fake news
 * (morte, prisão, renúncia, golpe/fraude). Usados para (a) ampliar a query da
 * News API sem perder precisão e (b) reconhecer o mesmo evento com outra palavra.
 */
const SYNONYM_GROUPS = [
  ['morreu', 'morte', 'faleceu', 'morto', 'morta', 'obito', 'óbito', 'falecimento'],
  ['preso', 'presa', 'prisao', 'prisão', 'detido', 'detida', 'condenado', 'condenada'],
  ['renunciou', 'renuncia', 'renúncia', 'demitiu', 'demissao', 'demissão', 'exonerado', 'exonerada'],
  ['golpe', 'fraude', 'estelionato', 'roubo', 'roubou'],
  ['acidente', 'acidentou', 'atropelado', 'atropelada'],
];

const expandSynonyms = (word) => {
  const norm = normalize(word);
  const group = SYNONYM_GROUPS.find(g => g.some(w => normalize(w) === norm));
  return group ? [...new Set(group)] : [word];
};

/**
 * Verifica se o texto (artigo ou checagem) fala do MESMO fato da alegação, e não apenas
 * da mesma pessoa/assunto em outro contexto. Com poucas palavras-chave exige TODAS;
 * com mais, ao menos 60% — aceitando sinônimos do mesmo grupo.
 */
const isRelevantArticle = (article, coreKeywords) => {
  if (!coreKeywords || coreKeywords.length === 0) return true;

  const text = normalize(`${article.title || ''} ${article.description || ''}`);
  const matches = coreKeywords.filter(kw =>
    expandSynonyms(kw).some(variant => text.includes(normalize(variant)))
  ).length;

  const required = coreKeywords.length <= 3
    ? coreKeywords.length
    : Math.ceil(coreKeywords.length * 0.6);

  return matches >= required;
};

const getArticleAgeDays = (publishedAt) => {
  if (!publishedAt) return Infinity;
  const diff = Date.now() - new Date(publishedAt).getTime();
  return diff / (1000 * 60 * 60 * 24);
};

const STOPWORDS = new Set([
  // Português
  'de','a','o','e','do','da','em','para','com','que','não','um','uma','uns','umas',
  'os','as','se','na','no','nas','nos','por','pelo','pela','pelos','pelas',
  'mais','menos','foi','ao','aos','mas','ou','já','sobre','entre','após','ante',
  'até','desde','sem','sob','disse','segundo','ainda','também','muito','muitos',
  'muitas','pouco','poucos','poucas','esse','essa','esses','essas','este','esta',
  'estes','estas','isso','isto','aquele','aquela','seu','sua','seus','suas',
  'ele','ela','eles','elas','como','quando','onde','porque','pois','então',
  'assim','todo','toda','todos','todas','cada','outro','outra','outros','outras',
  'ser','estar','ter','haver','vai','vão','foi','são','está','estão','pode','podem',
  // Inglês (conteúdo raspado às vezes vem misturado)
  'this','the','is','are','was','were','be','been','being','have',
  'has','had','do','does','did','will','would','could','should','and','for','with',
]);

const extractKeywords = (text, maxWords = 10) => {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-záàâãéêíóôõúüç\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w))
    .slice(0, maxWords);
};

const BR_CONTEXT = '(brasil OR brazil)';

/**
 * Gera as queries para a News API (precisa com AND + sinônimos, e fallback com OR)
 * e devolve também o texto da alegação e as palavras-chave, reaproveitados na busca de checagens.
 */
const buildQueries = (rawContent, inputType) => {
  let base = rawContent;

  if (inputType === 'url' && rawContent.includes('Título:')) {
    base = rawContent.split('\n')[0].replace('Título:', '').trim();
  }

  const cleaned = base.substring(0, 150).trim();
  const keywords = extractKeywords(cleaned, 10);

  if (keywords.length === 0) {
    return { queries: [`${cleaned} ${BR_CONTEXT}`], coreKeywords: [], keywords: [], claimText: cleaned };
  }

  const coreKeywords = keywords.slice(0, 5);

  const preciseQuery = coreKeywords
    .map(kw => {
      const synonyms = expandSynonyms(kw);
      return synonyms.length > 1 ? `(${synonyms.join(' OR ')})` : kw;
    })
    .join(' AND ');

  const looseQuery = `${keywords.join(' OR ')} ${BR_CONTEXT}`;

  const queries = [preciseQuery];
  if (looseQuery !== preciseQuery) queries.push(looseQuery);

  console.log('[Checker] Query precisa (AND):', preciseQuery);
  console.log('[Checker] Query de fallback (OR):', looseQuery);
  return { queries, coreKeywords, keywords, claimText: cleaned };
};

// ─────────────────────────────────────────────
// NEWS API
// ─────────────────────────────────────────────

const fetchFromNewsAPI = async (query) => {
  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: {
      q:        query,
      language: 'pt',
      sortBy:   'relevancy',
      pageSize: 30,
      apiKey:   process.env.NEWS_API,
    },
  });

  return response.data;
};

/** Busca com múltiplas queries e desduplicação por URL */
const searchSources = async (queries) => {
  if (!process.env.NEWS_API) {
    console.error('[News API] Chave NEWS_API não configurada no .env');
    return { articles: [], totalResults: 0 };
  }

  const seen    = new Set();
  const articles = [];
  let maxTotal  = 0;

  for (const query of queries) {
    try {
      const data = await fetchFromNewsAPI(query);
      maxTotal = Math.max(maxTotal, data.totalResults || 0);
      console.log(`[News API] Query: "${query}" → ${data.totalResults} resultados`);

      for (const a of (data.articles || [])) {
        if (!seen.has(a.url)) {
          seen.add(a.url);
          articles.push(a);
        }
      }
    } catch (err) {
      console.error(`[News API] Erro na query "${query}":`, err.response?.status, err.message);
    }
  }

  return { articles, totalResults: maxTotal };
};

// ─────────────────────────────────────────────
// GOOGLE FACT CHECK TOOLS API
// ─────────────────────────────────────────────

/**
 * Converte a classificação textual de uma agência ("Falso", "Enganoso", "Distorcido"...)
 * em uma categoria: 'false' | 'mixed' | 'true' | 'unknown'.
 * A ordem importa: "parcialmente falso" deve ser 'mixed', e "não é verdade" deve ser 'false'.
 */
const classifyRating = (rating = '') => {
  const r = normalize(rating);
  if (!r) return 'unknown';

  if (/(parcial|em parte|distorcid|exagerad|imprecis|descontextualiz|sem contexto|nao e bem assim|discutivel|misto|incomplet|desatualizad|mixed|partly)/.test(r)) return 'mixed';
  if (/\b(falso|falsa|fake|mentira|mentiroso|enganos[oa]|boato|golpe|inventad[oa]|manipulad[oa]|montagem|insustentavel|false)\b/.test(r)
      || /nao e verdade|nao procede|sem prova|sem evidencia/.test(r)) return 'false';
  if (/\b(verdade|verdadeiro|verdadeira|fato|correto|correta|comprovad[oa]|confirmad[oa]|real|true)\b/.test(r)) return 'true';
  return 'unknown';
};

/**
 * Busca checagens já publicadas por agências (Lupa, Aos Fatos, Estadão Verifica etc.).
 * Só devolve checagens cujo texto trata do MESMO fato (mesmo filtro de relevância dos artigos).
 * Se a chave não estiver configurada ou a API falhar, devolve [] e o sistema segue sem ela.
 */
const searchFactChecks = async (queries, coreKeywords) => {
  const key = getFactCheckKey();
  if (!key) return [];
  if (!coreKeywords || coreKeywords.length === 0) return []; // sem palavras-chave não há como garantir relevância

  const seen = new Set();
  const reviews = [];

  for (const query of queries.filter(Boolean)) {
    try {
      const { data } = await axios.get(FACT_CHECK_ENDPOINT, {
        params: { query, languageCode: 'pt', pageSize: 10, key },
        timeout: 10000,
      });
      console.log(`[Fact Check] Query: "${query}" → ${(data.claims || []).length} alegação(ões)`);

      for (const claim of (data.claims || [])) {
        for (const review of (claim.claimReview || [])) {
          if (!review.url || seen.has(review.url)) continue;
          seen.add(review.url);

          const relevant = isRelevantArticle(
            { title: claim.text, description: review.title },
            coreKeywords
          );
          if (!relevant) continue;

          reviews.push({
            claimText:  claim.text || review.title || '',
            claimant:   claim.claimant || '',
            publisher:  review.publisher?.name || review.publisher?.site || 'Agência de checagem',
            site:       review.publisher?.site || '',
            url:        review.url,
            title:      review.title || '',
            reviewDate: review.reviewDate || null,
            rating:     review.textualRating || '',
            kind:       classifyRating(review.textualRating),
          });
        }
      }
    } catch (err) {
      const status = err.response?.status;
      const reason = err.response?.data?.error?.message || err.message;
      if (status === 400 || status === 403) {
        console.error(`[Fact Check] Chave rejeitada (HTTP ${status}): ${reason}. Verifique se a "Fact Check Tools API" está ativada no projeto e se a chave está correta.`);
        return reviews; // não adianta tentar as demais queries
      }
      console.error(`[Fact Check] Erro na query "${query}":`, status, reason);
    }
  }

  return reviews.slice(0, 5);
};

/** Resume as checagens de agências em um veredito. Retorna null se nenhuma tiver classificação utilizável. */
const determineFactCheckVerdict = (reviews = []) => {
  const usable = reviews.filter(r => r.kind !== 'unknown');
  if (usable.length === 0) return null;

  const count = (k) => usable.filter(r => r.kind === k).length;
  const f = count('false');
  const t = count('true');
  const m = count('mixed');

  const described = usable.slice(0, 3)
    .map(r => `${r.publisher} classificou como "${r.rating}"`).join('; ');
  const claim = (usable[0].claimText || '').substring(0, 160);
  const claimLine = claim ? ` Alegação analisada pela agência: "${claim}".` : '';
  const confidence = (base) => Math.min(97, base + 3 * (usable.length - 1));

  if (f > 0 && t === 0) {
    return {
      verdict: 'FALSO / NÃO VERIFICADO',
      confidenceScore: confidence(88),
      explanation: `Agência(s) de checagem de fatos já analisaram esta alegação: ${described}.${claimLine} `
        + 'Checagens profissionais têm prioridade sobre o volume de cobertura. Não compartilhe sem conferir a fonte original.',
    };
  }
  if (t > 0 && f === 0 && m === 0) {
    return {
      verdict: 'VERDADEIRO',
      confidenceScore: confidence(88),
      explanation: `Agência(s) de checagem de fatos confirmaram esta informação: ${described}.${claimLine}`,
    };
  }
  if (f === 0) {
    return {
      verdict: 'PARCIALMENTE VERDADEIRO',
      confidenceScore: confidence(75),
      explanation: `Agência(s) de checagem de fatos encontraram problemas de contexto ou exagero nesta informação: ${described}.${claimLine} `
        + 'Leia a checagem completa para entender o que é correto e o que não é.',
    };
  }
  return {
    verdict: 'INCONCLUSIVO',
    confidenceScore: 50,
    explanation: `As agências de checagem divergem sobre esta alegação: ${described}.${claimLine} Consulte as checagens originais.`,
  };
};

// ─────────────────────────────────────────────
// ANÁLISE E SCORING DOS ARTIGOS
// ─────────────────────────────────────────────

/** Anexa fonte e flag de desmentido a cada artigo e ordena: checadores → maior confiança → mais recentes. */
const analyzeArticles = (articles) => {
  return articles
    .map(article => ({ article, info: getSourceInfo(article), debunking: isDebunkingArticle(article) }))
    .sort((a, b) =>
      (b.info.factChecker - a.info.factChecker) ||
      (b.info.weight - a.info.weight) ||
      (new Date(b.article.publishedAt || 0) - new Date(a.article.publishedAt || 0))
    );
};

/**
 * Score de credibilidade (0–100) baseado em quantidade, peso, recência e diversidade de fontes
 * CONFIÁVEIS. O veredito forçado de FALSO (hardFalse) só dispara se uma agência de checagem
 * desmentiu OU se 2+ veículos confiáveis distintos desmentiram — um único veículo apenas penaliza o score.
 */
const calculateCredibilityScore = (analyzed) => {
  if (analyzed.length === 0) return { score: 0, hardFalse: false, debunkSources: [] };

  let rawScore = 0;
  const uniqueTrusted = new Set();
  const debunkers = [];

  for (const { article, info, debunking } of analyzed) {
    if (debunking && info.weight >= 0.7) {
      rawScore -= info.weight * 25;
      debunkers.push({ name: info.name, factChecker: info.factChecker });
      continue;
    }

    if (info.weight === 0) continue;

    const ageDays = getArticleAgeDays(article.publishedAt);
    let recency = 0;
    if (ageDays <= RECENCY_WINDOWS.VERY_RECENT)  recency = 15;
    else if (ageDays <= RECENCY_WINDOWS.RECENT)  recency = 5;
    else if (ageDays >  RECENCY_WINDOWS.OLD)     recency = -10;

    // A recência é proporcional ao peso: uma fonte desconhecida recente não vale mais que uma confiável antiga
    rawScore += info.weight * (10 + recency);
    if (info.trusted) uniqueTrusted.add(info.name);
  }

  rawScore += Math.min(uniqueTrusted.size * 3, 20);

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const debunkSources = [...new Set(debunkers.map(d => d.name))];
  const hardFalse = debunkers.some(d => d.factChecker) || debunkSources.length >= 2;
  return { score, hardFalse, debunkSources };
};

// ─────────────────────────────────────────────
// VEREDITO HEURÍSTICO
// ─────────────────────────────────────────────

/**
 * Veredito por regras. Só afirma VERDADEIRO com boa cobertura de fontes confiáveis e só afirma FALSO
 * com desmentido real. Ausência ou pouca cobertura NUNCA vira "falso": vira INCONCLUSIVO.
 */
const determineVerdict = (score, analyzed, totalResults, hardFalse, debunkSources) => {
  const uniqueSources  = [...new Set(analyzed.map(a => a.info.name))];
  const trustedPresent = [...new Set(analyzed.filter(a => a.info.trusted && !a.debunking).map(a => a.info.name))];
  const sourceList     = uniqueSources.slice(0, 5).join(', ') || 'nenhuma';

  let verdict, confidenceScore, explanation;

  if (hardFalse) {
    verdict         = 'FALSO / NÃO VERIFICADO';
    confidenceScore = 90;
    explanation     = `Fonte(s) confiável(is) (${debunkSources.join(', ')}) classificaram esta informação `
      + 'como falsa, boato ou enganosa. Esse desmentido tem prioridade sobre o volume geral de cobertura: '
      + 'mesmo que o tema apareça em outros veículos, o conteúdo desses artigos desmente a alegação. '
      + 'Não compartilhe sem checar a fonte original.';
  } else if (score >= 70 && trustedPresent.length >= 2) {
    verdict         = 'VERDADEIRO';
    confidenceScore = Math.min(85, score);
    explanation     = `Há ampla cobertura desta informação por veículos confiáveis (${trustedPresent.slice(0, 3).join(', ')}), `
      + `em ${analyzed.length} artigo(s) de ${uniqueSources.length} veículo(s) distintos. `
      + (totalResults > 20 ? `O volume total de ${totalResults} resultados reforça a ampla cobertura. ` : '')
      + 'Atenção: cobertura indica que o fato foi noticiado; confira os detalhes nas fontes abaixo.';
  } else if (analyzed.length === 0) {
    verdict         = 'INCONCLUSIVO';
    confidenceScore = 10;
    explanation     = 'Nenhuma matéria sobre este assunto foi encontrada nas fontes consultadas. '
      + 'Isso NÃO significa que a informação seja falsa: a busca cobre apenas notícias recentes e pode não ter registrado o fato. '
      + 'Consulte agências de checagem (Lupa, Aos Fatos) e a fonte original antes de compartilhar.';
  } else if (trustedPresent.length === 0) {
    verdict         = 'INCONCLUSIVO';
    confidenceScore = Math.min(40, Math.max(10, score));
    explanation     = `Foram encontrados ${analyzed.length} artigo(s), mas nenhum de veículo reconhecidamente confiável (${sourceList}). `
      + 'Sem confirmação de fontes confiáveis não é possível afirmar se a informação é verdadeira ou falsa. '
      + 'Busque a fonte original antes de repassar.';
  } else {
    verdict         = 'INCONCLUSIVO';
    confidenceScore = Math.min(60, Math.max(10, score));
    explanation     = `A cobertura encontrada é limitada (score ${score}/100): ${analyzed.length} artigo(s) de ${uniqueSources.length} veículo(s) (${sourceList}), `
      + `com ${trustedPresent.length} fonte(s) confiável(is). Isso não basta para confirmar nem descartar a informação. `
      + 'Verifique os detalhes em fontes primárias antes de compartilhar.';
  }

  return { verdict, confidenceScore, explanation, uniqueSources, trustedPresent };
};

// ─────────────────────────────────────────────
// IA — camada de confirmação (opcional)
// ─────────────────────────────────────────────

const ALLOWED_VERDICTS = ['VERDADEIRO', 'PARCIALMENTE VERDADEIRO', 'INCONCLUSIVO', 'FALSO / NÃO VERIFICADO'];

const buildAiPrompt = (content, heuristic, analyzed, factChecks) => {
  const evidenceLines = analyzed.slice(0, 8).map(({ article: a, info, debunking }, i) => {
    const trustedTag = info.weight >= 0.7 ? 'FONTE CONFIÁVEL' : info.weight === 0 ? 'fonte de baixa credibilidade' : 'fonte de credibilidade incerta';
    const debunkTag = debunking ? ' ⚠️ ESTE ARTIGO PARECE DESMENTIR/CHECAR A ALEGAÇÃO COMO FALSA' : '';
    return `${i + 1}. [${trustedTag}]${debunkTag} ${info.name} — "${a.title || ''}"\n   Resumo: ${(a.description || '').substring(0, 300)}\n   Publicado em: ${a.publishedAt || 'data desconhecida'}\n   URL: ${a.url}`;
  }).join('\n\n');

  const factCheckLines = factChecks.slice(0, 5).map((r, i) =>
    `${i + 1}. [CHECAGEM DE AGÊNCIA] ${r.publisher} classificou como "${r.rating}" a alegação: "${(r.claimText || '').substring(0, 200)}" — ${r.url}`
  ).join('\n');

  const system = `Você é um verificador de fatos (fact-checker) brasileiro, rigoroso e cético.
Avalie a alegação usando SOMENTE as evidências fornecidas abaixo. Não use conhecimento próprio para confirmar ou negar a alegação.
Regras obrigatórias:
- NUNCA invente fatos, datas, números, declarações ou nomes de veículos que não estejam nas evidências.
- Se as evidências não tratarem DIRETAMENTE do fato alegado, o veredito deve ser "INCONCLUSIVO". A AUSÊNCIA de matérias NÃO prova que a alegação é falsa.
- Se houver "CHECAGEM DE AGÊNCIA" tratando da mesma alegação, o veredito DEVE seguir a classificação dela.
- Se QUALQUER evidência marcada como "ESTE ARTIGO PARECE DESMENTIR" vier de fonte confiável ou agência de fact-checking, o veredito DEVE ser "FALSO / NÃO VERIFICADO".
- Cobertura jornalística de um boato não confirma o boato: verifique se o artigo AFIRMA o fato ou apenas o MENCIONA.
- Fontes de baixa credibilidade (blogs, redes sociais) NÃO confirmam uma alegação por si só.
- Uma evidência citar a MESMA PESSOA/ENTIDADE não significa que trata do MESMO FATO. Ignore evidências sobre outro assunto.
- Responda ESTRITAMENTE em JSON válido, sem markdown, sem texto fora do JSON, no formato:
{"verdict": "VERDADEIRO" | "PARCIALMENTE VERDADEIRO" | "INCONCLUSIVO" | "FALSO / NÃO VERIFICADO", "confidenceScore": <número 0-100>, "explanation": "<3 a 5 frases em português, citando apenas fontes que aparecem nas evidências>", "keyPoints": ["<ponto curto 1>", "<ponto curto 2>", "<ponto curto 3>"]}`;

  const user = `ALEGAÇÃO/TEXTO A VERIFICAR:
"""${content.substring(0, 1200)}"""

PRÉ-ANÁLISE AUTOMÁTICA (heurística por reputação de fontes — pode estar errada, use só como referência):
Veredito preliminar: ${heuristic.verdict} (score ${heuristic.score}/100)

CHECAGENS DE AGÊNCIAS (fact-checkers) SOBRE A ALEGAÇÃO:
${factCheckLines || 'Nenhuma checagem de agência encontrada.'}

ARTIGOS JORNALÍSTICOS ENCONTRADOS (já ordenados por confiabilidade):
${evidenceLines || 'Nenhum artigo relacionado foi encontrado na busca.'}

Responda apenas o JSON pedido.`;

  return { system, user };
};

/** Chama a OpenAI. Retorna null se não configurada ou se a chamada falhar. */
const confirmWithAI = async (content, heuristic, score, analyzed, factChecks) => {
  if (!openaiClient) return null;

  try {
    const { system, user } = buildAiPrompt(content, { verdict: heuristic.verdict, score }, analyzed, factChecks);

    const completion = await openaiClient.chat.completions.create({
      model: AI_MODEL,
      temperature: 0.2,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);

    if (!ALLOWED_VERDICTS.includes(parsed.verdict)) return null;
    if (typeof parsed.confidenceScore !== 'number') return null;

    return {
      verdict: parsed.verdict,
      confidenceScore: Math.max(0, Math.min(100, Math.round(parsed.confidenceScore))),
      explanation: String(parsed.explanation || '').trim() || heuristic.explanation,
      keyPoints: Array.isArray(parsed.keyPoints) && parsed.keyPoints.length > 0
        ? parsed.keyPoints.map(String)
        : null,
    };
  } catch (err) {
    console.error('[IA] Falha na camada de confirmação, usando apenas heurística:', err.message);
    return null;
  }
};

/**
 * Rede de segurança sobre a resposta da IA: ela não pode "inventar" um veredito que as
 * evidências não sustentam. Quando o guarda discorda, o resultado cai para INCONCLUSIVO
 * com a explicação heurística (que descreve exatamente o que foi encontrado).
 */
const guardAiResult = (ai, { hardFalse, debunkSources, trustedCount, heuristic }) => {
  if (!ai) return null;

  // Desmentido forte (agência de checagem / 2+ veículos): a IA não pode contrariar
  if (hardFalse && ai.verdict !== 'FALSO / NÃO VERIFICADO') return null;

  const downgrade = () => ({
    verdict: 'INCONCLUSIVO',
    confidenceScore: Math.min(ai.confidenceScore, 60),
    explanation: heuristic.explanation,
    keyPoints: null,
  });

  // FALSO exige desmentido real — ausência de cobertura não é prova de falsidade
  if (ai.verdict === 'FALSO / NÃO VERIFICADO' && !hardFalse && debunkSources.length === 0) return downgrade();

  // VERDADEIRO / PARCIALMENTE exige ao menos uma fonte confiável nas evidências
  if ((ai.verdict === 'VERDADEIRO' || ai.verdict === 'PARCIALMENTE VERDADEIRO') && trustedCount === 0) return downgrade();

  return ai;
};

// ─────────────────────────────────────────────
// MONTAGEM DAS FONTES EXIBIDAS
// ─────────────────────────────────────────────

/** Mesma URL (sem query/barra final) ou mesmo título normalizado = é o próprio artigo verificado ou cópia dele. */
const isSameAsInput = (article, sourceUrl, inputTitle) => {
  const a = parseUrl(article.url);
  const b = parseUrl(sourceUrl);
  if (a && b && a.host === b.host && a.path.replace(/\/+$/, '') === b.path.replace(/\/+$/, '')) return true;
  if (inputTitle && normalize(article.title).trim() === normalize(inputTitle).trim()) return true;
  return false;
};

/**
 * Escolhe poucas fontes, as melhores: checagens de agências primeiro, depois artigos de fontes
 * confiáveis (ordenados por confiança e recência). Fontes de baixa credibilidade nunca aparecem;
 * fontes desconhecidas só entram se houver menos de 3 confiáveis.
 */
const buildDisplaySources = (analyzed, factChecks) => {
  const fromFactChecks = factChecks.slice(0, 3).map(r => ({
    title:       r.title || r.claimText,
    url:         r.url,
    snippet:     r.claimText ? `Alegação analisada: ${r.claimText}`.substring(0, 300) : '',
    source:      r.publisher,
    publishedAt: r.reviewDate,
    weight:      1,
    trusted:     true,
    debunking:   r.kind === 'false',
    factCheck:   true,
    rating:      r.rating,
    ratingKind:  r.kind,
  }));

  const room = Math.max(3, MAX_DISPLAY_SOURCES - fromFactChecks.length);
  const good = analyzed.filter(a => a.info.weight >= 0.7);
  const unknown = analyzed.filter(a => a.info.weight > 0 && a.info.weight < 0.7);
  const picked = (good.length >= 3 ? good : [...good, ...unknown]).slice(0, room);

  const fromArticles = picked.map(({ article: a, info, debunking }) => ({
    title:       a.title,
    url:         a.url,
    snippet:     a.description || '',
    source:      info.name,
    publishedAt: a.publishedAt,
    weight:      info.weight,
    trusted:     info.trusted,
    debunking,
    factCheck:   info.factChecker,
  }));

  return [...fromFactChecks, ...fromArticles];
};

// ─────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────

/**
 * Verifica uma notícia/texto:
 *  1. busca checagens de agências (Google Fact Check) e cobertura na News API em paralelo;
 *  2. calcula um score por regras sobre artigos relevantes;
 *  3. se configurada, usa a OpenAI para revisar as MESMAS evidências (com guarda de segurança);
 *  4. checagens de agências têm a palavra final sobre o veredito.
 *
 * @param {string} content   - Texto, ou "Título: ...\n\nConteúdo: ..." no caso de URL
 * @param {string} inputType - 'text' | 'url'
 * @param {{sourceUrl?: string}} options - URL original (para não usar a própria matéria como confirmação)
 */
const checkWithAI = async (content, inputType, options = {}) => {
  const { queries, coreKeywords, keywords, claimText } = buildQueries(content, inputType);
  console.log('[Checker] Queries geradas:', queries, '| Palavras-chave centrais:', coreKeywords);

  // 1. Busca em paralelo: News API + checagens de agências
  const factCheckQueries = [claimText, keywords.slice(0, 6).join(' ')].filter((q, i, arr) => q && arr.indexOf(q) === i);
  const [{ articles: rawArticles, totalResults }, factChecks] = await Promise.all([
    searchSources(queries),
    searchFactChecks(factCheckQueries, coreKeywords),
  ]);

  // 2. Filtra artigos de outro contexto e, no caso de URL, a própria matéria verificada
  const inputTitle = inputType === 'url' ? claimText : null;
  let articles = rawArticles.filter(a => isRelevantArticle(a, coreKeywords));
  const discardedCount = rawArticles.length - articles.length;
  if (discardedCount > 0) {
    console.log(`[Checker] ${discardedCount} artigo(s) descartado(s) por não tratarem do mesmo fato.`);
  }
  if (inputType === 'url' && options.sourceUrl) {
    const before = articles.length;
    articles = articles.filter(a => !isSameAsInput(a, options.sourceUrl, inputTitle));
    if (before > articles.length) console.log('[Checker] A própria matéria verificada foi removida das evidências.');
  }

  // 3. Análise por regras
  const analyzed = analyzeArticles(articles);
  const { score, hardFalse, debunkSources } = calculateCredibilityScore(analyzed);
  console.log(`[Checker] Score: ${score}/100 (${articles.length} artigos, ${factChecks.length} checagens, hardFalse=${hardFalse})`);

  const heuristic = determineVerdict(score, analyzed, totalResults, hardFalse, debunkSources);
  const factCheckVerdict = determineFactCheckVerdict(factChecks);

  const heuristicKeyPoints = [
    `${articles.length} artigo(s) relevante(s) de ${heuristic.uniqueSources.length} veículo(s)`,
    heuristic.trustedPresent.length > 0
      ? `Fontes confiáveis presentes: ${heuristic.trustedPresent.slice(0, 4).join(', ')}`
      : 'Nenhuma fonte de alta confiabilidade identificada',
    debunkSources.length > 0
      ? `⚠️ Desmentido por: ${debunkSources.join(', ')}`
      : `Score de credibilidade: ${score}/100`,
  ];
  if (discardedCount > 0) {
    heuristicKeyPoints.push(`${discardedCount} artigo(s) descartado(s) por citarem o mesmo tema em outro contexto`);
  }

  // 4. IA (só quando há evidência — sem evidência ela só inventaria algo)
  const hasEvidence = articles.length > 0 || factChecks.length > 0;
  const aiRaw = hasEvidence ? await confirmWithAI(content, heuristic, score, analyzed, factChecks) : null;
  const aiResult = guardAiResult(aiRaw, {
    hardFalse,
    debunkSources,
    trustedCount: heuristic.trustedPresent.length + (factCheckVerdict ? 1 : 0),
    heuristic,
  });

  // 5. Veredito final — checagem de agência > IA (guardada) > heurística
  let final;
  if (factCheckVerdict) {
    const agrees = aiResult && aiResult.verdict === factCheckVerdict.verdict;
    const checkedBy = [...new Set(factChecks.filter(r => r.kind !== 'unknown').map(r => `${r.publisher} (${r.rating || 'sem classificação'})`))];
    final = {
      verdict: factCheckVerdict.verdict,
      confidenceScore: factCheckVerdict.confidenceScore,
      explanation: factCheckVerdict.explanation + (agrees ? ` Análise complementar: ${aiResult.explanation}` : ''),
      keyPoints: [`Checado por agência(s): ${checkedBy.slice(0, 3).join(', ')}`, ...(aiResult?.keyPoints || heuristicKeyPoints)].slice(0, 5),
    };
  } else if (aiResult) {
    final = {
      verdict: aiResult.verdict,
      confidenceScore: aiResult.confidenceScore,
      explanation: aiResult.explanation,
      keyPoints: aiResult.keyPoints || heuristicKeyPoints,
    };
  } else {
    final = {
      verdict: heuristic.verdict,
      confidenceScore: heuristic.confidenceScore,
      explanation: heuristic.explanation + (hasEvidence && !openaiClient ? ' (Verificação por IA não configurada — resultado baseado apenas em fontes.)' : ''),
      keyPoints: heuristicKeyPoints,
    };
  }

  const sources = buildDisplaySources(analyzed, factChecks);

  return {
    verdict:         final.verdict,
    confidenceScore: final.confidenceScore,
    summary:         `Verificação baseada em ${articles.length} artigo(s) de ${heuristic.uniqueSources.length} fonte(s)`
      + `${factChecks.length > 0 ? ` e ${factChecks.length} checagem(ns) de agências` : ''}`
      + `${aiResult ? ', com revisão por IA' : ''}. Score algorítmico: ${score}/100.`,
    explanation:     final.explanation,
    keyPoints:       final.keyPoints,
    searchQuery:     queries[0],
    factCheckCount:  factChecks.length,
    sources,
  };
};

module.exports = {
  checkWithAI,
  searchSources,
  searchFactChecks,
  buildQueries,
  classifyRating,
  determineFactCheckVerdict,
  getSourceInfo,
  isDebunkingArticle,
  isUntrustedDomain,
  getSourceWeight,
};
