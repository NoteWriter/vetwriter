import fetch from 'node-fetch';
import pgPromise from 'pg-promise';
import { File } from 'formdata-node';
import fs from 'fs/promises';
import workQueue from './queue.mjs';

const API_KEY = process.env.OPENAI_API_KEY;

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
  
      const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: form,
      });
  
      const whisperData = await whisperResponse.json();
      console.log('Whisper API response:', JSON.stringify(whisperData));
  
      const transcription = whisperData.text; // Extract the transcription
  
      // Send the response from Whisper to ChatGPT
      const requestBody = {
        model: 'gpt-3.5-turbo-16k',
        messages: [
          {
            role: 'user',
            content: transcription,
          },
        ],
      };
  
      const chatGPTResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
  
      const chatGPTData = await chatGPTResponse.json();
      console.log('ChatGPT API response:', JSON.stringify(chatGPTData));
  
      // Extract the completion
      const completion = chatGPTData.choices && chatGPTData.choices.length > 0 ? chatGPTData.choices[0].message.content.trim() : '';
  
      // Save the completion in the database
      await db.none('INSERT INTO vetwriter(user_id, patient_name, transcription, reply) VALUES($1, $2, $3, $4)', [userId, patientName, transcription, completion]);
  
      console.log('Job completed:', job);
    } catch (error) {
      console.error('Error processing job:', job);
      console.error('Error:', error);
    }
  });
  