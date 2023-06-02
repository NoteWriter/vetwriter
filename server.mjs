import express from 'express';
import fetch from 'node-fetch';
import { FormData } from 'formdata-node';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import { File } from 'formdata-node';
import fs from 'fs/promises';
import pgPromise from 'pg-promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_KEY = process.env.OPENAI_API_KEY;
const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || 'http://localhost';

const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());

const pgp = pgPromise();
const config = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
};
const db = pgp(config);

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
  
  // Insert transcription into database
  const transcription = data.text;
  await db.none(
    'INSERT INTO transcriptions(patient_name, transcription) VALUES($1, $2)',
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

    // Update database entry with reply
    const updateResult = await db.none('UPDATE transcriptions SET reply = $1 WHERE transcription = $2', [message, userMessage]);

    if (updateResult) {
      res.json({ reply: message });
    } else {
      throw new Error('Error updating the database');
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: __dirname + '/public/' });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

const initializeDatabase = async () => {
  try {
    await db.none(`
      CREATE TABLE IF NOT EXISTS transcriptions(
        id SERIAL PRIMARY KEY,
        patient_name TEXT,
        transcription TEXT,
        reply TEXT
      )
    `);
    console.log("Table created successfully");
  } catch (error) {
    console.error("Error creating table:", error);
  }
};


initializeDatabase();
