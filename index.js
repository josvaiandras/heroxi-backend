const fs = require('fs');
require('dotenv').config();
const express = require('express');
const cors = 'cors';
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
const admin = require('firebase-admin');
const NodeCache = require('node-cache'); // 👈 ADDED

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize cache with a 60-minute Time-To-Live (TTL) for items
const leaderboardCache = new NodeCache({ stdTTL: 3600 }); // 👈 ADDED

// Firebase Admin SDK Initialization
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = JSON.parse(
    fs.readFileSync('serviceAccountKey.json', 'utf8')
  );
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const rateLimiter = require('./rateLimiter');

// Set up OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Root Route
app.get('/', (req, res) => {
  res.send('Hello from HeroXI backend!');
});

// --- PROMPT BUILDER FUNCTIONS (Unchanged) ---
function buildPrompt(lineupText) {
  return `
Please rate this football XI objectively on a scale from -3 to 10 (negative scores allowed). Your response must start with the rating on the first line in this exact format:
Rating: <score>
Then, provide a concise analysis (around 200 words) covering player fit, tactical fit, strengths, weaknesses, and key tactical observations. Use an analytical tone.

Team:
${lineupText}
  `.trim();
}

function buildTeamInsightPrompt(lineupText) {
  return `
Analyze the following football team and provide as many fun and interesting facts as possible about the players:
${lineupText}
Keep the response concise (under 150 words) and focus on entertaining or surprising trivia, achievements, nicknames, unique skills, or memorable moments related to the players.
  `.trim();
}

function buildMatchSimulationPrompt(
  teamA,
  teamB,
  formationA,
  formationB,
  lineupA,
  lineupB
) {
  return `
Simulate a football match between two fictional teams based on the following:
Team A: Formation: ${formationA}, Lineup: ${lineupA}
Team B: Formation: ${formationB}, Lineup: ${lineupB}

Generate a match report (max 200 words total):
1.  **Pre-match Analysis:** At the very start, clearly state that Team A is the match initiator who issued the challenge. Then describe both teams’ strengths and weaknesses.
2.  **Highlights:** Provide minute-by-minute highlights including goal scorers, key moments, and drama.
3.  **Result:** State the final score.
4.  **Winner Declaration:** On a new line, at the very end of your response, you MUST declare the winner in this exact format: "Winner: Team A" or "Winner: Team B".

Return plain text only in a style like a professional sports journalist summarizing the match.
  `.trim();
}

function parseWinnerFromText(text) {
  const winnerRegex = /Winner:\s*(Team A|Team B)/i;
  const match = text.match(winnerRegex);
  if (match && match[1]) {
    const winner = match[1].toLowerCase();
    return winner === 'team a' ? 'teamA' : 'teamB';
  }
  console.warn('Could not parse a clear winner. Assigning a winner randomly.');
  return Math.random() < 0.5 ? 'teamA' : 'teamB';
}

function buildSingleMatchSimulationPrompt(
  englandLineup,
  opponentName,
  formation
) {
  return `
Simulate a football match between England (Formation: ${formation}, Lineup: ${englandLineup}) and an opponent named ${opponentName}.
Write a concise 3-paragraph match summary (max 200 words total):
Pre-match analysis highlighting the strengths and weaknesses of both teams.
Minute-by-minute highlights including goal scorers and key events.
Final score, the winner.
Use a creative, epic tone, as if narrating a thrilling football match.
Return plain text only.
  `.trim();
}

function buildPersonalityTestPrompt(lineupText) {
  return `
You are a professional psychologist. Analyze the personality traits of a football manager who would select the following starting XI and formation:
${lineupText}
Provide an insightful summary of their personality, strengths, and weaknesses. NOT their football manager style, but deduct real life personality. Keep your response under 150 words.
  `.trim();
}

