// Leaderboard-only view for clients
const elements = {
    leaderboardDisplay: document.getElementById('leaderboardDisplay'),
    quizStats: {
        topScore: document.getElementById('topScore'),
        easiestRound: document.getElementById('easiestRound'),
        hardestRound: document.getElementById('hardestRound'),
        bestRound: document.getElementById('bestRound')
    }
};

function getState() {
    const savedData = localStorage.getItem('quizData');
    if (savedData) {
        try {
            return JSON.parse(savedData);
        } catch (e) {
            return { teams: [], rounds: [], scores: {} };
        }
    }
    return { teams: [], rounds: [], scores: {} };
}

function updateLeaderboard() {
    const state = getState();
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
    updateStatistics(state);
}

function updateStatistics(state) {
    if (!state.teams.length || !state.rounds.length) return;
    let stats = {
        topScore: { team: '', score: 0 },
        easiestRound: { round: '', avgScore: 0 },
        hardestRound: { round: '', avgScore: Infinity },
        bestRound: { team: '', round: '', score: 0 }
    };
    state.rounds.forEach(round => {
        let roundTotal = 0;
        let roundMax = round.maxPoints;
        state.teams.forEach(team => {
            const score = (state.scores[team] && state.scores[team][round.name]) || 0;
            roundTotal += score;
            if (score > stats.bestRound.score) {
                stats.bestRound = { team, round: round.name, score };
            }
        });
        const avgScore = roundTotal / state.teams.length;
        const percentScore = (avgScore / roundMax) * 100;
        if (percentScore > stats.easiestRound.avgScore) {
            stats.easiestRound = { round: round.name, avgScore: percentScore };
        }
        if (percentScore < stats.hardestRound.avgScore) {
            stats.hardestRound = { round: round.name, avgScore: percentScore };
        }
    });
    state.teams.forEach(team => {
        const total = Object.values(state.scores[team] || {}).reduce((sum, score) => sum + score, 0);
        if (total > stats.topScore.score) {
            stats.topScore = { team, score: total };
        }
    });
    elements.quizStats.topScore.innerHTML = `
        <p>${stats.topScore.team || 'N/A'}</p>
        <p>${stats.topScore.score} points</p>
    `;
    elements.quizStats.easiestRound.innerHTML = `
        <p>${stats.easiestRound.round || 'N/A'}</p>
        <p>${Math.round(stats.easiestRound.avgScore)}% avg</p>
    `;
    elements.quizStats.hardestRound.innerHTML = `
        <p>${stats.hardestRound.round || 'N/A'}</p>
        <p>${Math.round(stats.hardestRound.avgScore)}% avg</p>
    `;
    elements.quizStats.bestRound.innerHTML = `
        <p>${stats.bestRound.team || 'N/A'}</p>
        <p>${stats.bestRound.round ? `${stats.bestRound.round}: ${stats.bestRound.score} points` : 'N/A'}</p>
    `;
}

updateLeaderboard();
// Optionally, refresh every 5 seconds for live updates
setInterval(updateLeaderboard, 5000);
