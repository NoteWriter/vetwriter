import express from 'express';
import fetch from 'node-fetch';
import { FormData } from 'formdata-node';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import fs from 'fs/promises';
import pgPromise from 'pg-promise';
import path from 'path';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import cookieParser from 'cookie-parser';
import workQueue from './queue.mjs';
import AWS from 'aws-sdk';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_KEY = process.env.OPENAI_API_KEY;
const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || 'http://localhost';

const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(cookieParser());
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

// Session middleware
app.use(async (req, res, next) => {
  const sessionToken = req.cookies.sessionToken;

  if (!sessionToken) {
    // No session token in cookie - user is not logged in
    req.user = null;
  } else {
    try {
      const user = await db.one('SELECT * FROM users WHERE session_token = $1', [sessionToken]);
      req.user = user;
    } catch (error) {
      console.error('Error:', error);
      req.user = null;
    }
  }

  next();
});

async function uploadFileToS3(fileBuffer, fileName) {
  const params = {
    Bucket: process.env.BUCKETEER_BUCKET_NAME,
    Key: fileName,
    Body: fileBuffer
  };

  return new Promise((resolve, reject) => {
    s3.upload(params, function(err, data) {
      if (err) {
        console.error(err); // this line will print more details about the error
        reject(err);
      } else {
        resolve(data.Location);
      }
    });
  });
}


AWS.config.update({
  region: BUCKETEER_AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  };
});

const s3 = new AWS.S3();

app.post('/whisper/asr', upload.single('audio'), async (req, res) => {
  const patientName = req.query.patientName; // Extract patient name from query parameters
  const audioBuffer = Buffer.from(req.file.buffer);

  // Save the converted audio file to disk
  const fileName = `output_${uuidv4()}.webm`;
  const audioFileUrl = await uploadFileToS3(audioBuffer, fileName);

  const job = await workQueue.add({
    userId: req.user.id,
    patientName: patientName,
    model: 'whisper-1',
    audioFileUrl: audioFileUrl,
    audioType: 'audio/webm'
  });

  res.json({ jobId: job.id });
  console.log('Job created:', job);
});


const startWorker = (id) => {

  console.log(`Started worker ${id}`);
};

