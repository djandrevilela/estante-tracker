<div align="center">

# 📚 Estante

**Segue BD, manga e comics — sem contas, sem anúncios, sem enviares os teus dados para lado nenhum.**

[![PWA](https://img.shields.io/badge/PWA-instalável-121218?style=flat-square)](#)
[![Licença MIT](https://img.shields.io/badge/licença-MIT-D62839?style=flat-square)](LICENSE)
[![PT/EN](https://img.shields.io/badge/idiomas-PT%20%2F%20EN-35608D?style=flat-square)](#)

</div>

---

Estante é uma PWA gratuita e de código aberto para descobrir séries de BD, comics e manga, marcar o que já leste e receber um aviso quando sai capítulo ou volume novo de algo que segues. Instala-se no ecrã principal do Android ou do iOS como uma app normal — sem loja de aplicações, sem conta, sem publicidade.

## ✨ Funcionalidades

- 🔍 **Descobrir** — pesquisa Marvel, DC (via Comic Vine) e manga (via AniList), com sinopse, editora e capa
- 📖 **Biblioteca pessoal** — organiza por "a seguir", a ler, lido ou abandonado
- ✅ **Progresso de leitura** — marca capítulos e volumes individualmente, ou tudo de uma vez
- 🔔 **Notificações push** — avisa quando sai algo novo do que segues, mesmo com a app fechada
- 💡 **Sugestões para ti** — recomendações com base no que já lês, e ordens de leitura sugeridas
- 📊 **Estatísticas** — total lido, sequência de dias, editora favorita
- 🌗 **Tema claro/escuro** — automático ou à tua escolha
- 🌍 **PT / EN** — com deteção automática do idioma do telemóvel
- 🔒 **Dados locais** — a tua biblioteca e progresso ficam só no teu dispositivo (IndexedDB); nada de conta nem servidor a guardar o que lês

## 🖼️ Capturas de ecrã

<!-- Substitui por capturas reais depois de publicares -->
<div align="center">
<img src="docs/screenshots/discover.png" width="200" alt="Ecrã Descobrir" />
<img src="docs/screenshots/library.png" width="200" alt="Ecrã Biblioteca" />
<img src="docs/screenshots/detail.png" width="200" alt="Detalhe de uma série" />
</div>

## 🚀 Usar

A versão publicada fica em: `https://SEU-UTILIZADOR.github.io/estante-tracker/`

No telemóvel: abre o link → menu do browser → **"Adicionar ao ecrã principal"**. A partir daí funciona como qualquer app instalada, incluindo offline para o que já tens guardado.

## 🏗️ Arquitetura

```
Frontend estático (GitHub Pages)          Backend mínimo (Cloudflare Worker, grátis)
├─ HTML/CSS/JS puro, sem build      ──▶   ├─ Proxy seguro para Marvel/Comic Vine
├─ IndexedDB (dados 100% locais)          ├─ Lista "a seguir" + subscrições push
├─ Manga (AniList) chamado direto         └─ Envia notificações quando algo sai
└─ Service Worker (offline + push)             ↑
                                          GitHub Actions (cron gratuito, 6/6h)
```

Só a lista de séries que segues e a subscrição de notificações saem do teu dispositivo — o mínimo necessário para o aviso funcionar. Tudo o resto (progresso, capítulos lidos, estatísticas) nunca sai do telemóvel.

## 🛠️ Publicar a tua própria instância

Guia completo passo a passo (GitHub Pages + Cloudflare Worker + GitHub Actions) em **[docs/DEPLOY.md](docs/DEPLOY.md)**.

Resumo rápido:
1. Publica esta pasta no GitHub Pages — já dá para usar manga e biblioteca local
2. (Opcional) Publica o Worker em `worker/` no Cloudflare — ativa Marvel/DC e notificações push
3. (Opcional) Liga o cron gratuito do GitHub Actions para verificar lançamentos periodicamente

## 🔐 Privacidade e segurança

- Sem contas, sem tracking, sem anúncios
- Nenhuma chave de API (Marvel, Comic Vine, VAPID) fica exposta no código público — vivem só como *secrets* do Worker
- Código aberto — audita tu mesmo o que a app faz

## 🧱 Stack

HTML/CSS/JS puro (sem framework nem build step) · IndexedDB · Service Worker (PWA + Web Push) · Cloudflare Workers · GitHub Actions · APIs: Marvel, Comic Vine, AniList

## 🗺️ Roadmap

- [ ] Exportar/partilhar listas de leitura personalizadas
- [ ] Suporte a mais fontes de manga/webtoon
- [ ] Widgets de estatísticas mais detalhados

Sugestões e *pull requests* são bem-vindos.

## 📄 Licença

Distribuído sob licença [MIT](LICENSE) — usa, modifica e publica à vontade.

---

<div align="center">
<sub>Feito para quem lê muita BD e perde a conta dos capítulos.</sub>
</div>
