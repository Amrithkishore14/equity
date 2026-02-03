// Handles choose plan flow on subscriptions page
(function () {
  const buttons = document.querySelectorAll('[data-plan]');
  const alertBox = document.querySelector('#subAlert');
  if (!buttons.length) return;

  async function checkLogin() {
    try {
      const res = await fetch('/api/me');
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.user ? data.user : null;
    } catch (e) {
      return null;
    }
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const plan = btn.dataset.plan;
      localStorage.setItem('pendingPlan', plan);
      const user = await checkLogin();
      if (!user) {
        localStorage.setItem('postLoginRedirect', `/subscriptions?plan=${encodeURIComponent(plan)}`);
        window.location.href = '/login';
        return;
      }
      try {
        const res = await fetch('/api/payments/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan_key: plan }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.message || 'Unable to start payment');
        }
        const options = {
          key: data.key_id,
          order_id: data.order_id,
          name: data.name || 'Equity Investor Club',
          description: data.description || 'Educational access subscription',
          handler: function () {
            window.location.href = '/user?sub=1';
          },
          modal: {
            ondismiss: function () {
              showAlert('Payment cancelled. You can retry anytime.', 'error');
            },
          },
        };
        if (typeof Razorpay === 'undefined') {
          showAlert('Payment SDK not loaded. Please retry.', 'error');
          return;
        }
        const rzp = new Razorpay(options);
        rzp.open();
      } catch (err) {
        showAlert(err.message || 'Payment could not be initiated.', 'error');
      }
    });
  });

  function showAlert(msg, type = 'error') {
    if (!alertBox) return;
    alertBox.textContent = msg;
    alertBox.className = `alert ${type}`;
    alertBox.style.display = 'block';
  }
})();
