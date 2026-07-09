# Prompt-Modelo — Resumo Matador (TEC Concursos)

Cole o prompt abaixo numa sessão do Claude junto com o material do caderno
(PDF do caderno, export da extensão ou lista de links + comentários).
Preencha os campos entre `[colchetes]`.

---

Você vai gerar um **"Resumo Matador"** — uma apostila em HTML (arquivo único,
autocontido) construída **exclusivamente a partir das questões que estou te
enviando**, no padrão que já usamos. Leia todo o material antes de escrever.

## Dados deste caderno

- **Banca:** [FCC]
- **Disciplina / assunto:** [Economia e Finanças Públicas — ex.: Contas Nacionais & Teoria da Tributação]
- **Caderno de origem:** [nome do caderno no TEC + nº de questões]
- **Concursos-alvo:** [AFRFB · SEFAZ SP · FTE SEFAZ MT]
- **Número do caderno na série:** [Caderno 01]
- **Material anexado:** [PDF do caderno com enunciados, gabaritos e comentários do fórum / export JSON da extensão]

## O que é o Resumo Matador

Não é um resumo genérico da matéria: é a **engenharia reversa do que a banca
cobra**. Tudo deve vir das questões e dos comentários mais votados do fórum —
a literalidade que a banca usa, os erros que ela planta nas alternativas e os
esquemas/mnemônicos que os professores e alunos deram nos comentários.

## Regra de ouro: COBERTURA TOTAL (não deixe nada de fora)

Prefiro um resumo **maior e completo** a um resumo enxuto que perca conteúdo.
Regras obrigatórias:

1. **Toda questão do caderno deve estar mapeada** em pelo menos uma seção, com
   seu botão ⚡Q. Nenhuma questão pode ficar órfã.
2. **Todo ponto de conhecimento cobrado deve aparecer no texto** — inclusive o
   que foi cobrado uma única vez, em uma única alternativa. Se uma alternativa
   errada testa uma nuance ("imposto X é municipal, não estadual"), essa
   nuance entra no resumo.
3. Extraia conteúdo **das alternativas erradas também**: cada erro plantado
   pela banca vira uma pegadinha documentada ou uma linha de tabela.
4. Se um tópico foi cobrado de formas ligeiramente diferentes em questões
   diferentes, registre **as duas redações** — a variação de literalidade é
   exatamente o que derruba candidato.
5. Ao final, faça uma **auto-conferência**: percorra a lista de IDs das
   questões e verifique que todos os IDs aparecem no HTML. Liste no chat
   qualquer questão que tenha ficado de fora e corrija antes de entregar.
6. Na dúvida entre incluir ou cortar, **inclua**. O limite é a redundância,
   não o tamanho.

## Estrutura do documento

1. **Cabeçalho:** faixa "RESUMO MATADOR · DIRETO DAS QUESTÕES · [BANCA]",
   título da disciplina, subtítulo do assunto, parágrafo dizendo de quantas
   questões o resumo foi extraído e linha "Foco: [concursos-alvo]".
2. **Sumário** numerado com âncoras clicáveis para cada seção.
3. **Seções temáticas** (agrupe as questões por tópico, na ordem lógica da
   matéria). Cada seção contém:
   - Texto corrido com a **literalidade da banca** (palavras-chave decisivas
     em MAIÚSCULAS ou negrito: FINAIS, DENTRO, FLUXO, NÃO…);
   - **Tabelas** para conteúdo comparativo (agente × papel, critério ×
     aplicação, direto × indireto…);
   - **Caixas destacadas** conforme o tipo de conteúdo (use os títulos
     consagrados):
     - `DEFINIÇÃO MATADORA` — definição literal cobrada;
     - `PEGADINHA CLÁSSICA` / `COMO A [BANCA] ENGANA` — erros plantados;
     - `BIZU` — regra prática de resolução (ex.: "Bizu do PIB — 5 cortes");
     - `DECOREBA PREMIADA` — item de memorização seca que a banca premia;
     - `JURISPRUDÊNCIA DA BANCA` — o que a banca aceita/considera correto
       mesmo quando a doutrina diverge;
     - `FÓRMULA LITERAL COBRADA` / `IDENTIDADES FUNDAMENTAIS` — fórmulas na
       redação exata da prova;
     - `MNEMÔNICO CONSAGRADO DO FÓRUM` — esquemas dos comentários;
     - `NUANCES QUE A [BANCA] PREMIA` / `SINAIS QUE DERRUBAM CANDIDATO` —
       distinções finas entre alternativas quase idênticas;
     - `REGRA DE OURO` — síntese máxima da seção.
   - **Diagramas** em HTML/CSS ou SVG inline quando o conteúdo pedir (fluxo
     circular, escadas de agregados, curvas) — recriados a partir dos
     esquemas dos comentários, nunca imagens externas;
   - Ao final da seção, a linha **"Questões desta seção:"** com um botão
     `⚡ Q<id>` para cada questão usada.
4. **Rodapé:** "Resumo gerado a partir do caderno '[nome]' ([N] questões, TEC
   Concursos) · Esquemas recriados a partir dos comentários mais votados do
   fórum · Estude, revise, aprove. 🦁"

## Botões ⚡Q (integração com o TEC)

- Cada botão abre `https://www.tecconcursos.com.br/questoes/<id>` num
  **painel lateral (iframe deslizante)** dentro da própria página, com botão
  de fechar e opção "abrir em nova aba" como fallback (o TEC pode bloquear
  iframe — trate `X-Frame-Options` oferecendo o link direto).
- O `<id>` é o número da questão no TEC (o mesmo do link/PDF).

## Requisitos técnicos do HTML

- **Arquivo único e autocontido**: CSS e JS inline, sem CDN, sem fontes ou
  imagens externas.
- Visual da série: fundo escuro, títulos com destaque, caixas coloridas por
  tipo (pegadinha em tom de alerta, bizu em tom de dica, etc.), tabelas
  zebradas, botões ⚡Q em pílula.
- **Imprimível em PDF** com boa quebra de página (`@media print`: evitar
  cortar caixas e tabelas no meio).
- Responsivo (leitura no celular).
- Nome do arquivo: `resumo-matador-[disciplina]-[nn].html`.

## Tom e estilo

- Português direto, voz de professor de cursinho experiente: zero enrolação,
  foco total em "o que a banca escreve" e "onde ela te derruba".
- Sempre que a banca usar um termo específico ("centro de interesse econômico
  predominante", "sem caráter temporário"), reproduza-o **literalmente** e
  sinalize que é decoreba obrigatória.
- Frases curtas nas caixas; texto corrido apenas para costurar o raciocínio.

## Entrega

1. O arquivo HTML completo;
2. No chat: a lista de seções, o total de questões mapeadas e o resultado da
   auto-conferência de cobertura (item 5 da regra de ouro);
3. Se alguma questão não couber em nenhuma seção, crie uma seção "Tópicos
   adjuntos cobrados junto" em vez de descartá-la.
