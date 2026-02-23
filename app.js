// app.js — PR-ready Supabase + fallback + komentáre

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
  }
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
async function saveQuizToSupabase() {
  if (mode !== 'supabase') {
    saveQuizToLocal();
    return;
  }
  if (!state.isAdmin) {
    alert('Iba admin môže ukladať quiz.');
    return;
  }
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
  
  // 6. Legacy Scores (backward compat)
  const { data: scores } = await supabase
    .from('scores')
    .select('team_id, round_id, score');
  
  // Map legacy scores
  state.scores = {};
  teams.forEach(team => {
    state.scores[team.name] = {};
    rounds.forEach(round => {
      const s = (scores || []).find(
        sc => sc.team_id === team.id && sc.round_id === round.id
      );
      state.scores[team.name][round.name] = s ? Number(s.score) : 0;
    });
  });
  
  // Map topic scores
  state.topicScores = {};
  teams.forEach(team => {
    state.topicScores[team.name] = {};
    rounds.forEach(round => {
      const rTopics = roundTopicsData.filter(rt => rt.round_id === round.id).sort((a, b) => a.topic_order - b.topic_order);
      rTopics.forEach((rt, idx) => {
        const key = round.name + '::' + (idx + 1);
        const ts = topicScoresData.find(ts => ts.team_id === team.id && ts.round_topic_id === rt.id);
        state.topicScores[team.name][key] = ts ? Number(ts.score) : 0;
      });
    });
  });
  
  updateTeamsList();
  updateRoundsList();
  updateScoreboard();
  updateLeaderboard();
  updateQuizStats();
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
  const { data: scores } = await supabase
    .from('scores')
    .select('team_id, round_id, score');
  // Spočítaj total per team
  const leaderboard = teams.map(team => {
    let total = 0;
    rounds.forEach(round => {
      const s = scores.find(
        sc => sc.team_id === team.id && sc.round_id === round.id
      );
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

// === VALIDÁCIA SKÓRE ===
function validateScore(val) {
  const n = Number(val);
  return !isNaN(n) && n >= 0;
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
    teamDiv.innerHTML = `
      <span>${team}</span>
      <button onclick="removeTeam('${team}')" class="neon-button">Remove</button>
    `;
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
      return `<span class="round-topic-pill">${icon} ${name} <span class="topic-max">(max ${max})</span></span>`;
    }).join('');
    const safeName = round.name.replace(/'/g, "\\'");
    roundDiv.innerHTML = `
      <div style="flex:1;">
        <div class="round-name">${round.name}</div>
        <div class="round-topics-row">${topicPills || '<span style="color:#666; font-size:0.9em;">Žiadne témy</span>'}</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button onclick="editRound('${safeName}')" class="neon-button" style="background:#2196F3; font-size:0.85em;">Edit</button>
        <button onclick="removeRound('${safeName}')" class="neon-button" style="background:#e53935; font-size:0.85em;">Remove</button>
      </div>
    `;
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
  showTopicSelectionModal(roundName, (topic1, topic2) => {
    const newTopics = [topic1, topic2];
    round.topics = newTopics;
    state.roundTopics[roundName] = newTopics;
    // Re-initialize topic scores for all teams with new topics
    state.teams.forEach(team => {
      if (!state.topicScores[team]) state.topicScores[team] = {};
      // Remove old topic scores for this round
      Object.keys(state.topicScores[team]).forEach(key => {
        if (key.startsWith(roundName + '::')) delete state.topicScores[team][key];
      });
      // Add new topic scores (init to 0)
      newTopics.forEach((t, idx) => {
        const key = roundName + '::' + (idx + 1);
        state.topicScores[team][key] = 0;
      });
      // Reset legacy flat score
      if (state.scores[team]) state.scores[team][roundName] = 0;
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
      html += `<th colspan="${colspan}" style="border-bottom:none; text-align:center;">${round.name}</th>`;
    });
    html += '<th rowspan="2">Total</th></tr>';
    // Second header row: topic names
    html += '<tr>';
    state.rounds.forEach(round => {
      const topics = round.topics || state.roundTopics[round.name] || [];
      if (topics.length) {
        topics.forEach(t => {
          const label = (t.categoryIcon || '') + ' ' + (t.customName || t.categoryName || '?');
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
      html += `<th>${round.name}</th>`;
    });
    html += '<th>Total</th></tr>';
  }
  
  // Data rows
  state.teams.forEach(team => {
    html += `<tr><td>${team}</td>`;
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
  updateScoreboard();
  updateLeaderboard();
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
  updateScoreboard();
  updateLeaderboard();
};

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
            <td>${score.team}</td>
            <td>${score.total}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  updateQuizStats();
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

console.log('App.js loaded!');
