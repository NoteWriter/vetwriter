async function fetchPastNotes() {
    try {
      const response = await fetch('/past-notes');
      const data = await response.json();
  
      const notesContainer = document.getElementById('notes-container');
      notesContainer.innerHTML = '';
  
      data.forEach((note) => {
        const noteElement = document.createElement('a');
        noteElement.textContent = `${note.patient_name} - ${note.timestamp}`;
        noteElement.href = `/note?id=${note.id}`;
        notesContainer.appendChild(noteElement);

        // Add a line break for better readability
        const breakElement = document.createElement('br');
        notesContainer.appendChild(breakElement);
      });
    } catch (error) {
      console.error('Error:', error);
    }
}
