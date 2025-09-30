// State management
const state = {
    teams: [],
    rounds: [],
    scores: {},
    currentTab: 'scoring'
};

// DOM Elements
const elements = {
    teamName: document.getElementById('teamName'),
    addTeam: document.getElementById('addTeam'),
    teamsList: document.getElementById('teamsList'),
    roundName: document.getElementById('roundName'),
    maxPoints: document.getElementById('maxPoints'),
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

// Scroll to leaderboard section and switch tab
function scrollToLeaderboard() {
    // Switch to leaderboard tab if not already
    if (state.currentTab !== 'leaderboard') {
        switchTab('leaderboard');
        // Wait for DOM update
        setTimeout(() => {
            const leaderboardSection = document.getElementById('leaderboardSection');
            if (leaderboardSection) {
                leaderboardSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    } else {
        const leaderboardSection = document.getElementById('leaderboardSection');
        if (leaderboardSection) {
            leaderboardSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
}

// Event Listeners
if (elements.addTeam) elements.addTeam.onclick = addTeam;
if (elements.addRound) elements.addRound.onclick = addRound;
if (elements.newQuiz) elements.newQuiz.onclick = confirmNewQuiz;
if (elements.saveQuiz) elements.saveQuiz.onclick = saveQuizToLocal;
if (elements.loadQuiz) elements.loadQuiz.onclick = loadQuizFromLocal;
if (elements.exportQuiz) elements.exportQuiz.onclick = exportQuizData;
if (elements.tabButtons) elements.tabButtons.forEach(button => {
    button.onclick = () => {
        const tab = button.dataset.tab;
        switchTab(tab);
    };
});

// Add event listener for both Leaderboard buttons (tab and scoreboard section)
document.addEventListener('DOMContentLoaded', function() {
    // Tab navigation Leaderboard button already handled above
    const leaderboardScrollBtn = document.getElementById('leaderboardScrollBtn');
    if (leaderboardScrollBtn) {
        leaderboardScrollBtn.onclick = scrollToLeaderboard;
    }
    // Optionally, add a second button elsewhere if needed
});

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

// Team Management
function addTeam() {
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
        if (state.currentTab === 'leaderboard') {
            updateLeaderboard();
        }
    }
}
window.removeTeam = function(teamName) {
    const index = state.teams.indexOf(teamName);
    if (index > -1) {
        state.teams.splice(index, 1);
        delete state.scores[teamName];
        updateTeamsList();
        updateScoreboard();
        if (state.currentTab === 'leaderboard') {
            updateLeaderboard();
        }
    }
};
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
// Round Management
function addRound() {
    const roundName = elements.roundName.value.trim();
    if (!roundName) {
        alert('Please enter round name');
        return;
    }
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
    if (state.currentTab === 'leaderboard') {
        updateLeaderboard();
    }
}
window.removeRound = function(roundName) {
    const index = state.rounds.findIndex(r => r.name === roundName);
    if (index > -1) {
        state.rounds.splice(index, 1);
        state.teams.forEach(team => {
            delete state.scores[team][roundName];
        });
        updateRoundsList();
        updateScoreboard();
        if (state.currentTab === 'leaderboard') {
            updateLeaderboard();
        }
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
window.updateScore = function(team, round, score) {
    let parsed = parseFloat(score);
    if (isNaN(parsed) || parsed < 0) parsed = 0;
    // No maxPoints limit
    state.scores[team][round] = parsed;
    updateScoreboard();
    if (state.currentTab === 'leaderboard') {
        updateLeaderboard();
    }
};
let scoreboardSorted = false;

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
    // Use a persistent display order
    if (!state.displayTeams) state.displayTeams = [...state.teams];
    // If teams were added/removed, sync displayTeams
    if (state.displayTeams.length !== state.teams.length || !state.displayTeams.every(t => state.teams.includes(t))) {
        state.displayTeams = [...state.teams];
    }
    const displayTeams = state.displayTeams;
    displayTeams.forEach(team => {
        html += `<tr><td>${team}</td>`;
        let total = 0;
        state.rounds.forEach(round => {
            const score = state.scores[team][round.name] || 0;
            total += score;
            html += `<td><input type="number" class="score-input neon-input" 
                        value="${score}" 
                        min="0" 
                        step="0.5"
                        onchange="updateScore('${team}', '${round.name}', this.value)"></td>`;
        });
        html += `<td>${total}</td></tr>`;
    });
    html += '</table>';
    elements.scoreboardTable.innerHTML = html;
}

// Add event listener for sort button
const sortBtn = document.getElementById('sortScoreboard');
if (sortBtn) {
    sortBtn.onclick = function() {
        // Sort displayTeams by score ONCE
        state.displayTeams = [...state.displayTeams].sort((a, b) => {
            const totalA = Object.values(state.scores[a]).reduce((sum, score) => sum + score, 0);
            const totalB = Object.values(state.scores[b]).reduce((sum, score) => sum + score, 0);
            return totalB - totalA;
        });
        updateScoreboard();
    };
}
function updateLeaderboard() {
    const teamScores = state.teams.map(team => {
        const total = Object.values(state.scores[team]).reduce((sum, score) => sum + score, 0);
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
    updateStatistics();
}
function updateStatistics() {
    if (state.teams.length === 0 || state.rounds.length === 0) return;
    let stats = {
        topScore: { team: '', score: 0 },
        easiestRound: { round: '', avgScore: 0 },
        hardestRound: { round: '', avgScore: Infinity },
        bestRound: { team: '', round: '', score: 0 }
    };
    state.rounds.forEach((round, idx) => {
        let roundTotal = 0;
        state.teams.forEach(team => {
            const score = state.scores[team][round.name] || 0;
            roundTotal += score;
            if (score > stats.bestRound.score) {
                stats.bestRound = { team, round: round.name, roundIdx: idx, score };
            }
        });
        const avgScore = roundTotal / state.teams.length;
        // Use avgScore directly for easiest/hardest
        if (avgScore > stats.easiestRound.avgScore) {
            stats.easiestRound = { round: round.name, avgScore };
        }
        if (avgScore < stats.hardestRound.avgScore) {
            stats.hardestRound = { round: round.name, avgScore };
        }
    });
    state.teams.forEach(team => {
        const total = Object.values(state.scores[team]).reduce((sum, score) => sum + score, 0);
        if (total > stats.topScore.score) {
            stats.topScore = { team, score: total };
        }
    });
    elements.quizStats.topScore.innerHTML = `
        <p>${stats.topScore.team || 'N/A'}</p>
        <p>${stats.topScore.score} bodov</p>
    `;
    elements.quizStats.easiestRound.innerHTML = `
        <p>${stats.easiestRound.round || 'N/A'}</p>
        <p>${typeof stats.easiestRound.avgScore === 'number' && !isNaN(stats.easiestRound.avgScore) ? stats.easiestRound.avgScore.toFixed(2) : 'N/A'} priemer</p>
    `;
    elements.quizStats.hardestRound.innerHTML = `
        <p>${stats.hardestRound.round || 'N/A'}</p>
        <p>${typeof stats.hardestRound.avgScore === 'number' && !isNaN(stats.hardestRound.avgScore) ? stats.hardestRound.avgScore.toFixed(2) : 'N/A'} priemer</p>
    `;
    elements.quizStats.bestRound.innerHTML = `
        <p>${stats.bestRound.team || 'N/A'}</p>
        <p>${stats.bestRound.round ? `${(stats.bestRound.roundIdx+1)}. kolo, ${stats.bestRound.score} bodov` : 'N/A'}</p>
    `;
}
function confirmNewQuiz() {
    if (confirm('Are you sure you want to start a new quiz? This will clear all current data.')) {
        state.teams = [];
        state.rounds = [];
        state.scores = {};
        updateTeamsList();
        updateRoundsList();
        updateScoreboard();
        if (state.currentTab === 'leaderboard') {
            updateLeaderboard();
        }
    }
}
function saveQuizToLocal() {
    localStorage.setItem('quizData', JSON.stringify(state));
    alert('Quiz saved successfully!');
}
function loadQuizFromLocal() {
    const savedData = localStorage.getItem('quizData');
    if (savedData) {
        try {
            const loadedState = JSON.parse(savedData);
            state.teams = loadedState.teams;
            state.rounds = loadedState.rounds;
            state.scores = loadedState.scores;
            updateTeamsList();
            updateRoundsList();
            updateScoreboard();
            if (state.currentTab === 'leaderboard') {
                updateLeaderboard();
            }
            alert('Quiz loaded successfully!');
        } catch (e) {
            alert('Error loading quiz data!');
            console.error('Error loading quiz:', e);
        }
    } else {
        alert('No saved quiz found!');
    }
}
function exportQuizData() {
    const dataStr = JSON.stringify(state, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportLink = document.createElement('a');
    exportLink.setAttribute('href', dataUri);
    exportLink.setAttribute('download', 'quiz_data.json');
    exportLink.click();
}
// Initial load
(function initialLoad() {
    const savedData = localStorage.getItem('quizData');
    if (savedData) {
        try {
            const loadedState = JSON.parse(savedData);
            state.teams = loadedState.teams;
            state.rounds = loadedState.rounds;
            state.scores = loadedState.scores;
            updateTeamsList();
            updateRoundsList();
            updateScoreboard();
        } catch (e) {
            console.error('Error loading saved data:', e);
        }
    }
})();

console.log('App.js loaded!');
