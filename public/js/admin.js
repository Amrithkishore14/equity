const userTableBody = document.querySelector('#userTableBody');
const logTableBody = document.querySelector('#logTableBody');
const userCountEl = document.querySelector('#userCount');
const addUserForm = document.querySelector('#addUserForm');
const adminAlert = document.querySelector('#adminAlert');
const updateForm = document.querySelector('#dailyUpdateForm');
const updateTextarea = document.querySelector('#dailyContentInput');
const updateTimestamp = document.querySelector('#dailyTimestamp');
const deleteUpdateBtn = document.querySelector('#deleteUpdateBtn');
const updateModeLabel = document.querySelector('#updateMode');
const dailyPublishInput = document.querySelector('#dailyPublishAt');
const quoteForm = document.querySelector('#quoteForm');
const quoteInput = document.querySelector('#quoteInput');
const weeklyForm = document.querySelector('#weeklyForm');
const weeklyInput = document.querySelector('#weeklyInput');
const weeklyPublishInput = document.querySelector('#weeklyPublishAt');
const pollForm = document.querySelector('#pollForm');
const pollQuestion = document.querySelector('#pollQuestion');
const pollOptions = document.querySelector('#pollOptions');
const pollPublish = document.querySelector('#pollPublishAt');
const articleForm = document.querySelector('#articleForm');
const articleTitle = document.querySelector('#articleTitle');
const articleContent = document.querySelector('#articleContent');
const articlePublish = document.querySelector('#articlePublishAt');
const articleSources = document.querySelector('#articleSources');
const articleSourceTags = document.querySelectorAll('input[name="articleSourceTags"]');
const statsUsers = document.querySelector('#statsUsers');
const statsActive = document.querySelector('#statsActive');
const statsPages = document.querySelector('#statsPages');
const historyUpdates = document.querySelector('#historyUpdates');
const historySummaries = document.querySelector('#historySummaries');
const pendingCommentsBody = document.querySelector('#pendingCommentsBody');
const settingsForm = document.querySelector('#settingsForm');
const newsForm = document.querySelector('#newsForm');
const newsInput = document.querySelector('#newsInput');
const newsSubmit = newsForm ? newsForm.querySelector('button[type="submit"]') : null;
const newsToggle = document.querySelector('#newsEnabled');
const disclaimerInput = document.querySelector('#globalDisclaimer');
const instagramInput = document.querySelector('#instagramLink');
const inquiriesToggle = document.querySelector('#inquiriesEnabled');
const digestEmailToggle = document.querySelector('#digestEmailEnabled');
const enableNseToggle = document.querySelector('#enableNse');
const enableBseToggle = document.querySelector('#enableBse');
const generateDigestBtn = document.querySelector('#generateDigestBtn');
const publishDigestBtn = document.querySelector('#publishDigestBtn');
const digestPreview = document.querySelector('#digestPreview');
const stockTotal = document.querySelector('#stockTotal');
const stockNse = document.querySelector('#stockNse');
const stockBse = document.querySelector('#stockBse');
const stockLast = document.querySelector('#stockLast');
const stockWarning = document.querySelector('#stockWarning');
const refreshStocksBtn = document.querySelector('#refreshStocksBtn');
const inquiriesBody = document.querySelector('#inquiriesBody');
const subscriptionRequestsBody = document.querySelector('#subscriptionRequestsBody');

let currentUpdateId = null;

function alertAdmin(msg, type = 'success') {
  if (!adminAlert) return;
  adminAlert.textContent = msg;
  adminAlert.className = `alert ${type}`;
  adminAlert.style.display = 'block';
}

async function fetchUsers() {
  const res = await fetch('/api/admin/users');
  if (!res.ok) return alertAdmin('Unable to load users', 'error');
  const data = await res.json();
  renderUsers(data.users || []);
}

