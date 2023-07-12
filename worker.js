import fetch from 'node-fetch';
import pgPromise from 'pg-promise';
import { File } from 'formdata-node';
import fs from 'fs/promises';
import path from 'path';
import workQueue from './queue.mjs';
import AWS from 'aws-sdk';

const API_KEY = process.env.OPENAI_API_KEY;

const pgp = pgPromise({
  /* initialization options */
});

AWS.config.update({
    region: process.env.BUCKETEER_AWS_REGION,
    credentials: {
      accessKeyId: process.env.BUCKETEER_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.BUCKETEER_AWS_SECRET_ACCESS_KEY
    }
  });
  
  const s3 = new AWS.S3();

async function downloadFileFromS3(fileName) {
    const params = {
      Bucket: process.env.BUCKETEER_BUCKET_NAME,
      Key: fileName
    };
  
    return new Promise((resolve, reject) => {
      s3.getObject(params, function(err, data) {
        if (err) {
          reject(err);
        } else {
          resolve(data.Body);
        }
      });
    });
}

async function deleteFileFromS3(fileName) {
    const params = {
      Bucket: process.env.BUCKETEER_BUCKET_NAME,
      Key: fileName
    };
  
    return new Promise((resolve, reject) => {
      s3.deleteObject(params, function(err, data) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
}

const connection = {
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
};

const db = pgp(connection);

workQueue.process(async (job) => {
    const { userId, patientName, model, audioFileUrl, audioType } = job.data;
    const fileName = path.basename(audioFileUrl);
    const audioBuffer = await downloadFileFromS3(fileName);
  
    try {
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
  
      const transcription = whisperData.text; // Extract the transcription
  
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
  
      const completion = chatGPTData.choices && chatGPTData.choices.length > 0 ? chatGPTData.choices[0].message.content.trim() : '';
  
      await db.none('INSERT INTO vetwriter(user_id, patient_name, transcription, reply) VALUES($1, $2, $3, $4)', [userId, patientName, transcription, completion]);
  
      await deleteFileFromS3(fileName);
    } catch (error) {
      console.error('Error processing job:', job);
      console.error('Error:', error);
    }
});
