/**
 * Horizon 60 — Hierarchical Portfolio State & Logic
 * Data: accounts[] → each has holdings[] (balance for Cash/Debt; ticker, quantity, purchasePrice for Retirement/Crypto)
 */

const ACCOUNT_TYPES = ['Cash', 'Retirement', 'Crypto', 'Debt'];
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';
const ALPHA_VANTAGE_QUOTE = 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=';

let state = {
  accounts: [],
  expandedAccountId: null,
  priceCache: {}, // ticker -> { price, at }
  apiKey: localStorage.getItem('horizon60_apiKey') || '',
};

/** Per-unit purchase price (backward compat: derive from legacy costBasis if needed) */
function getPurchasePrice(holding) {
  const qty = Number(holding.quantity) || 0;
  if (holding.purchasePrice != null && !Number.isNaN(holding.purchasePrice)) return holding.purchasePrice;
  if (holding.costBasis != null && holding.costBasis > 0 && qty > 0) return holding.costBasis / qty;
  return null;
}

/** Cost basis = Quantity * Purchase Price (for security holdings) */
function getHoldingCostBasis(holding, accountType) {
  if (!isSecurityType(accountType)) return null;
  const qty = Number(holding.quantity) || 0;
  const pp = getPurchasePrice(holding);
  return pp != null ? qty * pp : null;
}

/** Market value = Quantity * Current price (for security holdings) */
function getHoldingMarketValue(holding, accountType) {
  return getHoldingValue(holding, accountType);
}

function id() {
  return Math.random().toString(36).slice(2);
}

function formatMoney(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const s = abs >= 1e6 ? (abs / 1e6).toFixed(2) + 'M' : abs >= 1e3 ? (abs / 1e3).toFixed(1) + 'k' : abs.toFixed(2);
  return (n < 0 ? '-' : '') + '$' + s;
}

