# Estante — tracker de BD, Manga & Comics

PWA instalável (Android/iOS) para descobrir séries, marcar capítulos/volumes
como lidos e receber notificação quando sai lançamento novo de algo que
segues. Frontend 100% estático (GitHub Pages, grátis), com um Cloudflare
Worker minimalista a fazer de proxy seguro às APIs que precisam de chave
secreta e a disparar as notificações push.

**Fase 1 (base):** catálogo (Marvel/DC via Worker + Manga via AniList), biblioteca
local, progresso de leitura, PWA instalável, notificações push, PT/EN.
**Fase 2 (adicionada agora):** estatísticas pessoais (lidos, séries, sequência de
dias), sugestões "para ti" com base no que já lês, ordens de leitura sugeridas,
tema claro/escuro (automático ou manual), partilhar a estante.

## Checklist de publicação (ordem recomendada)

1. ☐ Criar o repositório no GitHub e publicar no GitHub Pages (secção 1)
2. ☐ Criar conta Cloudflare e publicar o Worker (secção 2)
3. ☐ Colar o URL do Worker em Definições → Endereço do servidor, na app (secção 3)
4. ☐ Adicionar os secrets `WORKER_URL` e `CRON_SECRET` no repositório GitHub (secção 4)
5. ☐ Testar: instalar a PWA no telemóvel, ativar notificações, seguir uma série, correr o workflow manualmente uma vez para confirmar que chega uma notificação
6. ☐ (Opcional) Restringir o CORS do Worker ao teu domínio do GitHub Pages, em vez de `*` — ver nota no fim da secção 2

## Estrutura

```
.
├── index.html, css/, js/, locales/, icons/, manifest.json, sw.js   ← app estática (GitHub Pages)
├── worker/                                                         ← Cloudflare Worker (proxy + push)
└── .github/workflows/check-updates.yml                             ← cron gratuito (GitHub Actions)
```

## O que fica onde (importante para privacidade/segurança)

- **Biblioteca, progresso de leitura, capítulos lidos** → só no teu telemóvel (IndexedDB). Nunca saem daí.
- **Lista "a seguir" + subscrição de notificações** → guardadas no Worker (Cloudflare KV), porque é o mínimo necessário para o cron saber a quem avisar quando sai algo novo.
- **Chaves da Marvel / Comic Vine / VAPID** → só existem como *secrets* do Worker. Nunca aparecem no repositório nem no código que corre no browser.

---

## 1. Publicar o frontend no GitHub Pages

1. Cria um repositório novo no GitHub e envia o conteúdo desta pasta (exceto `worker/`, que é um projeto à parte) para a branch `main`.
2. Em **Settings → Pages**, escolhe "Deploy from a branch", branch `main`, pasta `/ (root)`.
3. Ao fim de um minuto o site fica em `https://SEU-UTILIZADOR.github.io/NOME-DO-REPO/`.

Sem mais nada configurado, a app já funciona: consegues pesquisar manga (AniList, direto do browser), adicionar à biblioteca, marcar capítulos como lidos e instalar como PWA. Marvel/DC e as notificações push só ficam ativos depois do passo 2.

## 2. Publicar o Cloudflare Worker (proxy + notificações)

Precisas de uma conta Cloudflare gratuita.

```bash
cd worker
npm install
npx wrangler login

# cria o armazenamento (KV) usado para a lista "a seguir" e subscrições
npx wrangler kv namespace create ESTANTE_KV
# copia o "id" que aparece e cola em wrangler.toml
```

Gera as chaves de notificação (VAPID) — podes usar o pacote já instalado:

```bash
node -e "import('@block65/webcrypto-web-push').then(async m=>{const k=await m.generateVapidKeys();console.log(k)})"
```

Guarda os segredos no Worker (nunca no repositório):

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT        # ex: mailto:tu@example.com
npx wrangler secret put CRON_SECRET          # inventa uma password aleatória

# opcionais — só precisas se quiseres Marvel/DC:
npx wrangler secret put MARVEL_PUBLIC_KEY
npx wrangler secret put MARVEL_PRIVATE_KEY
npx wrangler secret put COMICVINE_API_KEY
```

- Chave Marvel: developer.marvel.com (gratuita, tens public key + private key).
- Chave Comic Vine: comicvine.gamespot.com/api (gratuita, só uso não-comercial — perfeito para uso pessoal).

Publica:

```bash
npx wrangler deploy
```

Vais ficar com um URL tipo `https://estante-proxy.SEU-UTILIZADOR.workers.dev`.

**Nota de segurança opcional mas recomendada:** por omissão o Worker aceita
pedidos de qualquer origem (`access-control-allow-origin: "*"` em
`worker/src/index.js`). Depois de teres o teu URL definitivo do GitHub Pages,
troca esse `"*"` pelo teu domínio real (ex.:
`"https://SEU-UTILIZADOR.github.io"`) e volta a fazer `npx wrangler deploy`.
Isto impede que outros sites usem o teu Worker (e a tua quota das APIs) sem
seres tu a pedir.

Também vale a pena substituir `SEU-UTILIZADOR/estante` no `User-Agent` que o
Worker envia à Comic Vine (`worker/src/index.js`, função `searchComicVine` e
`comicVineIssueCount`) pelo link real do teu repositório — a Comic Vine pede
um User-Agent identificável nos termos de uso.

## 3. Ligar o frontend ao Worker

Na app, vai a **Definições → Endereço do servidor** e cola esse URL. É guardado localmente no teu dispositivo — cada pessoa que usar a app aponta para o seu próprio Worker (ou todos podem partilhar o mesmo, se preferires simplificar).

## 4. Ativar o cron gratuito (verificação periódica)

No repositório do GitHub, em **Settings → Secrets and variables → Actions**, cria:

- `WORKER_URL` → o URL do teu Worker (sem barra final)
- `CRON_SECRET` → o mesmo valor que puseste em `wrangler secret put CRON_SECRET`

O workflow em `.github/workflows/check-updates.yml` já está configurado para correr de 6 em 6 horas, gratuito em repositórios públicos. Podes disparar manualmente em **Actions → Verificar lançamentos novos → Run workflow** para testar.

---

## Limitações conhecidas (por design, para te pouparem surpresas)

- **iOS**: notificações push só funcionam depois de instalares a PWA no ecrã principal (Partilhar → Adicionar ao Ecrã Principal). Uma aba do Safari nunca recebe push, é uma limitação da Apple.
- **Contagem de capítulos Marvel/DC**: a Marvel/Comic Vine não expõem uma lista "capítulo 1, 2, 3…" como o manga — o número total é uma aproximação (nº de issues catalogadas). Serve bem para marcar progresso, mas não é garantidamente exato ao lançamento oficial mais recente.
- **Comic Vine**: chave gratuita é só para uso não-comercial.
- **Sem CORS no browser para Marvel/Comic Vine**: por isso passam sempre pelo Worker; só o manga (AniList) é chamado diretamente do browser.

## Desenvolvimento local

Não há build step — é só abrir `index.html` com um servidor estático simples (por causa do `fetch` dos JSON de `locales/` e do módulo ES):

```bash
npx serve .
# ou: python3 -m http.server 8080
```

Para o Worker: `cd worker && npx wrangler dev`.
