// Subscription request page logic
(function () {
  const heading = document.querySelector('#planHeading');
  const details = document.querySelector('#planDetails');
  const btn = document.querySelector('#requestAccessBtn');
  const alertBox = document.querySelector('#requestAlert');

  function getParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }

  const plan = getParam('plan') || localStorage.getItem('pendingPlan') || 'Starter';
  localStorage.removeItem('pendingPlan');

  const planBenefits = {
    Starter: ['Educational reports', 'Weekly learning digest', 'Email onboarding support'],
    Pro: ['All Starter benefits', 'Priority Q&A', 'Extended archives', 'Moderated comments access'],
    Institution: ['Team access', 'Admin controls', 'Moderated comments', 'Group onboarding'],
  };

  function renderPlan() {
    if (heading) heading.textContent = `${plan} plan`;
    if (details) {
      const list = planBenefits[plan] || planBenefits.Starter;
      details.innerHTML = `<p><strong>${plan}</strong> includes:</p><ul class="list">${list.map((i) => `<li>${i}</li>`).join('')}</ul>
        <p class="small muted">Payments are handled via our onboarding team.</p>
        <p class="small">Prefer UPI? Pay to <strong>amrithcricket@oksbi</strong> on GPay/UPI and email proof to <a href="mailto:hello@equityinvestorclub.com">hello@equityinvestorclub.com</a>.</p>`;
    }
  }

  async function submitRequest() {
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    try {
      const res = await fetch('/api/subscription-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (data.success) {
        showAlert('Your request has been submitted. Our team will contact you shortly.', 'success');
        btn.disabled = true;
      } else {
        showAlert(data.message || 'Could not submit request.', 'error');
        btn.disabled = false;
        btn.textContent = 'Request Access';
      }
    } catch (e) {
      showAlert('Network error. Please try again.', 'error');
      btn.disabled = false;
      btn.textContent = 'Request Access';
    }
  }

  function showAlert(msg, type = 'success') {
    if (!alertBox) return;
    alertBox.textContent = msg;
    alertBox.className = `alert ${type}`;
    alertBox.style.display = 'block';
  }

  if (btn) btn.addEventListener('click', submitRequest);
  renderPlan();
})();
