const fs = require('fs');
require("dotenv").config();
const express = require("express");
const cors =require("cors");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const admin = require('firebase-admin');

const app = express();
const port = process.env.PORT || 3000;

const challengeHighlights = [
    "of players who all scored penalties for England",
    "with more than 50 caps each",
    "with the best haircuts",
    "with under 40 total England appearances",
    "with the most goals",
    "with average height above 6 feet",
    "with unique first names",
    "with the most clean sheets",
    "of players who all played in the Premier League era",
    "with the most assists",
    "of players who were all born in London",
    "of players from a single club",
    "with only players from 1 year",
    "with the highest combined transfer value",
    "with the lowest combined transfer value",
    "of players who all played abroad during their career",
    "with the youngest average age",
    "with the most caps",
    "of players who all have one-syllable last names",
    "with the oldest average age"
  ];

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Firebase Admin SDK Initialization
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Render environment
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  // Local environment
  serviceAccount = JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'));
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
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

// 🧠 Rating Prompt Builder
function buildPrompt(lineupText) {
  return `
Please rate this football XI objectively on a scale from -3 to 10 (negative scores allowed). Your response must start with the rating on the first line in this exact format:
Rating: <score> 
Then, provide a concise analysis (around 200 words) covering player fit, tactical fit, strengths, weaknesses, and key tactical observations. Use an analytical tone.

Team:
${lineupText}
  `.trim();
}

// 💡 Team Insight Prompt Builder
function buildTeamInsightPrompt(lineupText) {
  return `
Analyze the following football team and provide as many fun and interesting facts as possible about the players:
${lineupText}
Keep the response concise (under 200 words) and focus on entertaining or surprising trivia, achievements, nicknames, unique skills, or memorable moments related to the players.
  `.trim();
}

// 🏟️ Match Simulation Prompt Builder
function buildMatchSimulationPrompt(teamA, teamB, formationA, formationB, lineupA, lineupB) {
  return `
Simulate a football match between two fictional teams based on the following:
Team A: Formation: ${formationA}, Lineup: ${lineupA}
Team B: Formation: ${formationB}, Lineup: ${lineupB}
Generate a match report (max 200 words total):
At the very start of the pre-match analysis. Clearly state that Team A is the match initiator who issued the challenge. Then describe both teams’ strengths and weaknesses.
Minute-by-minute highlights including goal scorers, key moments, and drama.
Final score, winning team.
Return plain text only in a style like a professional sports journalist summarizing the match.
  `.trim();
}

// 🏟️ Single Match Simulation Prompt Builder
function buildSingleMatchSimulationPrompt(englandLineup, opponentName, formation) {
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

// 👤 Personality Test Prompt Builder
function buildPersonalityTestPrompt(lineupText) {
  return `
You are a professional psychologist. Analyze the personality traits of a football manager who would select the following starting XI and formation:
${lineupText}
Provide an insightful summary of their personality, strengths, and weaknesses. NOT their football manager style, but deduct real life personality. Keep your response under 150 words.
  `.trim();
}

// 🏆 Tournament Simulation Prompt Builder
function buildTournamentSimulationPrompt(tournamentType, lineupText) {
  return `
Simulate the following tournament: ${tournamentType}. (Limit: 200 words)

Using this England team:
${lineupText}

Include famous players from ${tournamentType} (e.g. Zidane in 2000, Iniesta in 2012, etc.)

Generate a realistic path for England through the tournament (group stage, knockout rounds, etc.), but don't make it the real historical accurate outcome.

Provide match results, key moments, standout performers, and realistic scores.

Do not make it overly positive or biased — if England loses, explain how and why realistically. 

If England doesn’t win the tournament, end by naming the real-life winner of that tournament.
  `.trim();
}


// 💡 Team Insight Prompt Builder
function buildTeamInsightPrompt(lineupText) {
  return `
Analyze the following football team and provide as many fun and interesting facts as possible about the players:
${lineupText}
Keep the response concise (under 150 words) and focus on entertaining or surprising trivia, achievements, nicknames, unique skills, or memorable moments related to the players.
  `.trim();
}

// 🔽 START: NEW PROMPT BUILDER FOR DAILY CHALLENGE
// This function creates the specific prompt for evaluating the daily challenge.
function buildDailyChallengePrompt(dailyChallenge, lineupText) {
  return `
This is the Daily Challenge: ${dailyChallenge}
Here is the selected team: ${lineupText}
Please evaluate this team thoroughly, methodically, and objectively in relation to the challenge. Go player by player, assessing how each name fits the criteria of the Daily Challenge. After the analysis, give the team a score out of 10 based on how well it fulfills the challenge.
If the score is 7 or above, mark the result as "Daily Challenge Passed". Keep your answer below 150 words. 
  `.trim();
}
// 🔼 END: NEW PROMPT BUILDER FOR DAILY CHALLENGE


// 🔽 START: NEW SECURE ENDPOINT FOR FETCHING DAILY CHALLENGE
app.get("/get-daily-challenge", rateLimiter, (req, res) => {
  try {
    // This logic now runs securely on the server
    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 0);
    const diff = today - startOfYear;
    const oneDay = 1000 * 60 * 60 * 24;
    const dayOfYear = Math.floor(diff / oneDay);

    const challengeIndex = dayOfYear % challengeHighlights.length;
    const currentChallenge = challengeHighlights[challengeIndex];

    // Send ONLY the current challenge text back to the client
    res.status(200).json({ dailyChallenge: currentChallenge });

  } catch (error) {
    console.error("Error fetching daily challenge:", error);
    res.status(500).json({ error: "Failed to get daily challenge." });
  }
});
// 🔼 END: NEW SECURE ENDPOINT