function renderUsers(users) {
  if (!userTableBody) return;
  userTableBody.innerHTML = '';
  users.forEach((u) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${u.name}</td>
      <td>${u.email}</td>
      <td><span class="badge-inline">${u.role}</span></td>
      <td><span class="status-pill ${u.status === 'active' ? '' : 'inactive'}">${u.status}</span></td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td class="table-actions">
        <button class="btn btn-outline" data-action="status" data-id="${u.id}" data-status="${u.status}">${u.status === 'active' ? 'Deactivate' : 'Activate'}</button>
        <button class="btn btn-outline" data-action="reset" data-id="${u.id}">Reset Password</button>
        <button class="btn btn-outline" data-action="delete" data-id="${u.id}">Delete</button>
      </td>`;
    userTableBody.appendChild(tr);
  });
  if (userCountEl) userCountEl.textContent = users.length;
}

async function fetchLogs() {
  if (!logTableBody) return;
  const res = await fetch('/api/admin/logs');
  const data = await res.json();
  logTableBody.innerHTML = '';
  (data.logs || []).forEach((log) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${log.id}</td>
      <td>${log.user_email || 'N/A'}</td>
      <td>${log.role || '-'}</td>
      <td>${log.action}</td>
      <td>${log.ip || '-'}</td>
      <td>${new Date(log.timestamp).toLocaleString()}</td>`;
    logTableBody.appendChild(tr);
  });
}

if (addUserForm) {
  addUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(addUserForm));
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      alertAdmin('User added');
      addUserForm.reset();
      fetchUsers();
    } else {
      alertAdmin(data.message || 'Could not add user', 'error');
    }
  });
}

if (userTableBody) {
  userTableBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'status') {
      const next = btn.dataset.status === 'active' ? 'inactive' : 'active';
      const res = await fetch(`/api/admin/users/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (data.success) {
        alertAdmin('Status updated');
        fetchUsers();
      } else alertAdmin(data.message || 'Update failed', 'error');
    }
    if (action === 'reset') {
      const pwd = prompt('Enter new password');
      if (!pwd) return;
      const res = await fetch(`/api/admin/users/${id}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      });
      const data = await res.json();
      if (data.success) alertAdmin('Password reset');
      else alertAdmin(data.message || 'Reset failed', 'error');
    }
    if (action === 'delete') {
      if (!confirm('Delete this user?')) return;
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        alertAdmin('User deleted');
        fetchUsers();
      } else alertAdmin(data.message || 'Delete failed', 'error');
    }
  });
}

async function initAdmin() {
  await fetchUsers();
  await fetchLogs();
  await loadDailyUpdate();
  await loadStats();
  await loadHistory();
  await loadPendingComments();
  await loadStockStats();
  await loadInquiries();
  await loadSubscriptionRequests();
  loadSettings();
}

initAdmin();

async function loadSettings() {
  if (!settingsForm) return;
  const res = await fetch('/api/admin/settings');
  const data = await res.json();
  if (!data.success) return;
  const s = data.settings || {};
  if (newsToggle) newsToggle.checked = s.news_enabled === 'true';
  if (disclaimerInput) disclaimerInput.value = s.disclaimer || '';
  if (instagramInput) instagramInput.value = s.instagram || '';
  if (inquiriesToggle) inquiriesToggle.checked = s.inquiries_enabled === 'true';
  if (digestEmailToggle) digestEmailToggle.checked = s.digest_email_enabled === 'true';
  if (enableNseToggle) enableNseToggle.checked = s.enable_nse === 'true';
  if (enableBseToggle) enableBseToggle.checked = s.enable_bse === 'true';
}

if (settingsForm) {
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
  const payload = {
    news_enabled: newsToggle?.checked ?? false,
    disclaimer: disclaimerInput?.value ?? '',
    instagram: instagramInput?.value ?? '',
    inquiries_enabled: inquiriesToggle?.checked ?? false,
    digest_email_enabled: digestEmailToggle?.checked ?? false,
    enable_nse: enableNseToggle?.checked ?? false,
    enable_bse: enableBseToggle?.checked ?? false,
  };
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) alertAdmin('Settings saved'); else alertAdmin('Save failed', 'error');
  });
}

