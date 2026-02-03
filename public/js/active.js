// Live active user counter for homepage/admin
async function pollActiveUsers() {
  try {
    const res = await fetch('/api/active-users');
    const data = await res.json();
    const homepageCounter = document.querySelector('#activeUsersText');
    const adminCounter = document.querySelector('#liveActiveUsers');
    if (homepageCounter) homepageCounter.textContent = `👥 ${data.count} people currently learning · Covering 2,000+ NSE & BSE listed companies (educational analysis only).`;
    if (adminCounter) adminCounter.textContent = data.count;
  } catch (e) {
    // fail silently to avoid UX noise
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  pollActiveUsers();
} else {
  document.addEventListener('DOMContentLoaded', pollActiveUsers);
}
setInterval(pollActiveUsers, 10_000);