// Endpoint for Team Rating
app.post("/rate-my-xi", rateLimiter, async (req, res) => {
  try {
    const { lineupText } = req.body;
    if (!lineupText) {
      return res.status(400).json({ error: "Lineup text is required." });
    }

    const prompt = buildPrompt(lineupText);
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.choices[0].message.content;
    const ratingRegex = /Rating:\s*(-?\d+(\.\d+)?)/; // Match "Rating: <score>" anywhere
    const ratingMatch = text.match(ratingRegex);
    let rating = null;
    let analysis = '';

    if (ratingMatch) {
      rating = parseFloat(ratingMatch[1]);
      const ratingIndex = text.indexOf(ratingMatch[0]);
      analysis = text.substring(ratingIndex + ratingMatch[0].length).trim();
    } else {
      analysis = "Unable to extract rating from the response. Please try again.";
    }

    res.json({ rating, analysis });
  } catch (error) {
    console.error("Error rating team:", error);
    res.status(500).json({ error: "Failed to rate team." });
  }
});


// Endpoint for Tournament Simulation
app.post("/simulate-tournament", rateLimiter, async (req, res) => {
  try {
    const { lineupText, tournamentType } = req.body;
    if (!lineupText || !tournamentType) {
      return res.status(400).json({ error: "Lineup text and tournament type are required." });
    }

    const prompt = buildTournamentSimulationPrompt(tournamentType, lineupText);
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const tournamentResult = response.choices[0].message.content;
    res.json({ tournamentResult });

  } catch (error) {
    console.error("Error simulating tournament:", error);
    res.status(500).json({ error: "Failed to simulate tournament." });
  }
});


// Endpoint for Personality Test
app.post("/personality-test", rateLimiter, async (req, res) => {
  try {
    const { lineupText } = req.body;
    if (!lineupText) {
      return res.status(400).json({ error: "Lineup text is required." });
    }

    const prompt = buildPersonalityTestPrompt(lineupText);
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    // The handler in script.js expects a JSON object with an 'analysis' key
    const analysis = response.choices[0].message.content;
    res.json({ analysis });

  } catch (error) {
    console.error("Error fetching personality analysis:", error);
    res.status(500).json({ error: "Failed to fetch personality analysis." });
  }
});


// Endpoint for Team Insight
app.post("/team-insight", rateLimiter, async (req, res) => {
  try {
    const { lineupText } = req.body;
    if (!lineupText) {
      return res.status(400).json({ error: "Lineup text is required." });
    }

    const prompt = buildTeamInsightPrompt(lineupText);
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const insight = response.choices[0].message.content;
    res.json({ insight });

  } catch (error) {
    console.error("Error fetching team insight:", error);
    res.status(500).json({ error: "Failed to fetch team insight." });
  }
});


// Endpoint for Single-Player Match Simulation
app.post("/simulate-single-match", rateLimiter, async (req, res) => {
  try {
    const { englandLineup, opponentName } = req.body;
    if (!englandLineup || !opponentName) {
      return res.status(400).json({ error: "England lineup and opponent name are required." });
    }

    const formationMatch = englandLineup.match(/in a (\d-\d-\d) setup:/);
    const formation = formationMatch ? formationMatch[1] : "4-4-2";

    const useMock = false;
    if (useMock) {
      const mockResult = `Mock simulation: England (${formation}) vs. ${opponentName}. England started with high pressing, exploiting ${opponentName}'s weak flanks. ${opponentName} countered with quick transitions. In the 20th minute, an England striker scored from a set-piece. ${opponentName} equalized in the 55th minute via a penalty. A late England goal in the 85th minute sealed it. Final score: 2-1 to England. Looks like ${opponentName}'s defense forgot their boots today! ⚽`;
      return res.json({ result: mockResult });
    }

    const prompt = buildSingleMatchSimulationPrompt(englandLineup, opponentName, formation);
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.choices[0].message.content;
    res.json({ result: text });
  } catch (error) {
    console.error("Error simulating single match:", error);
    res.status(500).json({ error: "Failed to simulate match." });
  }
});

