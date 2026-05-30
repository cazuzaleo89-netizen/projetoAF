import { useState, useRef } from "react";

const C = {
  bg: "#07090f", surface: "#0c1220", surfaceAlt: "#090e1a",
  border: "#1a2640", borderLight: "#243354",
  accent: "#00e5a0", accentBg: "rgba(0,229,160,0.09)", accentBdr: "rgba(0,229,160,0.35)",
  good: "#00e5a0", goodBg: "rgba(0,229,160,0.09)", goodBdr: "rgba(0,229,160,0.25)",
  warn: "#f59e0b", warnBg: "rgba(245,158,11,0.09)", warnBdr: "rgba(245,158,11,0.3)",
  danger: "#f43f5e", dangerBg: "rgba(244,63,94,0.09)", dangerBdr: "rgba(244,63,94,0.3)",
  text: "#dde6f0", sub: "#5a7898", muted: "#2d3f58",
};

const pc = (t) => t >= 70 ? C.good : t >= 50 ? C.warn : C.danger;
const pbg = (t) => t >= 70 ? C.goodBg : t >= 50 ? C.warnBg : C.dangerBg;
const pbdr = (t) => t >= 70 ? C.goodBdr : t >= 50 ? C.warnBdr : C.dangerBdr;
const plbl = (t) => t >= 70 ? "EM FORMA" : t >= 50 ? "PROGRESSO" : "CRÍTICA";

