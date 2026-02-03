const stockInput = document.querySelector('#stockSearch');
const stockHiddenSymbol = document.querySelector('#stockSymbol');
const stockHiddenExchange = document.querySelector('#stockExchange');
const stockList = document.querySelector('#stockSuggestions');
let debounceTimer;

async function searchStocks(term) {
  const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(term)}`);
  return res.json();
}

function renderSuggestions(items) {
  stockList.innerHTML = '';
  items.forEach((s) => {
    const li = document.createElement('li');
    li.className = 'suggest-item';
    li.innerHTML = `<span>${s.stock_name}</span><span class="badge-inline">${s.exchange}</span>`;
    li.addEventListener('click', () => {
      stockInput.value = s.stock_name;
      stockHiddenSymbol.value = s.symbol;
      stockHiddenExchange.value = s.exchange;
      stockList.innerHTML = '';
    });
    stockList.appendChild(li);
  });
}

if (stockInput && stockList) {
  stockInput.addEventListener('input', (e) => {
    const v = e.target.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (v.length < 2) { stockList.innerHTML=''; return; }
      const data = await searchStocks(v);
      if (data.success) renderSuggestions(data.results || []);
    }, 150);
  });
}