app.post('/chatgpt', async (req, res) => {
  try {
    const userMessage = req.body.message;

    const requestBody = {
      model: 'gpt-3.5-turbo-16k',
      messages: [
        {
          role: 'system',
          content: 'You are an amazing veterinary scribe. You receive the transcriptions of conversations between veterinary doctors and the owners of their patients, you pull out only the relevant medical information, and you put it all into a complete SOAP note following this outline: SUMMARY Reason for visit (include details about complaint like when it started, how long it has been happening, what they have tried, etc.) VITALS Age: Sex: Weight: Temperature:  Heart Rate:  Body Condition: SUBJECTIVE (the information that the patients owner provides): Chief Complaint: Other Symptoms: Diet: Indoor/Outdoor: Current Medications: OBJECTIVE (write this for normal exams, but replace anything that is abnormal): Pt is BAR, MM are pink and moist with CRT < 2 seconds. EENT are clean and clear. Heart and lungs auscultate with no murmurs, crackles or wheezes. Abdomen is soft and non-painful on palpation. Femoral pulses are SSS. Peripheral LN are soft, round and non-painful.).ASSESSMENT (Include concise details about what was done (eg. exam performed, tests administered). Include any discussion from the transcript about what the veterinarian thinks the diagnosis might be and why they think it):PLAN: (Any additional tests, surgeries, estimates, medicaitons, follow-up, etc. that need to be done). You only use information contained in the transcript, leaving blank anything that is not in the transcript. Always include the section headers SUMMARY, VITALS, SUBJECTIVE, OBJECTIVE, ASSESMENT, PLAN, but only include the others smaller titles if there is information about them from the transcript. You write very concise, carefully worded notes that contain all of the medically relevant information from the transcript. Please write a very concise SOAP note for the following transcript. Summarize the details as much as possible while still including all medically relevant information. Avoid full sentences when possible and aim to present information in the most compact form, for example, instead of writing "The doctor recommended a diet change" just write "Recommended a diet change"',
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
      await db.none('UPDATE vetwriter SET reply = $1, content = $2 WHERE transcription = $3 AND user_id = $4', [message, requestBody.messages[0].content, userMessage, req.user.id]);
      res.json({ reply: message });
    } catch (error) {
      throw new Error('Error updating the database');
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

const initializeDatabase = async () => {
  try {
    await db.none(`
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT,
      session_token TEXT UNIQUE
      )
    `);
    await db.none(`
    CREATE TABLE IF NOT EXISTS vetwriter(
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      patient_name TEXT,
      transcription TEXT,
      reply TEXT,
      content TEXT,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Tables created successfully");
  } catch (error) {
    console.error("Error creating tables:", error);
  }
};

initializeDatabase();

// This will serve the index.html if user is logged in else, returns 'Not authorized'
app.get('/home', (req, res) => {
  if (!req.user) {
    res.status(401).json({ message: 'Not authorized' });
  } else {
    res.sendFile('index.html', { root: __dirname + '/public/' });
  }
});

// This is your new home page
app.get('/', (req, res) => {
  res.sendFile('login.html', { root: __dirname + '/public/' });
});

app.use(express.static('public')); // This line sets up static file serving

// This will serve the register.html if a user wants to register
app.get('/register', (req, res) => {
  res.sendFile('register.html', { root: __dirname + '/public/' });
});

app.get('/past-notes', async (req, res) => {
  try {
    const notes = await db.any('SELECT * FROM vetwriter WHERE user_id = $1 ORDER BY timestamp DESC', [req.user.id]);

    res.render('past-notes', { notes: notes.map(note => ({
        id: note.id,
        patient_name: note.patient_name || "Blank",
        timestamp: new Date(note.timestamp).toLocaleString(),
        reply: note.reply
      })
    )});
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error while fetching past notes.' });
  }
});

app.get('/note', async (req, res) => {
  const noteId = req.query.id;

  try {
    const note = await db.one('SELECT * FROM vetwriter WHERE id = $1', [noteId]);
    res.render('note', { 
      note: {
        id: note.id,
        patient_name: note.patient_name || "Blank",
        timestamp: new Date(note.timestamp).toLocaleString(),
        reply: note.reply
      }
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error while fetching the note.' });
  }
});



// Create a new route for user registration
app.post('/register', async (req, res) => {
  let { username, password } = req.body;
  username = username.toLowerCase();  
  const saltRounds = 15;
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  try {
    const existingUser = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [username]);
    if (existingUser) {
      res.status(409).json({ message: 'Username already exists' });
      return;
    }
    
    await db.none('INSERT INTO users(username, password) VALUES($1, $2)', [username, hashedPassword]);
    res.json({ message: 'User created successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error while creating user.' });
  }
});



// Create a new route for user login
app.post('/login', async (req, res) => {
  let { username, password } = req.body;
  username = username.toLowerCase();  

  try {
    const user = await db.one('SELECT * FROM users WHERE username = $1', [username]);

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      res.status(401).json({ message: 'Invalid username or password' });
      return;
    }

    // If password matches, we'll generate a session token
    const sessionToken = uuidv4();

    // Store the session token in the database, associated with this user
    await db.none('UPDATE users SET session_token = $1 WHERE id = $2', [sessionToken, user.id]);

    // And send it back as a cookie
    res.cookie('sessionToken', sessionToken, { maxAge: 7200000, httpOnly: true, secure: true, sameSite: 'strict' });
    res.json({ success: true, message: 'Logged in successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error while logging in.' });
  }
});

// Logout endpoint
app.post('/logout', async (req, res) => {
  try {
    const sessionToken = req.cookies.sessionToken;
    await db.none('UPDATE users SET session_token = NULL WHERE session_token = $1', [sessionToken]);
    res.clearCookie('sessionToken');
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error while logging out.' });
  }
});
