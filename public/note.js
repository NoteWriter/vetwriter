async function fetchNote() {
    const urlParams = new URLSearchParams(window.location.search);
    const noteId = urlParams.get('id');
  
    try {
      const response = await fetch(`/note?id=${noteId}`);
      const data = await response.json();
  
      const noteContainer = document.getElementById('note-container');

      // create an HTML structure to present the data
      const noteHTML = `
          <h2>Patient Name: ${data.patient_name}</h2>
          <h3>Timestamp: ${new Date(data.timestamp).toLocaleString()}</h3>
          <p>Reply: ${data.reply}</p>
      `;

      noteContainer.innerHTML = noteHTML;
    } catch (error) {
      console.error('Error:', error);
    }
}

fetchNote();