function parseTECCsv(raw) {
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV deve ter pelo menos 2 linhas");
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
  const headers = lines[0].split(sep).map((h) => norm(h.replace(/"/g, "")));
  const fi = (...ts) => { for (const t of ts) { const i = headers.findIndex((h) => h.includes(norm(t))); if (i >= 0) return i; } return -1; };
  const mi = fi("materia", "disciplina", "assunto pai", "area");
  const ai = fi("assunto", "topico", "conteudo", "tema");
  const ri = fi("resolvidas", "respondidas", "total questoes", "questoes resolvidas", "questoes");
  const ci = fi("acertos", "corretas", "certas", "corretos");
  const ti = fi("taxa", "percentual", "aproveitamento", "acerto");
  const mc = mi >= 0 ? mi : ai >= 0 ? ai : 0;
  return lines.slice(1).map((line) => {
    const v = line.split(sep).map((x) => x.trim().replace(/"/g, ""));
    const res = ri >= 0 ? parseInt(v[ri]) || 0 : 0;
    const ace = ci >= 0 ? parseInt(v[ci]) || 0 : 0;
    let taxa = ti >= 0 ? parseFloat((v[ti] || "0").replace("%", "").replace(",", ".")) || 0 : res > 0 ? (ace / res) * 100 : 0;
    return { materia: v[mc] || "Outros", assunto: ai >= 0 && mi >= 0 ? v[ai] || "" : "", resolvidas: res, acertos: ace, taxa: Math.round(taxa * 10) / 10 };
  }).filter((r) => r.materia && r.materia !== "Outros" || r.resolvidas > 0);
}

function groupByMateria(rows) {
  const map = {};
  rows.forEach((r) => {
    if (!map[r.materia]) map[r.materia] = { materia: r.materia, resolvidas: 0, acertos: 0 };
    map[r.materia].resolvidas += r.resolvidas;
    map[r.materia].acertos += r.acertos;
  });
  return Object.values(map).map((d) => ({ ...d, taxa: d.resolvidas > 0 ? Math.round((d.acertos / d.resolvidas) * 1000) / 10 : 0 }));
}

const SAMPLE = `Matéria;Assunto;Resolvidas;Acertos;Taxa
Direito Tributário;ICMS;180;108;60%
Direito Tributário;ISS;90;45;50%
Direito Administrativo;Atos Administrativos;150;120;80%
Direito Administrativo;Licitações;100;75;75%
Contabilidade Geral;Balanço Patrimonial;200;160;80%
Contabilidade Pública;Lei 4320;100;40;40%
Contabilidade Pública;SIAFI;60;21;35%
Matemática Financeira;Juros Compostos;80;48;60%
Matemática Financeira;Análise de Invest.;40;16;40%
Legislação Específica;Estatuto Servidores;130;104;80%
Raciocínio Lógico;Lógica Formal;90;45;50%
Português;Gramática;100;80;80%`;

function PlanText({ text }) {
  return (
    <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 13.5, lineHeight: 1.9, color: C.text }}>
      {text.split("\n").map((line, i) => {
        if (/^###\s/.test(line)) return <div key={i} style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, color: C.accent, marginTop: 24, marginBottom: 8, paddingBottom: 7, borderBottom: `1px solid ${C.border}` }}>{line.replace(/^###\s*/, "")}</div>;
        if (/^##\s/.test(line)) return <div key={i} style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 17, color: C.text, marginTop: 28, marginBottom: 10 }}>{line.replace(/^##\s*/, "")}</div>;
        if (/^\*\*[^*]+\*\*$/.test(line.trim())) return <div key={i} style={{ fontWeight: 700, color: "#c5dcef", marginTop: 14, marginBottom: 3 }}>{line.replace(/\*\*/g, "")}</div>;
        if (/^[•\-\*] /.test(line)) return <div key={i} style={{ paddingLeft: 18, color: "#8dacc4", marginBottom: 4, position: "relative" }}><span style={{ position: "absolute", left: 4, color: C.accent, fontSize: 10 }}>▶</span>{line.replace(/^[•\-\*] /, "")}</div>;
        if (line.trim() === "") return <div key={i} style={{ height: 6 }} />;
        const parts = line.split(/(\*\*[^*]+\*\*)/);
        if (parts.length > 1) return <div key={i} style={{ color: "#8dacc4", marginBottom: 2 }}>{parts.map((p, j) => p.startsWith("**") ? <strong key={j} style={{ color: C.text, fontWeight: 600 }}>{p.replace(/\*\*/g, "")}</strong> : p)}</div>;
        return <div key={i} style={{ color: "#8dacc4", marginBottom: 2 }}>{line}</div>;
      })}
    </div>
  );
}

export default function PlanejadorInteligente() {
  const [tab, setTab] = useState("import");
  const [csv, setCsv] = useState("");
  const [err, setErr] = useState("");
  const [discs, setDiscs] = useState([]);
  const [cfg, setCfg] = useState({ concurso: "", examDate: "", dailyHours: 6, weeklyDays: 6, cutoff: 70, disciplines: [] });
  const [plano, setPlano] = useState("");
  const [gen, setGen] = useState(false);
  const fileRef = useRef(null);

  const parse = () => {
    setErr("");
    try {
      const rows = parseTECCsv(csv);
      const d = groupByMateria(rows).sort((a, b) => a.taxa - b.taxa);
      setDiscs(d);
      setCfg((p) => ({ ...p, disciplines: d.map((x) => ({ nome: x.materia, peso: Math.round(100 / d.length), meta: 70 })) }));
      setTab("diagnostic");
    } catch (e) { setErr(e.message); }
  };

  const daysLeft = () => {
    if (!cfg.examDate) return null;
    return Math.max(0, Math.ceil((new Date(cfg.examDate + "T00:00:00") - new Date()) / 86400000));
  };

  const projScore = () => {
    if (!discs.length || !cfg.disciplines.length) return 0;
    const tp = cfg.disciplines.reduce((s, d) => s + d.peso, 0) || 1;
    return Math.round((discs.reduce((s, d) => { const c = cfg.disciplines.find((x) => x.nome === d.materia); return s + (d.taxa / 100) * (c ? c.peso : 100 / discs.length); }, 0) / tp) * 100);
  };

  const generate = async () => {
    if (!discs.length) return;
    setGen(true); setPlano(""); setTab("plan");
    const dias = daysLeft();
    const crit = discs.filter((d) => d.taxa < 50);
    const prog = discs.filter((d) => d.taxa >= 50 && d.taxa < 70);
    const boas = discs.filter((d) => d.taxa >= 70);
    const prompt = `Você é um consultor sênior de aprovação em concursos fiscais com a metodologia Guruja. Gere um planejamento semanal estratégico e preciso.

## Perfil
- Concurso: ${cfg.concurso || "Concurso Fiscal"}
- Data da prova: ${cfg.examDate || "Não definida"}${dias !== null ? ` (${dias} dias restantes)` : ""}
- Disponibilidade: ${cfg.dailyHours}h/dia × ${cfg.weeklyDays} dias = ${cfg.dailyHours * cfg.weeklyDays}h/semana
- Nota de corte estimada: ${cfg.cutoff}%
- Nota projetada atual: ${projScore()}%

## Estatísticas TEC Concursos
${discs.map((d) => { const c = cfg.disciplines.find((x) => x.nome === d.materia); return `- ${d.materia}: ${d.taxa}% acerto | ${d.resolvidas} questões | Peso edital: ${c?.peso || "?"}%`; }).join("\n")}

## Lacunas
- CRÍTICAS (<50%): ${crit.map((d) => `${d.materia} (${d.taxa}%)`).join(", ") || "Nenhuma"}
- PROGRESSO (50-70%): ${prog.map((d) => `${d.materia} (${d.taxa}%)`).join(", ") || "Nenhuma"}
- EM FORMA (≥70%): ${boas.map((d) => d.materia).join(", ") || "Nenhuma"}

Responda EXATAMENTE neste formato:

### 🎯 DIAGNÓSTICO EXECUTIVO
[2-3 frases precisas sobre a situação + maior risco de reprovação + o que muda essa semana]

### 🚨 3 PRIORIDADES DA SEMANA
**1. [Disciplina]** — [por que é urgente e estratégia de ataque com número de questões]
**2. [Disciplina]** — [estratégia]
**3. [Disciplina]** — [estratégia]

### 📅 CRONOGRAMA DIA A DIA
**Segunda-feira**
• [Disciplina + Assunto específico]: [X]h de teoria + [Y] questões
• Meta de acerto: [Z]%
• Caderno TEC: [filtro exato]

[Repita para Terça, Quarta, Quinta, Sexta, Sábado]

### 📊 METAS DA SEMANA
- Total de questões: [N]
- Total de horas: [N]h
- Acerto alvo geral: [N]%
- Disciplina foco: [nome]

### ⚡ ALERTA CRÍTICO
[Uma frase sobre o ponto mais urgente e a ação imediata — seja cirúrgico]

Use somente números baseados nos dados reais. Seja direto e tático.`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }) });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      setPlano(data.content?.find((c) => c.type === "text")?.text || "Erro ao gerar.");
    } catch { setPlano("### ⚠️ Erro de Conexão\n\nNão foi possível conectar à IA. Tente novamente."); }
    setGen(false);
  };

  const totals = { q: discs.reduce((s, d) => s + d.resolvidas, 0), avg: discs.length ? Math.round(discs.reduce((s, d) => s + d.taxa, 0) / discs.length) : 0, crit: discs.filter((d) => d.taxa < 50).length };
  const TABS = [{ id: "import", icon: "📥", label: "Importar TEC", always: true }, { id: "diagnostic", icon: "📊", label: "Diagnóstico" }, { id: "config", icon: "⚙️", label: "Configurar" }, { id: "plan", icon: "🧠", label: "Plano IA" }];

  const Btn = ({ onClick, children, disabled, variant = "accent", style: s = {} }) => {
    const v = variant === "accent" ? { bg: C.accentBg, bdr: C.accentBdr, col: C.accent } : { bg: "transparent", bdr: C.border, col: C.sub };
    return <button onClick={onClick} disabled={disabled} style={{ padding: "10px 22px", borderRadius: 8, cursor: disabled ? "wait" : "pointer", fontSize: 13, fontFamily: "'Syne',sans-serif", fontWeight: 700, background: v.bg, border: `1px solid ${v.bdr}`, color: disabled ? C.sub : v.col, transition: "all 0.15s", ...s }}>{children}</button>;
  };

  const Card = ({ children, style: s = {} }) => <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, ...s }}>{children}</div>;

  const SH = ({ children, style: s = {} }) => <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: C.text, margin: "0 0 16px", ...s }}>{children}</h3>;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'Inter',sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600&display=swap');*{box-sizing:border-box;margin:0;padding:0}textarea,input{outline:none}input[type=range]{accent-color:#00e5a0}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#1a2640;border-radius:4px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}.fi{animation:fade .35s ease}`}</style>

      <div style={{ padding: "16px 22px 13px", borderBottom: `1px solid ${C.border}`, background: "linear-gradient(180deg,#0d1828 0%,transparent 100%)", display: "flex", alignItems: "center", gap: 13 }}>
        <div style={{ width: 42, height: 42, borderRadius: 10, background: C.accentBg, border: `1px solid ${C.accentBdr}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>⚔️</div>
        <div>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 17, color: C.text, letterSpacing: "-0.02em" }}>Planejamento Inteligente</h1>
          <p style={{ color: C.sub, fontSize: 11, marginTop: 2 }}>Metodologia Guruja · Estatísticas TEC · Powered by Claude AI</p>
        </div>
        {discs.length > 0 && <div style={{ marginLeft: "auto", padding: "4px 11px", background: C.accentBg, border: `1px solid ${C.accentBdr}`, borderRadius: 6, fontSize: 11, color: C.accent, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>✓ {discs.length} disciplinas</div>}
      </div>

      <div style={{ padding: "11px 22px", display: "flex", gap: 7, overflowX: "auto", borderBottom: `1px solid ${C.border}`, background: C.surfaceAlt }}>
        {TABS.filter((t) => t.always || discs.length > 0).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "6px 15px", borderRadius: 7, cursor: "pointer", fontSize: 12.5, fontFamily: "'Syne',sans-serif", fontWeight: 700, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", background: tab === t.id ? C.accentBg : "transparent", border: `1px solid ${tab === t.id ? C.accentBdr : C.border}`, color: tab === t.id ? C.accent : C.sub, transition: "all 0.12s" }}>
            <span>{t.icon}</span><span>{t.label}</span>
          </button>
        ))}
      </div>

      <div style={{ padding: "22px", maxWidth: 920, margin: "0 auto" }} className="fi">

        {tab === "import" && (
          <div style={{ maxWidth: 680, margin: "0 auto" }}>
            <Card style={{ marginBottom: 16 }}>
              <SH style={{ color: C.accent }}>Como exportar do TEC Concursos</SH>
              {[["1","Acesse","tecconcursos.com.br → menu Estatísticas"],["2","Configure os filtros","Selecione disciplinas e período de estudo"],["3","Exporte","Botão 'Exportar para planilha' → salve o .csv"],["4","Cole abaixo","Abra o arquivo CSV, Ctrl+A e cole no campo abaixo"]].map(([n, v, d]) => (
                <div key={n} style={{ display: "flex", gap: 11, marginBottom: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: C.accentBg, border: `1px solid ${C.accentBdr}`, color: C.accent, fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{n}</div>
                  <div><span style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{v}: </span><span style={{ color: C.sub, fontSize: 12.5 }}>{d}</span></div>
                </div>
              ))}
            </Card>

            <Card style={{ border: `1px solid ${err ? C.dangerBdr : C.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <SH style={{ margin: 0 }}>Cole o CSV aqui</SH>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setCsv(SAMPLE)} style={{ padding: "5px 11px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, background: "transparent", border: `1px solid ${C.border}`, color: C.sub }}>📋 Exemplo</button>
                  <button onClick={() => fileRef.current?.click()} style={{ padding: "5px 11px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, background: C.accentBg, border: `1px solid ${C.accentBdr}`, color: C.accent }}>📁 Upload .csv</button>
                  <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => setCsv(ev.target.result); r.readAsText(f, "UTF-8"); }} />
                </div>
              </div>
              <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"Matéria;Assunto;Resolvidas;Acertos;Taxa\nDireito Tributário;ICMS;150;90;60%\n..."} style={{ width: "100%", height: 155, background: "#050810", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 13px", color: C.text, fontSize: 11.5, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.65 }} />
              {err && <div style={{ marginTop: 8, padding: "8px 12px", background: C.dangerBg, border: `1px solid ${C.dangerBdr}`, borderRadius: 6, color: C.danger, fontSize: 12 }}>⚠ {err}</div>}
              <Btn onClick={parse} disabled={!csv.trim()} style={{ marginTop: 13, width: "100%", padding: "11px 0", fontSize: 14, opacity: csv.trim() ? 1 : 0.4 }}>⚡ Processar e Analisar →</Btn>
            </Card>
          </div>
        )}

        {tab === "diagnostic" && discs.length > 0 && (
          <div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
              {[
                { icon: "📝", v: totals.q.toLocaleString("pt-BR"), l: "Questões Resolvidas", c: C.accent },
                { icon: "🎯", v: `${totals.avg}%`, l: "Acerto Médio", c: pc(totals.avg) },
                { icon: "🚨", v: totals.crit, l: "Disciplinas Críticas", c: totals.crit > 0 ? C.danger : C.good },
                { icon: "📈", v: `${projScore()}%`, l: `Nota Proj. (meta ${cfg.cutoff}%)`, c: projScore() >= cfg.cutoff ? C.good : C.danger },
                ...(daysLeft() !== null ? [{ icon: "⏳", v: daysLeft(), l: "Dias para a Prova", c: daysLeft() > 60 ? C.accent : daysLeft() > 20 ? C.warn : C.danger }] : []),
              ].map((k, i) => (
                <div key={i} style={{ flex: "1 1 120px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontSize: 18, marginBottom: 5 }}>{k.icon}</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 26, fontWeight: 700, color: k.c, lineHeight: 1 }}>{k.v}</div>
                  <div style={{ fontSize: 11, color: C.sub, marginTop: 5 }}>{k.l}</div>
                </div>
              ))}
            </div>

            {projScore() < cfg.cutoff && (
              <div style={{ marginBottom: 16, padding: "12px 16px", background: C.dangerBg, border: `1px solid ${C.dangerBdr}`, borderRadius: 10, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 20 }}>🔴</span>
                <div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, color: C.danger, fontSize: 13 }}>Nota projetada abaixo do corte</div>
                  <div style={{ fontSize: 12, color: "#f87f90", marginTop: 2 }}>Você precisa melhorar {cfg.cutoff - projScore()} pontos na nota ponderada. Foco nas disciplinas críticas de alto peso.</div>
                </div>
              </div>
            )}

            <Card style={{ marginBottom: 16 }}>
              <SH>📊 Desempenho por Disciplina</SH>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {[...discs].sort((a, b) => a.taxa - b.taxa).map((d) => {
                  const c = cfg.disciplines.find((x) => x.nome === d.materia);
                  const meta = c?.meta || 70;
                  const col = pc(d.taxa);
                  return (
                    <div key={d.materia}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{d.materia}</span>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: pbg(d.taxa), color: col, border: `1px solid ${pbdr(d.taxa)}`, letterSpacing: "0.07em" }}>{plbl(d.taxa)}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 15, fontWeight: 700, color: col }}>{d.taxa}%</span>
                          {d.taxa < meta && <span style={{ fontSize: 10.5, color: C.sub }}>-{(meta - d.taxa).toFixed(1)}%</span>}
                        </div>
                      </div>
                      <div style={{ height: 7, background: "#0b1422", borderRadius: 99, overflow: "visible", position: "relative" }}>
                        <div style={{ height: "100%", width: `${Math.min(d.taxa, 100)}%`, background: `linear-gradient(90deg,${col}70,${col})`, borderRadius: 99, transition: "width 0.7s ease" }} />
                        <div style={{ position: "absolute", top: -3, bottom: -3, left: `${meta}%`, width: 1.5, background: C.muted, borderRadius: 1 }} title={`Meta: ${meta}%`} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                        <span style={{ fontSize: 10.5, color: C.sub }}>{d.resolvidas.toLocaleString("pt-BR")} questões · {d.acertos.toLocaleString("pt-BR")} acertos</span>
                        <span style={{ fontSize: 10.5, color: C.sub }}>meta: {meta}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {discs.some((d) => d.taxa < 70) && (
              <Card style={{ marginBottom: 18 }}>
                <SH>📋 Cadernos TEC — Ataques Prioritários</SH>
                <p style={{ color: C.sub, fontSize: 12, marginBottom: 14, marginTop: -8 }}>Crie estes cadernos no TEC para atacar seus pontos fracos de forma cirúrgica</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[...discs].filter((d) => d.taxa < 70).sort((a, b) => a.taxa - b.taxa).slice(0, 6).map((d, i) => (
                    <div key={d.materia} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#060a14", borderRadius: 8, border: `1px solid ${C.border}` }}>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 700, color: C.danger, background: C.dangerBg, padding: "2px 7px", borderRadius: 4, flexShrink: 0 }}>#{i + 1}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{d.materia}</div>
                        <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{d.taxa < 50 ? "Filtro: todas as questões · nível médio + difícil · ciclo completo" : "Filtro: questões erradas · revisão dos assuntos críticos"} · Meta: +{Math.max(5, Math.ceil(70 - d.taxa))}%</div>
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 14, color: pc(d.taxa), flexShrink: 0 }}>{d.taxa}%</div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Btn onClick={() => setTab("config")} variant="ghost">⚙️ Configurar Edital</Btn>
              <Btn onClick={generate} disabled={gen}>{gen ? "⏳ Gerando..." : "🧠 Gerar Plano com IA →"}</Btn>
            </div>
          </div>
        )}

        {tab === "config" && (
          <div style={{ maxWidth: 680, margin: "0 auto" }}>
            <Card style={{ marginBottom: 16 }}>
              <SH>📋 Dados do Concurso</SH>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {[{ l: "Concurso / Cargo", k: "concurso", t: "text", p: "ex: SEFAZ-SP Auditor Fiscal" }, { l: "Data da Prova", k: "examDate", t: "date" }, { l: "Horas de estudo / dia", k: "dailyHours", t: "number", min: 1, max: 14 }, { l: "Dias de estudo / semana", k: "weeklyDays", t: "number", min: 1, max: 7 }, { l: "Nota de Corte Estimada (%)", k: "cutoff", t: "number", min: 40, max: 100 }].map((f) => (
                  <div key={f.k}>
                    <label style={{ display: "block", fontSize: 11, color: C.sub, fontWeight: 600, marginBottom: 6, letterSpacing: "0.04em" }}>{f.l}</label>
                    <input type={f.t} value={cfg[f.k]} placeholder={f.p} min={f.min} max={f.max} onChange={(e) => setCfg((p) => ({ ...p, [f.k]: f.t === "number" ? +e.target.value : e.target.value }))} style={{ width: "100%", background: "#060a14", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", color: C.text, fontSize: 13, colorScheme: "dark", fontFamily: "'Inter',sans-serif" }} />
                  </div>
                ))}
              </div>
            </Card>

            {cfg.disciplines.length > 0 && (
              <Card style={{ marginBottom: 18 }}>
                <SH>⚖️ Pesos do Edital por Disciplina</SH>
                <p style={{ color: C.sub, fontSize: 12, marginBottom: 16, marginTop: -8 }}>% da prova que cada disciplina representa · Total atual: <strong style={{ color: cfg.disciplines.reduce((s, d) => s + d.peso, 0) > 105 ? C.warn : C.good }}>{cfg.disciplines.reduce((s, d) => s + d.peso, 0)}%</strong></p>
                <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                  {cfg.disciplines.map((d, i) => (
                    <div key={d.nome} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.nome}</span>
                      <input type="range" min={1} max={40} value={d.peso} onChange={(e) => { const u = [...cfg.disciplines]; u[i] = { ...u[i], peso: +e.target.value }; setCfg((p) => ({ ...p, disciplines: u })); }} style={{ width: 100 }} />
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, color: C.accent, width: 40, textAlign: "right", flexShrink: 0 }}>{d.peso}%</span>
                      <input type="number" min={50} max={100} value={d.meta} title="Meta de acerto" onChange={(e) => { const u = [...cfg.disciplines]; u[i] = { ...u[i], meta: +e.target.value }; setCfg((p) => ({ ...p, disciplines: u })); }} style={{ width: 52, background: "#060a14", border: `1px solid ${C.border}`, borderRadius: 5, padding: "4px 7px", color: C.text, fontSize: 12, textAlign: "center" }} />
                      <span style={{ fontSize: 10, color: C.sub, flexShrink: 0 }}>meta%</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Btn onClick={generate} disabled={gen}>{gen ? "⏳ Gerando..." : "🧠 Gerar Planejamento com IA →"}</Btn>
            </div>
          </div>
        )}

        {tab === "plan" && (
          <div style={{ maxWidth: 780, margin: "0 auto" }} className="fi">
            {gen ? (
              <div style={{ textAlign: "center", padding: "64px 0" }}>
                <div style={{ width: 50, height: 50, margin: "0 auto 18px", border: `3px solid ${C.border}`, borderTop: `3px solid ${C.accent}`, borderRadius: "50%", animation: "spin 0.85s linear infinite" }} />
                <p style={{ color: C.sub, fontSize: 13, animation: "pulse 1.4s ease infinite" }}>Consultando a IA · Gerando plano personalizado com base nos seus dados do TEC...</p>
              </div>
            ) : !plano ? (
              <div style={{ textAlign: "center", padding: "64px 0" }}>
                <div style={{ fontSize: 50, marginBottom: 16 }}>🧠</div>
                <h3 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 19, marginBottom: 8 }}>Plano não gerado ainda</h3>
                <p style={{ color: C.sub, fontSize: 13, marginBottom: 24 }}>Importe seus dados do TEC e clique em "Gerar Plano com IA"</p>
                {discs.length > 0 && <Btn onClick={generate}>⚡ Gerar Agora</Btn>}
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                  <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 19, color: C.text }}>🗓 Planejamento Semanal</h2>
                  <Btn onClick={generate} variant="ghost" style={{ fontSize: 12, padding: "7px 13px" }}>↻ Regenerar</Btn>
                </div>
                <Card style={{ marginBottom: 16 }}><PlanText text={plano} /></Card>
                <div style={{ display: "flex", gap: 11, flexWrap: "wrap" }}>
                  {[
                    { v: `${cfg.dailyHours * cfg.weeklyDays}h`, l: "horas/semana", c: C.accent, bg: C.accentBg, bdr: C.accentBdr },
                    { v: `${discs.filter((d) => d.taxa < 70).length}`, l: "disciplinas p/ reforço", c: C.warn, bg: C.warnBg, bdr: C.warnBdr },
                    { v: `${projScore()}%`, l: `nota proj. (corte ${cfg.cutoff}%)`, c: projScore() >= cfg.cutoff ? C.good : C.danger, bg: projScore() >= cfg.cutoff ? C.goodBg : C.dangerBg, bdr: projScore() >= cfg.cutoff ? C.goodBdr : C.dangerBdr },
                    ...(daysLeft() !== null ? [{ v: `${daysLeft()}d`, l: "até a prova", c: daysLeft() > 30 ? C.accent : C.danger, bg: daysLeft() > 30 ? C.accentBg : C.dangerBg, bdr: daysLeft() > 30 ? C.accentBdr : C.dangerBdr }] : []),
                  ].map((s, i) => (
                    <div key={i} style={{ flex: "1 1 110px", padding: "12px 15px", background: s.bg, border: `1px solid ${s.bdr}`, borderRadius: 8 }}>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700, color: s.c, lineHeight: 1 }}>{s.v}</div>
                      <div style={{ fontSize: 11, color: C.sub, marginTop: 5 }}>{s.l}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
