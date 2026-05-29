# Painel Fiscal — Atualização

Melhorias aplicadas sobre a versão original, sem alterar os dados nem a lógica de estudo já existente. Seu histórico continua salvo no mesmo lugar (localStorage, chave `pf4`).

## O que mudou

### 0. Janela flutuante por cima de outras janelas/sites (Picture-in-Picture)
Foi adicionado um botão **⧉** no cabeçalho do cronômetro. Ao clicar, o cronômetro abre numa **janela separada que fica sempre por cima de tudo** — outros sites, outras janelas e até outros programas. Ideal para estudar em outra aba/site e continuar vendo (e controlando) o tempo.
- Disponível no **Chrome e no Edge no computador** (usa a API Document Picture-in-Picture).
- A janela mostra: relógio, disciplina, status, controles (Iniciar/Pausar/Encerrar), o **estado do Pomodoro** (fase e ciclos, quando ativo) e um **resumo do dia** (tempo estudado vs. meta, nº de sessões e questões com % de acerto).
- Em navegadores que não suportam (Firefox, Safari, maioria dos celulares), o botão avisa que o recurso precisa do Chrome/Edge no PC — isso é uma limitação do navegador, não do app. Um site comum não consegue desenhar sobre outras janelas; o Picture-in-Picture é a única via permitida para isso.

### 0b. Cronômetro flutuante entre as abas (unificado)
Antes existiam **dois cronômetros separados**: o painel flutuante (que era só uma demonstração — não salvava sessões, usava uma lista de disciplinas fixa e tinha um placar ✓/✗ que não gravava nada) e o cronômetro "de verdade" da aba Cronômetro. Agora há **um único timer**: o painel flutuante passou a controlar e espelhar a sessão real e fica visível **em todas as abas**. Assim você pode iniciar o estudo e navegar pelo Dashboard, Questões, etc., sem perder o cronômetro de vista.
- Iniciar/Pausar/Retomar/Encerrar no painel acionam o timer real (salva no histórico, dá XP, respeita o Pomodoro).
- A disciplina do painel fica sincronizada com a da aba Cronômetro (lista real de disciplinas).
- O placar ✓/✗ do painel (que não gravava nada) foi ocultado — questões continuam sendo registradas na aba Questões.
- Corrigido um conflito do atalho de teclado (Espaço) que era capturado duas vezes.

### 1. Navegação no celular (correção importante)
Na versão anterior, em telas pequenas a barra lateral inteira ficava escondida e **não havia nada no lugar** — ou seja, no celular não dava para trocar de aba. Agora há uma **barra de navegação inferior** (Painel, Timer, Questões, Metas, Config) que aparece só no mobile e fica sincronizada com a navegação do desktop.

### 2. Script quebrado removido
O `index.html` carregava `mobile-patch.js`, que não existia (erro 404 a cada acesso). A referência foi removida.

### 3. App instalável + offline (PWA)
Adicionados `manifest.webmanifest`, `sw.js` (service worker) e ícones. Agora o painel pode ser **instalado na tela inicial** do celular/desktop e **funciona sem internet** depois do primeiro acesso. Ideal para estudar em qualquer lugar.

### 4. Cronômetro flutuante reposicionado no mobile
O cronômetro flutuante passava por cima da nova barra inferior e bloqueava os toques. No celular ele agora fica acima da barra, sem atrapalhar.

### 5. Importação mais segura
Importar um `.json` substitui todos os dados. Agora aparece uma **confirmação** antes, evitando perda acidental de histórico.

### 6. Ajustes de tela pequena e telas com notch
Layout de uma coluna em telas bem estreitas (≤380px) e respeito às áreas seguras (`safe-area-inset`) em celulares com notch/barra inferior.

## Arquivos
- `index.html` — app principal (atualizado)
- `manifest.webmanifest` — metadados de instalação (PWA)
- `sw.js` — service worker (cache/offline)
- `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` — ícones do app

## Como publicar no GitHub Pages
1. Suba **todos** os arquivos desta pasta para o repositório `projetofiscal` (na mesma raiz onde está o `index.html` hoje).
2. Confirme que GitHub Pages está apontando para a branch correta.
3. Acesse pelo celular e use "Adicionar à tela inicial" para instalar.

> Importante: o service worker e a instalação só funcionam via HTTPS (GitHub Pages já é HTTPS). Abrir o arquivo direto do disco (`file://`) não ativa o modo offline — isso é normal.

## Observação sobre cache (PWA)
Como o app passa a ser cacheado, após publicar uma nova versão pode ser necessário recarregar a página uma vez (ou fechar/reabrir o app instalado) para ver as mudanças. Se quiser forçar atualização no futuro, troque a linha `const CACHE = 'painel-fiscal-v1'` em `sw.js` para `v2`, `v3`, etc.

## Ajustes solicitados
- **Calendário do mês removido** do Dashboard. O card "Diagnóstico Automático" passou a ocupar a largura inteira no lugar.

## Nova aba: Edital & Revisão
Adicionada uma nova aba (no menu lateral e na barra inferior do celular) com três ferramentas integradas:

### 🧠 Revisão Inteligente
Lista priorizada do que revisar hoje, calculada a partir dos seus próprios dados: dias sem estudar cada disciplina (sessões), percentual de acerto (questões), erros recorrentes do caderno e tópicos pendentes do edital. Disciplinas com mais "sinais de alerta" aparecem no topo, com etiquetas explicando o porquê (ex.: "9 dias sem estudar", "acerto 45%", "2 erros recorrentes").

### 📋 Edital por Disciplina
Checklist de tópicos do edital por disciplina, com barra de % concluído. Dá para adicionar um tópico por vez ou colar a lista inteira de uma vez (um por linha). Marcar/desmarcar atualiza o progresso e alimenta a Revisão Inteligente.

### 🎯 Caderno de Erros — TEC Concursos
Registro das questões que você erra no TEC, pelo número da questão. Cada questão vira um link direto para abri-la no TEC (tecconcursos.com.br/questoes/NÚMERO). O botão "errei+" marca erro recorrente; questões erradas 2+ vezes recebem destaque e sobem para o topo da revisão. Filtros: "só recorrentes" e "ocultar resolvidas".

> Sobre a integração com o TEC: o TEC Concursos não oferece uma API pública nem exportação do seu histórico de questões, e o navegador bloqueia leitura automática de outro site (CORS/login). Por isso a integração é por **deep-link + registro manual do número da questão** — que é a forma viável e já cobre o objetivo de revisar o que você erra mais de uma vez. Caso o TEC passe a oferecer exportação (CSV) do desempenho, dá para adicionar importação depois.
