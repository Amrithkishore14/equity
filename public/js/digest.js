(async () => {
  const container = document.querySelector('#digestContainer');
  const archiveList = document.querySelector('#digestArchive');
  if (!container) return;
  try {
    const res = await fetch('/api/digest/latest');
    const data = await res.json();
    if (!data.success || !data.latest) {
      container.textContent = 'No digest published yet.';
      return;
    }
    container.innerHTML = data.latest.content;
    if (archiveList) {
      archiveList.innerHTML = (data.archive || [])
        .map((d) => `<li>${new Date(d.created_at).toDateString()}</li>`)
        .join('');
      if (!archiveList.innerHTML) archiveList.innerHTML = '<li class="small">No older digests yet.</li>';
    }
  } catch (err) {
    container.textContent = 'Unable to load digest right now.';
  }
})();
