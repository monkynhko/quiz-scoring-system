// app.js — PR-ready Supabase + fallback + komentáre

// === HTML ESCAPE UTILITY ===
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// === KONFIGURÁCIA SUPABASE ===
// Vlož svoje údaje z projektu Supabase (viď README_SUPABASE.md)
// WARNING: Do NOT commit real keys. Use `.env` / hosting environment variables.
let SUPABASE_URL = '<SUPABASE_URL_PLACEHOLDER>'; // e.g. https://xyz.supabase.co
let SUPABASE_ANON_KEY = '<SUPABASE_ANON_KEY_PLACEHOLDER>';
// Allow override from generated config.js (window.SUPABASE_URL / window.SUPABASE_ANON_KEY)
if (typeof window !== 'undefined' && window.SUPABASE_URL) SUPABASE_URL = window.SUPABASE_URL;
if (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY) SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

// If placeholders are still present, prefer local fallback to avoid runtime errors
const _MISSING_SUPABASE_CONFIG = String(SUPABASE_URL).includes('<') || String(SUPABASE_ANON_KEY).includes('<');

// Prepínač režimu: 'supabase' alebo 'local'. If config missing, default to 'local'.
let mode = _MISSING_SUPABASE_CONFIG ? 'local' : 'supabase'; // Zmeň na 'local' ak chceš použiť localStorage fallback

// === SUPABASE KLIENT (CDN UMD) ===
let supabase = null;
let supabaseReady = Promise.resolve();
if (mode === 'supabase') {
  if (typeof window.supabase === 'undefined') {
    supabaseReady = new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.7/dist/umd/supabase.min.js';
      script.onload = () => {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        resolve();
      };
      document.head.appendChild(script);
    });
  } else {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    supabaseReady = Promise.resolve();
  }
}

// Listen for auth events (magic link redirects) so the page reacts after redirect
supabaseReady = supabaseReady.then(async () => {
  try {
    if (mode === 'supabase' && supabase && supabase.auth && typeof supabase.auth.onAuthStateChange === 'function') {
      supabase.auth.onAuthStateChange((event, session) => {
        // When user signs in via magic link, re-fetch profile and update UI
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          fetchAdminProfile().catch(err => console.error('fetchAdminProfile failed', err));
          // Clean URL from tokens/params for nicer UX
          try {
            const hasHashToken = window.location.hash && (window.location.hash.includes('access_token') || window.location.hash.includes('refresh_token'));
            const hasSearchToken = window.location.search && (window.location.search.includes('access_token') || window.location.search.includes('refresh_token'));
            if (hasHashToken || hasSearchToken) {
              // Remove auth tokens from URL without reloading
              const cleanPath = window.location.pathname + (window.location.search ? window.location.search.replace(/(access_token=[^&]*&?|refresh_token=[^&]*&?)/g, '').replace(/\?&|&&/g, '?').replace(/\?$/, '') : '');
              history.replaceState(null, document.title, cleanPath);
              window.location.hash = '';
            }
          } catch (e) { /* ignore */ }
        }
      });
    }
  } catch (e) {
    console.warn('Error setting up auth listener', e);
  }
});