function buildTournamentSimulationPrompt(tournamentType, lineupText) {
  return `
Simulate the following tournament: ${tournamentType}. (Limit: 200 words)

Using this England team:
${lineupText}

Include famous players from ${tournamentType} (e.g. Zidane in 2000, Iniesta in 2012, etc.)

Generate a realistic path for England through the tournament (group stage, knockout rounds, etc.), but don't make it the real historical accurate outcome. Generate a tournament win at 25% probability.

Provide match results, key moments, standout performers, and realistic scores.

Do not make it overly positive or biased — if England loses, explain how and why realistically.

If England doesn’t win the tournament, end by naming the real-life winner of that tournament.
  `.trim();
}

function buildDailyChallengePrompt(dailyChallenge, lineupText) {
  return `
This is the Daily Challenge: ${dailyChallenge}
Here is the selected team: ${lineupText}
Please evaluate this team thoroughly, methodically, and objectively in relation to the challenge. Go player by player, assessing how each name fits the criteria of the Challenge. Take your time to verify the accuracy of your information. After the analysis, give the team a score out of 10 based on how well it fulfills the challenge.
If the score is 7 or above, mark the result as "Daily Challenge Passed". Keep your answer below 150 words.
  `.trim();
}

// =================================================================
// START: NEW PAGINATED LEADERBOARD ENDPOINTS
// =================================================================

async function fetchLeaderboardPage(type, limit, startAfterUid) {
  const field = type === 'daily' ? 'totalCompleted' : 'matchesWon';
  const usersRef = db.collection('users');
  let query = usersRef.where(field, '>', 0).orderBy(field, 'desc').limit(limit);

  if (startAfterUid) {
    const startAfterDoc = await db.collection('users').doc(startAfterUid).get();
    if (startAfterDoc.exists) {
      query = query.startAfter(startAfterDoc);
    }
  }

  const querySnapshot = await query.get();

  const users = [];
  querySnapshot.forEach((doc) => {
    users.push({ uid: doc.id, ...doc.data() });
  });
  return users;
}

app.get('/leaderboards/daily', async (req, res) => {
  const limit = parseInt(req.query.limit) || 3;
  const startAfter = req.query.startAfter || null;

  try {
    const users = await fetchLeaderboardPage('daily', limit, startAfter);
    res.json(users);
  } catch (error) {
    console.error('Error fetching daily leaderboard:', error);
    res.status(500).json({ error: 'Failed to load leaderboard.' });
  }
});

app.get('/leaderboards/h2h', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const startAfter = req.query.startAfter || null;

  try {
    const users = await fetchLeaderboardPage('h2h', limit, startAfter);
    res.json(users);
  } catch (error) {
    console.error('Error fetching H2H leaderboard:', error);
    res.status(500).json({ error: 'Failed to load leaderboard.' });
  }
});

// =================================================================
// START: REAL-TIME STAT UPDATE ENDPOINTS
// =================================================================

app.post('/update-stats/win/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'User ID is required.' });

  const userRef = db.collection('users').doc(userId);

  try {
    await userRef.update({
      matchesWon: admin.firestore.FieldValue.increment(1),
      lastWinAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const updatedUserDoc = await userRef.get();
    if (!updatedUserDoc.exists()) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const newScore = updatedUserDoc.data().matchesWon;

    const higherScoresSnapshot = await db
      .collection('users')
      .where('matchesWon', '>', newScore)
      .count()
      .get();
    const newRank = higherScoresSnapshot.data().count + 1;

    // Note: Caching is removed as we are lazy loading directly from DB
    // leaderboardCache.del('leaderboard_h2h');

    res.json({ newScore, newRank });
  } catch (error) {
    console.error(`Error updating win stats for ${userId}:`, error);
    res.status(500).json({ error: 'Failed to update win stats.' });
  }
});

// =================================================================
// ALL OTHER ENDPOINTS
// =================================================================

app.post('/rate-my-xi', rateLimiter, async (req, res) => {
  try {
    const { lineupText } = req.body;
    if (!lineupText) {
      return res.status(400).json({ error: 'Lineup text is required.' });
    }

    const prompt = buildPrompt(lineupText);
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0].message.content;
    const ratingRegex = /Rating:\s*(-?\d+(\.\d+)?)/;
    const ratingMatch = text.match(ratingRegex);
    let rating = null;
    let analysis = '';

    if (ratingMatch) {
      rating = parseFloat(ratingMatch[1]);
      const ratingIndex = text.indexOf(ratingMatch[0]);
      analysis = text.substring(ratingIndex + ratingMatch[0].length).trim();
    } else {
      analysis =
        'Unable to extract rating from the response. Please try again.';
    }

    res.json({ rating, analysis });
  } catch (error) {
    console.error('Error rating team:', error);
    res.status(500).json({ error: 'Failed to rate team.' });
  }
});

