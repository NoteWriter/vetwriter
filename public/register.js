document.getElementById('registerForm').addEventListener('submit', async function(e) {
    e.preventDefault();
  
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
  
    const response = await fetch('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });
  
    const data = await response.json();
  
    if (response.status === 200) {
      alert('Registration successful');
      window.location.href = '/';
    } else {
      alert('Error: ' + data.message);
    }
  });
  