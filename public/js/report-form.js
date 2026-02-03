// Handles stock search + report submit
const stockSearchInput = document.querySelector('#stockSearch');
const stockSuggestions = document.querySelector('#stockSuggestions');
const stockSymbolHidden = document.querySelector('#stockSymbol');
const stockExchangeHidden = document.querySelector('#stockExchange');
const stockIdHidden = document.querySelector('#stockId');
const reportForm = document.querySelector('#stockReportForm');
const reportAlert = document.querySelector('#reportAlert');
const reportOutput = document.querySelector('#reportOutput');
const basicOutput = document.querySelector('#basicOutput');
const reportSubmit = reportForm ? reportForm.querySelector('button[type="submit"]') : null;
const copy = window.EIC_COPY?.report || {};
const primaryTextEl = document.querySelector('#reportPrimaryText');
const stockSearchLabel = document.querySelector('label[for="stockSearch"]');
const promoInput = document.querySelector('#promoCode');
const promoLabel = document.querySelector('label[for="promoCode"]');
const viewPlansBtn = document.querySelector('#viewPlansBtn');
const subscriptionNotice = document.querySelector('#subscriptionNotice');
let hasActiveSubscription = false;
let searchTimer;
let selectionValid = false;

function showAlert(msg, type = 'error') {
  if (!reportAlert) return;
  reportAlert.textContent = msg;
  reportAlert.className = `alert ${type}`;
  reportAlert.style.display = 'block';
}

