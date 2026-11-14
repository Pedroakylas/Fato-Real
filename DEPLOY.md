# Como colocar o Fato Real no ar (Vercel + MongoDB Atlas)

O site inteiro (frontend + API) roda na Vercel, no mesmo domínio:
- `https://SEU-SITE.vercel.app/`      → páginas (pasta `frontend/`)
- `https://SEU-SITE.vercel.app/api/…` → API Express (pasta `backend/`, via `api/index.js`)

## 1. MongoDB Atlas (banco gratuito)
1. Crie conta em https://www.mongodb.com/cloud/atlas e um cluster gratuito (M0).
2. **Database Access** → Add New Database User → defina usuário e senha (evite símbolos na senha).
3. **Network Access** → Add IP Address → **Allow access from anywhere** (`0.0.0.0/0`).
   (A Vercel usa IPs que mudam, por isso precisa liberar tudo.)
4. **Connect → Drivers** → copie a connection string e coloque o nome do banco antes do `?`:
   `mongodb+srv://USUARIO:SENHA@cluster0.xxxxx.mongodb.net/fato-real?retryWrites=true&w=majority`

## 2. Chaves
- `NEWS_API` (obrigatória): https://newsapi.org
- `GOOGLE_FACTCHECK_API_KEY` (opcional): Google Cloud → APIs e serviços → Credenciais → Chave de API
- `OPENAI_API_KEY` (opcional)
- `JWT_SECRET`: gere uma chave aleatória:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## 3. Subir para o GitHub
```bash
git init
git add .
git commit -m "Fato Real"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/fato-real.git
git push -u origin main
```
Antes, rode `git status` e confirme que **nenhum `.env` aparece** (o `.gitignore` já bloqueia).

## 4. Vercel
1. https://vercel.com → entre com o GitHub → **Add New → Project** → importe o repositório.
2. **Framework Preset: Other.** Root Directory: raiz (`./`). Não preencha Build/Output (o `vercel.json` já define).
3. Em **Environment Variables**, cadastre: `MONGODB_URI`, `JWT_SECRET`, `NEWS_API`,
   `GOOGLE_FACTCHECK_API_KEY` e (se usar) `OPENAI_API_KEY`.
4. **Deploy**.

## 5. Testar
1. Abra `https://SEU-SITE.vercel.app/api/health`. Deve mostrar `"status":"OK"`, `"database":"conectado"`
   e as chaves como `configurada`.
2. Abra a página inicial, faça uma verificação, cadastre um usuário e confira o histórico.

## Problemas comuns
| Sintoma | Causa / solução |
|---|---|
| `database: erro de conexão` | URI errada, senha com símbolo não codificado, ou falta liberar `0.0.0.0/0` no Atlas. |
| `database: não configurado` | Falta `MONGODB_URI` nas Environment Variables. Depois de alterar variáveis, faça **Redeploy**. |
| `newsApi: ausente` | Falta `NEWS_API`. Sem ela não há fontes. |
| Verificação sem fontes, erro 426/429 | Plano gratuito da News API é só para desenvolvimento e tem limite diário (100 req). |
| Erro 504 / demora | Função cortada por tempo. Ajuste `maxDuration` em `vercel.json` conforme seu plano. |
| Página abre, mas ações dão erro | Veja Vercel → projeto → **Logs**. |

## Rodar localmente
```bash
npm install
cp .env.example backend/.env     # e preencha
npm run dev                      # API em http://localhost:5000
npx http-server frontend -p 3000 # site em http://localhost:3000
```
Localmente o `api.js` usa `http://localhost:5000/api`; online usa `/api` automaticamente.

## Observações
- O limite de 50 verificações/15 min fica em memória: na Vercel cada instância tem o seu contador (serve como proteção básica).
- Nunca suba chaves para o GitHub. Se vazarem, gere novas.