function formatMoneyFull(n) {
  if (n == null || Number.isNaN(n)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function isSecurityType(type) {
  return type === 'Retirement' || type === 'Crypto';
}

/** Get value of one holding (balance for Cash/Debt; qty * price for Retirement/Crypto, fallback purchase price) */
function getHoldingValue(holding, accountType) {
  if (isSecurityType(accountType)) {
    const currentPrice = state.priceCache[holding.ticker?.toUpperCase()]?.price;
    const fallbackPrice = getPurchasePrice(holding);
    const price = currentPrice ?? fallbackPrice;
    const qty = Number(holding.quantity) || 0;
    return price != null ? qty * price : null;
  }
  return Number(holding.balance) || 0;
}

/** Account balance = sum of holding values. Debt is stored as positive balance but subtracted for net worth. */
function getAccountBalance(account) {
  let total = 0;
  for (const h of account.holdings) {
    const v = getHoldingValue(h, account.type);
    if (v != null && !Number.isNaN(v)) total += v;
  }
  return total;
}

/** Total net worth = sum of account balances, with Debt subtracted */
function getTotalNetWorth() {
  let nw = 0;
  for (const a of state.accounts) {
    const bal = getAccountBalance(a);
    if (a.type === 'Debt') nw -= bal; else nw += bal;
  }
  return nw;
}

/** Summary totals by type (for the 4 cards). Debt as positive number for display. */
function getSummaryByType() {
  const summary = { Cash: 0, Retirement: 0, Crypto: 0, Debt: 0 };
  for (const a of state.accounts) {
    const bal = getAccountBalance(a);
    summary[a.type] = (summary[a.type] || 0) + (a.type === 'Debt' ? bal : bal);
  }
  return summary;
}

/** Total invested (cost basis) for a security account */
function getAccountTotalInvested(account) {
  if (!isSecurityType(account.type)) return null;
  let total = 0;
  for (const h of account.holdings) {
    const cb = getHoldingCostBasis(h, account.type);
    if (cb != null && !Number.isNaN(cb)) total += cb;
  }
  return total;
}

/** Total current market value for a security account (same as balance) */
function getAccountTotalMarketValue(account) {
  if (!isSecurityType(account.type)) return null;
  return getAccountBalance(account);
}

/** P/L in dollars: market value - cost basis. Returns null if either missing. */
function getHoldingProfitLossDollar(holding, accountType) {
  if (!isSecurityType(accountType)) return null;
  const costBasis = getHoldingCostBasis(holding, accountType);
  const marketVal = getHoldingMarketValue(holding, accountType);
  if (costBasis == null || marketVal == null) return null;
  return marketVal - costBasis;
}

/** P/L as percentage: (marketValue - costBasis) / costBasis * 100. Returns null if missing. */
function getHoldingProfitLossPct(holding, accountType) {
  const cb = getHoldingCostBasis(holding, accountType);
  const pl = getHoldingProfitLossDollar(holding, accountType);
  if (cb == null || cb === 0 || pl == null) return null;
  return (pl / cb) * 100;
}

/** Fetch quote from Alpha Vantage (via CORS proxy), cache result */
async function fetchQuote(symbol) {
  if (!symbol || !state.apiKey) return null;
  const sym = String(symbol).trim().toUpperCase();
  const url = ALPHA_VANTAGE_QUOTE + encodeURIComponent(sym) + '&apikey=' + encodeURIComponent(state.apiKey);
  try {
    const res = await fetch(CORS_PROXY + encodeURIComponent(url));
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    const quote = data && data['Global Quote'];
    const priceStr = quote && quote['05. price'];
    const price = priceStr != null ? parseFloat(priceStr) : null;
    if (price != null && !Number.isNaN(price)) {
      state.priceCache[sym] = { price, at: Date.now() };
      return price;
    }
    return null;
  } catch (e) {
    console.warn('Quote fetch failed', sym, e);
    return null;
  }
}

/** Refresh prices for all unique tickers in state */
async function refreshAllPrices() {
  const tickers = new Set();
  for (const a of state.accounts) {
    if (isSecurityType(a.type))
      a.holdings.forEach(h => { if (h.ticker) tickers.add(h.ticker.trim().toUpperCase()); });
  }
  for (const t of tickers) {
    await fetchQuote(t);
    await new Promise(r => setTimeout(r, 300)); // rate limit
  }
  render();
}

// ——— Render ———

function renderNetWorth() {
  const nw = getTotalNetWorth();
  const el = document.getElementById('net-worth-hero');
  const changeEl = document.getElementById('net-worth-change');
  if (el) {
    const [whole, dec] = formatMoneyFull(nw).replace('$', '').split('.');
    el.innerHTML = `$${whole.replace(/,/g, ',')}.<span class="text-white/30 text-3xl">${(dec || '00').slice(0, 2)}</span>`;
  }
  if (changeEl) changeEl.textContent = '—'; // optional: compute vs last month
}

function getTypeIcon(type) {
  const icons = { Cash: 'account_balance_wallet', Retirement: 'auto_graph', Crypto: 'currency_bitcoin', Debt: 'credit_card_off' };
  return icons[type] || 'account_balance';
}

function getTypeCardClass(type) {
  if (type === 'Crypto') return 'border-accent-blue/20 hover:border-accent-blue/50';
  if (type === 'Debt') return 'border-red-500/10 hover:border-red-500/50';
  return 'hover:border-primary/50';
}

function renderSummaryCards() {
  const summary = getSummaryByType();
  const container = document.getElementById('summary-cards');
  if (!container) return;
  const cards = ACCOUNT_TYPES.map(type => {
    const value = type === 'Debt' ? summary.Debt : summary[type];
    const label = type === 'Cash' ? 'Liquid Cash' : type === 'Retirement' ? 'Retirement' : type === 'Crypto' ? 'Digital Assets' : 'Liabilities';
    const valueClass = type === 'Debt' ? 'text-red-500' : type === 'Crypto' ? 'text-accent-blue' : 'text-primary';
    const displayValue = formatMoney(value);
    return `
      <div class="glass-panel p-5 rounded-xl group transition-all ${getTypeCardClass(type)}">
        <div class="flex justify-between items-start mb-4">
          <span class="material-symbols-outlined ${type === 'Crypto' ? 'text-accent-blue/60 group-hover:text-accent-blue' : type === 'Debt' ? 'text-white/40 group-hover:text-red-400' : 'text-white/40 group-hover:text-white'} transition-colors">${getTypeIcon(type)}</span>
          <div class="h-6 w-16 opacity-80">
            <svg class="w-full h-full" viewBox="0 0 100 40"><path d="M0 35 Q 25 35, 40 20 T 80 10 T 100 5" fill="none" stroke="${type === 'Crypto' ? '#00d4ff' : type === 'Debt' ? '#ef4444' : '#0df20d'}" stroke-width="2"/></svg>
          </div>
        </div>
        <p class="text-white/60 text-xs font-bold uppercase tracking-wider">${label}</p>
        <h3 class="text-2xl font-bold text-white mt-1">${displayValue}</h3>
        <p class="${valueClass} text-xs font-semibold mt-1">${type === 'Debt' ? 'Pay down to improve' : type === 'Crypto' ? 'Volatile' : 'Growth'}</p>
      </div>`;
  });
  container.innerHTML = cards.join('');
}

function renderAccountList() {
  const container = document.getElementById('account-list');
  if (!container) return;
  if (state.accounts.length === 0) {
    container.innerHTML = '<p class="text-white/40 text-sm">No accounts yet. Click “Add New Account” to start.</p>';
    return;
  }
  const totalNw = Math.max(getTotalNetWorth(), 0.001);
  let html = '';
  for (const acc of state.accounts) {
    const balance = getAccountBalance(acc);
    const isExpanded = state.expandedAccountId === acc.id;
    const isDebt = acc.type === 'Debt';
    const displayBalance = isDebt ? -balance : balance;
    const weightOfTotal = totalNw > 0 ? (Math.abs(displayBalance) / totalNw * 100) : 0;

    html += `
      <div class="glass-panel rounded-xl overflow-hidden">
        <button type="button" data-account-id="${acc.id}" class="account-row w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-white/50">${getTypeIcon(acc.type)}</span>
            <div>
              <span class="font-bold text-white">${escapeHtml(acc.name)}</span>
              <span class="text-white/50 text-sm ml-2">${escapeHtml(acc.institution)}</span>
            </div>
          </div>
          <div class="flex items-center gap-4">
            <span class="font-bold ${isDebt ? 'text-red-400' : 'text-primary'}">${formatMoneyFull(displayBalance)}</span>
            <span class="material-symbols-outlined text-white/40 transition-transform ${isExpanded ? 'rotate-180' : ''}">expand_more</span>
          </div>
        </button>
        ${isExpanded ? renderAccountDetail(acc, balance, totalNw) : ''}
      </div>`;
  }
  container.innerHTML = html;

  container.querySelectorAll('.account-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.accountId;
      state.expandedAccountId = state.expandedAccountId === id ? null : id;
      render();
    });
  });

  container.querySelectorAll('[data-add-holding]').forEach(btn => {
    btn.addEventListener('click', () => openAddHoldingModal(btn.dataset.addHolding));
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function plBadgeClass(plDollar) {
  if (plDollar == null || plDollar === 0) return 'text-white/60';
  return plDollar > 0 ? 'badge-profit' : 'badge-loss';
}

function renderAccountDetail(account, accountBalance, totalNw) {
  const holdings = account.holdings || [];
  const isSecurity = isSecurityType(account.type);
  const totalForWeight = Math.abs(accountBalance) || 0.001;

  const totalInvested = isSecurity ? getAccountTotalInvested(account) : null;
  const totalMarketValue = isSecurity ? getAccountTotalMarketValue(account) : null;

  let rows = '';
  for (const h of holdings) {
    const value = getHoldingValue(h, account.type);
    const valueNum = value != null ? value : 0;
    const weight = totalForWeight > 0 ? (valueNum / totalForWeight * 100) : 0;
    const assetLabel = isSecurity ? (h.ticker || '—') : 'Cash';
    const qtyOrBal = isSecurity ? (Number(h.quantity) || 0) : (Number(h.balance) || 0);
    const currentPrice = isSecurity ? (state.priceCache[h.ticker?.toUpperCase()]?.price ?? getPurchasePrice(h)) : null;
    const priceStr = currentPrice != null ? formatMoneyFull(currentPrice) : '—';

    const costBasis = isSecurity ? getHoldingCostBasis(h, account.type) : null;
    const costBasisStr = costBasis != null ? formatMoneyFull(costBasis) : '—';
    const marketValueStr = value != null ? formatMoneyFull(valueNum) : '—';
    const plDollar = isSecurity ? getHoldingProfitLossDollar(h, account.type) : null;
    const plPct = isSecurity ? getHoldingProfitLossPct(h, account.type) : null;
    const plDollarStr = plDollar != null ? (plDollar >= 0 ? '+' : '') + formatMoneyFull(plDollar) : '—';
    const plPctStr = plPct != null ? (plPct >= 0 ? '+' : '') + plPct.toFixed(2) + '%' : '—';
    const badgeClass = plBadgeClass(plDollar);

    rows += `
      <tr class="border-t border-white/10">
        <td class="py-3 px-4 text-white font-medium">${escapeHtml(assetLabel)}</td>
        <td class="py-3 px-4 text-white/70">${isSecurity ? qtyOrBal : formatMoneyFull(qtyOrBal)}</td>
        <td class="py-3 px-4 text-white/70">${priceStr}</td>
        <td class="py-3 px-4 text-white/70">${costBasisStr}</td>
        <td class="py-3 px-4 text-white font-semibold">${marketValueStr}</td>
        <td class="py-3 px-4 font-semibold ${badgeClass}">${plDollarStr}</td>
        <td class="py-3 px-4 font-semibold ${badgeClass}">${plPctStr}</td>
        <td class="py-3 px-4 text-primary font-semibold">${weight.toFixed(1)}%</td>
      </tr>`;
  }

  const displayBalance = account.type === 'Debt' ? -accountBalance : accountBalance;
  const accountWeight = totalNw > 0 ? (Math.abs(displayBalance) / totalNw * 100) : 0;

  const summaryStatsHtml = isSecurity && totalInvested != null && holdings.length > 0
    ? `
    <div class="flex flex-wrap items-center gap-6 mb-4 p-4 rounded-xl bg-white/5 border border-white/10">
      <div>
        <p class="text-[10px] uppercase tracking-wider text-white/50 font-bold">Total Invested</p>
        <p class="text-lg font-bold text-white/80">${formatMoneyFull(totalInvested)}</p>
      </div>
      <div>
        <p class="text-[10px] uppercase tracking-wider text-white/50 font-bold">Total Current Value</p>
        <p class="text-lg font-bold text-primary">${formatMoneyFull(totalMarketValue)}</p>
      </div>
      ${totalInvested != null && totalInvested > 0 && totalMarketValue != null
        ? (() => {
            const pl = totalMarketValue - totalInvested;
            const pct = (pl / totalInvested) * 100;
            const badge = pl >= 0 ? 'badge-profit' : 'badge-loss';
            return `
      <div>
        <p class="text-[10px] uppercase tracking-wider text-white/50 font-bold">Account P/L</p>
        <p class="text-lg font-bold ${badge}">${pl >= 0 ? '+' : ''}${formatMoneyFull(pl)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)</p>
      </div>`;
          })()
        : ''}
    </div>`
    : '';

  const tableHeaders = isSecurity
    ? `<th class="py-2 px-4 font-semibold">Asset</th>
       <th class="py-2 px-4 font-semibold">Qty</th>
       <th class="py-2 px-4 font-semibold">Price</th>
       <th class="py-2 px-4 font-semibold">Cost Basis</th>
       <th class="py-2 px-4 font-semibold">Market Value</th>
       <th class="py-2 px-4 font-semibold">P/L ($)</th>
       <th class="py-2 px-4 font-semibold">P/L (%)</th>
       <th class="py-2 px-4 font-semibold">Weight</th>`
    : `<th class="py-2 px-4 font-semibold">Asset</th>
       <th class="py-2 px-4 font-semibold">Balance</th>
       <th class="py-2 px-4 font-semibold">—</th>
       <th class="py-2 px-4 font-semibold">—</th>
       <th class="py-2 px-4 font-semibold">Value</th>
       <th class="py-2 px-4 font-semibold">—</th>
       <th class="py-2 px-4 font-semibold">—</th>
       <th class="py-2 px-4 font-semibold">Weight</th>`;

  return `
    <div class="border-t border-white/10 p-4 bg-black/20">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <h4 class="text-sm font-bold text-white/80">Holdings · ${formatMoneyFull(displayBalance)} (${accountWeight.toFixed(1)}% of portfolio)</h4>
        <button type="button" data-add-holding="${account.id}" class="text-primary hover:bg-primary/20 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 self-start sm:self-auto">
          <span class="material-symbols-outlined text-sm">add</span> Add Holding
        </button>
      </div>
      ${summaryStatsHtml}
      ${holdings.length === 0
        ? '<p class="text-white/40 text-sm">No holdings. Add a holding to see values and weights.</p>'
        : `
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="text-white/50 border-b border-white/10">${tableHeaders}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`}
    </div>`;
}

function render() {
  renderNetWorth();
  renderSummaryCards();
  renderAccountList();
}

// ——— Modals ———

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function openAddHoldingModal(accountId) {
  const account = state.accounts.find(a => a.id === accountId);
  if (!account) return;
  document.getElementById('holding-account-id').value = accountId;
  const isSecurity = isSecurityType(account.type);
  document.getElementById('holding-field-balance').classList.toggle('hidden', isSecurity);
  document.getElementById('holding-fields-security').classList.toggle('hidden', !isSecurity);
  document.getElementById('holding-balance').value = '';
  document.getElementById('holding-ticker').value = '';
  document.getElementById('holding-quantity').value = '';
  document.getElementById('holding-purchase-price').value = '';
  openModal('modal-add-holding');
}

// ——— Event handlers ———

function init() {
  render();

  document.getElementById('add-account-btn')?.addEventListener('click', () => openModal('modal-add-account'));

  document.getElementById('close-add-account')?.addEventListener('click', () => closeModal('modal-add-account'));
  document.getElementById('form-add-account')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('account-name').value.trim();
    const type = document.getElementById('account-type').value;
    const institution = document.getElementById('account-institution').value.trim();
    if (!name || !type || !institution) return;
    state.accounts.push({
      id: id(),
      name,
      type,
      institution,
      holdings: [],
    });
    document.getElementById('form-add-account').reset();
    closeModal('modal-add-account');
    render();
  });

  document.getElementById('close-add-holding')?.addEventListener('click', () => closeModal('modal-add-holding'));
  document.getElementById('form-add-holding')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const accountId = document.getElementById('holding-account-id').value;
    const account = state.accounts.find(a => a.id === accountId);
    if (!account) return;
    if (isSecurityType(account.type)) {
      const ticker = document.getElementById('holding-ticker').value.trim();
      const quantity = parseFloat(document.getElementById('holding-quantity').value) || 0;
      const purchasePriceRaw = document.getElementById('holding-purchase-price').value.trim();
      const purchasePrice = purchasePriceRaw ? parseFloat(purchasePriceRaw) : undefined;
      if (!ticker || quantity <= 0) return;
      account.holdings.push({ id: id(), ticker, quantity, purchasePrice });
    } else {
      const balance = parseFloat(document.getElementById('holding-balance').value) || 0;
      account.holdings.push({ id: id(), balance });
    }
    document.getElementById('form-add-holding').reset();
    closeModal('modal-add-holding');
    render();
  });

  document.getElementById('sync-prices-btn')?.addEventListener('click', () => {
    if (!state.apiKey) {
      openModal('modal-api-key');
      return;
    }
    refreshAllPrices();
  });

  document.getElementById('save-api-key')?.addEventListener('click', () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (key) {
      state.apiKey = key;
      localStorage.setItem('horizon60_apiKey', key);
      closeModal('modal-api-key');
      refreshAllPrices();
    }
  });
  document.getElementById('skip-api-key')?.addEventListener('click', () => {
    closeModal('modal-api-key');
  });

  // Close modals on backdrop click
  document.querySelectorAll('[data-modal]').forEach(modal => {
    modal.addEventListener('click', () => {
      if (modal.id) closeModal(modal.id);
    });
  });
}

// Load persisted state from localStorage if present
function loadState() {
  try {
    const raw = localStorage.getItem('horizon60_accounts');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) state.accounts = parsed;
    }
  } catch (e) {
    console.warn('Could not load saved accounts', e);
  }
}

function saveState() {
  try {
    localStorage.setItem('horizon60_accounts', JSON.stringify(state.accounts));
  } catch (e) {
    console.warn('Could not save accounts', e);
  }
}

function scheduleSave() {
  clearTimeout(scheduleSave._tid);
  scheduleSave._tid = setTimeout(saveState, 400);
}

// Persist after any render that follows a state change
const _render = render;
render = function() {
  _render();
  scheduleSave();
};

loadState();
init();
