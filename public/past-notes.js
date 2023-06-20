async function fetchPastNotes() {
    try {
      const response = await fetch('/past-notes');
      const data = await response.json();
  
      const notesContainer = document.getElementById('notes-container');
      notesContainer.innerHTML = '';
  
      const ulElement = document.createElement('ul');  // Create a new 'ul' element

      data.forEach((note) => {
        const liElement = document.createElement('li'); // Create a new 'li' element
        const noteElement = document.createElement('a');
        noteElement.textContent = `${note.patient_name} - ${note.timestamp}`;
        noteElement.href = `/note?id=${note.id}`;
        liElement.appendChild(noteElement); // Append 'a' element into 'li' element
        ulElement.appendChild(liElement); // Append 'li' element into 'ul' element

        // Add a line break for better readability
        const breakElement = document.createElement('br');
        ulElement.appendChild(breakElement);  // Append 'br' element into 'ul' element
      });

      notesContainer.appendChild(ulElement);  // Append 'ul' element into 'notes-container' div
    } catch (error) {
      console.error('Error:', error);
    }
}
fetchPastNotes();