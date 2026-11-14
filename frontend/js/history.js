const HISTORY_PAGE_SIZE = 10;
let historyPage = 1;

document.addEventListener('DOMContentLoaded', () => {
  auth.updateNavbar();

  // O histórico é só para usuários logados
  if (!auth.isLoggedIn()) {
    window.location.href = 'login.html';
    return;
  }

  loadHistory(1);
});

/** Escapa HTML para evitar injeção de código vindo do texto verificado. */
function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Mapeia o veredito para o sufixo das classes CSS (dot-*, badge-*). */
function verdictKind(verdict = '') {
  if (verdict === 'VERDADEIRO') return 'true';
  if (verdict.startsWith('FALSO')) return 'false';
  if (verdict === 'PARCIALMENTE VERDADEIRO') return 'partial';
  return 'inconclusive';
}

function showHistoryError(message) {
  document.getElementById('historyContent').innerHTML = `
    <div class="alert alert-error">
      <i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(message)}
    </div>`;
}

async function loadHistory(page = 1) {
  const container = document.getElementById('historyContent');

  try {
    const data = await api.getHistory(page, HISTORY_PAGE_SIZE);
    historyPage = data.pagination.page;

    // Se apagou o último item de uma página que não é a primeira, volta uma página
    if (data.checks.length === 0 && data.pagination.total > 0 && page > 1) {
      return loadHistory(page - 1);
    }

    if (data.checks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🕓</div>
          <h3>Nenhuma verificação ainda</h3>
          <p>Suas verificações de fatos vão aparecer aqui.</p>
          <a href="index.html" class="btn btn-primary">Verificar uma notícia</a>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="history-grid">${data.checks.map(renderHistoryItem).join('')}</div>
      ${renderPagination(data.pagination)}`;
  } catch (error) {
    // Token expirado/inválido: manda para o login
    if (/token|acesso negado|usu[aá]rio n[aã]o encontrado/i.test(error.message)) {
      auth.removeToken();
      window.location.href = 'login.html';
      return;
    }
    showHistoryError(error.message || 'Erro ao carregar o histórico.');
  }
}

function renderHistoryItem(check) {
  const kind = verdictKind(check.verdict);
  const title = check.articleTitle && check.inputType === 'url'
    ? check.articleTitle
    : check.inputContent;
  const icon = check.inputType === 'url' ? 'fa-link' : 'fa-align-left';
  const date = new Date(check.createdAt).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });

  return `
    <a class="history-item" href="result.html?id=${encodeURIComponent(check.shareId)}">
      <span class="history-verdict-dot dot-${kind}"></span>
      <div class="history-content">
        <h4>${escapeHtml(title)}</h4>
        <p><i class="fa-solid ${icon}"></i> ${date} • Confiança ${Number(check.confidenceScore) || 0}%</p>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="history-badge badge-${kind}">${escapeHtml(check.verdict)}</span>
        <button class="btn btn-ghost btn-sm" title="Remover do histórico"
          onclick="deleteHistoryItem(event, '${encodeURIComponent(check._id)}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </a>`;
}

function renderPagination({ page, pages }) {
  if (pages <= 1) return '';
  return `
    <div style="display:flex;justify-content:center;align-items:center;gap:16px;margin-top:24px;">
      <button class="btn btn-outline btn-sm" ${page <= 1 ? 'disabled' : ''}
        onclick="loadHistory(${page - 1})">
        <i class="fa-solid fa-chevron-left"></i> Anterior
      </button>
      <span style="font-size:0.9rem;">Página ${page} de ${pages}</span>
      <button class="btn btn-outline btn-sm" ${page >= pages ? 'disabled' : ''}
        onclick="loadHistory(${page + 1})">
        Próxima <i class="fa-solid fa-chevron-right"></i>
      </button>
    </div>`;
}

async function deleteHistoryItem(event, id) {
  // O item inteiro é um link; impede de abrir o resultado ao clicar na lixeira
  event.preventDefault();
  event.stopPropagation();

  if (!confirm('Remover esta verificação do histórico?')) return;

  try {
    await api.deleteHistory(id);
    loadHistory(historyPage);
  } catch (error) {
    alert(error.message || 'Erro ao remover.');
  }
}