// Endpoint for Multiplayer Match Simulation
app.post("/simulate-match", rateLimiter, async (req, res) => {
  try {
    const { matchId } = req.body;
    if (!matchId) {
      return res.status(400).json({ error: "Match ID is required." });
    }

    const matchRef = db.collection('matches').doc(matchId);
    const matchSnap = await matchRef.get();

    if (!matchSnap.exists) {
      return res.status(404).json({ error: "Match not found." });
    }

    const matchData = matchSnap.data();
    if (!matchData.teamA || !matchData.teamB || !matchData.formationA || !matchData.formationB) {
      return res.status(400).json({ error: "Match is incomplete. Both teams and formations are required." });
    }

    // --- This part remains the same ---
    const prompt = buildMatchSimulationPrompt(
      "Team A", "Team B",
      matchData.formationA, matchData.formationB,
      matchData.teamA.join(", "), matchData.teamB.join(", ")
    );
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.choices[0].message.content;
    // --- End of existing logic ---


    // --- MODIFIED: Save the result to Firestore ---
    // Instead of sending the result back in the response,
    // we update the document, which will trigger the frontend listeners.
    await matchRef.update({
      simulationResult: text,
      status: 'completed'
    });

    // We can now send a simple success message. The client will get the
    // result via the Firestore listener.
    res.status(200).json({ message: "Simulation completed and result stored." });

  } catch (error) {
    console.error("Error simulating match:", error);
    res.status(500).json({ error: "Failed to simulate match." });
  }
});


// 🔽 START: UPDATED DAILY CHALLENGE ENDPOINT
// This endpoint now receives the daily challenge text from the frontend and uses the new prompt.
app.post("/daily-challenge", rateLimiter, async (req, res) => {
  try {
    const { lineupText, dailyChallenge } = req.body; // Destructure both from the body
    if (!lineupText || !dailyChallenge) {
      return res.status(400).json({ error: "Lineup text and daily challenge are required." });
    }

    const useMock = false;
    if (useMock) {
      const mockChallengeResult = "Congratulations! You've completed today's challenge with your selected XI. Your team shows great potential for teamwork and strategy. Keep up the good work!";
      return res.json({ challengeResult: mockChallengeResult });
    }

    // Use the new prompt builder
    const prompt = buildDailyChallengePrompt(dailyChallenge, lineupText);

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
    });

    const text = response.choices[0].message.content;
    
    // Send the AI's full response back to the client
    res.json({ challengeResult: text });

  } catch (error)
 {
    console.error("Error in daily challenge:", error);
    res.status(500).json({ error: "Failed to process daily challenge." });
  }
});
// 🔼 END: UPDATED DAILY CHALLENGE ENDPOINT

// Endpoint to Store Team Data
app.post('/save-team', async (req, res) => {
  try {
    const { teamName, formation, lineup, userId } = req.body;
    if (!teamName || !formation || !lineup || !userId) {
      return res.status(400).json({ error: "Team name, formation, lineup, and userId are required." });
    }

    const teamRef = db.collection('teams').doc(userId);
    await teamRef.set({
      teamName,
      formation,
      lineup,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.status(201).json({ message: "Team saved successfully!" });
  } catch (error) {
    console.error('Error saving team:', error);
    res.status(500).json({ error: "Failed to save team." });
  }
});

// Endpoint to Get a User's Saved Team
app.get('/get-team/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const teamRef = db.collection('teams').doc(userId);
    const docSnap = await teamRef.get();

    if (docSnap.exists) {
      res.status(200).json(docSnap.data());
    } else {
      res.status(404).json({ error: "Team not found for this user." });
    }
  } catch (error) {
    console.error('Error retrieving team:', error);
    res.status(500).json({ error: "Failed to retrieve team." });
  }
});

// Anonymous Authentication Endpoint
app.post('/auth/anonymous', async (req, res) => {
  try {
    const uid = `anon-${Date.now()}`;
    const customToken = await admin.auth().createCustomToken(uid);
    res.status(201).json({ customToken });
  } catch (error) {
    console.error('Error creating custom token:', error);
    res.status(500).json({ error: "Failed to authenticate anonymously." });
  }
});

// Start the Server
app.listen(port, () => {
  console.log(`HeroXI backend listening at http://localhost:${port}`);
});
