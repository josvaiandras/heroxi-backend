require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

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
  `;
}

app.post("/rate-xi", async (req, res) => {
  const lineupText = req.body.lineupText;

  // MOCK mode: set to true to use fake response for testing
  const useMock = true;

  if (useMock) {
    // Return a fake AI rating response for testing frontend/backend integration
    return res.json({
      rating: 7.5,
      analysis: "Solid team with good tactical fit. Strengths in midfield control and wing play. Defense could be more aggressive. Key player synergy noted. Keep an eye on stamina levels. Overall, a strong lineup! ⚽️",
      joke: "Why did the striker bring string to the match? To tie the score!",
    });
  }

  // If not mocking, here you would call the OpenAI API (real logic)
  try {
    const prompt = buildPrompt(lineupText);
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    // parse and send back the AI response
    const text = completion.choices[0].message.content;
    res.json({ result: text });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "OpenAI API error" });
  }
});

// New endpoint to save match data to Firestore
app.post('/save-match', async (req, res) => {
  try {
    const { matchId, teamA, teamB, formationA, formationB } = req.body;

    if (!matchId || !teamA || !teamB || !formationA || !formationB) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await db.collection('matches').doc(matchId).set({
      teamA,
      teamB,
      formationA,
      formationB,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ message: 'Match saved successfully' });
  } catch (error) {
    console.error('Error saving match:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// New GET endpoint to fetch match data by ID
app.get('/get-match/:matchId', async (req, res) => {
  const matchId = req.params.matchId;

  try {
    const matchDoc = await db.collection('matches').doc(matchId).get();

    if (!matchDoc.exists) {
      return res.status(404).json({ error: 'Match not found' });
    }

    res.json(matchDoc.data());
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch match' });
  }
});


// ⚽ Simulate match using both teams from Firestore and return commentary + score
app.post("/simulate-match", async (req, res) => {
  try {
    const { matchId } = req.body;
    if (!matchId) return res.status(400).json({ error: "matchId required" });

    const matchDoc = await db.collection("matches").doc(matchId).get();
    if (!matchDoc.exists) return res.status(404).json({ error: "Match not found" });

    const matchData = matchDoc.data();
    const { teamA, teamB, formationA, formationB } = matchData;

    if (!teamA || !teamB || !formationA || !formationB) {
      return res.status(400).json({ error: "Match is incomplete — both teams and formations are required." });
    }

    const prompt = `
Two user-created football teams are about to play a simulated match.

Team A (${formationA}): ${teamA.join(", ")}
Team B (${formationB}): ${teamB.join(", ")}

Simulate a realistic match between these two teams in 3 paragraphs:
1. Brief pre-match analysis of strengths/weaknesses.
2. Minute-by-minute highlights with goal scorers and key events.
3. Final score, winner, and a witty football remark.

Keep it under 200 words. Return plain text only.
    `.trim();

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
    res.status(500).json({ error: "Failed to simulate match" });
  }
});



// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
