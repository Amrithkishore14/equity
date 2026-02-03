async function postData(url = '', data = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

function showAlert(el, message, type = 'success') {
  if (!el) return;
  el.textContent = message;
  el.className = `alert ${type}`;
  el.style.display = 'block';
}

// Login
const loginForm = document.querySelector('#loginForm');
if (loginForm) {
  const alertBox = document.querySelector('#loginAlert');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(loginForm));
    const data = await postData('/api/login', formData);
    if (data.success) {
      showAlert(alertBox, 'Login successful. Redirecting...', 'success');
      const redirect = localStorage.getItem('postLoginRedirect');
      const target = redirect || (data.user.role === 'admin' ? '/admin' : '/user');
      if (redirect) localStorage.removeItem('postLoginRedirect');
      setTimeout(() => (window.location.href = target), 700);
    } else {
      showAlert(alertBox, data.message || 'Login failed', 'error');
    }
  });
}

// Register
const registerForm = document.querySelector('#registerForm');
if (registerForm) {
  const alertBox = document.querySelector('#registerAlert');
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(registerForm));
    const data = await postData('/api/register', formData);
    if (data.success) {
      showAlert(alertBox, 'Account created. You can log in now.', 'success');
      registerForm.reset();
    } else {
      showAlert(alertBox, data.message || 'Registration failed', 'error');
    }
  });
}

// Forgot password (placeholder)
const forgotForm = document.querySelector('#forgotForm');
if (forgotForm) {
  const alertBox = document.querySelector('#forgotAlert');
  forgotForm.addEventListener('submit', (e) => {
    e.preventDefault();
    showAlert(alertBox, 'Password reset feature is handled by admin. Contact support.', 'success');
  });
}
