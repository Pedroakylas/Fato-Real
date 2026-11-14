const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Garante que a URL tenha um protocolo (http/https).
 * Usuários frequentemente colam URLs sem "https://" (ex: copiando do celular),
 * o que fazia `new URL()` falhar sempre.
 */
const normalizeUrl = (input) => {
  let url = (input || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url;
};

/**
 * Headers que imitam um navegador real. Sem eles, muitos portais de notícia
 * (G1, Folha, UOL, Estadão etc.) barram a requisição com 403, pois seus
 * firewalls (Cloudflare/Akamai) detectam bots por headers incompletos.
 */
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Referer': 'https://www.google.com/',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
};

/** Transforma erros técnicos do axios em mensagens claras em português. */
const buildFriendlyError = (error) => {
  if (error.response) {
    const status = error.response.status;
    if (status === 403 || status === 401) {
      return 'Este site bloqueia o acesso automatizado (proteção anti-bot). Copie o texto da notícia e use a aba "Verificar Texto" em vez da URL.';
    }
    if (status === 404) {
      return 'Página não encontrada (404). Verifique se o link está correto e completo.';
    }
    if (status === 429) {
      return 'O site está limitando o número de acessos no momento. Tente novamente em alguns minutos.';
    }
    if (status >= 500) {
      return `O site de origem está com problemas no momento (erro ${status}). Tente novamente mais tarde.`;
    }
    return `O site retornou um erro inesperado (HTTP ${status}).`;
  }
  if (error.code === 'ECONNABORTED') {
    return 'O site demorou demais para responder (tempo esgotado). Tente novamente.';
  }
  if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
    return 'Endereço não encontrado. Verifique se a URL está digitada corretamente.';
  }
  if (error.code === 'ECONNREFUSED') {
    return 'A conexão com o site foi recusada.';
  }
  if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
    return 'O certificado de segurança do site é inválido.';
  }
  return `Não foi possível acessar a URL: ${error.message}`;
};

const scrapeArticle = async (rawUrl) => {
  const url = normalizeUrl(rawUrl);

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      responseType: 'text',
      // Só lança erro para 4xx/5xx de verdade; deixamos o axios decidir e tratamos no catch.
      headers: BROWSER_HEADERS,
    });

    const $ = cheerio.load(response.data);
    $('script, style, nav, footer, header, aside, noscript, iframe').remove();

    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('h1').first().text() ||
      $('title').text() ||
      'Título não encontrado';

    // Tenta cada seletor e fica com o que trouxer o texto mais longo
    // (o primeiro seletor que "existe" nem sempre é o que tem o corpo real da matéria).
    const selectors = ['article', '.article-body', '.post-content', '.entry-content', '[itemprop="articleBody"]', 'main'];
    let content = '';

    for (const selector of selectors) {
      const el = $(selector);
      if (el.length) {
        const text = el.text().replace(/\s+/g, ' ').trim();
        if (text.length > content.length) content = text;
      }
    }

    // Fallback 1: corpo inteiro da página
    if (content.length < 50) {
      content = $('body').text().replace(/\s+/g, ' ').trim();
    }

    // Fallback 2: meta description, caso a página seja renderizada via JavaScript
    // (nesse caso o HTML bruto que o axios baixa não tem o texto da matéria).
    if (content.length < 50) {
      const metaDesc =
        $('meta[property="og:description"]').attr('content') ||
        $('meta[name="description"]').attr('content') ||
        '';
      if (metaDesc.trim().length >= 50) content = metaDesc.trim();
    }

    content = content.substring(0, 3000);

    if (content.length < 50) {
      throw new Error(
        'CONTENT_TOO_SHORT::Não foi possível extrair o texto da notícia. Esta página provavelmente carrega o conteúdo via JavaScript, o que este verificador não consegue ler. Copie o texto da notícia e use a aba "Verificar Texto".'
      );
    }

    return { success: true, title: title.trim(), content, url };

  } catch (error) {
    if (typeof error.message === 'string' && error.message.startsWith('CONTENT_TOO_SHORT::')) {
      throw new Error(error.message.replace('CONTENT_TOO_SHORT::', ''));
    }
    throw new Error(buildFriendlyError(error));
  }
};

module.exports = { scrapeArticle, normalizeUrl };
