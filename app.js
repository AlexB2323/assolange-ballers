/*
 * ASSOLANGE BALLERS — versão 5, online com Firebase / GitHub Pages, mesário por senha.
 * Configuração em firebase.js; regras para copiar em firestore.rules.
 * O navegador NÃO determina permissões: o Firestore valida cada gravação.
 */
import * as cloud from './firebase.js';

const SEED_PLAYERS = {
  lucas:   { nome: 'Lucas “Lukinha” Martins', imagem: 'lucas.png' },
  rafael:  { nome: 'Rafael Torres', imagem: 'rafael.png' },
  caio:    { nome: 'Caio Andrade', imagem: 'caio.png' },
  bruno:   { nome: 'Bruno Reis', imagem: 'bruno.png' },
  matheus: { nome: 'Matheus Silva', imagem: 'matheus.png' },
  diego:   { nome: 'Diego Paixão', imagem: 'diego.png' },
  enzo:    { nome: 'Enzo Carvalho', imagem: 'enzo.png' },
  thiago:  { nome: 'Thiago Nunes', imagem: 'thiago.png' },
  joao:    { nome: 'João Pedro', imagem: 'joao.png' },
  samuel:  { nome: 'Samuel Costa', imagem: 'samuel.png' }
};

// Estes números vêm da arte original e SÓ aparecem antes do primeiro jogo salvo.
const EXAMPLE_RANKINGS = [
  { id: 'pontos', titulo: 'Maiores pontuadores', descricao: 'PONTOS POR JOGO (PPJ)', unidade: 'PPJ', icone: 'ico-ball', jogadores: [['lucas',24.8],['rafael',22.1],['caio',18.6],['bruno',16.4],['matheus',13.9]] },
  { id: 'assistencias', titulo: 'Assistências', descricao: 'ASSISTÊNCIAS POR JOGO (APJ)', unidade: 'APJ', icone: 'ico-shoe', jogadores: [['diego',8.7],['lucas',6.9],['enzo',5.8],['thiago',5.1],['rafael',4.6]] },
  { id: 'rebotes', titulo: 'Rebotes', descricao: 'REBOTES POR JOGO (RPJ)', unidade: 'RPJ', icone: 'ico-hoop', jogadores: [['joao',11.4],['bruno',9.8],['samuel',8.1],['caio',7.6],['matheus',6.9]] }
];

const KEYS = {
  custom: 'assolange_v2_atletas',
  games: 'assolange_v2_partidas',
  draft: 'assolange_v2_partida_aberta',
  admin: 'assolange_v3_admin_local'
};
const mainScroll = document.getElementById('main-scroll');
const homePage = document.getElementById('home-page');
const innerPage = document.getElementById('inner-page');
const overlay = document.getElementById('overlay');
const overlayPanel = document.getElementById('overlay-panel');
const toastEl = document.getElementById('toast');

const icon = id => `<svg aria-hidden="true"><use href="#${id}"></use></svg>`;
const safe = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function readData(key, fallback) {
  try {
    const data = JSON.parse(localStorage.getItem(key));
    return data === null ? fallback : data;
  } catch { return fallback; }
}
function writeData(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

let customPlayers = {}; // Banco online: players/<id>
let atletas = { ...SEED_PLAYERS };
let matches = []; // Banco online: matches/<id>
let draft = null; // Banco online: active/current
const initialStats = () => ({ pontos: 0, assistencias: 0, rebotes: 0 });
function newDraft() {
  return { status: 'setup', teamA: [], teamB: [], stats: {}, startedAt: null };
}
function cleanDraft(data) {
  if (!data || !Array.isArray(data.teamA) || !Array.isArray(data.teamB) || !data.stats ||
      !['setup', 'live'].includes(data.status)) return newDraft();
  const used = new Set();
  for (const key of ['teamA', 'teamB']) {
    data[key] = data[key].filter(id => {
      if (!atletas[id] || used.has(id)) return false;
      used.add(id); return true;
    });
  }
  for (const id of used) {
    const s = data.stats[id] || {};
    data.stats[id] = Object.fromEntries(['pontos','assistencias','rebotes'].map(k =>
      [k, Number.isSafeInteger(s[k]) && s[k] >= 0 ? s[k] : 0]));
  }
  if (data.status === 'live' && (!data.teamA.length || !data.teamB.length)) data.status = 'setup';
  return data;
}
draft = cleanDraft(draft);
let adminAuthorized = false; // Validação de admin no Firestore (roles/<UID>).
let canScore = false; // Administrador ou mesário autorizado.
let signedInUser = null;
let cloudLoaded = false;
let activeTeam = 'A';
let screen = 'inicio';
let rosterSearch = '';
let toastTimeout;
const playerName = (id, snapshot) => (atletas[id]?.nome || snapshot?.[id]?.nome || 'Atleta');
const playerImage = (id, snapshot) => {
  // Fotos enviadas pelo administrador podem mudar sem alterar os registros da partida.
  const photo = atletas[id] ? atletas[id].imagem : (snapshot?.[id]?.imagem || '');
  return typeof photo === 'string' ? photo : '';
};
const initials = name => name.trim().split(/\s+/).slice(0,2).map(x => x[0]).join('').toUpperCase();
function avatarMarkup(id, cls = 'player-avatar', snapshot = null) {
  const image = playerImage(id, snapshot);
  const name = playerName(id, snapshot);
  const url = image.startsWith('data:image/jpeg;base64,') || image.startsWith('data:image/png;base64,') || image.startsWith('data:image/webp;base64,')
    ? image : image ? `assets/${encodeURIComponent(image)}` : '';
  return url ? `<img class="${cls}" src="${safe(url)}" alt="" />`
    : `<span class="${cls} avatar-fallback" aria-hidden="true">${safe(initials(name))}</span>`;
}
function dateLabel(date, long = false) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return 'Data desconhecida';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: long ? 'long':'short', timeStyle:'short' }).format(d);
}
function playerAverageData() {
  const output = {};
  matches.forEach(match => {
    const ids = new Set([...(match.teamA || []), ...(match.teamB || [])]);
    for (const id of ids) {
      if (!atletas[id]) continue;
      if (!output[id]) output[id] = { jogos: 0, pontos: 0, assistencias: 0, rebotes: 0 };
      output[id].jogos++;
      for (const k of ['pontos','assistencias','rebotes']) {
        output[id][k] += Math.max(0, Number(match.stats?.[id]?.[k]) || 0);
      }
    }
  });
  return output;
}
function getRankings() {
  if (!matches.length) return EXAMPLE_RANKINGS;
  const totals = playerAverageData();
  return EXAMPLE_RANKINGS.map(item => ({
    ...item,
    jogadores: Object.entries(totals).map(([id, stats]) => [id, stats[item.id] / stats.jogos])
      .sort((a, b) => b[1] - a[1] || playerName(a[0]).localeCompare(playerName(b[0]), 'pt-BR'))
  }));
}
function rankingCard(ranking, compact = false, maxRows = 5) {
  const entries = ranking.jogadores.slice(0, maxRows);
  const rows = entries.length ? entries.map(([id, media], index) => `
    <button type="button" class="rank-row ${!matches.length && ranking.id === 'assistencias' && index === 4 ? 'special-rank' : ''}"
      data-player="${safe(id)}" aria-label="Ver perfil de ${safe(playerName(id))}">
      <span class="rank-number">${index + 1}</span>${avatarMarkup(id)}
      <span class="player-name">${safe(playerName(id))}</span>
      <span class="player-stat"><strong>${media.toFixed(1)}</strong><small>${ranking.unidade}</small></span>
    </button>`).join('') : '<p class="empty-ranking">Nenhum atleta disputou partidas ainda.</p>';
  return `<section class="ranking-card" aria-label="Ranking de ${safe(ranking.titulo)}">
    <div class="ranking-header">
      <svg class="ranking-icon" aria-hidden="true"><use href="#${ranking.icone}"></use></svg>
      <div class="ranking-heading"><h2>${safe(ranking.titulo)}</h2><p>${ranking.descricao}</p></div>
      ${compact ? '' : `<button type="button" class="view-all" data-ranking="${ranking.id}">Ver todos ${icon('ico-chevron')}</button>`}
    </div><div class="rank-rows">${rows}</div></section>`;
}
function updateHomeRankings() {
  document.getElementById('home-rankings').innerHTML = getRankings().map(r => rankingCard(r)).join('');
}
updateHomeRankings();

