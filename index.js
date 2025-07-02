const fs = require('fs');
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const admin = require('firebase-admin');

const app = express();
const port = process.env.PORT || 3000;

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
I've got this football XI with formation and roles:
${lineupText}

Please rate the team objectively on a scale from -3 to 10 (negative scores allowed). Start your response with the rating on the first line in this exact format:
Rating: <score>
Then, provide a concise analysis (around 150 words) covering player fit, tactical fit, strengths, weaknesses, and key tactical observations. Use an analytical and professional tone, and if appropriate, include a light, relevant football joke or witty comment to add some personality.

  `.trim();
}

// 🏟️ Match Simulation Prompt Builder
function buildMatchSimulationPrompt(teamA, teamB, formationA, formationB, lineupA, lineupB) {
  return `
Simulate a football match between two fictional teams based on the following:
Team A: Formation: ${formationA}, Lineup: ${lineupA}
Team B: Formation: ${formationB}, Lineup: ${lineupB}
Generate a 3-paragraph match report (max 200 words total):
At the very start of the pre-match analysis, name both teams with creative, realistic names. Clearly state that Team A is the match initiator who issued the challenge or hosted the match. Then describe both teams’ strengths and weaknesses.
Minute-by-minute highlights including goal scorers, key moments, and drama.
Final score, winning team, and a witty football-style closing remark.
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
Final score, the winner, and a witty football-related closing remark.
Return plain text only.
  `.trim();
}

// 👤 Personality Test Prompt Builder
function buildPersonalityTestPrompt(lineupText) {
  return `
You are a professional psychologist. Analyze the personality traits of a football manager who would select the following starting XI and formation:
${lineupText}
Provide an insightful summary of their personality, strengths, and quirks. Keep your response under 150 words.
Start your response with Personality Analysis: , in the first line. 

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

// Endpoint for Team Rating
app.post("/rate-my-xi", rateLimiter, async (req, res) => {
  try {
    const { lineupText } = req.body;
    if (!lineupText) {
      return res.status(400).json({ error: "Lineup text is required." });
    }

    const useMock = true;
    if (useMock) {
      return res.json({
        rating: 8.5,
        analysis: "This mock analysis suggests a strong team with good tactical fit, but perhaps a slight weakness in aerial duels. Still, a solid 8.5! They're almost as good as my imaginary team that always wins. Almost. 😉"
      });
    }

    const prompt = buildPrompt(lineupText);
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.choices[0].message.content;
    const ratingMatch = text.match(/^(-?\d+(\.\d+)?)/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
    const analysis = ratingMatch ? text.substring(ratingMatch[0].length).trim() : text.trim();

    res.json({ rating, analysis });
  } catch (error) {
    console.error("Error rating team:", error);
    res.status(500).json({ error: "Failed to rate team." });
  }
});

// Endpoint for Single-Player Match Simulation
app.post("/simulate-single-match", rateLimiter, async (req, res) => {
  try {
    const { englandLineup, opponentName } = req.body;
    if (!englandLineup || !opponentName) {
      return res.status(400).json({ error: "England lineup and opponent name are required." });
    }

    // Extract formation from englandLineup (e.g., "Here's my XI in a 4-4-2 setup:")
    const formationMatch = englandLineup.match(/in a (\d-\d-\d) setup:/);
    const formation = formationMatch ? formationMatch[1] : "4-4-2"; // Default to 4-4-2 if not found

    const useMock = true;
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

    const useMock = true;
    if (useMock) {
      const mockResult = `Mock simulation: Team A (${matchData.formationA}) vs. Team B (${matchData.formationB}). Team A started strong, exploiting the wings. Team B countered with a solid midfield press. In the 15th minute, a Team A striker scored from a cross. Team B equalized in the 60th minute with a long-range shot. The match ended 1-1, with both teams showing grit. Looks like the only winner here is the popcorn vendor! 🍿`;
      return res.json({ result: mockResult });
    }

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
    res.json({ result: text });
  } catch (error) {
    console.error("Error simulating match:", error);
    res.status(500).json({ error: "Failed to simulate match." });
  }
});

// Endpoint for Personality Test
app.post("/personality-test", rateLimiter, async (req, res) => {
  try {
    const { lineupText } = req.body;
    if (!lineupText) {
      return res.status(400).json({ error: "Lineup text is required." });
    }

    const useMock = true;
    if (useMock) {
      const mockAnalysis = "Based on your England XI selection, you exhibit a strategic mindset with a preference for balanced gameplay. Your choices suggest you're a team player who values both defensive stability and creative attacking options. You likely approach challenges methodically but aren't afraid to take calculated risks.";
      return res.json({ analysis: mockAnalysis });
    }

    const prompt = buildPersonalityTestPrompt(lineupText);
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.choices[0].message.content;
    res.json({ analysis: text });
  } catch (error) {
    console.error("Error in personality test:", error);
    res.status(500).json({ error: "Failed to perform personality test." });
  }
});

// Endpoint for Team Insight
app.post("/team-insight", rateLimiter, async (req, res) => {
  try {
    const { lineupText } = req.body;
    if (!lineupText) {
      return res.status(400).json({ error: "Lineup text is required." });
    }

    const useMock = true; // For now, we use a mock response
    if (useMock) {
      const mockInsight = "This team boasts impressive pace on the wings and solid power in defense. Playmaking seems centered in the midfield, with a key player likely being the central midfielder who can dictate tempo. Overall, a balanced squad, but could be vulnerable to quick counter-attacks if the midfield press is broken.";
      return res.json({ insight: mockInsight });
    }

    // This part would be used with a real API call
    const prompt = buildTeamInsightPrompt(lineupText);
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.choices[0].message.content;
    res.json({ insight: text });

  } catch (error) {
    console.error("Error in team insight:", error);
    res.status(500).json({ error: "Failed to perform team insight." });
  }
});


// Endpoint for Daily Challenge
app.post("/daily-challenge", async (req, res) => {
  try {
    const { lineupText } = req.body;
    if (!lineupText) {
      return res.status(400).json({ error: "Lineup text is required." });
    }

    const useMock = true;
    if (useMock) {
      const mockChallengeResult = "Congratulations! You've completed today's challenge with your selected XI. Your team shows great potential for teamwork and strategy. Keep up the good work!";
      return res.json({ challengeResult: mockChallengeResult });
    }

    res.status(501).json({ error: "Daily challenge not implemented yet." });
  } catch (error) {
    console.error("Error in daily challenge:", error);
    res.status(500).json({ error: "Failed to process daily challenge." });
  }
});

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
