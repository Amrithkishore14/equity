(function() {
  const disclaimerText = `Disclaimer:\nEquity Investor Club is not a SEBI registered advisor.\nAll content shared on this website is for educational and learning purposes only.\nMarket updates are derived from publicly available news and media sources.\nUsers are advised to do their own analysis before making any investment decisions.\nEquity Investor Club does not provide investment, trading, or financial advice.`;

  function makeBadge() {
    const wrap = document.createElement('div');
    wrap.className = 'disclaimer-badge-wrap';
    wrap.innerHTML = `
      <button class="disclaimer-chip" type="button" aria-expanded="false">Disclaimer</button>
      <div class="disclaimer-pop" hidden>
        <pre>${disclaimerText}</pre>
      </div>
    `;
    const btn = wrap.querySelector('button');
    const pop = wrap.querySelector('.disclaimer-pop');
    btn.addEventListener('click', () => {
      const isOpen = pop.hasAttribute('hidden') === false;
      pop.toggleAttribute('hidden', isOpen);
      btn.setAttribute('aria-expanded', (!isOpen).toString());
    });
    return wrap;
  }

  function inject(selector) {
    document.querySelectorAll(selector).forEach((el) => {
      if (el.dataset.disclaimerApplied) return;
      const badge = makeBadge();
      el.appendChild(badge);
      el.dataset.disclaimerApplied = 'true';
    });
  }

  function ready(fn){ if(document.readyState!=='loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  ready(() => {
    inject('.needs-disclaimer');
  });
})();
