// Main site interactions: nav toggle + theme toggle
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
const themeSwitch = document.querySelector('#themeSwitch');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('open');
    const isOpen = navLinks.classList.contains('open');
    navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
}

// Theme persistence
const themeKey = 'eic-theme';
const savedTheme = localStorage.getItem(themeKey);
if (savedTheme === 'light') document.body.classList.add('light');

if (themeSwitch) {
  themeSwitch.checked = document.body.classList.contains('light');
  themeSwitch.addEventListener('change', () => {
    document.body.classList.toggle('light', themeSwitch.checked);
    localStorage.setItem(themeKey, themeSwitch.checked ? 'light' : 'dark');
  });
}

// Utility to set active nav link based on path
(function setActiveNav() {
  const pathname = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach((link) => {
    const href = link.getAttribute('href');
    if (href === pathname || (pathname === '/' && href === '/')) {
      link.classList.add('active');
    }
  });
})();

// Intercept logout forms to redirect cleanly instead of showing JSON
function wireLogout(selector) {
  document.querySelectorAll(selector).forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await fetch('/api/logout', { method: 'POST' }); } catch (err) { /* ignore */ }
      window.location.href = '/login';
    });
  });
}

// Buttons or links tagged with data-logout trigger a clean logout
wireLogout('[data-logout]');