function setCurrentTab(tab) {
  document.querySelectorAll('.nav-item').forEach(btn => {
    const selected = btn.dataset.tab === tab;
    btn.classList.toggle('active', selected);
    if (selected) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}
function pageHeading(title, back = 'inicio', eyebrow = '') {
  return `<div class="page-top"><button type="button" class="back-button" data-tab="${safe(back)}" aria-label="Voltar">${icon('ico-back')}</button>
    <div>${eyebrow ? `<p class="page-eyebrow">${safe(eyebrow)}</p>` : ''}<h1 class="page-title">${safe(title)}</h1></div></div>`;
}
function navigate(tab, param = null) {
  closeOverlay();
  screen = tab;
  setCurrentTab(['elenco','jogos','estatisticas'].includes(tab) ? tab : 'inicio');
  if (tab === 'inicio') {
    innerPage.hidden = true;
    homePage.hidden = false;
    updateHomeRankings();
    mainScroll.scrollTop = 0;
    return;
  }
  homePage.hidden = true;
  innerPage.hidden = false;
  if (tab === 'elenco') renderRoster();
  else if (tab === 'jogos') renderMatches();
  else if (tab === 'estatisticas') {
    innerPage.innerHTML = pageHeading('Estatísticas') +
      `<p class="page-description">${matches.length ? `Médias reais de ${matches.length} partida(s) registrada(s).` : 'Exemplo da arte inicial. As médias reais serão calculadas após salvar partidas.'}</p>` +
      getRankings().map(r => rankingCard(r, true, Infinity)).join('');
  } else if (tab === 'ranking') {
    const ranking = getRankings().find(r => r.id === param);
    if (!ranking) return navigate('inicio');
    innerPage.innerHTML = pageHeading(ranking.titulo) +
      `<p class="page-description">${matches.length ? 'Médias das partidas registradas.' : 'Médias ilustrativas da arte original.'}</p>` + rankingCard(ranking, true, Infinity);
  } else if (tab === 'montar') {
    if (draft.status === 'live') return navigate('partida');
    renderSetup();
  } else if (tab === 'partida') {
    if (draft.status !== 'live') return navigate('montar');
    renderLive();
  } else if (tab === 'detalhe') renderMatchDetail(param);
  else return navigate('inicio');
  mainScroll.scrollTop = 0;
}

function renderRoster() {
  innerPage.innerHTML = pageHeading('Elenco') + `
    <p class="page-description">Jogadores disponíveis para escalar no Time A ou Time B.</p>
    <div class="roster-admin-tools">
      ${adminAuthorized ? `<div class="admin-session-label">${icon('ico-lock')} Administrador online <button type="button" data-action="admin-logout">Sair</button></div>
        <button type="button" class="primary-button" data-action="add-player">+ Cadastrar jogador</button>` :
      `<button type="button" class="secondary-button" data-action="admin-access">${icon('ico-lock')} ${signedInUser ? 'Minha conta / Sair' : 'Acessar como administrador'}</button>`}
    </div>
    <div class="player-grid">${Object.entries(atletas).map(([id, p]) => `
      <button class="player-tile" type="button" data-player="${safe(id)}">
        ${avatarMarkup(id, 'roster-avatar')}<strong>${safe(p.nome)}</strong><span>${adminAuthorized ? 'Ver perfil / Editar' : 'Ver estatísticas'}</span>
      </button>`).join('')}</div>`;
}
function showOverlay(title, content) {
  overlayPanel.innerHTML = `<div class="overlay-head"><h2>${safe(title)}</h2>
    <button type="button" class="overlay-close" data-action="close-overlay" aria-label="Fechar">${icon('ico-close')}</button></div>${content}`;
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  overlayPanel.querySelector('.overlay-close').focus();
}
function closeOverlay() {
  overlay.hidden = true;
  document.body.style.overflow = '';
}
function toast(message) {
  clearTimeout(toastTimeout);
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastTimeout = setTimeout(() => { toastEl.hidden = true; }, 3200);
}
function showProfile(id) {
  const item = atletas[id];
  if (!item) return;
  const total = playerAverageData()[id];
  const entries = total ? [
    ['JOGOS', total.jogos], ['PPJ', (total.pontos / total.jogos).toFixed(1)],
    ['APJ', (total.assistencias / total.jogos).toFixed(1)], ['RPJ', (total.rebotes / total.jogos).toFixed(1)]
  ] : (matches.length ? [] : EXAMPLE_RANKINGS.flatMap(r => r.jogadores.filter(([pid]) => pid === id)
    .map(([, value]) => [r.unidade, value.toFixed(1)])));
  showOverlay('Perfil do atleta', `<div class="profile-top">${avatarMarkup(id,'profile-avatar')}
    <strong>${safe(item.nome)}</strong></div>
    <p>${total ? 'Estatísticas reais das partidas registradas:' : matches.length ? 'Este atleta ainda não participou de partidas registradas.' : 'Médias ilustrativas da imagem inicial (ainda sem partidas registradas):'}</p>
    <div class="profile-stats">${entries.map(([label, val]) => `<div class="profile-stat"><strong>${val}</strong><span>${label}</span></div>`).join('') || '<p>Este atleta ainda não possui estatísticas.</p>'}</div>
    ${adminAuthorized ? `<button type="button" class="primary-button profile-edit" data-edit-player="${safe(id)}">${icon('ico-edit')} Editar nome e foto</button>` : ''}`);
}

// O MESÁRIO usa uma senha visível na interface; por trás o Firebase Authentication
// autentica uma conta compartilhada. A senha NUNCA é embutida no código público.
// O ADMINISTRADOR continua com e-mail e senha, em uma conta separada.
function adminGate(mode = 'scorer') {
  if (!cloud.configured) return showOverlay('Configure o Firebase',
    '<p>Preencha <strong>firebase.js</strong>, crie suas contas no Authentication e configure as Rules conforme o guia.</p>');
  if (signedInUser) return showOverlay('Minha conta', `
    <p>Conectado como <strong>${safe(signedInUser.email || '')}</strong>.</p>
    <p>${adminAuthorized ? 'Você é administrador e pode editar os jogadores.' : canScore ? 'Você é mesário e pode lançar partidas.' : 'Sua conta ainda não recebeu permissão no Firestore. Configure o documento roles/UID.'}</p>
    ${adminAuthorized ? '<button type="button" class="primary-button" data-action="add-player">+ Cadastrar jogador</button><button type="button" class="secondary-button" data-action="import-local">Importar dados locais V3</button>' : ''}
    <button type="button" class="secondary-button" data-action="admin-logout">Sair da conta</button>`);
  if (mode === 'admin') {
    showOverlay('Administrador', `
      <div class="admin-warning">${icon('ico-lock')} <span><strong>Administração protegida</strong><br>Somente sua conta pode editar nomes e fotos, excluir registros e gerenciar atletas.</span></div>
      <form id="admin-login-form" class="new-player-form">
        <label for="admin-email">E-mail do administrador</label>
        <input id="admin-email" name="email" type="email" autocomplete="username" placeholder="seuemail@exemplo.com" required />
        <label for="admin-password">Senha do administrador</label>
        <input id="admin-password" name="senha" type="password" autocomplete="current-password" required placeholder="Sua senha" />
        <button type="submit" class="primary-button">Entrar como administrador</button>
      </form>
      <button type="button" class="secondary-button" data-action="access-scorer">Entrar como mesário (só senha)</button>`);
    document.getElementById('admin-email')?.focus();
    return;
  }
  showOverlay('Acesso do Mesário', `
    <div class="admin-warning">${icon('ico-lock')} <span><strong>Somente a senha</strong><br>Quem tiver a senha poderá montar times, registrar pontos, assistências, rebotes e finalizar partidas. Os demais apenas acompanham.</span></div>
    ${cloud.mesarioConfigured ? '' : '<p class="form-configuration-warning">Antes de entrar, configure <strong>MESARIO_EMAIL</strong> no arquivo <strong>firebase.js</strong>.</p>'}
    <form id="scorer-login-form" class="new-player-form">
      <label for="scorer-password">Senha do mesário</label>
      <input id="scorer-password" name="senha" type="password" autocomplete="current-password" placeholder="Digite a senha da mesa" required />
      <button type="submit" class="primary-button" ${cloud.mesarioConfigured ? '' : 'disabled'}>Entrar e registrar partida</button>
    </form>
    <button type="button" class="secondary-button" data-action="access-admin">Sou administrador</button>`);
  document.getElementById('scorer-password')?.focus();
}
function applyRole(user, role) {
  signedInUser = user;
  adminAuthorized = !!role.admin;
  canScore = !!role.scorer || adminAuthorized;
  if (screen === 'elenco') renderRoster();
  if (screen === 'jogos') renderMatches();
  if (screen === 'partida') renderLive();
  if (screen === 'montar') renderSetup(true);
  if (screen === 'detalhe') navigate('jogos');
}
async function handleScorerLogin(form) {
  const button = form.querySelector('button[type=submit]');
  if (button) button.disabled = true;
  try {
    const {user,role} = await cloud.loginScorer(form.elements.senha.value);
    applyRole(user,role);
    closeOverlay();
    toast('Modo mesário liberado! Pode registrar as partidas.');
    if (draft.status === 'live') navigate('partida');
    else navigate('montar');
  } catch (err) { failCloud(err); }
  finally { if (button?.isConnected) button.disabled = false; }
}
async function handleAdminLogin(form) {
  try {
    const {user,role} = await cloud.login(form.elements.email.value.trim(), form.elements.senha.value);
    applyRole(user,role);
    closeOverlay();
    toast(role.admin ? 'Administrador conectado!' : role.scorer ? 'Mesário conectado!' : 'Conta sem permissão. Configure roles/UID no Firestore.');
  } catch (err) { failCloud(err); }
}
function requireAdmin() {
  if (adminAuthorized) return true;
  adminGate('admin');
  return false;
}
function requireScorer() {
  if (canScore) return true;
  adminGate('scorer');
  return false;
}
async function logoutAdmin() {
  try {
    await cloud.logout();
    applyRole(null,{admin:false,scorer:false});
    closeOverlay();
    navigate('elenco');
    toast('Sessão encerrada.');
  } catch (err) { failCloud(err); }
}
function failCloud(error) {
  console.error('[Assolange/Firebase]', error);
  const code = error?.code || '';
  const message = code.includes('permission-denied') ? 'Ação bloqueada pelas regras do Firebase. Confira roles/UID e Rules.' :
    code.includes('invalid-credential') ? 'E-mail ou senha incorretos.' :
    code.includes('network') || code.includes('unavailable') ? 'Sem conexão com Firebase. Confira a internet.' :
    error?.message || 'Erro ao comunicar com o Firebase.';
  toast(message);
}
function playerEditor(id = null) {
  if (!requireAdmin()) return;
  const edit = id !== null;
  const item = edit ? atletas[id] : null;
  if (edit && !item) return toast('Jogador não encontrado.');
  showOverlay(edit ? 'Editar jogador' : 'Cadastrar jogador', `
    <div class="editor-intro">${edit ? avatarMarkup(id,'editor-avatar') : `<span class="editor-avatar avatar-fallback">+</span>`}
      <div><strong>${edit ? safe(item.nome) : 'Novo atleta'}</strong><small>Foto, nome e perfil do elenco</small></div></div>
    <form id="player-editor-form" class="new-player-form" data-edit-id="${safe(id || '')}">
      <label for="player-edit-name">Nome do jogador</label>
      <input id="player-edit-name" name="nome" maxlength="70" minlength="2" required placeholder="Ex.: Gabriel Souza" value="${edit ? safe(item.nome) : ''}" autocomplete="off" />
      <label for="player-edit-photo">Foto de perfil</label>
      <input id="player-edit-photo" name="foto" type="file" accept="image/jpeg,image/png,image/webp" />
      <p class="image-helper">JPG, PNG ou WebP, até 5 MB. A foto é reduzida e salva no Firestore, visível em todos os celulares.</p>
      <div id="new-photo-preview" class="new-photo-preview" hidden><img id="photo-preview-img" alt="Prévia da nova foto" /><span>Prévia da foto escolhida</span></div>
      ${edit ? `<label class="remove-photo-label"><input type="checkbox" name="removerFoto" /> Remover foto atual</label>` : ''}
      <button type="submit" class="primary-button">${edit ? 'Salvar alterações' : 'Cadastrar jogador'}</button>
    </form>`);
  document.getElementById('player-edit-name').focus();
}
async function imageToSmallDataUrl(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Escolha uma imagem JPG, PNG ou WebP.');
  if (file.size > 5 * 1024 * 1024) throw new Error('A foto deve ter no máximo 5 MB.');
  const blobURL = URL.createObjectURL(file);
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 240;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível processar a foto.');
    const side = Math.min(bitmap.width,bitmap.height);
    context.drawImage(bitmap, (bitmap.width-side)/2, (bitmap.height-side)/2, side, side, 0,0,240,240);
    bitmap.close();
    return canvas.toDataURL('image/jpeg',.77);
  } finally { URL.revokeObjectURL(blobURL); }
}
async function savePlayerEditor(form) {
  if (!requireAdmin()) return;
  const id = form.dataset.editId;
  const edit = !!id;
  if (edit && !atletas[id]) return toast('Jogador não encontrado.');
  const normalized = form.elements.nome.value.trim().replace(/\s+/g,' ');
  if (normalized.length < 2) return toast('Informe um nome com pelo menos 2 letras.');
  if (Object.entries(atletas).some(([other,p]) => other !== id && p.nome.toLocaleLowerCase('pt-BR') === normalized.toLocaleLowerCase('pt-BR'))) return toast('Este nome já está cadastrado.');
  const file = form.elements.foto.files[0];
  let imagem = edit ? (atletas[id].imagem || '') : '';
  if (edit && form.elements.removerFoto.checked) imagem = '';
  try { if (file) imagem = await imageToSmallDataUrl(file); }
  catch (err) { return toast(err.message || 'Não foi possível ler a foto.'); }
  const playerId = edit ? id : `novo_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  if (imagem.startsWith('data:') && imagem.length > 245000) return toast('Foto muito grande; escolha uma imagem menor.');
  try {
    await cloud.savePlayer(playerId, {nome:normalized, imagem});
    closeOverlay();
    navigate('elenco');
    toast(edit ? 'Perfil atualizado para todos os celulares!' : 'Jogador cadastrado no Firebase!');
  } catch (err) { failCloud(err); }
}

function draftTeams() {
  const names = team => draft[team === 'A' ? 'teamA' : 'teamB'].map(id => safe(playerName(id)));
  return ['A','B'].map(team => `<div class="setup-team team-${team.toLowerCase()}">
    <div class="team-identity"><span class="team-letter">${team}</span><div><strong>TIME ${team}</strong><small>${draft[team === 'A' ? 'teamA':'teamB'].length} jogador(es)</small></div></div>
    <p>${names(team).join(', ') || 'Aguardando jogadores...'}</p></div>`).join('');
}
function renderSetup(preserveScroll = false) {
  const scroll = preserveScroll ? mainScroll.scrollTop : 0;
  innerPage.innerHTML = pageHeading('Montar partida', 'inicio', 'CT ABDIAS FERREIRA') + `
    <div class="match-hero"><img src="assets/quadra-ct-abdias-ferreira.png" alt="" />
      <span class="match-hero-label">NOVA PARTIDA</span><strong>Monte os times</strong>
      <small>Selecione os jogadores que entram em quadra.</small></div>
    <div class="setup-teams">${draftTeams()}</div>
    <div class="section-title-row"><h2>ESCALAR JOGADORES</h2><span>${Object.keys(atletas).length} no elenco</span></div>
    <p class="page-description compact-description">Toque em <strong>A</strong> ou <strong>B</strong> para escolher o time. Toque novamente para retirar.</p>
    <label class="search-field"><span aria-hidden="true">⌕</span><input id="roster-search" type="search" autocomplete="off" placeholder="Buscar jogador..." value="${safe(rosterSearch)}" aria-label="Buscar jogador" /></label>
    <div class="selection-list" id="selection-list">${Object.entries(atletas).map(([id, player]) => {
      const a = draft.teamA.includes(id), b = draft.teamB.includes(id);
      return `<div class="roster-player" data-roster-name="${safe(player.nome.toLocaleLowerCase('pt-BR'))}">
        ${avatarMarkup(id, 'select-avatar')}
        <span class="roster-name">${safe(player.nome)}</span>
        <button class="team-pick pick-a ${a ? 'picked' : ''}" data-team-pick="A" data-id="${safe(id)}"
          type="button" aria-label="${a ? 'Remover':'Colocar'} ${safe(player.nome)} ${a ? 'do' : 'no'} Time A" aria-pressed="${a}">A</button>
        <button class="team-pick pick-b ${b ? 'picked' : ''}" data-team-pick="B" data-id="${safe(id)}"
          type="button" aria-label="${b ? 'Remover':'Colocar'} ${safe(player.nome)} ${b ? 'do' : 'no'} Time B" aria-pressed="${b}">B</button>
      </div>`;
    }).join('')}</div>
    <p class="no-search-results" id="no-search-results" hidden>Nenhum jogador encontrado.</p>
    <div class="setup-footer"><p>Time A: <b>${draft.teamA.length}</b> • Time B: <b>${draft.teamB.length}</b></p>
      <button type="button" class="primary-button" data-action="begin-game" ${!draft.teamA.length || !draft.teamB.length ? 'disabled' : ''}>Iniciar partida ${icon('ico-chevron')}</button>
    </div>`;
  mainScroll.scrollTop = scroll;
  filterRoster();
}
function filterRoster() {
  const q = rosterSearch.toLocaleLowerCase('pt-BR');
  let visible = 0;
  document.querySelectorAll('#selection-list .roster-player').forEach(el => {
    const found = el.dataset.rosterName.includes(q);
    el.hidden = !found;
    if (found) visible++;
  });
  const note = document.getElementById('no-search-results');
  if (note) note.hidden = visible > 0;
}
async function assignPlayer(id, team) {
  if (!requireScorer()) return;
  if (draft.status !== 'setup' || !atletas[id] || !['A','B'].includes(team)) return;
  try {
    await cloud.changeDraft(current => {
      if (current.status !== 'setup') return null;
      const field = team === 'A' ? 'teamA':'teamB';
      const alreadyThere = current[field].includes(id);
      current.teamA = current.teamA.filter(x => x !== id);
      current.teamB = current.teamB.filter(x => x !== id);
      if (!alreadyThere) current[field].push(id);
      return current;
    });
  } catch (err) { failCloud(err); }
}
async function beginMatch() {
  if (!requireScorer()) return;
  try {
    await cloud.changeDraft(current => {
      if (current.status !== 'setup' || !current.teamA.length || !current.teamB.length) return null;
      current.status = 'live';
      current.startedAt = new Date().toISOString();
      current.stats = Object.fromEntries([...current.teamA,...current.teamB].map(id => [id,initialStats()]));
      return current;
    });
    activeTeam = 'A';
    navigate('partida');
  } catch (err) { failCloud(err); }
}
const teamIds = (record, team) => record[team === 'A' ? 'teamA':'teamB'] || [];
const teamScore = (record, team) => teamIds(record, team).reduce((acc,id) => acc + (Number(record.stats?.[id]?.pontos) || 0),0);
function scoreboard(record, compact = false) {
  return `<div class="scoreboard ${compact ? 'scoreboard-compact' : ''}">
    <div class="scoreboard-team"><span class="score-team-name">TIME A</span><strong data-live-score="A">${teamScore(record,'A')}</strong><small>${teamIds(record,'A').length} jogadores</small></div>
    <div class="scoreboard-center"><span>VS</span><small>${compact ? 'RESULTADO' : 'PLACAR AO VIVO'}</small></div>
    <div class="scoreboard-team"><span class="score-team-name">TIME B</span><strong data-live-score="B">${teamScore(record,'B')}</strong><small>${teamIds(record,'B').length} jogadores</small></div>
  </div>`;
}
function livePlayerCard(id) {
  const s = draft.stats[id] || initialStats();
  return `<section class="live-player">
    <div class="live-player-head">${avatarMarkup(id,'live-avatar')}
      <strong>${safe(playerName(id))}</strong><span class="player-total-points"><b data-live-value="${safe(id)}:pontos">${s.pontos}</b> PTS</span>
    </div>
    <div class="stat-counter"><span>Pontos <strong data-live-value="${safe(id)}:pontos">${s.pontos}</strong></span>
      <div class="stat-buttons" ${canScore ? '' : 'hidden'}><button class="stat-minus" type="button" data-stat-change="pontos" data-id="${safe(id)}" data-amount="-1" aria-label="Retirar 1 ponto de ${safe(playerName(id))}" ${s.pontos < 1 ? 'disabled' : ''}>−</button>
      ${[1,2,3].map(n=> `<button type="button" class="stat-add" data-stat-change="pontos" data-id="${safe(id)}" data-amount="${n}" aria-label="Somar ${n} ponto(s) para ${safe(playerName(id))}">+${n}</button>`).join('')}</div></div>
    ${[['assistencias','Assistências','AST'],['rebotes','Rebotes','REB']].map(([key,label])=> `
      <div class="stat-counter"><span>${label} <strong data-live-value="${safe(id)}:${key}">${s[key]}</strong></span>
        <div class="stat-buttons" ${canScore ? '' : 'hidden'}><button type="button" class="stat-minus" data-stat-change="${key}" data-id="${safe(id)}" data-amount="-1" ${s[key] < 1 ? 'disabled' : ''} aria-label="Retirar ${label.toLowerCase()} de ${safe(playerName(id))}">−</button>
        <button type="button" class="stat-add" data-stat-change="${key}" data-id="${safe(id)}" data-amount="1" aria-label="Registrar ${label.toLowerCase()} de ${safe(playerName(id))}">+1</button></div></div>`).join('')}
  </section>`;
}
function renderLive() {
  const ids = teamIds(draft, activeTeam);
  innerPage.innerHTML = pageHeading('Partida em andamento','jogos','CT ABDIAS FERREIRA') + `
    <div class="live-ribbon"><span class="live-dot"></span> EM ANDAMENTO <span class="live-date">${dateLabel(draft.startedAt)}</span></div>
    <div class="scoreboard-wrap">${scoreboard(draft)}</div>
    <div class="live-team-tabs" role="group" aria-label="Selecionar time">
      <button type="button" data-switch-team="A" class="${activeTeam === 'A' ? 'selected' : ''}" aria-pressed="${activeTeam === 'A'}">TIME A <small>${draft.teamA.length}</small></button>
      <button type="button" data-switch-team="B" class="${activeTeam === 'B' ? 'selected' : ''}" aria-pressed="${activeTeam === 'B'}">TIME B <small>${draft.teamB.length}</small></button>
    </div>
    <p class="page-description live-instruction">${canScore ? 'Registre as jogadas de cada atleta. O placar soma automaticamente os pontos individuais.' : 'Acompanhe o placar online. Para registrar jogadas, entre como administrador ou mesário.'}</p>
    <div class="live-player-list">${ids.map(id => livePlayerCard(id)).join('')}</div>
    <div class="live-actions">${canScore ? `
      <button type="button" class="primary-button" data-action="finish-game">Finalizar e salvar partida</button>
      <button type="button" class="secondary-button" data-action="edit-teams">Editar escalação</button>` : `
      <button type="button" class="secondary-button" data-action="access-scorer">Entrar como mesário (senha)</button>`}
    </div>`;
}
function refreshLiveCounters() {
  for (const team of ['A','B']) {
    innerPage.querySelectorAll(`[data-live-score="${team}"]`).forEach(el=> { el.textContent = teamScore(draft,team); });
  }
  for (const id of [...draft.teamA,...draft.teamB]) {
    for (const key of ['pontos','assistencias','rebotes']) {
      innerPage.querySelectorAll(`[data-live-value="${CSS.escape(id + ':' + key)}"]`).forEach(el=> { el.textContent = draft.stats[id][key]; });
    }
  }
  innerPage.querySelectorAll('[data-stat-change][data-amount="-1"]').forEach(el => {
    el.disabled = (draft.stats[el.dataset.id]?.[el.dataset.statChange] || 0) === 0;
  });
}
async function changeStat(id, stat, amount) {
  if (!requireScorer()) return;
  if (!['pontos','assistencias','rebotes'].includes(stat) ||
      ![1,2,3,-1].includes(amount) || (stat !== 'pontos' && ![1,-1].includes(amount))) return;
  try {
    await cloud.changeDraft(current => {
      if (current.status !== 'live' || ![...current.teamA,...current.teamB].includes(id)) return null;
      const was = Number(current.stats[id]?.[stat] || 0);
      const next = Math.max(0,was + amount);
      if (next === was) return null;
      current.stats[id][stat] = next;
      return current;
    });
  } catch (err) { failCloud(err); }
}
async function editTeams() {
  if (!requireScorer() || draft.status !== 'live') return;
  const anyStat = Object.values(draft.stats).some(s => s.pontos || s.assistencias || s.rebotes);
  if (anyStat) return showOverlay('Editar escalação', `<p>Já existem estatísticas nesta partida. Para evitar misturar os registros dos atletas, a escalação só pode ser alterada antes da primeira jogada.</p>
    <button type="button" class="secondary-button" data-action="close-overlay">Continuar partida</button>`);
  try {
    await cloud.changeDraft(current => {
      if (current.status !== 'live' || Object.values(current.stats).some(s=>s.pontos||s.assistencias||s.rebotes)) return null;
      current.status='setup'; current.startedAt=null;
      return current;
    });
    navigate('montar');
  } catch (err) { failCloud(err); }
}
function confirmFinish() {
  if (!requireScorer() || draft.status !== 'live') return;
  showOverlay('Salvar partida?', `<p>O resultado <strong>Time A ${teamScore(draft,'A')} × ${teamScore(draft,'B')} Time B</strong> e todas as estatísticas serão salvos online no Firebase.</p>
    <button type="button" class="primary-button" data-action="confirm-finish">Salvar resultado</button>
    <button type="button" class="secondary-button" data-action="close-overlay">Voltar à partida</button>`);
}
async function finishMatch() {
  if (!requireScorer() || draft.status !== 'live') return;
  try {
    await cloud.completeMatch(current => ({
      id: `partida_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      startedAt:current.startedAt,
      finishedAt:new Date().toISOString(),
      teamA:[...current.teamA],teamB:[...current.teamB],
      stats:JSON.parse(JSON.stringify(current.stats)),
      players:Object.fromEntries([...current.teamA,...current.teamB].map(id=>[id,{
        nome:atletas[id]?.nome || 'Atleta',imagem:atletas[id]?.imagem?.startsWith('data:') ? '' : (atletas[id]?.imagem || '')
      }])),
      scoreA:teamScore(current,'A'),scoreB:teamScore(current,'B')
    }));
    rosterSearch='';
    closeOverlay();
    navigate('montar');
    toast('Partida salva no Firebase! Times liberados para o próximo jogo.');
  } catch(err) { failCloud(err); }
}