app.post('/simulate-tournament', rateLimiter, async (req, res) => {
  try {
    const { lineupText, tournamentType } = req.body;
    if (!lineupText || !tournamentType) {
      return res
        .status(400)
        .json({ error: 'Lineup text and tournament type are required.' });
    }

    const prompt = buildTournamentSimulationPrompt(tournamentType, lineupText);
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
    });

    const tournamentResult = response.choices[0].message.content;
    res.json({ tournamentResult });
  } catch (error) {
    console.error('Error simulating tournament:', error);
    res.status(500).json({ error: 'Failed to simulate tournament.' });
  }
});

app.post('/personality-test', rateLimiter, async (req, res) => {
  try {
    const { lineupText } = req.body;
    if (!lineupText) {
      return res.status(400).json({ error: 'Lineup text is required.' });
    }

    const prompt = buildPersonalityTestPrompt(lineupText);
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
    });

    const analysis = response.choices[0].message.content;
    res.json({ analysis });
  } catch (error) {
    console.error('Error fetching personality analysis:', error);
    res.status(500).json({ error: 'Failed to fetch personality analysis.' });
  }
});

app.post('/team-insight', rateLimiter, async (req, res) => {
  try {
    const { lineupText } = req.body;
    if (!lineupText) {
      return res.status(400).json({ error: 'Lineup text is required.' });
    }

    const prompt = buildTeamInsightPrompt(lineupText);
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
    });

    const insight = response.choices[0].message.content;
    res.json({ insight });
  } catch (error) {
    console.error('Error fetching team insight:', error);
    res.status(500).json({ error: 'Failed to fetch team insight.' });
  }
});

app.post('/simulate-single-match', rateLimiter, async (req, res) => {
  try {
    const { englandLineup, opponentName } = req.body;
    if (!englandLineup || !opponentName) {
      return res
        .status(400)
        .json({ error: 'England lineup and opponent name are required.' });
    }

    const formationMatch = englandLineup.match(/in a (\d-\d-\d) setup:/);
    const formation = formationMatch ? formationMatch[1] : '4-4-2';

    const prompt = buildSingleMatchSimulationPrompt(
      englandLineup,
      opponentName,
      formation
    );
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0].message.content;
    res.json({ result: text });
  } catch (error) {
    console.error('Error simulating single match:', error);
    res.status(500).json({ error: 'Failed to simulate match.' });
  }
});

app.post('/simulate-match', rateLimiter, async (req, res) => {
  try {
    const { matchId } = req.body;
    if (!matchId) {
      return res.status(400).json({ error: 'Match ID is required.' });
    }

    const matchRef = db.collection('matches').doc(matchId);
    const matchSnap = await matchRef.get();

    if (!matchSnap.exists) {
      return res.status(404).json({ error: 'Match not found.' });
    }

    const matchData = matchSnap.data();
    if (
      !matchData.teamA ||
      !matchData.teamB ||
      !matchData.formationA ||
      !matchData.formationB
    ) {
      return res
        .status(400)
        .json({
          error: 'Match is incomplete. Both teams and formations are required.',
        });
    }

    const prompt = buildMatchSimulationPrompt(
      'Team A',
      'Team B',
      matchData.formationA,
      matchData.formationB,
      matchData.teamA.join(', '),
      matchData.teamB.join(', ')
    );

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
    });
    const simulationText = response.choices[0].message.content;

    const winner = parseWinnerFromText(simulationText);

    await matchRef.update({
      simulationResult: simulationText,
      status: 'completed',
      winner: winner,
    });

    res
      .status(200)
      .json({ message: 'Simulation completed and result stored.' });
  } catch (error) {
    console.error('Error simulating match:', error);
    res.status(500).json({ error: 'Failed to simulate match.' });
  }
});

