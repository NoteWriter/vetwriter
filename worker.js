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
const connection = {
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
};

const db = pgp(connection);

const handleS3Operation = (action, fileName) => new Promise((resolve, reject) => {
  const params = {
    Bucket: process.env.BUCKETEER_BUCKET_NAME,
    Key: fileName
  };

  s3[action](params, function(err, data) {
    if (err) {
      reject(err);
    } else {
      resolve(action === 'getObject' ? data.Body : undefined);
    }
  });
});

const deleteFileFromS3 = fileName => handleS3Operation('deleteObject', fileName);
const downloadFileFromS3 = fileName => handleS3Operation('getObject', fileName);

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
          console.error('Whisper API request failed:', await whisperResponse.text())
          // your remaining error handling code
      }
  
      const whisperData = await whisperResponse.json();
      const transcription = whisperData.transcription;
  
      const requestBody = {
        model: 'gpt-3.5-turbo-16k',
        messages: [
          {
            role: 'system',
            content: 'You are an amazing veterinary scribe. You receive the transcriptions of conversations between veterinary doctors and the owners of their patients, you pull out only the relevant medical information, and you put it all into a complete SOAP note following this outline: SUMMARY Reason for visit (include details about complaint like when it started, how long it has been happening, what they have tried, etc.) VITALS Age: Sex: Weight: Temperature:  Heart Rate:  Body Condition: SUBJECTIVE (the information that the patients owner provides): Chief Complaint: Other Symptoms: Diet: Indoor/Outdoor: Current Medications: OBJECTIVE (write this for normal exams, but replace anything that is abnormal): Pt is BAR, MM are pink and moist with CRT < 2 seconds. EENT are clean and clear. Heart and lungs auscultate with no murmurs, crackles or wheezes. Abdomen is soft and non-painful on palpation. Femoral pulses are SSS. Peripheral LN are soft, round and non-painful.).ASSESSMENT (Include concise details about what was done (eg. exam performed, tests administered). Include any discussion from the transcript about what the veterinarian thinks the diagnosis might be and why they think it):PLAN: (Any additional tests, surgeries, estimates, medicaitons, follow-up, etc. that need to be done). You only use information contained in the transcript, leaving blank anything that is not in the transcript. Always include the section headers SUMMARY, VITALS, SUBJECTIVE, OBJECTIVE, ASSESMENT, PLAN, but only include the others smaller titles if there is information about them from the transcript. You write very concise, carefully worded notes that contain all of the medically relevant information from the transcript. Please write a very concise SOAP note for the following transcript. Summarize the details as much as possible while still including all medically relevant information. Avoid full sentences when possible and aim to present information in the most compact form, for example, instead of writing "The doctor recommended a diet change" just write "Recommended a diet change"',
          },
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
          console.error('ChatGPT API request failed:', await chatGPTResponse.text())
          // your remaining error handling code
      }
  
      const chatGPTData = await chatGPTResponse.json();
      const message = chatGPTData.choices && chatGPTData.choices.length > 0 ? chatGPTData.choices[0].message.content.trim() : '';
  
      // Create entry in vetwriter table
      try {
          await db.none('INSERT INTO vetwriter(user_id, patient_name, transcription, reply) VALUES($1, $2, $3, $4)', [userId, patientName, transcription, message]);
      } catch (error) {
          console.error('Error inserting into the database:', error);
          throw error;
      }
      try {
        await deleteFileFromS3(fileName);
      } catch (error) {
        console.error('Error:', error);
      }
    } catch (error) {
      console.error('Error in processing job:', error);
    }
});