function renderMatches() {
  innerPage.innerHTML = pageHeading('Jogos') + `
    <p class="page-description">Histórico das partidas disputadas no CT Abdias Ferreira.</p>
    ${draft.status === 'live' ? `<button class="resume-game" type="button" data-tab="partida"><span class="live-dot"></span><strong>Partida em andamento</strong>${icon('ico-chevron')}</button>` : draft.teamA.length || draft.teamB.length ? `<button class="resume-game" type="button" data-tab="montar"><strong>Continuar escalação</strong>${icon('ico-chevron')}</button>` : ''}
    ${canScore ? `<button type="button" class="primary-button start-another" data-action="open-match">+ ${draft.status === 'live' ? 'Retomar partida' : 'Nova partida'}</button>` : `<button type="button" class="secondary-button start-another" data-action="access-scorer">${icon('ico-lock')} Entrar como mesário para registrar partidas</button>`}
    <div class="section-title-row history-header"><h2>PARTIDAS SALVAS</h2><span>${matches.length} jogo(s)</span></div>
    ${matches.length ? `<div class="history-list">${matches.map((game,index) => `
      <button type="button" class="history-card" data-match-id="${safe(game.id)}">
        <div class="history-meta"><span>PARTIDA ${matches.length-index}</span><time>${dateLabel(game.finishedAt)}</time></div>
        <div class="history-scores"><div><small>TIME A</small><strong>${teamScore(game,'A')}</strong></div><b>×</b><div><small>TIME B</small><strong>${teamScore(game,'B')}</strong></div>${icon('ico-chevron')}</div>
        <small class="history-footer">${game.teamA.length + game.teamB.length} atletas • Ver estatísticas</small>
      </button>`).join('')}</div>` : `<div class="empty-box">${icon('ico-calendar')}<h3>Sem partidas salvas</h3><p>Toque na quadra no Início ou em Nova partida para escalar os times e registrar o primeiro resultado.</p></div>`}`;
}
function matchPlayersTable(game, team) {
  const ids = teamIds(game,team);
  return `<section class="match-detail-team"><div class="section-title-row"><h2>TIME ${team}</h2><span>${ids.length} atletas</span></div>
    <div class="match-table-head"><span>JOGADOR</span><span>PTS</span><span>AST</span><span>REB</span></div>
    ${ids.map(id=> { const s = game.stats[id] || initialStats(); return `<div class="match-table-row">
      <div>${avatarMarkup(id,'detail-avatar',game.players)}<span>${safe(playerName(id,game.players))}</span></div>
      <b>${Number(s.pontos) || 0}</b><b>${Number(s.assistencias) || 0}</b><b>${Number(s.rebotes) || 0}</b>
    </div>`; }).join('')}</section>`;
}
function renderMatchDetail(id) {
  const game = matches.find(m => m.id === id);
  if (!game) return navigate('jogos');
  innerPage.innerHTML = pageHeading('Resumo da partida','jogos','CT ABDIAS FERREIRA') + `
    <p class="page-description">Finalizada em ${dateLabel(game.finishedAt,true)}.</p>
    ${scoreboard(game, true)}
    <p class="result-note">${teamScore(game,'A') === teamScore(game,'B') ? 'Partida empatada' : `Vitória do Time ${teamScore(game,'A') > teamScore(game,'B') ? 'A':'B'}`}</p>
    ${matchPlayersTable(game,'A')}${matchPlayersTable(game,'B')}
    ${adminAuthorized ? `<button type="button" class="danger-outline" data-delete-match="${safe(game.id)}">Excluir este registro</button>` : ''}`;
}
function confirmDelete(id) {
  if (!requireAdmin() || !matches.some(game => game.id === id)) return;
  showOverlay('Excluir partida?', `<p>O resultado e todas as estatísticas desta partida serão apagados do histórico deste navegador. Esta ação não pode ser desfeita.</p>
    <button type="button" class="danger-button" data-confirm-delete="${safe(id)}">Excluir definitivamente do Firebase</button>
    <button type="button" class="secondary-button" data-action="close-overlay">Cancelar</button>`);
}
async function deleteMatch(id) {
  if (!requireAdmin()) return;
  try {
    await cloud.removeMatch(id);
    closeOverlay();
    navigate('jogos');
    toast('Partida excluída do Firebase.');
  } catch(err) { failCloud(err); }
}
function importLegacyDialog() {
  if (!requireAdmin()) return;
  const localPlayers = readData(KEYS.custom, {});
  const localMatches = readData(KEYS.games, []);
  const numberPlayers = Object.keys(localPlayers || {}).length;
  const numberMatches = Array.isArray(localMatches) ? localMatches.length : 0;
  showOverlay('Importar dados da versão 3', `<p>Este navegador possui <strong>${numberPlayers} jogador(es) editados/cadastrados</strong> e <strong>${numberMatches} partida(s)</strong> no armazenamento antigo.</p>
    <p>A importação adicionará esses registros ao Firebase. IDs iguais poderão sobrescrever registros existentes; use apenas na primeira migração, depois de fazer backup.</p>
    <button type="button" class="primary-button" data-action="confirm-import" ${!numberPlayers&&!numberMatches?'disabled':''}>Importar para a nuvem</button>
    <button type="button" class="secondary-button" data-action="close-overlay">Cancelar</button>`);
}
async function importLegacy() {
  if (!requireAdmin()) return;
  const localPlayers = readData(KEYS.custom, {});
  const localMatches = readData(KEYS.games, []);
  try {
    const total = await cloud.importLocal(localPlayers && !Array.isArray(localPlayers) ? localPlayers : {}, Array.isArray(localMatches)?localMatches:[]);
    closeOverlay();
    toast(`${total} registro(s) importado(s) da versão 3!`);
  } catch(err) { failCloud(err); }
}
function refreshCloudScreen() {
  if (screen === 'inicio') return updateHomeRankings();
  if (screen === 'elenco') return renderRoster();
  if (screen === 'jogos') return renderMatches();
  if (screen === 'partida') return draft.status === 'live' ? renderLive() : navigate('jogos');
  if (screen === 'montar') return draft.status === 'setup' ? renderSetup(true) : navigate('partida');
  if (screen === 'estatisticas' || screen === 'ranking' || screen === 'detalhe') return navigate('jogos');
}
function startCloudSync() {
  if (!cloud.configured) {
    console.warn('CONFIGURAÇÃO NECESSÁRIA: informe as chaves públicas em firebase.js');
    showOverlay('Falta configurar o Firebase', '<p>Abra o arquivo <strong>firebase.js</strong> e substitua os exemplos pelos valores fornecidos em Configurações do projeto → Seus apps (Web).</p><p>Depois configure as regras e o usuário conforme o LEIA-ME.</p>');
    return;
  }
  cloud.watchUser((user,role) => applyRole(user,role));
  cloud.subscribe({
    players(data) {
      customPlayers=data;
      atletas={...SEED_PLAYERS,...customPlayers};
      draft=cleanDraft(draft);
      refreshCloudScreen();
    },
    matches(data) {
      matches=data.sort((a,b)=>String(b.finishedAt||'').localeCompare(String(a.finishedAt||'')));
      refreshCloudScreen();
    },
    active(data) {
      draft=cleanDraft(data);
      cloudLoaded=true;
      refreshCloudScreen();
    },
    error(err) { failCloud(err); }
  });
}
// Delegação de eventos: funciona também com as telas criadas dinamicamente.
document.addEventListener('click', event => {
  const clicked = event.target.closest('button, [data-action]');
  if (!clicked) return;
  const d = clicked.dataset;
  if (d.action === 'close-overlay') return closeOverlay();
  if (d.action === 'menu') return showOverlay('Assolange Ballers', `
    <p>Basquete • Disciplina • Comunidade</p>
    <button class="overlay-link" data-tab="inicio">Início</button>
    <button class="overlay-link" data-action="open-match">Nova partida</button>
    <button class="overlay-link" data-tab="elenco">Elenco</button>
    <button class="overlay-link" data-tab="jogos">Jogos / Histórico</button>
    <button class="overlay-link" data-tab="estatisticas">Estatísticas</button>
    <button class="overlay-link" data-action="admin-access">${icon('ico-lock')} ${signedInUser ? 'Minha conta' : 'Entrar como administrador'}</button>`);
  if (d.action === 'notifications') return showOverlay('Notificações', '<p>Nenhuma notificação por enquanto.</p>');
  if (d.action === 'location') return window.open('https://www.google.com/maps/search/?api=1&query=CT%20Abdias%20Ferreira', '_blank', 'noopener,noreferrer');
  if (d.action === 'open-match') return draft.status === 'live' ? navigate('partida') : (canScore ? navigate('montar') : adminGate('scorer'));
  if (d.action === 'admin-access') return adminGate('admin');
  if (d.action === 'access-admin') return adminGate('admin');
  if (d.action === 'access-scorer') return adminGate('scorer');
  if (d.action === 'admin-logout') return logoutAdmin();
  if (d.action === 'add-player') return playerEditor();
  if (d.action === 'import-local') return importLegacyDialog();
  if (d.action === 'confirm-import') return importLegacy();
  if (d.editPlayer) return playerEditor(d.editPlayer);
  if (d.action === 'begin-game') return beginMatch();
  if (d.action === 'edit-teams') return editTeams();
  if (d.action === 'finish-game') return confirmFinish();
  if (d.action === 'confirm-finish') return finishMatch();
  if (d.teamPick) return assignPlayer(d.id,d.teamPick);
  if (d.switchTeam) { activeTeam = d.switchTeam; renderLive(); mainScroll.scrollTop = 0; return; }
  if (d.statChange) return changeStat(d.id,d.statChange,Number(d.amount));
  if (d.matchId) return navigate('detalhe',d.matchId);
  if (d.deleteMatch) return confirmDelete(d.deleteMatch);
  if (d.confirmDelete) return deleteMatch(d.confirmDelete);
  if (d.player) return showProfile(d.player);
  if (d.ranking) return navigate('ranking',d.ranking);
  if (d.tab) return navigate(d.tab);
});
document.addEventListener('input', event => {
  if (event.target.id === 'player-edit-photo') {
    const file = event.target.files[0];
    const preview = document.getElementById('new-photo-preview');
    if (!preview) return;
    if (!file) { preview.hidden = true; return; }
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5*1024*1024) {
      event.target.value = '';
      preview.hidden = true;
      return toast('Escolha uma foto JPG, PNG ou WebP de até 5 MB.');
    }
    const reader = new FileReader();
    reader.onload = () => { if (document.getElementById('photo-preview-img')) {
      document.getElementById('photo-preview-img').src = reader.result;
      preview.hidden = false;
    }};
    reader.readAsDataURL(file);
  }
  if (event.target.id === 'roster-search') {
    rosterSearch = event.target.value;
    filterRoster();
  }
});
document.addEventListener('submit', event => {
  if (event.target.id === 'scorer-login-form') {
    event.preventDefault();
    handleScorerLogin(event.target);
  }
  if (event.target.id === 'admin-login-form') {
    event.preventDefault();
    handleAdminLogin(event.target);
  }
  if (event.target.id === 'player-editor-form') {
    event.preventDefault();
    savePlayerEditor(event.target);
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !overlay.hidden) closeOverlay();
});

// Começa os ouvintes em tempo real após registrar todos os eventos.
startCloudSync();
