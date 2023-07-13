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
  region: process.env.BUCKETEER_AWS_REGION,
  credentials: {
    accessKeyId: process.env.BUCKETEER_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.BUCKETEER_AWS_SECRET_ACCESS_KEY
  }
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