// Weekly digest actions
async function generateDigest() {
  if (!digestPreview) return;
  digestPreview.textContent = 'Generating...';
  const res = await fetch('/api/admin/digest/generate', { method: 'POST' });
  const data = await res.json();
  if (data.success) {
    digestPreview.innerHTML = data.content;
  } else {
    digestPreview.textContent = 'Failed to generate digest.';
  }
}

async function publishDigest() {
  if (!digestPreview) return;
  const res = await fetch('/api/admin/digest/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: digestPreview.innerHTML }),
  });
  const data = await res.json();
  if (data.success) alertAdmin('Digest published'); else alertAdmin('Publish failed', 'error');
}

if (generateDigestBtn) generateDigestBtn.addEventListener('click', generateDigest);
if (publishDigestBtn) publishDigestBtn.addEventListener('click', publishDigest);

async function loadDailyUpdate() {
  if (!updateTextarea) return;
  const res = await fetch('/api/admin/daily/latest');
  const data = await res.json();
  if (data.update) {
    currentUpdateId = data.update.id;
    updateTextarea.value = data.update.content;
    if (updateTimestamp) updateTimestamp.textContent = new Date(data.update.created_at).toLocaleString();
    if (updateModeLabel) updateModeLabel.textContent = 'Editing active update';
    if (deleteUpdateBtn) deleteUpdateBtn.disabled = false;
    if (dailyPublishInput && data.update.publish_at) dailyPublishInput.value = data.update.publish_at.slice(0,16);
  } else {
    currentUpdateId = null;
    updateTextarea.value = '';
    if (updateTimestamp) updateTimestamp.textContent = 'No active update yet';
    if (updateModeLabel) updateModeLabel.textContent = 'Create first update';
    if (deleteUpdateBtn) deleteUpdateBtn.disabled = true;
  }
}

if (updateForm) {
  updateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
  const payload = { content: updateTextarea.value.trim(), publish_at: dailyPublishInput?.value || null };
  if (!payload.content) return alertAdmin('Content is required', 'error');
  if (payload.publish_at && new Date(payload.publish_at) < new Date()) return alertAdmin('Publish time must be in the future', 'error');

    const method = currentUpdateId ? 'PUT' : 'POST';
    const url = currentUpdateId ? `/api/admin/daily/${currentUpdateId}` : '/api/admin/daily';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      alertAdmin(currentUpdateId ? 'Update saved' : 'Update posted');
      await loadDailyUpdate();
    } else {
      alertAdmin(data.message || 'Could not save update', 'error');
    }
  });
}

