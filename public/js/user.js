async function getMe() {
  const res = await fetch('/api/me');
  return res.ok ? res.json() : null;
}

const profileName = document.querySelector('#profileName');
const profileEmail = document.querySelector('#profileEmail');
const profileRole = document.querySelector('#profileRole');
const profileStatus = document.querySelector('#profileStatus');
const userAlert = document.querySelector('#userAlert');
const streakCurrentEl = document.querySelector('#streakCurrent');
const streakLongestEl = document.querySelector('#streakLongest');

function alertUser(msg, type = 'success') {
  if (!userAlert) return;
  userAlert.textContent = msg;
  userAlert.className = `alert ${type}`;
  userAlert.style.display = 'block';
}

async function populateProfile() {
  const data = await getMe();
  if (!data || !data.user) return;
  const { user } = data;
  if (profileName) profileName.textContent = user.name;
  if (profileEmail) profileEmail.textContent = user.email;
  if (profileRole) profileRole.textContent = user.role;
  if (profileStatus) profileStatus.textContent = user.status || 'active';
  if (user.streak && streakCurrentEl && streakLongestEl) {
    streakCurrentEl.textContent = user.streak.current;
    streakLongestEl.textContent = user.streak.longest;
  }
}

const passwordForm = document.querySelector('#passwordForm');
if (passwordForm) {
  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(passwordForm));
    const res = await fetch('/api/user/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    const data = await res.json();
    if (data.success) {
      alertUser('Password updated');
      passwordForm.reset();
    } else {
      alertUser(data.message || 'Update failed', 'error');
    }
  });
}

const logoutBtn = document.querySelector('#logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });
}

populateProfile();
