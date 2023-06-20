async function fetchPastNotes() {
    try {
      const response = await fetch('/past-notes');
      const data = await response.json();
  
      const notesContainer = document.getElementById('notes-container');
      notesContainer.innerHTML = '';
  
      data.forEach((note) => {
        const noteElement = document.createElement('a');
        noteElement.textContent = `${note.patient_name} - ${new Date(note.timestamp).toLocaleString()}`;
        noteElement.href = `/note.html?id=${note.id}`;
        notesContainer.appendChild(noteElement);
      });
    } catch (error) {
      console.error('Error:', error);
    }
  }
  
  fetchPastNotes();
  