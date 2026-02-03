// Handles inquiry form submission on class page
const inquiryForm = document.querySelector('#inquiryForm');
const inquiryAlert = document.querySelector('#inquiryAlert');

function showInquiry(msg, type = 'success') {
  if (!inquiryAlert) return;
  inquiryAlert.textContent = msg;
  inquiryAlert.className = `alert ${type}`;
  inquiryAlert.style.display = 'block';
}

if (inquiryForm) {
  inquiryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(inquiryForm));
    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (data.success) {
        showInquiry('Thanks, we received your inquiry. We will get back within 2 business days.', 'success');
        inquiryForm.reset();
      } else {
        showInquiry(data.message || 'Unable to submit now. Please try later.', 'error');
      }
    } catch (err) {
      showInquiry('Server error. Please try again.', 'error');
    }
  });
}
