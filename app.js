// app.js — PR-ready Supabase + fallback + komentáre

// === KONFIGURÁCIA SUPABASE ===
// Vlož svoje údaje z projektu Supabase (viď README_SUPABASE.md)
// WARNING: Do NOT commit real keys. Use `.env` / hosting environment variables.
let SUPABASE_URL = '<SUPABASE_URL_PLACEHOLDER>'; // e.g. https://xyz.supabase.co
let SUPABASE_ANON_KEY = '<SUPABASE_ANON_KEY_PLACEHOLDER>';
// Allow override from generated config.js (window.SUPABASE_URL / window.SUPABASE_ANON_KEY)
if (typeof window !== 'undefined' && window.SUPABASE_URL) SUPABASE_URL = window.SUPABASE_URL;
if (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY) SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

// Prepínač režimu: 'supabase' alebo 'local'
let mode = 'supabase'; // Zmeň na 'local' ak chceš použiť localStorage fallback

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
  alert('Skontroluj svoj email a klikni na magic link. Po kliknutí sa stránka automaticky obnoví.');
  setTimeout(() => location.reload(), 1000); // reload po návrate z magic linku
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
      state.rounds.forEach(round => {
        state.scores[teamName][round.name] = 0;
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
  const round = { name: roundName };
  state.rounds.push(round);
  state.teams.forEach(team => {
    state.scores[team][roundName] = 0;
  });
  elements.roundName.value = '';
  updateRoundsList();
  updateScoreboard();
  updateLeaderboard();
}

function updateTeamsList() {
  elements.teamsList.innerHTML = '';
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
  state.rounds.forEach(round => {
    const roundDiv = document.createElement('div');
    roundDiv.className = 'team-item';
    roundDiv.innerHTML = `
      <span>${round.name}</span>
      <button onclick="removeRound('${round.name}')" class="neon-button">Remove</button>
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
    });
    updateRoundsList();
    updateScoreboard();
    updateLeaderboard();
  }
};

function updateScoreboard() {
  if (state.teams.length === 0 || state.rounds.length === 0) {
    elements.scoreboardTable.innerHTML = '<p>Add teams and rounds to see the scoreboard</p>';
    return;
  }
  let html = '<table>';
  html += '<tr><th>Team</th>';
  state.rounds.forEach(round => {
    html += `<th>${round.name}</th>`;
  });
  html += '<th>Total</th></tr>';
  state.teams.forEach(team => {
    html += `<tr><td>${team}</td>`;
    let total = 0;
    state.rounds.forEach(round => {
      const score = state.scores[team][round.name] || 0;
      total += score;
      html += `<td><input type="number" class="score-input neon-input" 
        value="${score}" min="0" step="0.5"
        onchange="updateScore('${team}', '${round.name}', this.value)"></td>`;
    });
    html += `<td>${total}</td></tr>`;
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

function updateLeaderboard() {
  const teamScores = state.teams.map(team => {
    const total = Object.values(state.scores[team] || {}).reduce((sum, score) => sum + score, 0);
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
  const title = prompt('Zadaj názov nového kvizu:');
  if (!title) return;
  state.teams = [];
  state.rounds = [];
  state.scores = {};
  state.title = title;
  state.quizId = null;
  updateTeamsList();
  updateRoundsList();
  updateScoreboard();
  updateLeaderboard();
  updateQuizStats();
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
  renderAuthButtons(); // <-- pridaj sem, aby sa zobrazilo vždy
});

function renderAuthButtons() {
  let container = document.getElementById('authButtons');
  if (!container) {
    // Umiestni do .container ak existuje
    const parent = document.querySelector('.container') || document.body;
    container = document.createElement('div');
    container.id = 'authButtons';
    container.style = 'margin: 16px 0; text-align: right; position: relative; z-index: 10;';
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