// If the redirect returned tokens in the URL (magic link), try to set the session manually
supabaseReady = supabaseReady.then(async () => {
  try {
    if (mode !== 'supabase' || !supabase || !supabase.auth) return;
    const parseTokensFrom = (src) => {
      if (!src) return null;
      const parts = src.replace(/^#/, '').replace(/^\?/, '').split('&');
      const obj = {};
      parts.forEach(p => {
        const [k, v] = p.split('=');
        if (k && v) obj[decodeURIComponent(k)] = decodeURIComponent(v);
      });
      return obj;
    };

    const hash = window.location.hash;
    const search = window.location.search;
    const fromHash = parseTokensFrom(hash);
    const fromSearch = parseTokensFrom(search);
    const tokens = Object.assign({}, fromSearch || {}, fromHash || {});
    if (tokens.access_token || tokens.refresh_token) {
      // tokens detected — attempting to set session
      try {
        // supabase.auth.setSession expects { access_token, refresh_token }
        await supabase.auth.setSession({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token
        });
      } catch (e) {
        console.warn('setSession failed, attempting fallback setAuth', e);
        try {
          if (tokens.access_token && typeof supabase.auth.setAuth === 'function') {
            supabase.auth.setAuth(tokens.access_token);
          }
        } catch (e2) {
          console.error('Fallback auth set failed', e2);
        }
      }

      // Fetch profile now that session is set
      try {
        await fetchAdminProfile();
      } catch (e) {
        console.warn('fetchAdminProfile after setSession failed', e);
      }

      // Clean URL so tokens aren't visible
      try {
        const cleanUrl = window.location.origin + window.location.pathname + window.location.search.replace(/(access_token=[^&]*&?|refresh_token=[^&]*&?)/g, '').replace(/\?&|&&/g, '?').replace(/\?$/, '') + window.location.hash.replace(/(#.*access_token=[^&]*&?|#.*refresh_token=[^&]*&?)/g, '');
        history.replaceState(null, document.title, cleanUrl);
      } catch (e) {
        // best-effort
      }
    }
  } catch (e) {
    console.warn('Error parsing/setting session from URL', e);
  }
});

// === STAV A DOM ===
const state = {
  user: null,
  isAdmin: false,
  quizId: null,
  teams: [],
  rounds: [],       // [{ name, topics: [{ categoryId, categoryName, categoryIcon, topicOrder, maxPoints, customName }] }]
  scores: {},        // { teamName: { roundName: score } } — legacy flat scores
  topicScores: {},   // { teamName: { roundTopicKey: score } } — topic-level scores
  roundTopics: {},   // { roundName: [{ id, categoryId, categoryName, categoryIcon, topicOrder, maxPoints, customName }] }
  categories: [],    // [{ id, name, icon }]
  quizzes: [],
  currentTab: 'scoring'
};

const elements = {
  teamName: document.getElementById('teamName'),
  addTeam: document.getElementById('addTeam'),
  teamsList: document.getElementById('teamsList'),
  roundName: document.getElementById('roundName'),
  addRound: document.getElementById('addRound'),
  roundsList: document.getElementById('roundsList'),
  scoreboardTable: document.getElementById('scoreboardTable'),
  leaderboardDisplay: document.getElementById('leaderboardDisplay'),
  newQuiz: document.getElementById('newQuiz'),
  saveQuiz: document.getElementById('saveQuiz'),
  loadQuiz: document.getElementById('loadQuiz'),
  exportQuiz: document.getElementById('exportQuiz'),
  tabButtons: document.querySelectorAll('.tab-button'),
  tabContents: document.querySelectorAll('.tab-content'),
  quizStats: {
    topScore: document.getElementById('topScore'),
    easiestRound: document.getElementById('easiestRound'),
    hardestRound: document.getElementById('hardestRound'),
    bestRound: document.getElementById('bestRound')
  },
  // Submissions tab
  submissionsList: document.getElementById('submissionsList'),
  submissionsRoundFilter: document.getElementById('submissionsRoundFilter'),
  submissionsStatusFilter: document.getElementById('submissionsStatusFilter'),
  submissionModal: document.getElementById('submissionModal'),
  submissionModalImg: document.getElementById('submissionModalImg'),
  submissionModalInfo: document.getElementById('submissionModalInfo'),
  submissionModalActions: document.getElementById('submissionModalActions'),
  closeSubmissionModal: document.getElementById('closeSubmissionModal')
};

// === AUTENTIFIKÁCIA ADMINA ===
async function signInAdmin(email) {
  console.log('signInAdmin() called; mode=', mode);
  if (mode !== 'supabase') {
    alert('Supabase nie je nakonfigurovaný v tejto inštancii. Skontroluj, či máš vygenerovaný `config.js` alebo nastav `window.SUPABASE_URL` a `window.SUPABASE_ANON_KEY`.');
    return false;
  }

    try {
      // prefer explicit redirect so magic link returns to the current origin
      const redirectTo = window.location.origin + window.location.pathname;
      const res = await supabase.auth.signInWithOtp({ email }, { redirectTo });
      if (res.error) {
        alert('Chyba pri prihlasovaní: ' + res.error.message);
        return false;
      }
      alert('Skontroluj svoj email a klikni na magic link. Po kliknutí sa stránka automaticky obnoví.');
      // in case the browser returns immediately, reload to trigger auth listener
      setTimeout(() => location.reload(), 1000);
      return true;
    } catch (e) {
      console.error('signInAdmin unexpected error', e);
      alert('Neočakovaná chyba pri požiadavke magic link: ' + (e.message || e));
      return false;
    }
}

async function signOutAdmin() {
  if (mode !== 'supabase') return;
  await supabase.auth.signOut();
  state.user = null;
  state.isAdmin = false;
  alert('Odhlásený.');
}

// Po prihlásení načítaj profil
async function fetchAdminProfile() {
  if (mode !== 'supabase') return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    state.user = null;
    renderAuthButtons();
    return false;
  }
  state.user = user;
  // Zisti is_admin z profiles
  const { data, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  state.isAdmin = !!(data && data.is_admin);
  setAdminUI(state.isAdmin);
  renderAuthButtons();
  return state.isAdmin;
}

// Povolenie/zablokovanie admin UI prvkov podľa roly
function setAdminUI(isAdmin) {
  // Admin controls
  [elements.newQuiz, elements.saveQuiz, elements.loadQuiz, elements.exportQuiz, elements.addTeam, elements.addRound].forEach(el => {
    if (el) el.disabled = !isAdmin;
  });
  // Team/round inputs
  if (elements.teamName) elements.teamName.disabled = !isAdmin;
  if (elements.roundName) elements.roundName.disabled = !isAdmin;
  // Scoreboard inputs
  const scoreboard = elements.scoreboardTable;
  if (scoreboard) {
    const inputs = scoreboard.querySelectorAll('input');
    inputs.forEach(inp => { inp.disabled = !isAdmin; });
  }
  // Remove buttons
  document.querySelectorAll('.team-item button, .round-item button').forEach(btn => {
    btn.disabled = !isAdmin;
  });
}

// === ULOŽENIE QUIZU DO SUPABASE ===
let _saving = false;
async function saveQuizToSupabase() {
  if (_saving) return;
  if (mode !== 'supabase') {
    saveQuizToLocal();
    return;
  }
  if (!state.isAdmin) {
    alert('Iba admin môže ukladať quiz.');
    return;
  }
  _saving = true;
  const btn = elements.saveQuiz;
  if (btn) { btn.disabled = true; btn.textContent = 'Ukladám...'; }
  try {
  // 1. Vytvor quiz
  let quizId = state.quizId;
  if (!quizId) {
    const insertPayload = { title: state.title || 'Quiz' };
    if (state.seasonId) insertPayload.season_id = state.seasonId;
    const { data: quiz, error: quizErr } = await supabase
      .from('quizzes')
      .insert([insertPayload])
      .select('id')
      .single();
    if (quizErr) {
      alert('Chyba pri ukladaní quizu: ' + quizErr.message);
      return;
    }
    quizId = quiz.id;
    state.quizId = quizId;
  }
  // 2. Teams
  const teamsPayload = state.teams.map(name => ({ quiz_id: quizId, name }));
  await supabase.from('teams').delete().eq('quiz_id', quizId); // prepis
  const { data: teams, error: teamsErr } = await supabase
    .from('teams')
    .insert(teamsPayload)
    .select('id, name');
  if (teamsErr) {
    alert('Chyba pri ukladaní tímov: ' + teamsErr.message);
    return;
  }
  // 3. Rounds
  const roundsPayload = state.rounds.map((r, i) => ({
    quiz_id: quizId,
    name: r.name,
    round_order: i
  }));
  // Delete old round_topics and topic_scores first (cascade from rounds)
  await supabase.from('rounds').delete().eq('quiz_id', quizId);
  const { data: rounds, error: roundsErr } = await supabase
    .from('rounds')
    .insert(roundsPayload)
    .select('id, name, round_order');
  if (roundsErr) {
    alert('Chyba pri ukladaní kôl: ' + roundsErr.message);
    return;
  }
  // 4. Round Topics
  // First, upsert any custom categories into the categories table
  const roundTopicsPayload = [];
  for (const round of rounds) {
    const topics = state.roundTopics[round.name] || [];
    for (let idx = 0; idx < topics.length; idx++) {
      const t = topics[idx];
      let catId = t.categoryId || null;
      // If custom category (no categoryId but has customName), upsert into categories
      if (!catId && t.customName) {
        const { data: upserted, error: upsertErr } = await supabase
          .from('categories')
          .upsert({ name: t.customName, icon: '❓' }, { onConflict: 'name' })
          .select('id')
          .single();
        if (!upsertErr && upserted) {
          catId = upserted.id;
          t.categoryId = catId; // update in-memory too
        }
      }
      roundTopicsPayload.push({
        round_id: round.id,
        category_id: catId,
        topic_order: idx + 1,
        max_points: t.maxPoints || 5
      });
    }
  }
  
  let savedRoundTopics = [];
  if (roundTopicsPayload.length > 0) {
    const { data: rtData, error: rtErr } = await supabase
      .from('round_topics')
      .insert(roundTopicsPayload)
      .select('id, round_id, category_id, topic_order, max_points');
    if (rtErr) {
      alert('Chyba pri ukladaní tém kôl: ' + rtErr.message);
      return;
    }
    savedRoundTopics = rtData || [];
  }
  
  // 5. Topic Scores (if we have round_topics)
  if (savedRoundTopics.length > 0) {
    const topicScoresPayload = [];
    teams.forEach(team => {
      rounds.forEach(round => {
        const topics = state.roundTopics[round.name] || [];
        topics.forEach((t, idx) => {
          const key = round.name + '::' + (idx + 1);
          const val = (state.topicScores[team.name] && state.topicScores[team.name][key]) || 0;
          // Find the matching saved round_topic
          const rt = savedRoundTopics.find(rt => rt.round_id === round.id && rt.topic_order === (idx + 1));
          if (rt) {
            topicScoresPayload.push({
              team_id: team.id,
              round_topic_id: rt.id,
              score: typeof val === 'number' && val >= 0 ? val : 0
            });
          }
        });
      });
    });
    if (topicScoresPayload.length > 0) {
      const { error: tsErr } = await supabase.from('topic_scores').insert(topicScoresPayload);
      if (tsErr) {
        alert('Chyba pri ukladaní topic skóre: ' + tsErr.message);
        return;
      }
    }
  }
  
  // 6. Legacy Scores (backward compatibility)
  await supabase.from('scores').delete().in('team_id', teams.map(t => t.id));
  const scoresPayload = [];
  teams.forEach(team => {
    rounds.forEach(round => {
      const val = state.scores[team.name]?.[round.name] ?? 0;
      scoresPayload.push({
        team_id: team.id,
        round_id: round.id,
        score: typeof val === 'number' && val >= 0 ? val : 0
      });
    });
  });
  if (scoresPayload.length > 0) {
    const { error: scoresErr } = await supabase.from('scores').insert(scoresPayload);
    if (scoresErr) {
      alert('Chyba pri ukladaní skóre: ' + scoresErr.message);
      return;
    }
  }
  alert('Quiz uložený do Supabase!');
  } finally {
    _saving = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Save Quiz'; }
  }
}

// === EXPORT QUIZ DATA (simple client-side download) ===
function exportQuizData() {
  try {
    const filename = (state.title ? state.title.replace(/[^a-z0-9_\-]/gi, '_') : 'quiz') + '_export.json';
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Export failed', e);
    alert('Export failed: ' + e.message);
  }
}

// === NAČÍTANIE QUIZU Z SUPABASE ===
async function loadQuizFromSupabase() {
  if (mode !== 'supabase') {
    loadQuizFromLocal();
    return;
  }
  const quizzes = await fetchQuizList();
  if (!quizzes || quizzes.length === 0) {
    alert('V databáze nie sú žiadne quizy.');
    return;
  }
  renderQuizDropdown(quizzes, async function(quizId) {
    if (!quizId || typeof quizId !== 'string') {
      alert('Neplatný výber.');
      return;
    }
    await loadQuizById(quizId);
  });
}

// === Načítanie quizu podľa ID ===
async function loadQuizById(quizId) {
  // 1. Quiz
  const { data: quiz, error: quizErr } = await supabase
    .from('quizzes')
    .select('id, title, season_id')
    .eq('id', quizId)
    .single();
  if (quizErr) {
    alert('Quiz nenájdený: ' + quizErr.message);
    return;
  }
  state.quizId = quiz.id;
  state.title = quiz.title;
  state.seasonId = quiz.season_id || null;
  // Reset submissions round filter for new quiz
  if (elements.submissionsRoundFilter) {
    elements.submissionsRoundFilter.innerHTML = '<option value="">Všetky kolá</option>';
  }
  // 2. Teams
  const { data: teams } = await supabase
    .from('teams')
    .select('id, name')
    .eq('quiz_id', quizId);
  state.teams = teams.map(t => t.name);
  // 3. Rounds
  const { data: rounds } = await supabase
    .from('rounds')
    .select('id, name, round_order')
    .eq('quiz_id', quizId)
    .order('round_order');
  
  // 4. Round Topics (new topic-based system)
  const roundIds = rounds.map(r => r.id);
  let roundTopicsData = [];
  if (roundIds.length) {
    const { data: rtData } = await supabase
      .from('round_topics')
      .select('id, round_id, category_id, topic_order, max_points')
      .in('round_id', roundIds)
      .order('topic_order');
    roundTopicsData = rtData || [];
  }
  
  // Fetch category info for round_topics
  const categoryIds = [...new Set(roundTopicsData.filter(rt => rt.category_id).map(rt => rt.category_id))];
  let categoriesMap = {};
  if (categoryIds.length) {
    const { data: cats } = await supabase
      .from('categories')
      .select('id, name, icon')
      .in('id', categoryIds);
    (cats || []).forEach(c => { categoriesMap[c.id] = c; });
  }
  
  // Build state.rounds with topics and state.roundTopics
  state.roundTopics = {};
  state.rounds = rounds.map(r => {
    const rTopics = roundTopicsData.filter(rt => rt.round_id === r.id).sort((a, b) => a.topic_order - b.topic_order);
    const topics = rTopics.map(rt => {
      const cat = categoriesMap[rt.category_id];
      return {
        id: rt.id,
        categoryId: rt.category_id,
        categoryName: cat ? cat.name : 'Unknown',
        categoryIcon: cat ? (cat.icon || '') : '❓',
        topicOrder: rt.topic_order,
        maxPoints: rt.max_points || 5,
        customName: null
      };
    });
    state.roundTopics[r.name] = topics;
    return { name: r.name, topics };
  });
  
  // 5. Topic Scores (new system)
  const rtIds = roundTopicsData.map(rt => rt.id);
  let topicScoresData = [];
  if (rtIds.length) {
    const { data: tsData } = await supabase
      .from('topic_scores')
      .select('team_id, round_topic_id, score')
      .in('round_topic_id', rtIds);
    topicScoresData = tsData || [];
  }
  
  // 6. Legacy Scores (backward compat – filtered to this quiz's rounds)
  let scores = [];
  if (roundIds.length) {
    const { data: scData } = await supabase
      .from('scores')
      .select('team_id, round_id, score')
      .in('round_id', roundIds);
    scores = scData || [];
  }
  
  // Map legacy scores
  const scoreLookup = {};
  (scores || []).forEach(s => { scoreLookup[s.team_id + '|' + s.round_id] = s; });
  const topicScoreLookup = {};
  (topicScoresData || []).forEach(ts => { topicScoreLookup[ts.team_id + '|' + ts.round_topic_id] = ts; });
  const rtByRound = {};
  roundTopicsData.forEach(rt => {
    if (!rtByRound[rt.round_id]) rtByRound[rt.round_id] = [];
    rtByRound[rt.round_id].push(rt);
  });

  state.scores = {};
  teams.forEach(team => {
    state.scores[team.name] = {};
    rounds.forEach(round => {
      const s = scoreLookup[team.id + '|' + round.id];
      state.scores[team.name][round.name] = s ? Number(s.score) : 0;
    });
  });
  
  // Map topic scores
  state.topicScores = {};
  teams.forEach(team => {
    state.topicScores[team.name] = {};
    rounds.forEach(round => {
      const rTopics = (rtByRound[round.id] || []).slice().sort((a, b) => a.topic_order - b.topic_order);
      rTopics.forEach((rt, idx) => {
        const key = round.name + '::' + (idx + 1);
        const ts = topicScoreLookup[team.id + '|' + rt.id];
        state.topicScores[team.name][key] = ts ? Number(ts.score) : 0;
      });
    });
  });
  
  updateTeamsList();
  updateRoundsList();
  updateScoreboard();
  updateLeaderboard();
  updateQuizStats();
  updateQuizNameDisplay();
}

// === FETCH NAJNOVŠIEHO LEADERBOARDU (public) ===
async function fetchLatestLeaderboard() {
  if (mode !== 'supabase') {
    // fallback: načítaj z leaderboard.json
    try {
      const resp = await fetch('leaderboard.json');
      if (!resp.ok) throw new Error('Chyba načítania snapshotu');
      return await resp.json();
    } catch (e) {
      alert('Nepodarilo sa načítať leaderboard: ' + e.message);
      return null;
    }
  }
  // Získaj najnovší quiz
  const { data: quiz } = await supabase
    .from('quizzes')
    .select('id, title, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!quiz) return null;
  // Získaj teams, rounds, scores
  const { data: teams } = await supabase
    .from('teams')
    .select('id, name')
    .eq('quiz_id', quiz.id);
  const { data: rounds } = await supabase
    .from('rounds')
    .select('id, name, round_order')
    .eq('quiz_id', quiz.id)
    .order('round_order');
  const roundIds = (rounds || []).map(r => r.id);
  let scores = [];
  if (roundIds.length) {
    const { data: scData } = await supabase
      .from('scores')
      .select('team_id, round_id, score')
      .in('round_id', roundIds);
    scores = scData || [];
  }
  // Spočítaj total per team
  const scoreLookup = {};
  (scores || []).forEach(s => { scoreLookup[s.team_id + '|' + s.round_id] = s; });
  const leaderboard = (teams || []).map(team => {
    let total = 0;
    rounds.forEach(round => {
      const s = scoreLookup[team.id + '|' + round.id];
      total += s ? Number(s.score) : 0;
    });
    return { team: team.name, total };
  });
  leaderboard.sort((a, b) => b.total - a.total);
  return { quiz, teams, rounds, scores, leaderboard };
}

// === ZOZNAM QUIZOV (archív) ===
async function fetchQuizList() {
  if (mode !== 'supabase') return [];
  const { data: quizzes } = await supabase
    .from('quizzes')
    .select('id, title, created_at, season_id')
    .order('created_at', { ascending: false })
    .limit(20);
  return quizzes || [];
}

// Fetch seasons list (for assigning a new quiz to a season)
async function fetchSeasons() {
  if (mode !== 'supabase') return [];
  const { data, error } = await supabase
    .from('seasons')
    .select('id, name, is_active')
    .order('name', { ascending: true });
  if (error) {
    console.warn('fetchSeasons error', error);
    return [];
  }
  return data || [];
}

// Fetch categories list for round topic selection
async function fetchCategories() {
  if (mode !== 'supabase') return [];
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, icon')
    .order('name', { ascending: true });
  if (error) {
    console.warn('fetchCategories error', error);
    return [];
  }
  state.categories = data || [];
  return state.categories;
}

// === FALLBACK LOCALSTORAGE ===
function saveQuizToLocal() {
  localStorage.setItem('quizData', JSON.stringify(state));
  alert('Quiz uložený do localStorage!');
}
function loadQuizFromLocal() {
  const savedData = localStorage.getItem('quizData');
  if (savedData) {
    try {
      const loadedState = JSON.parse(savedData);
      Object.assign(state, loadedState);
      updateTeamsList();
      updateRoundsList();
      updateScoreboard();
      updateLeaderboard();
      alert('Quiz načítaný z localStorage!');
    } catch (e) {
      alert('Chyba načítania z localStorage!');
    }
  }
}

// === ZÁKLADNÉ FUNKCIE UI ===
function addTeam() {
  if (!state.isAdmin) return;
  const teamsInput = elements.teamName.value.trim();
  if (!teamsInput) return;
  const teamNames = teamsInput.split('\n')
    .map(name => name.trim())
    .filter(name => name.length > 0);
  let addedCount = 0;
  teamNames.forEach(teamName => {
    if (!state.teams.includes(teamName)) {
      state.teams.push(teamName);
      state.scores[teamName] = {};
      state.topicScores[teamName] = {};
      state.rounds.forEach(round => {
        state.scores[teamName][round.name] = 0;
        const topics = round.topics || state.roundTopics[round.name] || [];
        topics.forEach((t, idx) => {
          const key = round.name + '::' + (idx + 1);
          state.topicScores[teamName][key] = 0;
        });
      });
      addedCount++;
    }
  });
  if (addedCount > 0) {
    elements.teamName.value = '';
    updateTeamsList();
    updateScoreboard();
    updateLeaderboard();
  }
}

function addRound() {
  if (!state.isAdmin) return;
  const roundName = elements.roundName.value.trim();
  if (!roundName) return;
  if (state.rounds.some(r => r.name === roundName)) {
    alert('Round already exists!');
    return;
  }
  // Show topic selection modal for 2 topics
  showTopicSelectionModal(roundName, (topic1, topic2) => {
    const topics = [topic1, topic2];
    const round = { name: roundName, topics };
    state.rounds.push(round);
    state.roundTopics[roundName] = topics;
    // Initialize topic scores for all teams
    state.teams.forEach(team => {
      if (!state.topicScores[team]) state.topicScores[team] = {};
      topics.forEach((t, idx) => {
        const key = roundName + '::' + (idx + 1);
        state.topicScores[team][key] = 0;
      });
      // Also keep legacy flat score
      if (!state.scores[team]) state.scores[team] = {};
      state.scores[team][roundName] = 0;
    });
    elements.roundName.value = '';
    updateRoundsList();
    updateScoreboard();
    updateLeaderboard();
  });
}

// Show modal for selecting 2 topics (categories) for a round
function showTopicSelectionModal(roundName, onConfirm, existingTopics) {
  const overlay = document.createElement('div');
  overlay.style = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:9999;';
  const box = document.createElement('div');
  box.style = 'background:#111; color:#fff; padding:24px; border-radius:12px; min-width:360px; max-width:90%;';
  
  function buildCategorySelect(num) {
    let opts = state.categories.map(c => `<option value="${c.id}">${c.icon || ''} ${c.name}</option>`).join('');
    return `
      <div style="margin-bottom:12px;">
        <label style="font-weight:bold;">Téma ${num}:</label><br>
        <select id="topicCat${num}" style="width:100%; padding:8px; margin-top:6px; border-radius:8px; border:1px solid #333; background:#222; color:#fff;">
          ${opts}
          <option value="__custom__">Iná...</option>
        </select>
        <input id="topicCustom${num}" placeholder="Vlastný názov kategórie" style="width:100%; padding:8px; margin-top:6px; border-radius:8px; border:1px solid #333; display:none;" />
        <div style="margin-top:6px;">
          <label style="font-size:0.9em;">Max bodov:</label>
          <input id="topicMax${num}" type="number" value="5" min="1" max="20" step="0.5" style="width:60px; padding:4px; border-radius:6px; border:1px solid #333; margin-left:6px;" />
        </div>
      </div>
    `;
  }
  
  box.innerHTML = `
    <h3 style="margin-top:0">Kolo: ${roundName}</h3>
    <p style="color:#aaa; font-size:0.9em; margin-bottom:12px;">Vyber 2 témy (kategórie) pre toto kolo:</p>
    ${buildCategorySelect(1)}
    ${buildCategorySelect(2)}
    <div style="text-align:right; display:flex; gap:8px; justify-content:flex-end;">
      <button id="cancelTopicModal" class="neon-button">Zrušiť</button>
      <button id="confirmTopicModal" class="neon-button">Pridať kolo</button>
    </div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  
  // Wire up custom category toggles
  [1, 2].forEach(n => {
    const sel = box.querySelector(`#topicCat${n}`);
    const customInput = box.querySelector(`#topicCustom${n}`);
    sel.addEventListener('change', () => {
      customInput.style.display = sel.value === '__custom__' ? '' : 'none';
    });
  });

  // Pre-fill with existing topics if provided (edit mode)
  if (existingTopics && existingTopics.length) {
    [1, 2].forEach(n => {
      const t = existingTopics[n - 1];
      if (!t) return;
      const sel = box.querySelector(`#topicCat${n}`);
      const customInput = box.querySelector(`#topicCustom${n}`);
      const maxInput = box.querySelector(`#topicMax${n}`);
      if (t.categoryId && sel) {
        sel.value = t.categoryId;
      } else if (t.customName) {
        sel.value = '__custom__';
        customInput.value = t.customName;
        customInput.style.display = '';
      }
      if (maxInput && t.maxPoints) maxInput.value = t.maxPoints;
    });
  }
  
  box.querySelector('#cancelTopicModal').onclick = () => overlay.remove();
  box.querySelector('#confirmTopicModal').onclick = () => {
    const topics = [];
    for (let n = 1; n <= 2; n++) {
      const sel = box.querySelector(`#topicCat${n}`);
      const customInput = box.querySelector(`#topicCustom${n}`);
      const maxPts = parseFloat(box.querySelector(`#topicMax${n}`).value) || 5;
      
      if (sel.value === '__custom__') {
        const customName = customInput.value.trim();
        if (!customName) {
          alert(`Zadaj vlastný názov pre tému ${n}.`);
          return;
        }
        topics.push({
          categoryId: null,
          categoryName: customName,
          categoryIcon: '❓',
          topicOrder: n,
          maxPoints: maxPts,
          customName: customName
        });
      } else {
        const cat = state.categories.find(c => c.id === sel.value);
        topics.push({
          categoryId: cat ? cat.id : null,
          categoryName: cat ? cat.name : 'Unknown',
          categoryIcon: cat ? (cat.icon || '') : '',
          topicOrder: n,
          maxPoints: maxPts,
          customName: null
        });
      }
    }
    overlay.remove();
    onConfirm(topics[0], topics[1]);
  };
}

function updateTeamsList() {
  elements.teamsList.innerHTML = '';
  const badge = document.getElementById('teamsBadge');
  if (badge) badge.textContent = state.teams.length ? '(' + state.teams.length + ' tímov)' : '';
  state.teams.forEach(team => {
    const teamDiv = document.createElement('div');
    teamDiv.className = 'team-item';
    const span = document.createElement('span');
    span.textContent = team;
    const btn = document.createElement('button');
    btn.className = 'neon-button';
    btn.textContent = 'Remove';
    btn.dataset.team = team;
    btn.addEventListener('click', function() { window.removeTeam(this.dataset.team); });
    teamDiv.appendChild(span);
    teamDiv.appendChild(btn);
    elements.teamsList.appendChild(teamDiv);
  });
}
window.removeTeam = function(teamName) {
  if (!state.isAdmin) return;
  const index = state.teams.indexOf(teamName);
  if (index > -1) {
    state.teams.splice(index, 1);
    delete state.scores[teamName];
    updateTeamsList();
    updateScoreboard();
    updateLeaderboard();
  }
};

function updateRoundsList() {
  elements.roundsList.innerHTML = '';
  const badge = document.getElementById('roundsBadge');
  if (badge) badge.textContent = state.rounds.length ? '(' + state.rounds.length + ' kôl)' : '';
  state.rounds.forEach(round => {
    const roundDiv = document.createElement('div');
    roundDiv.className = 'team-item round-item-card';
    const topics = round.topics || state.roundTopics[round.name] || [];
    const topicPills = topics.map(t => {
      const icon = t.categoryIcon || '';
      const name = t.customName || t.categoryName || '?';
      const max = t.maxPoints || 5;
      return `<span class="round-topic-pill">${escapeHtml(icon)} ${escapeHtml(name)} <span class="topic-max">(max ${max})</span></span>`;
    }).join('');
    roundDiv.innerHTML = `
      <div style="flex:1;">
        <div class="round-name">${escapeHtml(round.name)}</div>
        <div class="round-topics-row">${topicPills || '<span style="color:#666; font-size:0.9em;">Žiadne témy</span>'}</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="neon-button answers-round-btn" style="background:#ff9800; font-size:0.85em;">📝 Odpovede</button>
        <button class="neon-button edit-round-btn" style="background:#2196F3; font-size:0.85em;">Edit</button>
        <button class="neon-button remove-round-btn" style="background:#e53935; font-size:0.85em;">Remove</button>
      </div>
    `;
    // Attach event handlers via data attributes
    const answersBtn = roundDiv.querySelector('.answers-round-btn');
    const editBtn = roundDiv.querySelector('.edit-round-btn');
    const removeBtn = roundDiv.querySelector('.remove-round-btn');
    answersBtn.dataset.round = round.name;
    editBtn.dataset.round = round.name;
    removeBtn.dataset.round = round.name;
    answersBtn.addEventListener('click', function() { showCorrectAnswersModal(this.dataset.round); });
    editBtn.addEventListener('click', function() { window.editRound(this.dataset.round); });
    removeBtn.addEventListener('click', function() { window.removeRound(this.dataset.round); });
    elements.roundsList.appendChild(roundDiv);
  });
}
window.removeRound = function(roundName) {
  if (!state.isAdmin) return;
  const index = state.rounds.findIndex(r => r.name === roundName);
  if (index > -1) {
    state.rounds.splice(index, 1);
    state.teams.forEach(team => {
      delete state.scores[team][roundName];
      // remove topic scores
      if (state.topicScores[team]) {
        Object.keys(state.topicScores[team]).forEach(key => {
          if (key.startsWith(roundName + '::')) delete state.topicScores[team][key];
        });
      }
    });
    delete state.roundTopics[roundName];
    updateRoundsList();
    updateScoreboard();
    updateLeaderboard();
  }
};

window.editRound = function(roundName) {
  if (!state.isAdmin) return;
  const round = state.rounds.find(r => r.name === roundName);
  if (!round) return;
  const currentTopics = round.topics || state.roundTopics[roundName] || [];

  // Save existing topic scores BEFORE opening modal so they survive edits
  const savedScores = {};
  state.teams.forEach(team => {
    savedScores[team] = {};
    currentTopics.forEach((t, idx) => {
      const key = roundName + '::' + (idx + 1);
      savedScores[team][idx] = (state.topicScores[team] && state.topicScores[team][key]) || 0;
    });
  });

  showTopicSelectionModal(roundName, (topic1, topic2) => {
    const newTopics = [topic1, topic2];
    round.topics = newTopics;
    state.roundTopics[roundName] = newTopics;
    // Re-initialize topic scores for all teams, preserving existing values by index
    state.teams.forEach(team => {
      if (!state.topicScores[team]) state.topicScores[team] = {};
      // Remove old topic scores for this round
      Object.keys(state.topicScores[team]).forEach(key => {
        if (key.startsWith(roundName + '::')) delete state.topicScores[team][key];
      });
      // Add new topic scores — reuse saved value if the index existed, else 0
      newTopics.forEach((t, idx) => {
        const key = roundName + '::' + (idx + 1);
        state.topicScores[team][key] = savedScores[team][idx] !== undefined ? savedScores[team][idx] : 0;
      });
      // Recompute legacy flat score as sum of preserved topic scores
      let roundTotal = 0;
      newTopics.forEach((t, idx) => {
        const key = roundName + '::' + (idx + 1);
        roundTotal += state.topicScores[team][key] || 0;
      });
      if (state.scores[team]) state.scores[team][roundName] = roundTotal;
    });
    updateRoundsList();
    updateScoreboard();
    updateLeaderboard();
  }, currentTopics);
};

function updateScoreboard() {
  if (state.teams.length === 0 || state.rounds.length === 0) {
    elements.scoreboardTable.innerHTML = '<p>Add teams and rounds to see the scoreboard</p>';
    return;
  }
  
  // Determine if we have topic-based rounds
  const hasTopics = state.rounds.some(r => (r.topics && r.topics.length) || (state.roundTopics[r.name] && state.roundTopics[r.name].length));
  
  let html = '<table>';
  
  if (hasTopics) {
    // Two-row header: round name spanning 2 cols, then topic names below
    html += '<tr><th rowspan="2">Team</th>';
    state.rounds.forEach(round => {
      const topics = round.topics || state.roundTopics[round.name] || [];
      const colspan = topics.length || 1;
      html += `<th colspan="${colspan}" style="border-bottom:none; text-align:center;">${escapeHtml(round.name)}</th>`;
    });
    html += '<th rowspan="2">Total</th></tr>';
    // Second header row: topic names
    html += '<tr>';
    state.rounds.forEach(round => {
      const topics = round.topics || state.roundTopics[round.name] || [];
      if (topics.length) {
        topics.forEach(t => {
          const label = escapeHtml((t.categoryIcon || '') + ' ' + (t.customName || t.categoryName || '?'));
          html += `<th style="font-size:0.8em; font-weight:normal; color:#aaa;">${label}<br><span style="font-size:0.75em;">(max ${t.maxPoints || 5})</span></th>`;
        });
      } else {
        html += `<th style="font-size:0.8em;">&nbsp;</th>`;
      }
    });
    html += '</tr>';
  } else {
    // Legacy single-row header
    html += '<tr><th>Team</th>';
    state.rounds.forEach(round => {
      html += `<th>${escapeHtml(round.name)}</th>`;
    });
    html += '<th>Total</th></tr>';
  }
  
  // Data rows
  state.teams.forEach(team => {
    html += `<tr><td>${escapeHtml(team)}</td>`;
    let total = 0;
    state.rounds.forEach(round => {
      const topics = round.topics || state.roundTopics[round.name] || [];
      if (topics.length) {
        topics.forEach((t, idx) => {
          const key = round.name + '::' + (idx + 1);
          const score = (state.topicScores[team] && state.topicScores[team][key]) || 0;
          total += score;
          const safeTeam = team.replace(/'/g, "\\'");
          const safeKey = key.replace(/'/g, "\\'");
          html += `<td><input type="number" class="score-input neon-input" 
            value="${score}" min="0" max="${t.maxPoints || 10}" step="0.5"
            onchange="updateTopicScore('${safeTeam}', '${safeKey}', this.value)"></td>`;
        });
      } else {
        // Legacy: single score per round
        const score = state.scores[team][round.name] || 0;
        total += score;
        html += `<td><input type="number" class="score-input neon-input" 
          value="${score}" min="0" step="0.5"
          onchange="updateScore('${team}', '${round.name}', this.value)"></td>`;
      }
    });
    html += `<td><strong>${total}</strong></td></tr>`;
  });
  html += '</table>';
  elements.scoreboardTable.innerHTML = html;
  updateQuizStats();
}

window.updateScore = function(team, round, score) {
  if (!state.isAdmin) return;
  let parsed = parseFloat(score);
  if (isNaN(parsed) || parsed < 0) parsed = 0;
  state.scores[team][round] = parsed;
  debouncedScoreRender();
};

window.updateTopicScore = function(team, topicKey, score) {
  if (!state.isAdmin) return;
  let parsed = parseFloat(score);
  if (isNaN(parsed) || parsed < 0) parsed = 0;
  if (!state.topicScores[team]) state.topicScores[team] = {};
  state.topicScores[team][topicKey] = parsed;
  // Update legacy flat score (sum of topics in this round)
  const roundName = topicKey.split('::')[0];
  if (state.scores[team]) {
    let roundTotal = 0;
    const topics = state.roundTopics[roundName] || [];
    topics.forEach((t, idx) => {
      const key = roundName + '::' + (idx + 1);
      roundTotal += (state.topicScores[team] && state.topicScores[team][key]) || 0;
    });
    state.scores[team][roundName] = roundTotal;
  }
  debouncedScoreRender();
};

let _scoreRenderTimer = null;
function debouncedScoreRender() {
  if (_scoreRenderTimer) clearTimeout(_scoreRenderTimer);
  _scoreRenderTimer = setTimeout(() => {
    updateScoreboard();
    updateLeaderboard();
  }, 300);
}

function updateLeaderboard() {
  const hasTopics = state.rounds.some(r => (r.topics && r.topics.length) || (state.roundTopics[r.name] && state.roundTopics[r.name].length));
  
  const teamScores = state.teams.map(team => {
    let total = 0;
    if (hasTopics) {
      // Sum topic scores
      state.rounds.forEach(round => {
        const topics = round.topics || state.roundTopics[round.name] || [];
        topics.forEach((t, idx) => {
          const key = round.name + '::' + (idx + 1);
          total += (state.topicScores[team] && state.topicScores[team][key]) || 0;
        });
      });
    } else {
      total = Object.values(state.scores[team] || {}).reduce((sum, score) => sum + score, 0);
    }
    return { team, total };
  }).sort((a, b) => b.total - a.total);
  elements.leaderboardDisplay.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Position</th>
          <th>Team</th>
          <th>Total Score</th>
        </tr>
      </thead>
      <tbody>
        ${teamScores.map((score, index) => `
          <tr class="${index === 0 ? 'winner' : ''}">
            <td>${index + 1}</td>
            <td>${escapeHtml(score.team)}</td>
            <td>${score.total}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  updateQuizStats();
}

// Display current quiz name in header
function updateQuizNameDisplay() {
  const el = document.getElementById('currentQuizName');
  if (!el) return;
  el.textContent = state.title || '';
}

function updateQuizStats() {
  if (!elements.quizStats) return;
  const { topScore, easiestRound, hardestRound, bestRound } = elements.quizStats;
  if (!state.teams.length || !state.rounds.length) {
    if (topScore) topScore.textContent = '-';
    if (easiestRound) easiestRound.textContent = '-';
    if (hardestRound) hardestRound.textContent = '-';
    if (bestRound) bestRound.textContent = '-';
    return;
  }
  // Top score
  let maxScore = -Infinity, maxTeam = '';
  state.teams.forEach(team => {
    const total = Object.values(state.scores[team] || {}).reduce((a, b) => a + b, 0);
    if (total > maxScore) {
      maxScore = total;
      maxTeam = team;
    }
  });
  if (topScore) topScore.textContent = `${maxTeam} (${maxScore})`;
  // Easiest/hardest round (najvyšší/priemerný priemer na kolo)
  let easiest = -Infinity, hardest = Infinity, best = -Infinity;
  let easiestName = '', hardestName = '', bestName = '';
  state.rounds.forEach(round => {
    let sum = 0;
    state.teams.forEach(team => {
      sum += state.scores[team][round.name] || 0;
    });
    const avg = sum / state.teams.length;
    if (avg > easiest) {
      easiest = avg;
      easiestName = round.name;
    }
    if (avg < hardest) {
      hardest = avg;
      hardestName = round.name;
    }
    if (sum > best) {
      best = sum;
      bestName = round.name;
    }
  });
  if (easiestRound) easiestRound.textContent = `${easiestName} (${easiest.toFixed(2)})`;
  if (hardestRound) hardestRound.textContent = `${hardestName} (${hardest.toFixed(2)})`;
  if (bestRound) bestRound.textContent = `${bestName} (${best})`;
}

// === SUBMISSIONS (photo review) ===
async function fetchSubmissions(quizId, roundId, status) {
  if (mode !== 'supabase' || !quizId) return [];
  let q = supabase
    .from('answer_submissions')
    .select('id, quiz_id, team_id, round_id, photo_url, photo_path, submitted_at, submitted_by, status, admin_notes, score_override, reviewed_at, reviewed_by, ai_status, ai_score, ai_max_score, ai_error')
    .eq('quiz_id', quizId)
    .order('submitted_at', { ascending: false });
  if (roundId) q = q.eq('round_id', roundId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) { console.error('fetchSubmissions error', error); return []; }
  return data || [];
}

async function loadAndRenderSubmissions() {
  if (!state.quizId) {
    if (elements.submissionsList) elements.submissionsList.innerHTML = '<p style="color:#aaa;text-align:center;">Najprv načítaj kvíz.</p>';
    return;
  }
  // Populate round filter if empty
  if (elements.submissionsRoundFilter && elements.submissionsRoundFilter.options.length <= 1) {
    const { data: rounds } = await supabase
      .from('rounds')
      .select('id, name, round_order')
      .eq('quiz_id', state.quizId)
      .order('round_order');
    (rounds || []).forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      elements.submissionsRoundFilter.appendChild(opt);
    });
  }
  const roundId = elements.submissionsRoundFilter ? elements.submissionsRoundFilter.value : '';
  const statusVal = elements.submissionsStatusFilter ? elements.submissionsStatusFilter.value : '';
  const submissions = await fetchSubmissions(state.quizId, roundId, statusVal);

  // Need team & round names for display
  const teamIds = [...new Set(submissions.map(s => s.team_id))];
  const roundIds = [...new Set(submissions.map(s => s.round_id))];

  let teamMap = {};
  let roundMap = {};
  if (teamIds.length) {
    const { data: teams } = await supabase.from('teams').select('id, name').in('id', teamIds);
    (teams || []).forEach(t => { teamMap[t.id] = t.name; });
  }
  if (roundIds.length) {
    const { data: rounds } = await supabase.from('rounds').select('id, name').in('id', roundIds);
    (rounds || []).forEach(r => { roundMap[r.id] = r.name; });
  }

  // Generate signed URLs for all submissions (private bucket)
  for (const sub of submissions) {
    if (sub.photo_path) {
      sub._signedUrl = await getSignedPhotoUrl(sub.photo_path);
    } else {
      sub._signedUrl = sub.photo_url || '';
    }
  }

  renderSubmissions(submissions, teamMap, roundMap);
}

function renderSubmissions(submissions, teamMap, roundMap) {
  const container = elements.submissionsList;
  if (!container) return;
  if (!submissions.length) {
    container.innerHTML = '<p style="color:#aaa;text-align:center;padding:24px;">Žiadne odovzdania.</p>';
    return;
  }
  container.innerHTML = '';
  submissions.forEach(sub => {
    const card = document.createElement('div');
    card.className = 'submission-card';
    const statusIcon = sub.status === 'reviewed' ? '✅' : sub.status === 'rejected' ? '❌' : '⏳';
    const statusClass = 'status-' + sub.status;
    const time = sub.submitted_at ? new Date(sub.submitted_at).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' }) : '';
    const date = sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString('sk-SK') : '';
    const teamName = escapeHtml(teamMap[sub.team_id] || sub.team_id);
    const roundName = escapeHtml(roundMap[sub.round_id] || sub.round_id);

    // AI status badge
    let aiBadge = '';
    if (sub.ai_status === 'processing') {
      aiBadge = '<div style="font-size:0.8em; color:#7c3aed; margin-top:2px;">🔄 AI...</div>';
    } else if (sub.ai_status === 'completed' && sub.ai_max_score > 0) {
      const aiPct = Math.round((sub.ai_score / sub.ai_max_score) * 100);
      const aiColor = aiPct > 70 ? '#00e676' : aiPct >= 50 ? '#ffd600' : '#ff5252';
      aiBadge = `<div style="font-size:0.8em; color:${aiColor}; margin-top:2px; font-weight:bold;">🤖 ${sub.ai_score}/${sub.ai_max_score}</div>`;
    } else if (sub.ai_status === 'failed') {
      aiBadge = '<div style="font-size:0.8em; color:#ff5252; margin-top:2px;">⚠️ AI chyba</div>';
    }

    card.innerHTML = `
      <div class="submission-thumb">
        <img src="${escapeHtml(sub._signedUrl || sub.photo_url || '')}" alt="Hárok" loading="lazy">
      </div>
      <div class="submission-info">
        <div class="submission-team">${teamName}</div>
        <div class="submission-detail">Kolo: ${roundName}</div>
        <div class="submission-detail">${date} ${time}</div>
        <div class="submission-status ${statusClass}">${statusIcon} ${escapeHtml(sub.status)}</div>
        ${aiBadge}
      </div>
      <div class="submission-actions">
        <button class="neon-button submission-view-btn" data-id="${sub.id}">Zobraziť</button>
      </div>
    `;
    container.appendChild(card);

    // Store data on the card for modal
    card.querySelector('.submission-view-btn').addEventListener('click', () => {
      showSubmissionDetail(sub, teamMap, roundMap);
    });
  });
}

async function showSubmissionDetail(sub, teamMap, roundMap) {
  const modal = elements.submissionModal;
  if (!modal) return;
  // Use signed URL for private bucket
  const imgUrl = sub._signedUrl || sub.photo_url || '';
  elements.submissionModalImg.src = imgUrl;

  const teamName = escapeHtml(teamMap[sub.team_id] || sub.team_id);
  const roundName = escapeHtml(roundMap[sub.round_id] || sub.round_id);
  const statusIcon = sub.status === 'reviewed' ? '✅' : sub.status === 'rejected' ? '❌' : '⏳';
  const time = sub.submitted_at ? new Date(sub.submitted_at).toLocaleString('sk-SK') : '';

  elements.submissionModalInfo.innerHTML = `
    <p><strong>Tím:</strong> ${teamName}</p>
    <p><strong>Kolo:</strong> ${roundName}</p>
    <p><strong>Odoslané:</strong> ${time}</p>
    <p><strong>Status:</strong> ${statusIcon} ${escapeHtml(sub.status)}</p>
    ${sub.admin_notes ? '<p><strong>Poznámky:</strong> ' + escapeHtml(sub.admin_notes) + '</p>' : ''}
    ${sub.score_override != null ? '<p><strong>Skóre:</strong> ' + escapeHtml(String(sub.score_override)) + '</p>' : ''}
  `;

  // === AI Vyhodnotenie sekcia ===
  const aiSection = document.createElement('div');
  aiSection.style = 'margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,0,255,0.3);';

  const aiStatus = sub.ai_status || null;
  const aiScore = sub.ai_score;
  const aiMax = sub.ai_max_score;

  if (aiStatus === 'completed' && aiScore != null) {
    aiSection.innerHTML = `
      <p style="color:#0ff; font-weight:bold;">🤖 AI Vyhodnotenie</p>
      <p style="color:#00e676; font-size:1.2em;">AI skóre: ${aiScore}/${aiMax}</p>
    `;
    // Load and display evaluations
    try {
      const { data: evals } = await supabase
        .from('ai_evaluations')
        .select('*')
        .eq('submission_id', sub.id)
        .order('question_number');
      if (evals && evals.length) {
        let tableHtml = '<table style="width:100%; font-size:0.85em; margin-top:8px; border-collapse:collapse;">';
        tableHtml += '<tr style="color:#0ff;"><th>#</th><th>AI prečítal</th><th>Správna</th><th>Conf</th><th>✅/❌</th><th>Override</th></tr>';
        evals.forEach(ev => {
          const conf = Math.round(ev.confidence || 0);
          const bgColor = conf > 90 ? 'rgba(0,200,83,0.15)' : conf > 70 ? 'rgba(255,200,0,0.15)' : 'rgba(255,0,0,0.1)';
          const icon = ev.is_correct ? '✅' : '❌';
          const overrideIcon = ev.admin_override === true ? '✅' : ev.admin_override === false ? '❌' : '';
          tableHtml += `<tr style="background:${bgColor};">
            <td style="padding:4px; border-bottom:1px solid #333;">${ev.question_number}</td>
            <td style="padding:4px; border-bottom:1px solid #333;">${escapeHtml(ev.ocr_text || '')}</td>
            <td style="padding:4px; border-bottom:1px solid #333;">${escapeHtml(ev.correct_answer || '')}</td>
            <td style="padding:4px; border-bottom:1px solid #333;">${conf}%</td>
            <td style="padding:4px; border-bottom:1px solid #333;">${icon}</td>
            <td style="padding:4px; border-bottom:1px solid #333;">${overrideIcon}</td>
          </tr>`;
        });
        tableHtml += '</table>';
        aiSection.innerHTML += tableHtml;

        // Admin override buttons for each evaluation
        if (state.isAdmin) {
          const overrideDiv = document.createElement('div');
          overrideDiv.style = 'margin-top:8px;';
          overrideDiv.innerHTML = '<p style="color:#aaa; font-size:0.85em;">Klikni na riadok pre manuálny override:</p>';
          
          // Make table rows clickable for override
          setTimeout(() => {
            const rows = aiSection.querySelectorAll('tr');
            rows.forEach((row, i) => {
              if (i === 0) return; // skip header
              row.style.cursor = 'pointer';
              row.addEventListener('click', async () => {
                const ev = evals[i - 1];
                const current = ev.admin_override;
                let newOverride;
                if (current === null || current === undefined) {
                  newOverride = !ev.is_correct; // flip AI decision
                } else {
                  newOverride = null; // reset
                }
                const { error } = await supabase
                  .from('ai_evaluations')
                  .update({ admin_override: newOverride })
                  .eq('id', ev.id);
                if (error) {
                  alert('Chyba: ' + error.message);
                } else {
                  // Recalculate score
                  const { data: updatedEvals } = await supabase
                    .from('ai_evaluations')
                    .select('is_correct, admin_override')
                    .eq('submission_id', sub.id);
                  if (updatedEvals) {
                    let newScore = 0;
                    updatedEvals.forEach(e => {
                      const correct = e.admin_override !== null ? e.admin_override : e.is_correct;
                      if (correct) newScore++;
                    });
                    await supabase
                      .from('answer_submissions')
                      .update({ ai_score: newScore })
                      .eq('id', sub.id);
                    sub.ai_score = newScore;
                  }
                  // Refresh modal
                  showSubmissionDetail(sub, teamMap, roundMap);
                }
              });
            });
          }, 0);
        }
      }
    } catch (e) {
      console.error('Failed to load AI evaluations', e);
    }
  } else if (aiStatus === 'processing') {
    aiSection.innerHTML = '<p style="color:#ffd600; animation: pulse 1.2s infinite;">⏳ AI spracováva...</p>';
    // Reset button for stuck processing
    if (state.isAdmin) {
      const resetAiBtn = document.createElement('button');
      resetAiBtn.className = 'neon-button';
      resetAiBtn.textContent = '🔄 Reset AI (zaseknuté)';
      resetAiBtn.style = 'background: #e65100; margin-top:8px; width:100%; font-size:0.95em;';
      resetAiBtn.addEventListener('click', async () => {
        if (!confirm('Resetovať AI status na "pending"? Potom môžeš spustiť AI znova.')) return;
        resetAiBtn.disabled = true;
        resetAiBtn.textContent = '⏳ Resetujem...';
        const { error } = await supabase
          .from('answer_submissions')
          .update({ ai_status: null, ai_score: null, ai_max_score: null, ai_error: null })
          .eq('id', sub.id);
        if (error) {
          alert('Chyba: ' + error.message);
          resetAiBtn.disabled = false;
          resetAiBtn.textContent = '🔄 Reset AI (zaseknuté)';
        } else {
          // Also delete old AI evaluations for this submission
          await supabase.from('ai_evaluations').delete().eq('submission_id', sub.id);
          sub.ai_status = null;
          sub.ai_score = null;
          sub.ai_max_score = null;
          sub.ai_error = null;
          showSubmissionDetail(sub, teamMap, roundMap);
        }
      });
      aiSection.appendChild(resetAiBtn);
    }
  } else if (aiStatus === 'failed') {
    aiSection.innerHTML = `<p style="color:#ff5252;">⚠️ AI chyba: ${escapeHtml(sub.ai_error || 'Neznáma chyba')}</p>`;
  }

  // AI trigger button (if not completed and not processing)
  if (state.isAdmin && aiStatus !== 'completed' && aiStatus !== 'processing') {
    const aiBtn = document.createElement('button');
    aiBtn.className = 'neon-button';
    aiBtn.textContent = '🤖 Spustiť AI vyhodnotenie';
    aiBtn.style = 'background: linear-gradient(135deg, #7c3aed, #2563eb); margin-top:8px; width:100%;';
    aiBtn.addEventListener('click', async () => {
      aiBtn.disabled = true;
      aiBtn.textContent = '⏳ Spracovávam...';
      try {
        const { data, error } = await supabase.functions.invoke('evaluate-submission', {
          body: { submission_id: sub.id }
        });
        if (error) throw error;
        // Reload submission data
        const { data: updated } = await supabase
          .from('answer_submissions')
          .select('ai_status, ai_score, ai_max_score, ai_error')
          .eq('id', sub.id)
          .single();
        if (updated) {
          sub.ai_status = updated.ai_status;
          sub.ai_score = updated.ai_score;
          sub.ai_max_score = updated.ai_max_score;
          sub.ai_error = updated.ai_error;
        }
        showSubmissionDetail(sub, teamMap, roundMap);
      } catch (e) {
        alert('AI chyba: ' + (e.message || JSON.stringify(e)));
        aiBtn.disabled = false;
        aiBtn.textContent = '🤖 Spustiť AI vyhodnotenie (znova)';
      }
    });
    aiSection.appendChild(aiBtn);
  }

  // "Potvrdiť AI skóre → zapísať body" button
  if (state.isAdmin && aiStatus === 'completed' && aiScore != null) {
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'neon-button';
    confirmBtn.textContent = `☑️ Potvrdiť AI skóre → zapísať body`;
    confirmBtn.style = 'background: linear-gradient(135deg, #00c853, #00bfa5); margin-top:8px; width:100%;';
    confirmBtn.addEventListener('click', async () => {
      // Write AI score to score_override and mark as reviewed
      const { error } = await supabase
        .from('answer_submissions')
        .update({ score_override: aiScore, status: 'reviewed', reviewed_at: new Date().toISOString(), reviewed_by: state.user?.id })
        .eq('id', sub.id);
      if (error) {
        alert('Chyba: ' + error.message);
      } else {
        sub.status = 'reviewed';
        sub.score_override = aiScore;
        elements.submissionModal.style.display = 'none';
        await loadAndRenderSubmissions();
        alert('Body zapísané! Skóre: ' + aiScore + '/' + aiMax);
      }
    });
    aiSection.appendChild(confirmBtn);
  }

  elements.submissionModalInfo.appendChild(aiSection);

  const actionsEl = elements.submissionModalActions;
  actionsEl.innerHTML = '';

  if (state.isAdmin) {
    if (sub.status !== 'reviewed') {
      const reviewBtn = document.createElement('button');
      reviewBtn.className = 'neon-button';
      reviewBtn.textContent = '✅ Schváliť';
      reviewBtn.addEventListener('click', async () => {
        await updateSubmissionStatus(sub.id, 'reviewed');
        sub.status = 'reviewed';
        modal.style.display = 'none';
        await loadAndRenderSubmissions();
      });
      actionsEl.appendChild(reviewBtn);
    }
    if (sub.status !== 'rejected') {
      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'neon-button';
      rejectBtn.style.background = '#c62828';
      rejectBtn.textContent = '❌ Zamietnuť';
      rejectBtn.addEventListener('click', async () => {
        await updateSubmissionStatus(sub.id, 'rejected');
        sub.status = 'rejected';
        modal.style.display = 'none';
        await loadAndRenderSubmissions();
      });
      actionsEl.appendChild(rejectBtn);
    }
    if (sub.status !== 'pending') {
      const resetBtn = document.createElement('button');
      resetBtn.className = 'neon-button';
      resetBtn.style.background = '#555';
      resetBtn.textContent = '⏳ Reset na pending';
      resetBtn.addEventListener('click', async () => {
        await updateSubmissionStatus(sub.id, 'pending');
        sub.status = 'pending';
        modal.style.display = 'none';
        await loadAndRenderSubmissions();
      });
      actionsEl.appendChild(resetBtn);
    }
  }

  modal.style.display = 'flex';
}

async function updateSubmissionStatus(id, status) {
  if (mode !== 'supabase') return;
  if (!state.isAdmin) { alert('Iba admin môže meniť status.'); return; }
  const userId = state.user ? state.user.id : null;
  const { error } = await supabase
    .from('answer_submissions')
    .update({ status, reviewed_at: new Date().toISOString(), reviewed_by: userId })
    .eq('id', id);
  if (error) {
    alert('Chyba pri zmene statusu: ' + error.message);
  }
}

function switchTab(tab) {
  state.currentTab = tab;
  elements.tabButtons.forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  elements.tabContents.forEach(content => {
    content.classList.toggle('active', content.id === `${tab}Tab`);
  });
  if (tab === 'leaderboard') {
    updateLeaderboard();
  }
  if (tab === 'submissions') {
    loadAndRenderSubmissions();
  }
  if (tab === 'answers') {
    loadAndRenderCorrectAnswers();
  }
}

// === Nový quiz s názvom ===
async function confirmNewQuiz() {
  if (!state.isAdmin) return;
  // Show a small modal with title input and season select
  const seasons = await fetchSeasons();
  const overlay = document.createElement('div');
  overlay.style = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:9999;';
  const box = document.createElement('div');
  box.style = 'background:#111; color:#fff; padding:20px; border-radius:12px; min-width:320px; max-width:90%;';
  box.innerHTML = `
    <h3 style="margin-top:0">Nový kvíz</h3>
    <div style="margin-bottom:8px;"><label style="font-weight:bold">Názov:</label><br><input id="newQuizTitle" style="width:100%; padding:8px; margin-top:6px; border-radius:8px; border:1px solid #333;" /></div>
    <div style="margin-bottom:12px;"><label style="font-weight:bold">Sezóna:</label><br><select id="newQuizSeason" style="width:100%; padding:8px; margin-top:6px; border-radius:8px; border:1px solid #333;"></select></div>
    <div style="text-align:right; display:flex; gap:8px; justify-content:flex-end;"><button id="cancelNewQuiz" class="neon-button">Zrušiť</button><button id="createNewQuizBtn" class="neon-button">Vytvoriť</button></div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const select = box.querySelector('#newQuizSeason');
  // populate seasons
  const placeholderOpt = document.createElement('option'); placeholderOpt.value = ''; placeholderOpt.text = '-- žiadna --'; select.appendChild(placeholderOpt);
  seasons.forEach(s => {
    const opt = document.createElement('option'); opt.value = s.id; opt.text = s.name || s.id; if (s.is_active) opt.selected = true; select.appendChild(opt);
  });
  const titleInput = box.querySelector('#newQuizTitle');
  titleInput.focus();
  box.querySelector('#cancelNewQuiz').onclick = () => { overlay.remove(); };
  box.querySelector('#createNewQuizBtn').onclick = () => {
    const title = titleInput.value.trim();
    if (!title) { alert('Zadaj názov.'); return; }
    const seasonId = select.value || null;
    state.teams = [];
    state.rounds = [];
    state.scores = {};
    state.topicScores = {};
    state.roundTopics = {};
    state.title = title;
    state.seasonId = seasonId;
    state.quizId = null;
    overlay.remove();
    updateTeamsList();
    updateRoundsList();
    updateScoreboard();
    updateLeaderboard();
    updateQuizStats();
    updateQuizNameDisplay();
  };
}

// === Dynamický dropdown na výber quizu ===
function renderQuizDropdown(quizzes, onSelect, label = 'Vyber quiz:') {
  let old = document.getElementById('quizDropdown');
  if (old) old.remove();
  const container = document.createElement('div');
  container.id = 'quizDropdown';
  container.style = 'margin: 24px auto; text-align: center; max-width: 350px; background: #181830; border-radius: 18px; box-shadow: 0 2px 12px #0006; padding: 18px;';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.style = 'margin-right: 8px; font-weight: bold; font-size: 1.1em; color: #0ff;';
  container.appendChild(lbl);
  const select = document.createElement('select');
  select.style = 'padding: 8px 16px; font-size: 1.1em; border-radius: 12px; border: 1px solid #0ff; background: #222; color: #0ff; margin-right: 12px;';
  quizzes.forEach(q => {
    const option = document.createElement('option');
    option.value = q.id;
    option.textContent = `${q.title} (${q.created_at?.slice(0,10)})`;
    select.appendChild(option);
  });
  container.appendChild(select);
  const btn = document.createElement('button');
  btn.textContent = 'Načítať';
  btn.className = 'neon-button';
  btn.style = 'margin-left: 8px;';
  btn.onclick = () => {
    onSelect(select.value);
    container.remove();
  };
  container.appendChild(btn);
  // Umiestni pod Load Quiz tlačidlo
  const loadQuizBtn = document.getElementById('loadQuiz');
  if (loadQuizBtn && loadQuizBtn.parentNode) {
    loadQuizBtn.parentNode.insertAdjacentElement('afterend', container);
  } else {
    document.body.prepend(container);
  }
}

// Initial load
(async function initialLoad() {
  await supabaseReady;
  await fetchAdminProfile();
  if (mode === 'supabase') await fetchCategories();
  setAdminUI(state.isAdmin);
  renderAuthButtons(); // <-- pridaj sem, aby sa zobrazilo vždy
  updateQuizNameDisplay();
})();

document.addEventListener('DOMContentLoaded', function() {
  if (elements.addTeam) elements.addTeam.onclick = addTeam;
  if (elements.addRound) elements.addRound.onclick = addRound;
  if (elements.newQuiz) elements.newQuiz.onclick = confirmNewQuiz;
  if (elements.saveQuiz) elements.saveQuiz.onclick = saveQuizToSupabase;
  if (elements.loadQuiz) elements.loadQuiz.onclick = loadQuizFromSupabase;
  if (elements.exportQuiz) elements.exportQuiz.onclick = exportQuizData;
  if (elements.tabButtons) elements.tabButtons.forEach(button => {
    button.onclick = () => {
      const tab = button.dataset.tab;
      switchTab(tab);
    };
  });
  const leaderboardBtn = document.getElementById('leaderboardScrollBtn');
  if (leaderboardBtn) {
    leaderboardBtn.onclick = () => {
      window.open('leaderboard.html', '_blank');
    };
  }

  // Sort A-Z button
  const sortBtn = document.getElementById('sortScoreboard');
  if (sortBtn) {
    sortBtn.onclick = () => {
      state.teams.sort((a, b) => a.localeCompare(b, 'sk'));
      updateTeamsList();
      updateScoreboard();
      updateLeaderboard();
    };
  }

  // Collapsible section toggle
  document.querySelectorAll('.section-header-toggle').forEach(header => {
    header.addEventListener('click', function() {
      const targetId = this.dataset.target;
      const content = document.getElementById(targetId);
      const icon = this.querySelector('.toggle-icon');
      if (!content) return;
      content.classList.toggle('collapsed');
      if (icon) icon.classList.toggle('collapsed');
    });
  });

  // Submissions tab: filters + modal close
  if (elements.submissionsRoundFilter) {
    elements.submissionsRoundFilter.addEventListener('change', () => { loadAndRenderSubmissions(); });
  }
  if (elements.submissionsStatusFilter) {
    elements.submissionsStatusFilter.addEventListener('change', () => { loadAndRenderSubmissions(); });
  }
  if (elements.closeSubmissionModal) {
    elements.closeSubmissionModal.addEventListener('click', () => {
      elements.submissionModal.style.display = 'none';
    });
  }
  if (elements.submissionModal) {
    elements.submissionModal.addEventListener('click', (e) => {
      if (e.target === elements.submissionModal) elements.submissionModal.style.display = 'none';
    });
  }

  // Batch AI evaluate button
  const batchAiBtn = document.getElementById('batchAiEvaluate');
  if (batchAiBtn) batchAiBtn.addEventListener('click', batchAiEvaluate);

  renderAuthButtons(); // <-- pridaj sem, aby sa zobrazilo vždy
});

function renderAuthButtons() {
  let container = document.getElementById('authButtons');
  if (!container) {
    // Ensure DOM is ready: if no parent yet, schedule render after DOMContentLoaded
    const parent = document.querySelector('.container') || document.body;
    if (!parent) {
      document.addEventListener('DOMContentLoaded', renderAuthButtons);
      return;
    }
    container = document.createElement('div');
    container.id = 'authButtons';
    // high z-index to avoid being covered and clear right alignment
    container.style = 'margin: 16px 0; text-align: right; position: relative; z-index: 9999;';
    parent.prepend(container);
  }
  container.innerHTML = '';
  if (!state.user) {
    const signInBtn = document.createElement('button');
    signInBtn.textContent = 'Sign In (admin)';
    signInBtn.className = 'neon-button';
    signInBtn.onclick = async () => {
      const email = prompt('Zadaj svoj email pre magic link prihlásenie:');
      if (email) await signInAdmin(email);
    };
    container.appendChild(signInBtn);
  } else {
    const userSpan = document.createElement('span');
    userSpan.textContent = state.user.email + (state.isAdmin ? ' (admin)' : '');
    userSpan.style = 'margin-right: 12px; color: #0ff; font-weight: bold;';
    container.appendChild(userSpan);
    const signOutBtn = document.createElement('button');
    signOutBtn.textContent = 'Sign Out';
    signOutBtn.className = 'neon-button';
    signOutBtn.onclick = async () => {
      await signOutAdmin();
      location.reload();
    };
    container.appendChild(signOutBtn);
  }
}

// === CORRECT ANSWERS MANAGEMENT ===
async function loadCorrectAnswers(roundTopicId) {
  const { data, error } = await supabase
    .from('correct_answers')
    .select('question_number, correct_answer, accept_alternatives')
    .eq('round_topic_id', roundTopicId)
    .order('question_number');
  if (error) { console.error('loadCorrectAnswers error', error); return []; }
  return data || [];
}

async function saveCorrectAnswersForTopic(roundTopicId, answers) {
  for (const a of answers) {
    const { error } = await supabase
      .from('correct_answers')
      .upsert({
        round_topic_id: roundTopicId,
        question_number: a.question_number,
        correct_answer: a.correct_answer,
        accept_alternatives: a.accept_alternatives || []
      }, { onConflict: 'round_topic_id,question_number' });
    if (error) console.error('saveCorrectAnswer error', error);
  }
}

function showCorrectAnswersModal(roundName) {
  if (!state.isAdmin) return;
  const round = state.rounds.find(r => r.name === roundName);
  if (!round) { alert('Kolo nenájdené.'); return; }
  const topics = round.topics || state.roundTopics[roundName] || [];
  if (!topics.length) { alert('Kolo nemá žiadne témy. Najprv pridaj témy cez Edit.'); return; }

  // Check if topics have DB ids
  const allHaveIds = topics.every(t => t.id);
  if (!allHaveIds) {
    alert('Najprv ulož kvíz (Save Quiz) pred zadávaním odpovedí — témy ešte nemajú ID v databáze.');
    return;
  }

  const overlay = document.createElement('div');
  overlay.style = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:9999; overflow-y:auto;';
  const box = document.createElement('div');
  box.style = 'background:#111; color:#fff; padding:24px; border-radius:12px; min-width:400px; max-width:90%; max-height:90vh; overflow-y:auto;';

  let formHtml = '<h3 style="margin-top:0; color:#ff9800;">📝 Správne odpovede — ' + escapeHtml(roundName) + '</h3>';

  topics.forEach((topic, tIdx) => {
    const icon = topic.categoryIcon || '';
    const name = topic.customName || topic.categoryName || 'Téma ' + (tIdx + 1);
    const maxPts = topic.maxPoints || 5;
    const qCount = Math.ceil(maxPts);
    formHtml += '<div style="margin-top:16px; padding:12px; background:#1a1333; border-radius:8px; border:1px solid #333;">';
    formHtml += '<div style="font-weight:bold; color:#0ff; margin-bottom:8px;">' + escapeHtml(icon) + ' ' + escapeHtml(name) + ' <span style="color:#aaa; font-weight:normal;">(max ' + maxPts + ')</span></div>';
    for (let q = 1; q <= qCount; q++) {
      formHtml += '<div style="display:flex; gap:8px; align-items:center; margin-bottom:6px; flex-wrap:wrap;">';
      formHtml += '<label style="min-width:70px; font-size:0.9em;">Otázka ' + q + ':</label>';
      formHtml += '<input class="neon-input ca-answer" data-topic-idx="' + tIdx + '" data-q="' + q + '" placeholder="Správna odpoveď" style="flex:1; min-width:140px; padding:6px 10px; font-size:0.9em;" />';
      formHtml += '<input class="neon-input ca-alts" data-topic-idx="' + tIdx + '" data-q="' + q + '" placeholder="Alternatívy (čiarkou)" style="flex:1; min-width:140px; padding:6px 10px; font-size:0.85em; color:#aaa;" />';
      formHtml += '</div>';
    }
    formHtml += '</div>';
  });

  formHtml += '<div style="text-align:right; display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">';
  formHtml += '<button id="cancelCaModal" class="neon-button">Zrušiť</button>';
  formHtml += '<button id="saveCaModal" class="neon-button" style="background:#00c853;">💾 Uložiť</button>';
  formHtml += '</div>';

  box.innerHTML = formHtml;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Pre-fill from DB
  (async () => {
    for (let tIdx = 0; tIdx < topics.length; tIdx++) {
      const topic = topics[tIdx];
      if (!topic.id) continue;
      const existing = await loadCorrectAnswers(topic.id);
      existing.forEach(row => {
        const answerInput = box.querySelector('.ca-answer[data-topic-idx="' + tIdx + '"][data-q="' + row.question_number + '"]');
        const altsInput = box.querySelector('.ca-alts[data-topic-idx="' + tIdx + '"][data-q="' + row.question_number + '"]');
        if (answerInput) answerInput.value = row.correct_answer || '';
        if (altsInput) altsInput.value = (row.accept_alternatives || []).join(', ');
      });
    }
  })();

  box.querySelector('#cancelCaModal').onclick = () => overlay.remove();
  box.querySelector('#saveCaModal').onclick = async () => {
    const saveBtn = box.querySelector('#saveCaModal');
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ Ukladám...';
    try {
      for (let tIdx = 0; tIdx < topics.length; tIdx++) {
        const topic = topics[tIdx];
        if (!topic.id) continue;
        const maxPts = topic.maxPoints || 5;
        const qCount = Math.ceil(maxPts);
        const answers = [];
        for (let q = 1; q <= qCount; q++) {
          const answerInput = box.querySelector('.ca-answer[data-topic-idx="' + tIdx + '"][data-q="' + q + '"]');
          const altsInput = box.querySelector('.ca-alts[data-topic-idx="' + tIdx + '"][data-q="' + q + '"]');
          const correctAnswer = answerInput ? answerInput.value.trim() : '';
          const altsRaw = altsInput ? altsInput.value.trim() : '';
          const alternatives = altsRaw ? altsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
          if (!correctAnswer) continue; // skip empty
          answers.push({ question_number: q, correct_answer: correctAnswer, accept_alternatives: alternatives });
        }
        if (answers.length) {
          await saveCorrectAnswersForTopic(topic.id, answers);
        }
      }
      overlay.remove();
    } catch (e) {
      alert('Chyba pri ukladaní: ' + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Uložiť';
    }
  };
}

// === APPLY AI SCORE TO TOPIC SCORES ===
async function applyAiScoreToTopicScores(sub, evals) {
  // Find round and its topics
  const { data: roundData } = await supabase
    .from('rounds')
    .select('id, name')
    .eq('id', sub.round_id)
    .single();
  if (!roundData) throw new Error('Kolo nenájdené');

  const { data: roundTopics } = await supabase
    .from('round_topics')
    .select('id, topic_order, max_points')
    .eq('round_id', sub.round_id)
    .order('topic_order');
  if (!roundTopics || !roundTopics.length) throw new Error('Round topics nenájdené');

  // Get team name
  const { data: teamData } = await supabase
    .from('teams')
    .select('id, name')
    .eq('id', sub.team_id)
    .single();
  if (!teamData) throw new Error('Tím nenájdený');

  // Group evaluations by question number and compute score per topic
  // Assumption: questions map sequentially across topics
  // e.g. topic1 has maxPoints=5 (questions 1-5), topic2 has maxPoints=5 (questions 6-10)
  let qOffset = 0;
  for (const rt of roundTopics) {
    const qCount = Math.ceil(rt.max_points || 5);
    let topicScore = 0;
    for (let q = 1; q <= qCount; q++) {
      const globalQ = qOffset + q;
      const ev = evals.find(e => e.question_number === globalQ);
      if (ev) {
        const isCorrect = ev.admin_override != null ? ev.admin_override_correct : ev.is_correct;
        if (isCorrect) topicScore++;
      }
    }
    qOffset += qCount;

    // Upsert topic_score in DB
    const { data: existing } = await supabase
      .from('topic_scores')
      .select('id')
      .eq('team_id', sub.team_id)
      .eq('round_topic_id', rt.id)
      .maybeSingle();

    if (existing) {
      await supabase.from('topic_scores').update({ score: topicScore }).eq('id', existing.id);
    } else {
      await supabase.from('topic_scores').insert({ team_id: sub.team_id, round_topic_id: rt.id, score: topicScore });
    }

    // Update local state
    const roundName = roundData.name;
    const topicIdx = rt.topic_order;
    const key = roundName + '::' + topicIdx;
    if (!state.topicScores[teamData.name]) state.topicScores[teamData.name] = {};
    state.topicScores[teamData.name][key] = topicScore;

    // Update legacy flat score
    if (!state.scores[teamData.name]) state.scores[teamData.name] = {};
    // Recompute round total from all topic scores for this round
    let roundTotal = 0;
    roundTopics.forEach(rt2 => {
      const k = roundName + '::' + rt2.topic_order;
      roundTotal += (state.topicScores[teamData.name] && state.topicScores[teamData.name][k]) || 0;
    });
    state.scores[teamData.name][roundName] = roundTotal;
  }
}

// === BATCH AI EVALUATION ===
async function batchAiEvaluate() {
  if (!state.isAdmin || !state.quizId) { alert('Najprv načítaj kvíz.'); return; }
  const btn = document.getElementById('batchAiEvaluate');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Hľadám...'; }

  try {
    const { data: pending, error } = await supabase
      .from('answer_submissions')
      .select('id')
      .eq('quiz_id', state.quizId)
      .or('ai_status.eq.pending,ai_status.is.null')
      .order('submitted_at');
    if (error) throw error;
    if (!pending || !pending.length) {
      alert('Žiadne pending submissions na vyhodnotenie.');
      return;
    }

    const total = pending.length;
    for (let i = 0; i < total; i++) {
      if (btn) btn.textContent = '⏳ Spracovávam ' + (i + 1) + '/' + total + '...';
      try {
        await supabase.functions.invoke('evaluate-submission', {
          body: { submission_id: pending[i].id }
        });
      } catch (e) {
        console.error('Batch AI error for submission ' + pending[i].id, e);
      }
    }
    alert('Hotovo! Vyhodnotených: ' + total + ' submissions.');
    await loadAndRenderSubmissions();
  } catch (e) {
    alert('Chyba pri batch AI: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 AI: Vyhodnotiť všetky'; }
  }
}

// Generate signed URL from Supabase Storage (private bucket)
async function getSignedPhotoUrl(photoPath) {
  if (!photoPath) return '';
  try {
    const { data, error } = await supabase.storage
      .from('answer-sheets')
      .createSignedUrl(photoPath, 3600); // 1 hodina
    if (error) {
      console.error('getSignedPhotoUrl error', error);
      return '';
    }
    return data.signedUrl || '';
  } catch (e) {
    console.error('getSignedPhotoUrl exception', e);
    return '';
  }
}

// === CORRECT ANSWERS TAB MANAGEMENT ===
async function loadAndRenderCorrectAnswers() {
  if (!state.quizId) {
    const el = document.getElementById('correctAnswersList');
    if (el) el.innerHTML = '<p style="color:#aaa;">Najprv načítaj kvíz.</p>';
    return;
  }
  const el = document.getElementById('correctAnswersList');
  if (!el) return;

  // Get rounds and their topics for this quiz
  const { data: rounds } = await supabase
    .from('rounds')
    .select('id, name, round_order')
    .eq('quiz_id', state.quizId)
    .order('round_order');
  
  if (!rounds || !rounds.length) {
    el.innerHTML = '<p style="color:#aaa;">Žiadne kolá v tomto kvíze.</p>';
    return;
  }

  const roundIds = rounds.map(r => r.id);
  const { data: roundTopics } = await supabase
    .from('round_topics')
    .select('id, round_id, category_id, topic_order, max_points')
    .in('round_id', roundIds)
    .order('topic_order');

  // Get category names
  const catIds = [...new Set((roundTopics || []).filter(rt => rt.category_id).map(rt => rt.category_id))];
  let catMap = {};
  if (catIds.length) {
    const { data: cats } = await supabase.from('categories').select('id, name, icon').in('id', catIds);
    (cats || []).forEach(c => { catMap[c.id] = c; });
  }

  // Get existing correct answers
  const rtIds = (roundTopics || []).map(rt => rt.id);
  let existingAnswers = [];
  if (rtIds.length) {
    const { data } = await supabase
      .from('correct_answers')
      .select('id, round_topic_id, question_number, correct_answer')
      .in('round_topic_id', rtIds)
      .order('question_number');
    existingAnswers = data || [];
  }

  // Build UI
  let html = '';
  rounds.forEach(round => {
    const topics = (roundTopics || []).filter(rt => rt.round_id === round.id).sort((a, b) => a.topic_order - b.topic_order);
    html += `<div style="margin-bottom:20px; padding:16px; background:rgba(0,255,255,0.05); border:1px solid rgba(0,255,255,0.2); border-radius:12px;">`;
    html += `<h3 style="color:#0ff; margin-top:0;">${escapeHtml(round.name)}</h3>`;
    
    topics.forEach(rt => {
      const cat = catMap[rt.category_id];
      const catName = cat ? `${cat.icon || ''} ${cat.name}` : 'Téma';
      const maxQ = rt.max_points || 5;
      const answers = existingAnswers.filter(a => a.round_topic_id === rt.id);
      
      html += `<div style="margin-bottom:12px; padding:10px; background:rgba(255,0,255,0.05); border-radius:8px;">`;
      html += `<p style="color:#f0f; font-weight:bold; margin:0 0 8px;">${escapeHtml(catName)} (max ${maxQ} bodov / otázok)</p>`;
      
      for (let q = 1; q <= Math.ceil(maxQ); q++) {
        const existing = answers.find(a => a.question_number === q);
        const val = existing ? existing.correct_answer : '';
        html += `<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
          <span style="color:#aaa; min-width:24px;">${q}.</span>
          <input type="text" class="neon-input correct-answer-input" 
            data-rt-id="${rt.id}" data-question="${q}" data-existing-id="${existing ? existing.id : ''}"
            value="${escapeHtml(val)}" 
            placeholder="Správna odpoveď..."
            style="flex:1; padding:6px 10px; font-size:0.9em;">
        </div>`;
      }
      html += `</div>`;
    });
    html += `</div>`;
  });

  html += `<button id="saveCorrectAnswersBtn" class="neon-button" style="width:100%; padding:14px; font-size:1.1em; background:linear-gradient(135deg, #00c853, #00bfa5);">💾 Uložiť odpovede</button>`;
  el.innerHTML = html;

  // Save button
  document.getElementById('saveCorrectAnswersBtn')?.addEventListener('click', saveCorrectAnswers);
}

async function saveCorrectAnswers() {
  const inputs = document.querySelectorAll('.correct-answer-input');
  const toUpsert = [];
  const toDelete = [];
  
  inputs.forEach(input => {
    const rtId = input.dataset.rtId;
    const questionNum = parseInt(input.dataset.question);
    const existingId = input.dataset.existingId;
    const value = input.value.trim();
    
    if (value) {
      toUpsert.push({
        id: existingId || undefined,
        round_topic_id: rtId,
        question_number: questionNum,
        correct_answer: value
      });
    } else if (existingId) {
      toDelete.push(existingId);
    }
  });

  try {
    // Delete removed answers
    if (toDelete.length) {
      await supabase.from('correct_answers').delete().in('id', toDelete);
    }

    // Upsert answers (with id = update, without = insert)
    for (const ans of toUpsert) {
      if (ans.id) {
        await supabase.from('correct_answers')
          .update({ correct_answer: ans.correct_answer })
          .eq('id', ans.id);
      } else {
        delete ans.id;
        await supabase.from('correct_answers').insert(ans);
      }
    }

    alert('Odpovede uložené! ✅');
    await loadAndRenderCorrectAnswers();
  } catch (e) {
    alert('Chyba pri ukladaní: ' + e.message);
  }
}

console.log('App.js loaded!');
