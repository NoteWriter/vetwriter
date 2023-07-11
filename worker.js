import fetch from 'node-fetch';
import pgPromise from 'pg-promise';
import { File } from 'formdata-node';
import fs from 'fs/promises';
import workQueue from './queue.mjs';

const fetch = require('node-fetch');
const pgPromise = require('pg-promise');
const workQueue = require('./queue.mjs');

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

// The processing function
workQueue.process(async (job) => {
    const { userId, patientName, model, audioFilePath, audioType } = job.data;
    
    try {
      const audioBuffer = await fs.readFile(audioFilePath);
      const audioFile = new File([audioBuffer], 'audio.webm', { type: audioType });
      const form = new FormData();
      form.append('file', audioFile);
      form.append('model', model);
  
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
        'INSERT INTO vetwriter(user_id, patient_name, transcription, timestamp) VALUES($1, $2, $3, NOW())',
        [userId, patientName, transcription]
      );
    } catch (error) {
      console.error('Error:', error);
    }
  });

