let API_KEY;

const transcriptionElement = document.getElementById('transcription');
const outputTextArea = document.getElementById('output-text');

const recordButton = document.getElementById('recordButton');
const pauseButton = document.getElementById('pauseButton');
const patientNameElement = document.getElementById('patient-name'); // New line to get the patient name element

let recordRTC;
let patientName; // New line to declare the patient name variable

pauseButton.style.display = 'none'; 

const startRecording = async () => {
    try {
        patientName = patientNameElement.value; // New line to get patient name
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        const options = {
            type: 'audio',
            mimeType: 'audio/webm',
            numberOfAudioChannels: 1,
            recorderType: RecordRTC.StereoAudioRecorder,
            checkForInactiveTracks: true,
            desiredSampRate: 11025, // 
            bitRate: 64 // 
        };

        

        recordRTC = new RecordRTC(stream, options);
        recordRTC.startRecording();
        pauseButton.style.display = 'inline-block'; // Show the Pause button

        recordButton.textContent = 'Stop';
        recordButton.style.backgroundColor = '#FBD5D6';
        recordButton.style.color = '#102F3F';
    } catch (err) {
        console.error('Error:', err);
    }
};

const pauseRecording = () => {
    if (recordRTC && recordRTC.getState() === 'recording') {
        recordRTC.pauseRecording();
        pauseButton.textContent = 'Continue';
    }
    pauseButton.textContent = 'Continue';
    recordButton.style.display = 'none'; // Hide the Record button
};

const resumeRecording = () => {
    if (recordRTC && recordRTC.getState() === 'paused') {
        recordRTC.resumeRecording();
        pauseButton.textContent = 'Pause';
    }
    pauseButton.textContent = 'Pause';
    recordButton.style.display = 'inline-block';
};

pauseButton.addEventListener('click', () => {
    if (recordRTC && recordRTC.getState() === 'recording') {
        pauseRecording();
    } else if (recordRTC && recordRTC.getState() === 'paused') {
        resumeRecording();
    }
});


const stopRecording = () => {
    if (recordRTC) {
        recordRTC.stopRecording(() => {
            const audioBlob = recordRTC.getBlob();
            const fileSize = (audioBlob.size / 1024 / 1024).toFixed(2); // size in MB
            console.log(`File size: ${fileSize} MB`);
            sendToWhisperAPI(audioBlob);
            pauseButton.style.display = 'none'; // Hide the Pause button
        });

        recordButton.textContent = 'Start';
        recordButton.style.backgroundColor = '#BBE2EC';
    }
};

const sendToWhisperAPI = async (audioBlob) => {
  const SERVER_URL = `/whisper/asr?patientName=${encodeURIComponent(patientName)}`;

  const formData = new FormData();
  formData.append('audio', audioBlob, 'audio.webm');

  try {
    const response = await fetch(SERVER_URL, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    console.log('Server response:', JSON.stringify(response));

    if (data.transcription) {
      transcriptionElement.textContent = `Transcription: ${data.transcription}`;
      sendToChatGPT(data.transcription);
    } else {
      transcriptionElement.textContent = 'Transcription not available.';
    }

    patientNameElement.value = '';

  } catch (error) {
    console.error('Error:', error);
    transcriptionElement.textContent = 'Error while transcribing.';
  }
};

const sendToChatGPT = async (transcription) => {
  const SERVER_URL = '/chatgpt';

  try {
    const response = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: transcription }),
    });

    const data = await response.json();
    console.log('Server response:', JSON.stringify(response));

    if (data.reply) {
      outputTextArea.value = `Reply: ${data.reply}`;
    } else {
      outputTextArea.value = 'Reply not available.';
    }
  } catch (error) {
    console.error('Error:', error);
    outputTextArea.value = 'Error while getting reply.';
  }
};


recordButton.addEventListener('click', () => {
  if (recordRTC && recordRTC.getState() === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
});

const downloadButton = document.getElementById('downloadButton');

const downloadTextFile = () => {
  const text = document.getElementById('output-text').value;
  const filename = 'output.txt';
  const element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
};

downloadButton.addEventListener('click', downloadTextFile);

const copyButton = document.getElementById('copyButton');

copyButton.addEventListener('click', function() {
    outputTextArea.select();
    document.execCommand("copy");
});
