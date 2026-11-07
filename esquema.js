// Esquema — desenha um quadro-resumo no estilo de mapa mental de caderno:
// folha pontilhada, caixas coloridas, setas, chaves e exemplos sublinhados.
// Usado no Português Esquematizado (diario-bordo.html) e nas apostilas (apostila-leitura.html).
//
// Formato do quadro: { titulo, intro?, rotulos?: {itens, ex}, linhas: [{nome, def?, itens?, ex?, grupo?}] }
// Linhas seguidas com o mesmo "grupo" ficam juntas dentro de uma chave com o rótulo do grupo.
(function () {
  const CORES = ['#1f8a3b', '#d2601a', '#2347a8', '#c2304a', '#6a3fb5', '#157a7a', '#b0337f', '#8a5a1c', '#3a6e1f', '#a23b2a', '#2e5f9e'];
  const GRUPO_COR = '#d2601a';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const CSS = `
.esq{--ink:#1d2a44; --blue:#1d3a8a; position:relative; color:var(--ink); background-color:#fbf8f1;
  background-image:radial-gradient(rgba(29,42,68,.20) 1px, transparent 1.2px); background-size:16px 16px;
  border-radius:14px; padding:20px 14px 18px; box-shadow:0 6px 20px rgba(0,0,0,.25), inset 0 0 0 1px rgba(29,42,68,.10);
  font-family:'Kalam','Comic Sans MS',cursive; font-size:15.5px; line-height:1.35; text-align:left}
[data-theme="dark"] .esq{background-color:#f1ecdf}
.esq *{box-sizing:border-box}
.esq-title{font-weight:700; font-size:clamp(20px,5.4vw,27px); text-transform:uppercase; text-align:center; letter-spacing:.02em;
  padding-bottom:6px; margin:0 auto 16px; max-width:95%; border-bottom:5px solid var(--ink); border-radius:2px; width:fit-content}
.esq-intro{color:var(--blue); text-align:center; margin:-6px 0 14px; font-size:15px}
.esq-grp{display:grid; grid-template-columns:1fr; gap:8px; margin:6px 0 14px}
.esq-glabel{justify-self:start; border:2.5px solid var(--gc); color:var(--gc); border-radius:7px; padding:3px 10px; font-weight:700;
  text-transform:uppercase; font-size:14px; background:rgba(255,255,255,.55)}
.esq-gbody{border-left:3px solid var(--gc); border-radius:12px 0 0 12px; padding:4px 0 2px 12px; display:flex; flex-direction:column; gap:12px}
.esq-solo{display:flex; flex-direction:column; gap:14px}
.esq-it{display:flex; flex-direction:column; gap:3px}
.esq-head{display:flex; flex-wrap:wrap; align-items:center; gap:4px 6px}
.esq-box{border:2.5px solid var(--qc); border-radius:7px; padding:2px 9px 1px; font-weight:700; text-transform:uppercase; color:var(--ink);
  background:rgba(255,255,255,.6); box-shadow:2px 2px 0 color-mix(in srgb, var(--qc) 35%, transparent)}
.esq-arr{color:var(--qc); font-weight:700; font-size:18px; line-height:1}
.esq-def{color:var(--qc); font-weight:700; flex:1 1 160px}
.esq-itens{color:var(--blue); font-weight:700; margin-left:10px; padding-left:10px; border-left:2px solid var(--qc); border-radius:8px 0 0 8px}
.esq-itens b,.esq-ex b{font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--qc); margin-right:3px}
.esq-ex{margin-left:20px; color:var(--ink)}
.esq-ex span{text-decoration:underline; text-decoration-color:var(--qc); text-decoration-thickness:2px; text-underline-offset:4px}
@media (min-width:640px){
  .esq{padding:24px 22px 22px; font-size:16.5px}
  .esq-grp{grid-template-columns:170px 1fr; align-items:center}
  .esq-glabel{justify-self:stretch; text-align:center}
}`;

  function prepare() {
    if (document.getElementById('esq-style')) return;
    const st = document.createElement('style');
    st.id = 'esq-style';
    st.textContent = CSS;
    document.head.appendChild(st);
    if (!document.querySelector('link[href*="family=Kalam"]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&display=swap';
      document.head.appendChild(l);
    }
  }

  function itemHtml(l, cor, rot) {
    return `<div class="esq-it" style="--qc:${cor}">
      <div class="esq-head"><span class="esq-box">${esc(l.nome)}</span>${l.def ? `<span class="esq-arr">➜</span><span class="esq-def">${esc(l.def)}</span>` : ''}</div>
      ${l.itens ? `<div class="esq-itens">${rot.itens ? `<b>${esc(rot.itens)}:</b>` : ''}${esc(l.itens)}</div>` : ''}
      ${l.ex ? `<div class="esq-ex">${rot.ex ? `<b>${esc(rot.ex)}:</b>` : ''}<span>${esc(l.ex)}</span></div>` : ''}
    </div>`;
  }

  // q: o quadro; opts.titulo=false esconde o título (quando a página já mostra o título fora).
  function html(q, opts) {
    prepare();
    opts = opts || {};
    const rot = q.rotulos || {};
    const linhas = q.linhas || [];
    let out = '', i = 0, gi = 0;
    while (i < linhas.length) {
      const g = linhas[i].grupo;
      let j = i;
      while (j < linhas.length && linhas[j].grupo === g) j++;
      const itens = linhas.slice(i, j).map((l, k) => itemHtml(l, CORES[(i + k) % CORES.length], rot)).join('');
      if (g) {
        const gc = gi++ % 2 === 0 ? GRUPO_COR : '#2347a8';
        out += `<div class="esq-grp" style="--gc:${gc}"><div class="esq-glabel">${esc(g)}</div><div class="esq-gbody">${itens}</div></div>`;
      } else {
        out += `<div class="esq-solo">${itens}</div>`;
      }
      i = j;
    }
    return `<div class="esq">
      ${opts.titulo === false ? '' : `<div class="esq-title">${esc(q.titulo)}</div>`}
      ${q.intro ? `<div class="esq-intro">${esc(q.intro)}</div>` : ''}
      ${out}
    </div>`;
  }

  window.Esquema = { html, prepare };
})();