if (deleteUpdateBtn) {
  deleteUpdateBtn.addEventListener('click', async () => {
    if (!currentUpdateId) return;
    if (!confirm('Delete the active update?')) return;
    const res = await fetch(`/api/admin/daily/${currentUpdateId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      alertAdmin('Update deleted');
      await loadDailyUpdate();
    } else {
      alertAdmin(data.message || 'Delete failed', 'error');
    }
  });
}

// Quote
if (quoteForm) {
  quoteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
  const payload = { content: quoteInput.value.trim(), publish_at: document.querySelector('#quotePublishAt')?.value || null };
  if (!payload.content) return alertAdmin('Quote required', 'error');
  if (payload.publish_at && new Date(payload.publish_at) < new Date()) return alertAdmin('Publish time must be in the future', 'error');
    const res = await fetch('/api/admin/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) alertAdmin('Quote saved'); else alertAdmin('Quote failed', 'error');
  });
}

// Daily news
if (newsForm) {
  newsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = newsInput.value.trim();
    if (!content) return alertAdmin('News content is required', 'error');
    if (newsSubmit) { newsSubmit.disabled = true; newsSubmit.textContent = 'Posting...'; }
    try {
      const res = await fetch('/api/admin/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (data.success) {
        alertAdmin('Daily news posted');
        newsForm.reset();
      } else {
        alertAdmin(data.message || 'Unable to post news. Please try again.', 'error');
      }
    } catch (err) {
      alertAdmin('Network issue while posting news. Please retry.', 'error');
    } finally {
      if (newsSubmit) { newsSubmit.disabled = false; newsSubmit.textContent = 'Post Today\'s News'; }
    }
  });
}

// Weekly
if (weeklyForm) {
  weeklyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
  const payload = { content: weeklyInput.value.trim(), publish_at: weeklyPublishInput?.value || null };
  if (!payload.content) return alertAdmin('Weekly summary required', 'error');
  if (payload.publish_at && new Date(payload.publish_at) < new Date()) return alertAdmin('Publish time must be in the future', 'error');
    const res = await fetch('/api/admin/weekly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) alertAdmin('Weekly summary saved'); else alertAdmin('Save failed', 'error');
  });
}

// Poll
if (pollForm) {
  pollForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const opts = pollOptions.value.split('\\n').map((o) => o.trim()).filter(Boolean);
    const payload = { question: pollQuestion.value.trim(), options: opts, publish_at: pollPublish?.value || null };
    if (payload.publish_at && new Date(payload.publish_at) < new Date()) return alertAdmin('Publish time must be in the future', 'error');
    const res = await fetch('/api/admin/polls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) alertAdmin('Poll created'); else alertAdmin(data.message || 'Poll failed', 'error');
  });
}

// Article
if (articleForm) {
  articleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sourceTags = Array.from(articleSourceTags || []).filter((i) => i.checked).map((i) => i.value);
    const sourceNames = articleSources?.value?.trim();
    const payload = { title: articleTitle.value.trim(), content: articleContent.value.trim(), publish_at: articlePublish?.value || null, sources: { tags: sourceTags, names: sourceNames } };
    if (payload.publish_at && new Date(payload.publish_at) < new Date()) return alertAdmin('Publish time must be in the future', 'error');
    const res = await fetch('/api/admin/articles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) alertAdmin('Article saved'); else alertAdmin(data.message || 'Article failed', 'error');
  });
}

// Stats
async function loadStats() {
  const res = await fetch('/api/admin/stats');
  const data = await res.json();
  if (!data.success) return;
  if (statsUsers) statsUsers.textContent = data.stats.totalUsers;
  if (statsActive) statsActive.textContent = data.stats.activeUsers;
  if (statsPages) {
    statsPages.innerHTML = data.stats.topPages.map((p) => `<li>${p.path} — ${p.c}</li>`).join('');
  }
}

// History
async function loadHistory() {
  const res = await fetch('/api/admin/history');
  const data = await res.json();
  if (!data.success) return;
  if (historyUpdates) {
    historyUpdates.innerHTML = data.updates.map((u) => `<li>${new Date(u.publish_at).toLocaleString()} — ${u.content.slice(0,60)}...</li>`).join('');
  }
  if (historySummaries) {
    historySummaries.innerHTML = data.summaries.map((u) => `<li>${new Date(u.publish_at).toLocaleDateString()} — ${u.content.slice(0,60)}...</li>`).join('');
  }
}

// Stock master stats
async function loadStockStats() {
  if (!stockTotal) return;
  try {
    const res = await fetch('/api/admin/stocks/stats');
    const data = await res.json();
    if (!data.success) throw new Error();
    stockTotal.textContent = data.total;
    stockNse.textContent = data.nse;
    stockBse.textContent = data.bse;
    stockLast.textContent = data.last || 'Not refreshed yet';
    if (data.total === 0 && stockWarning) {
      stockWarning.style.display = 'block';
      stockWarning.textContent = 'Stock master is empty. Click refresh to import symbols.';
    } else if (stockWarning) {
      stockWarning.style.display = 'none';
    }
  } catch (err) {
    if (stockWarning) {
      stockWarning.style.display = 'block';
      stockWarning.textContent = 'Unable to load stock stats right now.';
    }
  }
}

if (refreshStocksBtn) {
  refreshStocksBtn.addEventListener('click', async () => {
    refreshStocksBtn.disabled = true;
    refreshStocksBtn.textContent = 'Refreshing...';
    try {
      const res = await fetch('/api/admin/stocks/refresh', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alertAdmin('Stock master refreshed');
        loadStockStats();
      } else {
        alertAdmin('Refresh failed. Please retry in a bit.', 'error');
      }
    } catch (err) {
      alertAdmin('Network issue while refreshing. Please try again.', 'error');
    } finally {
      refreshStocksBtn.disabled = false;
      refreshStocksBtn.textContent = '🔄 Refresh Stock Master';
    }
  });
}

// Inquiries
async function loadInquiries() {
  if (!inquiriesBody) return;
  try {
    const res = await fetch('/api/admin/inquiries');
    const data = await res.json();
    inquiriesBody.innerHTML = '';
    if (!data.success || !data.inquiries || !data.inquiries.length) {
      inquiriesBody.innerHTML = '<tr><td colspan="5" class="small">No inquiries yet.</td></tr>';
      return;
    }
    data.inquiries.forEach((q) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${q.name}</td><td>${q.email}</td><td>${q.phone || '-'}</td><td>${q.message}</td><td>${new Date(q.created_at).toLocaleString()}</td>`;
      inquiriesBody.appendChild(tr);
    });
  } catch (err) {
    inquiriesBody.innerHTML = '<tr><td colspan="5" class="small">Unable to load inquiries right now.</td></tr>';
  }
}