async function fetchStocks(q) {
  const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(q)}`);
  return res.json();
}

function renderSuggestions(items) {
  stockSuggestions.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'suggest-item muted';
    li.textContent = 'No results found';
    stockSuggestions.appendChild(li);
    return;
  }
  items.forEach((s) => {
    const li = document.createElement('li');
    li.className = 'suggest-item';
    li.innerHTML = `<span>${s.stock_name}</span><span class="badge-inline">${s.exchange}</span>`;
    li.addEventListener('click', () => {
      stockSearchInput.value = `${s.stock_name} (${s.exchange})`;
      stockSymbolHidden.value = s.symbol;
      stockExchangeHidden.value = s.exchange;
      stockIdHidden.value = s.stock_id || '';
      selectionValid = true;
      stockSuggestions.innerHTML = '';
      if (reportAlert) reportAlert.style.display = 'none';
      showSelectionValid();
      toggleSubmitState();
    });
    stockSuggestions.appendChild(li);
  });
}

if (stockSearchInput && stockSuggestions) {
  if (copy.placeholder) {
    stockSearchInput.placeholder = copy.placeholder;
    stockSearchInput.title = copy.tooltip || '';
  }
  stockSearchInput.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    selectionValid = false;
    stockSymbolHidden.value = '';
    stockExchangeHidden.value = '';
    stockIdHidden.value = '';
    showSelectionNeeded();
    clearTimeout(searchTimer);
    if (q.length < 2) {
      stockSuggestions.innerHTML = '';
      toggleSubmitState();
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        const data = await fetchStocks(q);
        if (data.success) renderSuggestions(data.results || []);
        else renderSuggestions([]);
      } catch (err) {
        renderSuggestions([]);
      }
    }, 150);
  });
}

if (reportForm) {
  if (reportOutput && !reportOutput.innerHTML.trim()) {
    reportOutput.innerHTML = `<p class="small muted">${copy.ctaShort || 'Select a stock or mutual fund to continue.'}</p>`;
  }
  if (primaryTextEl && copy.primaryInstruction) primaryTextEl.textContent = copy.primaryInstruction;
  if (stockSearchLabel) stockSearchLabel.textContent = copy.shortLabel || 'Search';
  if (promoLabel) promoLabel.textContent = 'Promo code (optional)';
  if (promoInput) promoInput.placeholder = '';
  // fetch subscription status from backend
  fetch('/api/me')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && data.user && data.user.subscription_active) {
        hasActiveSubscription = true;
        if (subscriptionNotice) {
          subscriptionNotice.className = 'alert success';
          subscriptionNotice.textContent = 'Active subscription detected';
          subscriptionNotice.style.display = 'block';
        }
      } else {
        if (subscriptionNotice) {
          subscriptionNotice.className = 'alert';
          subscriptionNotice.textContent = 'Subscription required to generate reports. If you have a promo code, enter it below.';
          subscriptionNotice.style.display = 'block';
        }
        if (viewPlansBtn) viewPlansBtn.style.display = 'inline-flex';
      }
      toggleSubmitState();
    })
    .catch(() => {
      toggleSubmitState();
    });

  function toggleSubmitState() {
    const hasStock = selectionValid && !!stockSymbolHidden.value && !!stockExchangeHidden.value;
    const allow = hasStock; // allow click to show basic + block message
    if (reportSubmit) reportSubmit.disabled = !allow;
  }

  if (promoInput) promoInput.addEventListener('input', toggleSubmitState);
  stockSearchInput?.addEventListener('input', toggleSubmitState);
  reportForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectionValid || !stockSymbolHidden.value || !stockExchangeHidden.value) {
      showAlert('Select a stock from the list.', 'error');
      return;
    }
    const promo = promoInput ? promoInput.value.trim() : '';
    if (reportSubmit) {
      reportSubmit.disabled = true;
      reportSubmit.textContent = 'Generating...';
    }
    if (reportOutput) reportOutput.innerHTML = '<p class="small muted">Generating your educational report...</p>';
    const payload = {
      symbol: stockSymbolHidden.value,
      exchange: stockExchangeHidden.value,
      promo,
    };
    try {
      const res = await fetch('/api/report/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) {
        renderBasic(data.basic);
        if (data.message && data.message.toLowerCase().includes('promo')) {
          return showAlert('Invalid or expired promo code.', 'error');
        }
        if (data.message) return showAlert(data.message, 'error');
        return showAlert('Premium feature. To unlock advanced analysis, please contact:\n📩 equityinvestorclub@gmail.com', 'error');
      }
      renderBasic(null);
      showAlert(copy.success || 'Report generated.', 'success');
      renderReport(data);
    } catch (err) {
      showAlert('Unable to generate right now. Please try again in a moment.', 'error');
    }
    if (reportSubmit) {
      reportSubmit.disabled = false;
      reportSubmit.textContent = 'Generate Report';
    }
  });
}

function showSelectionNeeded() {
  if (reportAlert) {
    reportAlert.textContent = 'Select a stock from the suggestions.';
    reportAlert.className = 'alert';
    reportAlert.style.display = 'block';
  }
}

function showSelectionValid() {
  if (reportAlert) {
    reportAlert.style.display = 'none';
  }
}

function renderReport(data) {
  if (!reportOutput || !data.stock) return;
  const { stock, summary } = data;
  const generatedOn = new Date().toLocaleString();
  const sector = stock.sector || 'Not available';
  const business = summary?.what_it_does || 'This company is part of the Indian listed universe. Explore its products, services, and how it fits in the market value chain.';
  const learnings = summary?.note || 'Focus on understanding the business model, revenue drivers, and the risks disclosed in public filings.';

  reportOutput.innerHTML = `
    <div class="report-card fade-in">
      <div class="report-top">
        <div>
          <p class="small muted">Educational Stock Report</p>
          <h3>${stock.name}</h3>
          <p class="small">Symbol: ${stock.symbol} · <span class="badge-inline">${stock.exchange}</span></p>
        </div>
        <div class="report-meta">
          <span class="badge-inline">Educational</span>
          <span class="small">Generated: ${generatedOn}</span>
        </div>
      </div>
      <div class="disclaimer muted">Disclaimer: ${stock.disclaimer || 'Educational purposes only. No investment advice.'}</div>
      <div class="report-grid">
        <div class="card">
          <h4>Business Overview</h4>
          <p>${business}</p>
        </div>
        <div class="card">
          <h4>Sector & Industry</h4>
          <p>Sector: ${sector}</p>
          <p class="small muted">Use this to explore sector dynamics (demand, regulation, competition) without viewing prices.</p>
        </div>
        <div class="card">
          <h4>Key Learnings</h4>
          <ul class="list dotted">
            <li>${learnings}</li>
            <li>Review annual reports, investor presentations, and exchange filings for factual details.</li>
            <li>Track how the company communicates risks and capital allocation.</li>
          </ul>
        </div>
        <div class="card">
          <h4>Risk Factors (educational)</h4>
          <ul class="list dotted">
            <li>Market and sector cycles can impact earnings.</li>
            <li>Regulatory changes may affect operations.</li>
            <li>Execution and governance are key — always verify via public disclosures.</li>
          </ul>
        </div>
        <div class="card">
          <h4>Public Information Summary</h4>
          <p>Use only publicly available sources such as exchange filings, annual reports, and reputable media. Prices, targets, or buy/sell opinions are intentionally excluded.</p>
        </div>
      </div>
      <div class="disclaimer muted">Disclaimer: ${stock.disclaimer || 'Educational purposes only. No investment advice.'}</div>
    </div>
  `;
}

function renderBasic(basic) {
  if (!basicOutput) return;
  if (!basic) {
    basicOutput.innerHTML = '';
    return;
  }
  basicOutput.innerHTML = `
    <div class="card">
      <h3>${basic.company || basic.name}</h3>
      <p>${basic.description || ''}</p>
      ${basic.price_delayed ? `<p class="small">Price (delayed): ${basic.price_delayed}</p>` : ''}
      <p class="small">Sector: ${basic.sector || 'N/A'} | Industry: ${basic.industry || 'N/A'}</p>
    </div>
  `;
}