// REPLACED Daily Challenge Endpoint
app.post('/daily-challenge', rateLimiter, async (req, res) => {
  try {
    const { lineupText, dailyChallenge } = req.body;
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!lineupText || !dailyChallenge || !token) {
      return res
        .status(400)
        .json({ error: 'Lineup, challenge, and auth token are required.' });
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;

    const prompt = buildDailyChallengePrompt(dailyChallenge, lineupText);
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
    });
    const challengeResultText = response.choices[0].message.content;

    let responsePayload = { challengeResult: challengeResultText };

    if (challengeResultText.includes('Daily Challenge Passed')) {
      const todayStr = new Date().toLocaleDateString('en-CA', {
        timeZone: 'Europe/London',
      });
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('en-CA', {
        timeZone: 'Europe/London',
      });

      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (userDoc.exists) {
        // <--- CORRECTED LINE
        const userData = userDoc.data();
        if (userData.lastCompletionDate !== todayStr) {
          const newStreak =
            userData.lastCompletionDate === yesterdayStr
              ? (userData.totalCompleted || 0) + 1
              : 1;

          await userRef.update({
            totalCompleted: newStreak,
            lastCompletionDate: todayStr,
          });

          const higherScoresSnapshot = await db
            .collection('users')
            .where('totalCompleted', '>', newStreak)
            .count()
            .get();
          const newRank = higherScoresSnapshot.data().count + 1;

          responsePayload = {
            ...responsePayload,
            newStreak,
            newRank,
            username: userData.username,
          };

          // Note: Caching is removed as we are lazy loading directly from DB
          // leaderboardCache.del('leaderboard_daily');
        }
      }
    }

    res.json(responsePayload);
  } catch (error) {
    // MODIFICATION: Log the detailed error to your server console
    console.error('Detailed error in /daily-challenge:', error);

    // This is the generic response the user sees
    res.status(500).json({ error: 'Failed to process daily challenge.' });
  }
});

app.post('/save-team', async (req, res) => {
  try {
    const { teamName, formation, lineup, userId } = req.body;
    if (!teamName || !formation || !lineup || !userId) {
      return res
        .status(400)
        .json({
          error: 'Team name, formation, lineup, and userId are required.',
        });
    }

    const teamRef = db.collection('teams').doc(userId);
    await teamRef.set(
      {
        teamName,
        formation,
        lineup,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.status(201).json({ message: 'Team saved successfully!' });
  } catch (error) {
    console.error('Error saving team:', error);
    res.status(500).json({ error: 'Failed to save team.' });
  }
});

app.get('/get-team/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const teamRef = db.collection('teams').doc(userId);
    const docSnap = await teamRef.get();

    if (docSnap.exists) {
      res.status(200).json(docSnap.data());
    } else {
      res.status(404).json({ error: 'Team not found for this user.' });
    }
  } catch (error) {
    console.error('Error retrieving team:', error);
    res.status(500).json({ error: 'Failed to retrieve team.' });
  }
});

app.post('/auth/anonymous', async (req, res) => {
  try {
    const uid = `anon-${Date.now()}`;
    const customToken = await admin.auth().createCustomToken(uid);
    res.status(201).json({ customToken });
  } catch (error) {
    console.error('Error creating custom token:', error);
    res.status(500).json({ error: 'Failed to authenticate anonymously.' });
  }
});

// Start the Server
app.listen(port, () => {
  console.log(`HeroXI backend listening at http://localhost:${port}`);
});
