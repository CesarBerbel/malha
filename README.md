# Malha – acompanhamento de treino de musculação

Um app web (PWA) que roda no navegador, pode ser instalado no celular como app e tem um **modo relógio** para smartwatch. Funciona offline, e os dados ficam salvos no próprio aparelho.

## Funcionalidades

- **Biblioteca** com cerca de 60 exercícios de musculação comuns, organizados por grupo muscular, mais exercícios personalizados. Ela abre numa gaveta, com busca e filtro por grupo, ao montar o plano.
- **Plano semanal**: monte o treino de cada dia (séries, repetições, carga e descanso por exercício), dê um nome, reordene e copie de outro dia.
- **Cronômetro de treino**:
  - **▶ Play**: começa a série e o cronômetro conta o tempo de execução.
  - **⏸ Pausa**: fecha a série e começa o cronômetro de **descanso do zero**.
  - Passado o limite (60 s por padrão, ajustável), o cronômetro **pisca**, vibra e apita para lembrar de voltar.
  - Ao terminar todas as séries de um exercício vem uma **pausa maior de hidratação** (180 s por padrão), mostrando qual é o próximo exercício.
  - Botões para adicionar ou remover série, pular exercício e encerrar o treino.
- **Histórico** dos treinos feitos (duração, séries e cargas), com resumo dos últimos 7 dias.
- **Barra flutuante**: ao sair da tela do treino em andamento, uma barra mostra o cronômetro e leva de volta a ele.
- **Tema claro e escuro**, que segue o tema do aparelho.
- **Ajustes**: tempos de descanso e hidratação, intervalo de repetição do alerta, vibração, som, tela sempre ligada e modo relógio.

## Como rodar

O service worker (offline/instalação) só funciona via `http(s)`, não abrindo o arquivo direto:

```bash
npx serve .
# ou
python -m http.server 8080
```

Para usar no celular e no relógio, publique a pasta num host com HTTPS (GitHub Pages, Netlify, Vercel, Cloudflare Pages — todos gratuitos para sites estáticos). Não há build: basta enviar os arquivos.

### Deploy com Coolify

O projeto tem `Dockerfile` e `nginx.conf` (Nginx servindo os arquivos na porta 80, com rota de saúde em `/healthz`). No Coolify: crie um recurso a partir do repositório Git, escolha o build pack **Dockerfile**, porta **80** e um domínio com `https://`. Cada `git push` gera um novo deploy.

## Celular

Abra o endereço no Chrome (Android) ou no Safari (iPhone) e use **"Adicionar à tela inicial" / "Instalar app"**.

## Smartwatch

- **Wear OS (Galaxy Watch, Pixel Watch etc.)**: abra o endereço num navegador do relógio (por exemplo Samsung Internet ou outro navegador para Wear OS). A interface compacta entra sozinha em telas pequenas; dá para forçar em *Ajustes → Modo relógio* ou abrindo o endereço com `?watch`.
- **Apple Watch**: o watchOS não tem navegador de uso geral, então lá é preciso um app nativo em Swift/watchOS. A lógica deste projeto (fases ready → work → rest → hydrate) pode ser reaproveitada nele.

### Levar o plano do celular para o relógio

Os dados ficam em cada aparelho (não há servidor). Em *Ajustes → Gerar link de sincronização* o app gera um link com o plano. Abra esse link no relógio ou em outro aparelho para importar.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `index.html` | estrutura da página |
| `app.js` | lógica: plano, sessão de treino, cronômetros, alertas, histórico |
| `exercises.js` | biblioteca de exercícios |
| `styles.css` | visual, incluindo o modo relógio (`body.watch`) |
| `sw.js` / `manifest.webmanifest` / `icon.svg` | PWA (offline e instalação) |
