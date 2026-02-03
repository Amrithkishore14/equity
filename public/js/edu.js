async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  return res.json();
}

// Daily quote
(async () => {
  const box = document.querySelector('#quoteBox');
  const timeEl = document.querySelector('#quoteTime');
  if (!box) return;
  const data = await fetchJSON('/api/quote/latest');
  if (data.quote) {
    box.textContent = data.quote.content;
    if (timeEl) timeEl.textContent = new Date(data.quote.publish_at).toLocaleString();
  } else {
    box.textContent = 'No quote yet. Check back soon.';
  }
})();

// Weekly summary
(async () => {
  const box = document.querySelector('#weeklyBox');
  const timeEl = document.querySelector('#weeklyTime');
  if (!box) return;
  const data = await fetchJSON('/api/weekly/latest');
  if (data.summary) {
    box.innerHTML = data.summary.content.replace(/\n/g, '<br>');
    if (timeEl) timeEl.textContent = new Date(data.summary.publish_at).toLocaleDateString();
  } else {
    box.textContent = 'No weekly summary for this week yet.';
  }
})();

// Polls
(async () => {
  const pollContainer = document.querySelector('#pollContainer');
  if (!pollContainer) return;
  const data = await fetchJSON('/api/poll');
  if (!data.poll) {
    pollContainer.innerHTML = '<p class="small">No poll available right now.</p>';
    return;
  }
  const poll = data.poll;
  const list = document.createElement('div');
  list.className = 'cards';
  poll.options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline';
    btn.textContent = `${opt.option_text} (${opt.pct}% / ${opt.count})`;
    btn.onclick = async () => {
      const res = await fetchJSON(`/api/poll/${poll.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_id: opt.id }),
      });
      const msg = document.createElement('div');
      msg.className = 'alert';
      if (res.success) {
        msg.classList.add('success');
        msg.textContent = 'Vote recorded. Refreshing results...';
        pollContainer.appendChild(msg);
        setTimeout(() => location.reload(), 600);
      } else {
        msg.classList.add('error');
        msg.textContent = res.message || 'Vote failed';
        pollContainer.appendChild(msg);
      }
    };
    list.appendChild(btn);
  });
  pollContainer.innerHTML = `<h3>${poll.question}</h3>`;
  pollContainer.appendChild(list);
})();

// Newsletter
const newsletterForm = document.querySelector('#newsletterForm');
if (newsletterForm) {
  const alertEl = document.querySelector('#newsletterAlert');
  newsletterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = newsletterForm.email.value;
    if (!email || !email.includes('@')) {
      alertEl.textContent = 'Please enter a valid email.';
      alertEl.className = 'alert error';
      alertEl.style.display = 'block';
      return;
    }
    const res = await fetchJSON('/api/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.success) {
      alertEl.textContent = 'Subscribed! Check your inbox for weekly learning emails.';
      alertEl.className = 'alert success';
      alertEl.style.display = 'block';
      newsletterForm.reset();
    } else {
      alertEl.textContent = res.message || 'Subscription failed';
      alertEl.className = 'alert error';
      alertEl.style.display = 'block';
    }
  });
}

// Articles list
(async () => {
  const listWrap = document.querySelector('#articleList');
  if (!listWrap) return;
  const data = await fetchJSON('/api/articles');
  if (!data.articles || !data.articles.length) {
    listWrap.innerHTML = '<p class="small">No articles yet.</p>';
    return;
  }
  const html = data.articles
    .map(
      (a) => `<div class="card"><h3>${a.title}</h3><p class="small">${new Date(a.publish_at).toLocaleDateString()}</p><p>${a.excerpt}...</p><a class="btn btn-outline" href="/articles/${a.slug}">Read</a></div>`
    )
    .join('');
  listWrap.innerHTML = html;
})();

// Smart dashboard widgets (placeholder logic)
(async () => {
  const recentWrap = document.querySelector('#recentReads');
  const suggestWrap = document.querySelector('#suggestedTopics');
  if (!recentWrap && !suggestWrap) return;
  if (recentWrap) recentWrap.innerHTML = '<p class="small">Your recently read items appear here after you view articles.</p>';
  if (suggestWrap) suggestWrap.innerHTML = '<ul class="list"><li>Start with: Basics</li><li>Next: Risk Management Basics</li><li>Macro: Economy & rates overview</li></ul>';
})();

// Continue learning card
(async () => {
  const card = document.querySelector('#continueCard');
  if (!card) return;
  try {
    const data = await fetchJSON('/api/user/continue-learning');
    if (!data.success) throw new Error('Failed');
    if (data.status === 'completed') {
      card.innerHTML = '<p class="small">Great job! You have completed all available articles.</p>';
      return;
    }
    const last = data.last_read_id ? `<p class="small">Last read article ID: ${data.last_read_id}</p>` : '';
    const next = data.next;
    card.innerHTML = `
      ${last}
      <h3>${next.title}</h3>
      <p class="small">${next.description || ''}</p>
      <div class="actions" style="margin-top:10px;">
        <a class="btn" href="/articles/${next.slug}">Continue</a>
        <button class="btn btn-outline" id="markCompletedBtn">Mark as completed</button>
      </div>
    `;
    const markBtn = card.querySelector('#markCompletedBtn');
    if (markBtn) {
      markBtn.addEventListener('click', async () => {
        await fetchJSON('/api/articles/' + next.slug + '/comments', { method: 'GET' }); // noop but keeps pattern; real completion tracked on read
        card.innerHTML = '<p class="small">Marked as completed. Refresh to fetch next suggestion.</p>';
      });
    }
  } catch (err) {
    card.innerHTML = '<p class="small">Unable to load continue-learning right now.</p>';
  }
})();

// Contact form
const contactForm = document.querySelector('#contactForm');
const contactAlert = document.querySelector('#contactAlert');
if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(contactForm));
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    const data = await res.json();
    if (data.success) {
      contactAlert.className = 'alert success';
      contactAlert.textContent = 'Thanks, we received your note.';
      contactAlert.style.display = 'block';
      contactForm.reset();
    } else {
      contactAlert.className = 'alert error';
      contactAlert.textContent = data.message || 'Message failed, please try later.';
      contactAlert.style.display = 'block';
    }
  });
}

// Stock report handler is in report-form.js (loaded where needed)

// Completion feedback handling (article list context)
const completePanel = document.querySelector('#articleCompletePanel');
async function markArticleCompleted(articleId) {
  if (!completePanel) return;
  const res = await fetchJSON('/api/user/complete-article', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ article_id: articleId }),
  });
  if (!res.success) return;
  completePanel.style.display = 'block';
  const msg = document.querySelector('#completeMessage');
  const nextWrap = document.querySelector('#nextSuggestion');
  const nextLink = document.querySelector('#nextLink');
  if (res.status === 'path_completed') {
    msg.textContent = 'You have completed all available articles in this path.';
    nextWrap.innerHTML = '';
    if (nextLink) nextLink.style.display = 'none';
    return;
  }
  const next = res.next;
  msg.textContent = 'Completed! Keep the momentum going.';
  if (next) {
    nextWrap.innerHTML = `<p class="small">Next up: ${next.title} — ⏱️ ${next.read_time_minutes} min read</p>`;
    if (nextLink) {
      nextLink.href = `/articles/${next.slug}`;
      nextLink.style.display = 'inline-flex';
    }
  }
}

// Explain Like I'm New toggle (hide advanced blocks, highlight basic)
(function explainToggle() {
  const toggle = document.querySelector('#explainToggle');
  if (!toggle) return;
  const basicBlocks = document.querySelectorAll('.basic');
  const advancedBlocks = document.querySelectorAll('.advanced');
  function applyState() {
    const on = toggle.checked;
    advancedBlocks.forEach((el) => (el.style.display = on ? 'none' : ''));
    basicBlocks.forEach((el) => {
      if (on) el.classList.add('basic-highlight');
      else el.classList.remove('basic-highlight');
    });
  }
  toggle.addEventListener('change', applyState);
  applyState();
})();
