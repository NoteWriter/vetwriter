import express from 'express';
import fetch from 'node-fetch';
import { FormData } from 'formdata-node';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import { File } from 'formdata-node';
import fs from 'fs/promises';
import pgPromise from 'pg-promise';
import path from 'path';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_KEY = process.env.OPENAI_API_KEY;
const app = express();
app.use(express.static('public')); // This line sets up static file serving
const port = process.env.PORT || 3000;
const host = process.env.HOST || 'http://localhost';

const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const pgp = pgPromise({
  /* initialization options */
});

// Configure your connection details as an object
const connection = {
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
};

// Pass the connection configuration to pg-promise
const db = pgp(connection);

app.post('/whisper/asr', upload.single('audio'), async (req, res) => {
  const patientName = req.query.patientName; // Extract patient name from query parameters
  const audioBuffer = Buffer.from(req.file.buffer);
  const audioFile = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });
  const form = new FormData();
  form.append('file', audioFile);
  form.append('model', 'whisper-1');

  // Save the converted audio file to disk
  const outputFilePath = __dirname + '/output.webm';
  await fs.writeFile(outputFilePath, audioBuffer);

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: form,
    });

    const data = await response.json();
    console.log('Whisper API response:', JSON.stringify(data));

    const transcription = data.text; // Define the transcription variable
  
// Insert transcription into database with the current timestamp
await db.none(
  'INSERT INTO vetwriter(patient_name, transcription, timestamp) VALUES($1, $2, NOW())',
  [patientName, transcription]
);
  
    res.json({ transcription: transcription });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error while transcribing.' });
  }
});

app.post('/chatgpt', async (req, res) => {
  try {
    const userMessage = req.body.message;

    const requestBody = {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an amazing medical scribe. You take transcriptions of conversations between doctors and patients, you pull out the relevant medical information, and you put it all into a SOAP note...',
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    const message = data.choices && data.choices.length > 0 ? data.choices[0].message.content.trim() : '';

    // Update database entry with reply and content
    try {
      await db.none('UPDATE vetwriter SET reply = $1, content = $2 WHERE transcription = $3', [message, requestBody.messages[0].content, userMessage]);
      res.json({ reply: message });
    } catch (error) {
      throw new Error('Error updating the database');
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/past-notes', async (req, res) => {
  try {
    const notes = await db.any('SELECT * FROM vetwriter ORDER BY timestamp DESC');
    
    res.render('past-notes', { notes: notes.map(note => {
        return {
            id: note.id,
            patient_name: note.patient_name || "Blank",
            timestamp: new Date(note.timestamp).toLocaleString(),
        };
    })});
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error while fetching past notes.' });
  }
});


app.get('/note', async (req, res) => {
  const noteId = req.query.id;
  const note = await db.one('SELECT * FROM vetwriter WHERE id = $1', [noteId]);
  res.json(note);
});

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: __dirname + '/public/' });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

const initializeDatabase = async () => {
  try {
    await db.none(`
      CREATE TABLE IF NOT EXISTS vetwriter(
        id SERIAL PRIMARY KEY,
        patient_name TEXT,
        transcription TEXT,
        reply TEXT,
        content TEXT,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Table created successfully");
  } catch (error) {
    console.error("Error creating table:", error);
  }
};


initializeDatabase();
