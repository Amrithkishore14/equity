async function fetchLatestUpdate() {
  try {
    const res = await fetch('/api/daily/latest');
    return res.ok ? res.json() : { success: false };
  } catch (e) {
    return { success: false };
  }
}

async function fetchLatestNews() {
  try {
    const res = await fetch('/api/news/latest');
    return res.ok ? res.json() : { success: false };
  } catch (e) {
    return { success: false };
  }
}

function renderUpdate(prefix, payload) {
  const contentEl = document.querySelector(`#${prefix}Content`);
  const timeEl = document.querySelector(`#${prefix}Timestamp`);
  const previewEl = document.querySelector(`#${prefix}Preview`);
  if (!contentEl) return;

  if (!payload || !payload.update) {
    contentEl.textContent = 'No update posted yet. Check back soon.';
    if (previewEl) previewEl.style.display = 'none';
    if (timeEl) timeEl.textContent = '';
    return;
  }

  contentEl.innerHTML = payload.update.html || payload.update.content;
  if (timeEl) timeEl.textContent = `Posted: ${new Date(payload.update.created_at).toLocaleString()}`;
  if (previewEl) previewEl.style.display = payload.update.preview ? 'block' : 'none';
}

(async function initUpdates() {
  const data = await fetchLatestUpdate();
  renderUpdate('daily', data);
  renderUpdate('userDaily', data);

  const news = await fetchLatestNews();
  const newsTarget = document.querySelector('#newsContent');
  const newsTime = document.querySelector('#newsTimestamp');
  const userNewsTarget = document.querySelector('#userNewsContent');
  const userNewsTime = document.querySelector('#userNewsTimestamp');

  if (newsTarget) {
    if (news && news.news) {
      newsTarget.textContent = news.news.content;
      if (newsTime) newsTime.textContent = new Date(news.news.updated_at).toLocaleString();
    } else {
      newsTarget.textContent = 'No daily news posted yet. Check back for educational market notes.';
    }
  }
  if (userNewsTarget) {
    if (news && news.news) {
      userNewsTarget.textContent = news.news.content;
      if (userNewsTime) userNewsTime.textContent = new Date(news.news.updated_at).toLocaleString();
    } else {
      userNewsTarget.textContent = 'No daily news posted yet. Check back for educational market notes.';
    }
  }
})();