async function loadSubscriptionRequests() {
  if (!subscriptionRequestsBody) return;
  subscriptionRequestsBody.innerHTML = '<tr><td colspan="7" class="small">Loading...</td></tr>';
  try {
    const res = await fetch('/api/admin/subscriptions');
    const data = await res.json();
    if (!data.success || !data.requests || !data.requests.length) {
      subscriptionRequestsBody.innerHTML = '<tr><td colspan="7" class="small">No subscription requests yet.</td></tr>';
      return;
    }
    subscriptionRequestsBody.innerHTML = '';
    data.requests.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.id}</td><td>${r.name || 'User'}</td><td>${r.email || ''}</td><td>${r.plan_name}</td><td>${r.status}</td><td>${new Date(r.requested_at).toLocaleString()}</td>
        <td class="table-actions">
          <button class="btn btn-outline" data-action="approve" data-id="${r.id}">Approve</button>
          <button class="btn btn-outline" data-action="reject" data-id="${r.id}">Reject</button>
        </td>`;
      subscriptionRequestsBody.appendChild(tr);
    });
  } catch (err) {
    subscriptionRequestsBody.innerHTML = '<tr><td colspan="7" class="small">Unable to load requests.</td></tr>';
  }
}

if (subscriptionRequestsBody) {
  subscriptionRequestsBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const url =
      action === 'approve'
        ? `/api/admin/subscriptions/${id}/approve`
        : `/api/admin/subscriptions/${id}/reject`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alertAdmin(`Request ${action}d`);
      loadSubscriptionRequests();
    } else {
      alertAdmin('Action failed', 'error');
    }
  });
}

// Pending comments
async function loadPendingComments() {
  if (!pendingCommentsBody) return;
  const res = await fetch('/api/admin/comments/pending');
  const data = await res.json();
  pendingCommentsBody.innerHTML = '';
  (data.comments || []).forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.id}</td><td>${c.email || ''}</td><td>${c.article_id}</td><td>${c.content}</td><td class=\"table-actions\"><button data-id=\"${c.id}\" data-action=\"approve\" class=\"btn btn-outline\">Approve</button><button data-id=\"${c.id}\" data-action=\"reject\" class=\"btn btn-outline\">Reject</button></td>`;
    pendingCommentsBody.appendChild(tr);
  });
}

if (pendingCommentsBody) {
  pendingCommentsBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const res = await fetch(`/api/admin/comments/${id}/${action}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alertAdmin(`Comment ${action}d`);
      loadPendingComments();
    }
  });
}
