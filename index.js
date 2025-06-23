require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const admin = require('firebase-admin');

// Parse the service account JSON from the environment variable
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// IMPORTANT: Replace literal '\n' with actual newline characters in the private_key
// This fixes the PEM formatting error
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // optional: specify your database URL here if needed
  // databaseURL: "https://your-project-id.firebaseio.com"
});

const db = admin.firestore();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('Hello from HeroXI backend!');
});

// Set up OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🧠 Rating prompt builder
function buildPrompt(lineupText) {
  return `
I've got this football XI with formation and roles:
${lineupText}

Rate the team objectively from -3 to 10 (negatives allowed). Start with the rating, then briefly analyze player fit, tactical fit, strengths, weaknesses, and key tactical observations. Use an analytical tone, and add a light football joke or witty comment if it fits naturally. Limit to about 150 words.
  `.trim();
}

// NEW: Match Simulation Prompt Builder
function buildMatchSimulationPrompt(teamAName, teamBName, formationA, formationB, lineupA, lineupB) {
  return `
Simulate a football match between Team ${teamAName} (Formation: ${formationA}, Lineup: ${lineupA}) and Team ${teamBName} (Formation: ${formationB}, Lineup: ${lineupB}).

Generate a brief match summary in 3 paragraphs:
1. Brief pre-match analysis of strengths/weaknesses.
2. Minute-by-minute highlights with goal scorers and key events.
3. Final score, winner, and a witty football remark.

Keep it under 200 words. Return plain text only.
    `.trim();
}

// 👤 Personality Test Prompt Builder (Placeholder for demonstration)
function buildPersonalityTestPrompt(lineupText) {
  return `
Analyze the personality traits of a football manager who would select the following XI and formation:
${lineupText}

Provide a fun, insightful summary of their managerial style, strengths, and quirks. Keep it under 150 words.
  `.trim();
}


// Endpoint for team rating
app.post("/rate-my-xi", async (req, res) => {
  try {
    const { lineupText } = req.body;
    if (!lineupText) {
      return res.status(400).json({ error: "Lineup text is required." });
    }

    const prompt = buildPrompt(lineupText);

    const useMock = true; // ✅ Set to false when ready for OpenAI call

    if (useMock) {
      return res.json({
        rating: 8.5,
        analysis: "This mock analysis suggests a strong team with good tactical fit, but perhaps a slight weakness in aerial duels. Still, a solid 8.5! They're almost as good as my imaginary team that always wins. Almost. 😉",
      });
    }

    // 🔥 Real OpenAI call
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.choices[0].message.content;
    const ratingMatch = text.match(/^(-?\d+(\.\d+)?)/); // Extract rating from start of string
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
    const analysis = ratingMatch ? text.substring(ratingMatch[0].length).trim() : text.trim();

    res.json({ rating, analysis });
  } catch (error) {
    console.error("Error rating team:", error);
    res.status(500).json({ error: "Failed to rate team." });
  }
});


// NEW: Endpoint to store team data
app.post('/save-team', async (req, res) => {
  try {
    const { teamName, formation, lineup, userId } = req.body;
    if (!teamName || !formation || !lineup || !userId) {
      return res.status(400).json({ error: 'Team name, formation, lineup, and userId are required.' });
    }

    const teamRef = db.collection('teams').doc(userId); // Use userId as document ID
    await setDoc(teamRef, {
      teamName,
      formation,
      lineup,
      createdAt: serverTimestamp(),
    }, { merge: true }); // Use merge to update if doc exists

    res.status(200).json({ message: 'Team saved successfully!' });
  } catch (error) {
    console.error('Error saving team:', error);
    res.status(500).json({ error: 'Failed to save team.' });
  }
});

// NEW: Endpoint to get a user's saved team
app.get('/get-team/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const teamRef = db.collection('teams').doc(userId);
    const docSnap = await getDoc(teamRef);

    if (docSnap.exists()) {
      res.status(200).json(docSnap.data());
    } else {
      res.status(404).json({ error: 'Team not found for this user.' });
    }
  } catch (error) {
    console.error('Error getting team:', error);
    res.status(500).json({ error: 'Failed to retrieve team.' });
  }
});

// NEW: Anonymous Authentication Endpoint
app.post('/auth/anonymous', async (req, res) => {
  try {
    // Generate a custom token (this is a simplified example, in a real app you might have more logic)
    const uid = `anon-${Date.now()}`; // Simple unique ID
    const customToken = await admin.auth().createCustomToken(uid);
    res.status(200).json({ customToken });
  } catch (error) {
    console.error('Error creating custom token:', error);
    res.status(500).json({ error: 'Failed to authenticate anonymously.' });
  }
});

// NEW: Endpoint for Match Simulation
app.post("/simulate-match", async (req, res) => {
  try {
    const { teamA, teamB, formationA, formationB, lineupA, lineupB } = req.body;

    if (!teamA || !teamB || !formationA || !formationB || !lineupA || !lineupB) {
      return res.status(400).json({ error: "All match details (team names, formations, lineups) are required." });
    }

    const prompt = buildMatchSimulationPrompt(teamA, teamB, formationA, formationB, lineupA, lineupB);

    const useMock = true; // ✅ Set to false when ready for OpenAI call

    if (useMock) {
      return res.json({
        result: `Team A dominated the wings early with a fluid 4-3-3, while Team B’s compact 3-4-3 focused on central overloads. Pre-match odds favored Team A.

In the 12th minute, Player1 curled in a beauty from the edge of the box. Player4 equalized with a header before halftime. The second half saw missed chances and a late winner from Player3 in the 87th minute after a quick counterattack.

Final score: Team A 2 - 1 Team B. A tight contest, but in the end, it was all about who wanted it more. Someone check Player3’s boots — they might be magnetic. 🧲⚽️`,
      });
    }

    // 🔥 Real OpenAI call
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

// NEW: Endpoint for Personality Test
app.post("/personality-test", async (req, res) => {
  try {
    const { lineupText } = req.body;
    if (!lineupText) {
      return res.status(400).json({ error: "Lineup text is required." });
    }

    const prompt = buildPersonalityTestPrompt(lineupText);

    const useMock = true; // ✅ Set to false when ready for OpenAI call

    if (useMock) {
      return res.json({
        result: "Your managerial style is bold and adventurous, unafraid to experiment with unconventional player roles. You value flair and creativity, but sometimes at the expense of defensive solidity. Your quirk? You probably name your tactics after obscure 80s rock bands. Keep on rocking, manager! 🎸⚽",
      });
    }

    // 🔥 Real OpenAI call
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.choices[0].message.content;
    res.json({ result: text });
  } catch (error) {
    console.error("Error running personality test:", error);
    res.status(500).json({ error: "Failed to run personality test." });
  }
});


app.listen(port, () => {
  console.log(`HeroXI backend listening at http://localhost:${port}`);
});