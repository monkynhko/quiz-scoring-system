// app.js — PR-ready Supabase + fallback + komentáre

// === KONFIGURÁCIA SUPABASE ===
// Vlož svoje údaje z projektu Supabase (viď README_SUPABASE.md)
const SUPABASE_URL = 'https://rpkipyfafkdndcaoedtq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwa2lweWZhZmtkbmRjYW9lZHRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxNzU5MDUsImV4cCI6MjA3NDc1MTkwNX0.qYsJffts9lkaUIdCDRM_4Yj9EP0-3yCAgNj8SMMH_VY';

// Prepínač režimu: 'supabase' alebo 'local'
let mode = 'supabase'; // Zmeň na 'local' ak chceš použiť localStorage fallback

// === SUPABASE KLIENT (CDN UMD) ===
let supabase = null;
if (mode === 'supabase') {
  // CDN UMD loader (ak už nie je v index.html)
  if (typeof window.supabase === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
    script.onload = () => {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    };
    document.head.appendChild(script);
  } else {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
}

// === STAV A DOM ===
const state = {
  user: null,
  isAdmin: false,
  quizId: null,
  teams: [],
  rounds: [],
  scores: {}, // { teamId: { roundId: score } }
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
  if (mode !== 'supabase') return;
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) {
    alert('Chyba pri prihlasovaní: ' + error.message);
    return false;
  }
  alert('Skontroluj svoj email a klikni na magic link.');
  return true;
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
  if (!user) return false;
  state.user = user;
  // Zisti is_admin z profiles
  const { data, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  state.isAdmin = !!(data && data.is_admin);
  return state.isAdmin;
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
    const { data: quiz, error: quizErr } = await supabase
      .from('quizzes')
      .insert([{ title: state.title || 'Quiz' }])
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
  await supabase.from('rounds').delete().eq('quiz_id', quizId);
  const { data: rounds, error: roundsErr } = await supabase
    .from('rounds')
    .insert(roundsPayload)
    .select('id, name, round_order');
  if (roundsErr) {
    alert('Chyba pri ukladaní kôl: ' + roundsErr.message);
    return;
  }
  // 4. Scores
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

// === NAČÍTANIE QUIZU Z SUPABASE ===
async function loadQuizFromSupabase(quizId) {
  if (mode !== 'supabase') {
    loadQuizFromLocal();
    return;
  }
  // 1. Quiz
  const { data: quiz, error: quizErr } = await supabase
    .from('quizzes')
    .select('id, title')
    .eq('id', quizId)
    .single();
  if (quizErr) {
    alert('Quiz nenájdený: ' + quizErr.message);
    return;
  }
  state.quizId = quiz.id;
  state.title = quiz.title;
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
  state.rounds = rounds.map(r => ({ name: r.name }));
  // 4. Scores
  const { data: scores } = await supabase
    .from('scores')
    .select('team_id, round_id, score');
  // Map scores
  state.scores = {};
  teams.forEach(team => {
    state.scores[team.name] = {};
    rounds.forEach(round => {
      const s = scores.find(
        sc => sc.team_id === team.id && sc.round_id === round.id
      );
      state.scores[team.name][round.name] = s ? Number(s.score) : 0;
    });
  });
  // ...update UI...
  updateTeamsList();
  updateRoundsList();
  updateScoreboard();
  updateLeaderboard();
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
    .select('id, title, created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  return quizzes || [];
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

// ...ZACHOVAJ OSTATNÉ FUNKCIE UI, updateScore, updateTeamsList, updateRoundsList, updateScoreboard, updateLeaderboard atď. (nezabudni upraviť, aby používali nové state.scores podľa team/round mena, nie indexu)...
// ...Pridaj jasné komentáre kde treba...

// === NASTAVENIE REŽIMU ===
// Ak chceš fallback na localStorage, nastav mode = 'local' vyššie.
// Ak chceš Supabase, nastav mode = 'supabase' a vlož správne kľúče.

// Initial load
(async function initialLoad() {
  // Najprv načítaj profil admina (ak je potrebné)
  await fetchAdminProfile();
  // Ak je admin prihlásený, prepni na admin tab
  if (state.isAdmin) {
    state.currentTab = 'admin';
    elements.tabButtons.forEach(button => {
      button.classList.toggle('active', button.dataset.tab === 'admin');
    });
    elements.tabContents.forEach(content => {
      content.classList.toggle('active', content.id === 'adminTab');
    });
  }
  // Potom načítaj quizy pre admina
  if (mode === 'supabase' && state.isAdmin) {
    const quizzes = await fetchQuizList();
    state.quizzes = quizzes;
    // ...naplň UI pre admina zoznamom quizov...
  }
  // Ak nie je admin, načítaj len posledný leaderboard
  if (mode === 'supabase' && !state.isAdmin) {
    const leaderboardData = await fetchLatestLeaderboard();
    if (leaderboardData) {
      // ...naplň UI len leaderboardom...
    }
  }
})();

console.log('App.js loaded!');
