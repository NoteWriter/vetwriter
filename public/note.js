async function fetchNote() {
    const urlParams = new URLSearchParams(window.location.search);
    const noteId = urlParams.get('id');
  
    try {
      const response = await fetch(`/note?id=${noteId}`);
      const data = await response.json();
  
      const noteContainer = document.getElementById('note-container');
      noteContainer.textContent = data.transcription;
    } catch (error) {
      console.error('Error:', error);
    }
}
fetchNote();
