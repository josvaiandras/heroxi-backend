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

Rate the team objectively from -3 to 10 (negatives allowed). Start with the rating, then briefly analyze player fit, tactical fit, strengths, weaknesses, and key tactical observations. Use an analytical tone, and add a light football joke or witty comment if it fits naturally. Limit to about 150 words.
  `.trim();
}

// 🏟️ Match Simulation Prompt Builder
function buildMatchSimulationPrompt(teamA, teamB, formationA, formationB, lineupA, lineupB) {
  return `
Simulate a football match between Team A (Formation: ${formationA}, Lineup: ${lineupA}) and Team B (Formation: ${formationB}, Lineup: ${lineupB}).

Generate a brief match summary in 3 paragraphs:
1. Brief pre-match analysis of strengths/weaknesses.
2. Minute-by-minute highlights with goal scorers and key events.
3. Final score, winner, and a witty football remark.

Keep it under 200 words. Return plain text only.
  `.trim();
}

// 👤 Personality Test Prompt Builder
function buildPersonalityTestPrompt(lineupText) {
  return `
Analyze the personality traits of a football manager who would select the following XI and formation:
${lineupText}

Provide a fun, insightful summary of their managerial style, strengths, and quirks. Keep it under 150 words.
  `.trim();
}

// Endpoint for Team Rating
app.post("/rate-my-xi", async (req, res) => {
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

// Endpoint for Match Simulation
app.post("/simulate-match", async (req, res) => {
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
app.post("/personality-test", async (req, res) => {
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