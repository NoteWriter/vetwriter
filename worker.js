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
    
    let audioBuffer;
    try {
        audioBuffer = await downloadFileFromS3(fileName);
    } catch (error) {
        console.error('Error downloading file from S3:', fileName, error);
        throw error;
    }

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
    
        if (!whisperResponse.ok) {
            console.error('Whisper API request failed:', await whisperResponse.text());
            throw new Error('Whisper API request failed');
        }

        const whisperData = await whisperResponse.json();
    
        const transcription = whisperData.text;
    
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

        if (!chatGPTResponse.ok) {
            console.error('GPT API request failed:', await chatGPTResponse.text());
            throw new Error('GPT API request failed');
        }
    
        const chatGPTData = await chatGPTResponse.json();
    
        const completion = chatGPTData.choices && chatGPTData.choices.length > 0 ? chatGPTData.choices[0].message.content.trim() : '';
    
        try {
            await db.none('INSERT INTO vetwriter(user_id, patient_name, transcription, reply) VALUES($1, $2, $3, $4)', [userId, patientName, transcription, completion]);
        } catch (error) {
            console.error('Database insertion failed:', error);
            throw error;
        }
    
        await deleteFileFromS3(fileName);
    } catch (error) {
        console.error('Error processing job:', job);
        console.error('Error:', error);
        // You might want to consider re-throwing the error after logging.
        // This would cause the job to fail and could be retried if your queue supports it.
        // throw error;
    }
});

