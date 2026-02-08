/**
 * Horizon 60 — Hierarchical Portfolio State & Logic
 * Data: accounts[] → each has holdings[] (balance for Cash/Debt; ticker, quantity, purchasePrice for Retirement/Crypto)
 */

const ACCOUNT_TYPES = ['Cash', 'Retirement', 'Crypto', 'Debt'];
const FINNHUB_QUOTE_URL = 'https://finnhub.io/api/v1/quote';
const COINGECKO_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

/** Ticker symbol -> CoinGecko coin id (for crypto price fetch) */
const COINGECKO_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple', ADA: 'cardano',
  DOGE: 'dogecoin', AVAX: 'avalanche-2', DOT: 'polkadot', MATIC: 'matic-network',
  LINK: 'chainlink', UNI: 'uniswap', ATOM: 'cosmos', LTC: 'litecoin', BCH: 'bitcoin-cash',
  NEAR: 'near', APT: 'aptos', SUI: 'sui', OP: 'optimism', ARB: 'arbitrum-one',
  INJ: 'injective-protocol', TIA: 'celestia', SEI: 'sei-network', PEPE: 'pepe',
  SHIB: 'shiba-inu', FLOKI: 'floki', WIF: 'dogwifcoin',
};

let state = {
  accounts: [],
  expandedAccountId: null,
  priceCache: {}, // ticker -> { price, at }
  apiKey: localStorage.getItem('horizon60_apiKey') || '',
};

/** Holdings parsed from CSV in Add Account modal; applied when user submits the form */
let pendingAddAccountHoldings = [];

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
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function isSecurityType(type) {
  return type === 'Retirement' || type === 'Crypto';
}

/** Current price for a security: override (if set) else API cache else purchase price */
function getCurrentPrice(holding) {
  if (holding.priceOverride != null && !Number.isNaN(holding.priceOverride)) return holding.priceOverride;
  const cached = state.priceCache[holding.ticker?.toUpperCase()]?.price;
  if (cached != null) return cached;
  return getPurchasePrice(holding);
}

/** Get value of one holding (balance for Cash/Debt; qty * price for Retirement/Crypto) */
function getHoldingValue(holding, accountType) {
  if (isSecurityType(accountType)) {
    const price = getCurrentPrice(holding);
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

/** Fetch quote from Finnhub (stocks), cache result. Uses CORS proxy to avoid 403 from browser. */
async function fetchQuote(symbol) {
  if (!symbol || !state.apiKey) return null;
  const sym = String(symbol).trim().toUpperCase();
  const url = FINNHUB_QUOTE_URL + '?symbol=' + encodeURIComponent(sym) + '&token=' + encodeURIComponent(state.apiKey);
  try {
    const res = await fetch(CORS_PROXY + encodeURIComponent(url));
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    const price = data && typeof data.c === 'number' && !Number.isNaN(data.c) ? data.c : null;
    if (price != null && price > 0) {
      state.priceCache[sym] = { price, at: Date.now() };
      return price;
    }
    return null;
  } catch (e) {
    console.warn('Quote fetch failed', sym, e);
    return null;
  }
}

/** Fetch crypto price from CoinGecko (no API key), cache result. Tries direct fetch first, then CORS proxy. */
async function fetchQuoteCoinGecko(symbol) {
  if (!symbol) return null;
  const sym = String(symbol).trim().toUpperCase();
  const id = COINGECKO_IDS[sym] || sym.toLowerCase();
  const url = COINGECKO_PRICE_URL + '?ids=' + encodeURIComponent(id) + '&vs_currencies=usd';

  function parseResponse(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    if (data && typeof data.contents === 'string') {
      try {
        data = JSON.parse(data.contents);
      } catch {
        return null;
      }
    }
    const coin = data && data[id];
    return coin && typeof coin.usd === 'number' && !Number.isNaN(coin.usd) ? coin.usd : null;
  }

  try {
    let res = await fetch(url);
    let text = await res.text();
    if (!res.ok) {
      res = await fetch(CORS_PROXY + encodeURIComponent(url));
      text = await res.text();
    }
    const price = parseResponse(text);
    if (price != null && price > 0) {
      state.priceCache[sym] = { price, at: Date.now() };
      return price;
    }
    return null;
  } catch (e) {
    try {
      const res = await fetch(CORS_PROXY + encodeURIComponent(url));
      const text = await res.text();
      const price = parseResponse(text);
      if (price != null && price > 0) {
        state.priceCache[sym] = { price, at: Date.now() };
        return price;
      }
    } catch (e2) {
      console.warn('CoinGecko fetch failed', sym, e2);
    }
    return null;
  }
}

/** Parse CSV text into array of row objects (first row = headers) */
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < lines[i].length; j++) {
      const c = lines[i][j];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === ',' && !inQuotes) {
        values.push(current.replace(/^"|"$/g, '').trim());
        current = '';
      } else current += c;
    }
    values.push(current.replace(/^"|"$/g, '').trim());
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] != null ? values[idx] : ''; });
    rows.push(obj);
  }
  return rows;
}

/** Map CSV Type column to our account type */
function mapCSVTypeToAccountType(typeStr) {
  const t = (typeStr || '').toLowerCase();
  if (t.includes('cash')) return 'Cash';
  if (t.includes('debt') || t.includes('loan')) return 'Debt';
  if (t.includes('crypto')) return 'Crypto';
  return 'Retirement';
}

/** Parse one CSV row into ticker, quantity, average cost basis (template: Ticker, Quantity, Average Cost Basis) */
function parseCSVRowToHolding(row) {
  const ticker = (row['Ticker'] || row['Symbol'] || '').trim();
  const qty = parseFloat(row['Quantity']) || 0;
  const avgCost = parseFloat(String(row['Average Cost Basis'] || '').replace(/[$,]/g, '')) || 0;
  const purchasePrice = avgCost > 0 ? avgCost : undefined;
  return { ticker: ticker ? ticker.toUpperCase() : '', quantity: qty, purchasePrice };
}

/** Import parsed CSV rows into state.accounts (group by Account Name). Legacy: only used if CSV has Account Name column. */
function importFromCSV(rows) {
  if (!rows.length) return;
  const byAccount = {};
  for (const row of rows) {
    const name = (row['Account Name'] || '').trim();
    if (!name) continue;
    if (!byAccount[name]) byAccount[name] = { type: mapCSVTypeToAccountType(row['Type']), rows: [] };
    byAccount[name].rows.push(row);
  }
  for (const [accountName, data] of Object.entries(byAccount)) {
    const type = data.type;
    const isSecurity = type === 'Retirement' || type === 'Crypto';
    const holdings = [];
    for (const row of data.rows) {
      const parsed = parseCSVRowToHolding(row);
      if (isSecurity && parsed.ticker) {
        holdings.push({ id: id(), ticker: parsed.ticker, quantity: parsed.quantity, purchasePrice: parsed.purchasePrice });
      }
    }
    if (holdings.length) {
      state.accounts.push({
        id: id(),
        name: accountName,
        type,
        institution: '',
        holdings,
      });
    }
  }
  saveState();
  render();
}

/** Import parsed CSV rows into a single account (used from Add Holding modal). Template: Ticker, Quantity, Average Cost Basis. */
function importFromCSVIntoAccount(rows, accountId) {
  const account = state.accounts.find(a => a.id === accountId);
  if (!account || !rows.length) return 0;
  const isSecurity = isSecurityType(account.type);
  let added = 0;
  for (const row of rows) {
    const parsed = parseCSVRowToHolding(row);
    if (isSecurity && parsed.ticker) {
      account.holdings.push({ id: id(), ticker: parsed.ticker, quantity: parsed.quantity, purchasePrice: parsed.purchasePrice });
      added++;
    }
  }
  if (added) {
    saveState();
    render();
  }
  return added;
}

/** Parse CSV rows into holding objects (no id). Template: Ticker, Quantity, Average Cost Basis. Used when importing in Add Account modal. */
function parseCSVRowsToHoldings(rows, type) {
  var list = [];
  var isSecurity = type === 'Retirement' || type === 'Crypto';
  for (var i = 0; i < rows.length; i++) {
    var parsed = parseCSVRowToHolding(rows[i]);
    if (isSecurity && parsed.ticker) {
      list.push({ ticker: parsed.ticker, quantity: parsed.quantity, purchasePrice: parsed.purchasePrice });
    }
  }
  return list;
}

/** Refresh prices for all unique tickers in state */
async function refreshAllPrices() {
  const cryptoTickers = new Set();
  const retirementTickers = new Set();
  for (const a of state.accounts) {
    if (!isSecurityType(a.type)) continue;
    a.holdings.forEach(h => {
      if (!h.ticker) return;
      const t = h.ticker.trim().toUpperCase();
      if (a.type === 'Crypto' || COINGECKO_IDS[t]) cryptoTickers.add(t);
      else retirementTickers.add(t);
    });
  }
  for (const t of cryptoTickers) {
    await fetchQuoteCoinGecko(t);
    await new Promise(r => setTimeout(r, 250));
  }
  for (const t of retirementTickers) {
    if (state.apiKey) await fetchQuote(t);
    await new Promise(r => setTimeout(r, 300));
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
        <div class="flex items-center gap-1 w-full">
          <button type="button" data-account-id="${acc.id}" class="account-row flex-1 flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors">
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-white/50">${getTypeIcon(acc.type)}</span>
              <div>
                <span class="font-bold text-white">${escapeHtml(acc.name)}</span>
                <span class="text-white/50 text-sm ml-2">${acc.institution ? escapeHtml(acc.institution) : '—'}</span>
              </div>
            </div>
            <div class="flex items-center gap-4">
              <span class="font-bold ${isDebt ? 'text-red-400' : 'text-primary'}">${formatMoneyFull(displayBalance)}</span>
              <span class="material-symbols-outlined text-white/40 transition-transform ${isExpanded ? 'rotate-180' : ''}">expand_more</span>
            </div>
          </button>
          <button type="button" data-edit-account="${acc.id}" class="account-edit-btn p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors" title="Edit account" aria-label="Edit account">
            <span class="material-symbols-outlined text-lg">edit</span>
          </button>
        </div>
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

  container.querySelectorAll('.account-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditAccountModal(btn.dataset.editAccount);
    });
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

  const totalInvested = isSecurity ? getAccountTotalInvested(account) : accountBalance;
  const totalMarketValue = isSecurity ? getAccountTotalMarketValue(account) : accountBalance;

  let rows = '';
  for (const h of holdings) {
    const value = getHoldingValue(h, account.type);
    const valueNum = value != null ? value : 0;
    const weight = totalForWeight > 0 ? (valueNum / totalForWeight * 100) : 0;
    const assetLabel = isSecurity ? (h.ticker || '—') : (account.type === 'Debt' ? 'Debt' : 'Cash');
    const qtyOrBal = isSecurity ? (Number(h.quantity) || 0) : (Number(h.balance) || 0);
    const currentPrice = isSecurity ? getCurrentPrice(h) : null;
    const priceStr = currentPrice != null ? formatMoneyFull(currentPrice) : '—';

    const avgCostBasis = isSecurity ? getPurchasePrice(h) : null;
    const avgCostBasisStr = avgCostBasis != null ? formatMoneyFull(avgCostBasis) : '—';
    const costBasis = isSecurity ? getHoldingCostBasis(h, account.type) : (isSecurity ? null : valueNum);
    const costBasisStr = costBasis != null ? formatMoneyFull(costBasis) : '—';
    const marketValueStr = value != null ? formatMoneyFull(valueNum) : '—';
    const plDollar = isSecurity ? getHoldingProfitLossDollar(h, account.type) : 0;
    const plPct = isSecurity ? getHoldingProfitLossPct(h, account.type) : 0;
    const plDollarStr = plDollar != null ? (plDollar >= 0 ? '+' : '') + formatMoneyFull(plDollar) : '—';
    const plPctStr = plPct != null ? (plPct >= 0 ? '+' : '') + plPct.toFixed(2) + '%' : '—';
    const badgeClass = plBadgeClass(plDollar);

    const qtyDisplay = isSecurity ? qtyOrBal : '—';
    rows += `
      <tr class="border-t border-white/10">
        <td class="py-3 px-4 text-white font-medium">${escapeHtml(assetLabel)}</td>
        <td class="py-3 px-4 text-white/70">${isSecurity ? qtyDisplay : '—'}</td>
        <td class="py-3 px-4 text-white/70">${priceStr}</td>
        <td class="py-3 px-4 text-white/70">${avgCostBasisStr}</td>
        <td class="py-3 px-4 text-white/70">${costBasisStr}</td>
        <td class="py-3 px-4 text-white font-semibold">${marketValueStr}</td>
        <td class="py-3 px-4 font-semibold ${badgeClass}">${plDollarStr}</td>
        <td class="py-3 px-4 font-semibold ${badgeClass}">${plPctStr}</td>
        <td class="py-3 px-4 text-primary font-semibold">${weight.toFixed(1)}%</td>
        <td class="py-3 px-4">
          <button type="button" data-edit-holding data-account-id="${escapeHtml(account.id)}" data-holding-id="${escapeHtml(h.id)}" class="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10" title="Edit">
            <span class="material-symbols-outlined text-lg">edit</span>
          </button>
        </td>
      </tr>`;
  }

  const displayBalance = account.type === 'Debt' ? -accountBalance : accountBalance;
  const accountWeight = totalNw > 0 ? (Math.abs(displayBalance) / totalNw * 100) : 0;

  var accountPlDollar = totalMarketValue != null && totalInvested != null ? totalMarketValue - totalInvested : 0;
  var accountPlPct = totalInvested != null && totalInvested > 0 && totalMarketValue != null ? (accountPlDollar / totalInvested) * 100 : 0;
  var accountPlBadge = accountPlDollar >= 0 ? 'badge-profit' : 'badge-loss';

  const summaryStatsHtml = `
    <div class="flex flex-wrap items-center gap-6 mb-4 p-4 rounded-xl bg-white/5 border border-white/10">
      <div>
        <p class="text-[10px] uppercase tracking-wider text-white/50 font-bold">Total Invested</p>
        <p class="text-lg font-bold text-white/80">${formatMoneyFull(totalInvested != null ? totalInvested : 0)}</p>
      </div>
      <div>
        <p class="text-[10px] uppercase tracking-wider text-white/50 font-bold">Total Current Value</p>
        <p class="text-lg font-bold text-primary">${formatMoneyFull(totalMarketValue != null ? totalMarketValue : 0)}</p>
      </div>
      <div>
        <p class="text-[10px] uppercase tracking-wider text-white/50 font-bold">Account P/L</p>
        <p class="text-lg font-bold ${accountPlBadge}">${accountPlDollar >= 0 ? '+' : ''}${formatMoneyFull(accountPlDollar)} (${accountPlPct >= 0 ? '+' : ''}${accountPlPct.toFixed(2)}%)</p>
      </div>
    </div>`;

  const tableHeaders = `<th class="py-2 px-4 font-semibold">Asset</th>
       <th class="py-2 px-4 font-semibold">Qty</th>
       <th class="py-2 px-4 font-semibold">Price</th>
       <th class="py-2 px-4 font-semibold">Avg Cost Basis</th>
       <th class="py-2 px-4 font-semibold">Cost Basis</th>
       <th class="py-2 px-4 font-semibold">Market Value</th>
       <th class="py-2 px-4 font-semibold">P/L ($)</th>
       <th class="py-2 px-4 font-semibold">P/L (%)</th>
       <th class="py-2 px-4 font-semibold">Weight</th>
       <th class="py-2 px-4 font-semibold w-12"></th>`;

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
  if (id === 'modal-add-account') pendingAddAccountHoldings = [];
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeModal(id, focusAfter) {
  const modal = document.getElementById(id);
  if (modal) {
    if (modal.contains(document.activeElement)) {
      if (focusAfter && typeof focusAfter.focus === 'function') focusAfter.focus();
      else document.activeElement.blur();
    }
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

function openEditAccountModal(accountId) {
  const account = state.accounts.find(a => a.id === accountId);
  if (!account) return;
  const idEl = document.getElementById('account-edit-id');
  const nameEl = document.getElementById('account-edit-name');
  const typeEl = document.getElementById('account-edit-type');
  const institutionEl = document.getElementById('account-edit-institution');
  if (idEl) idEl.value = account.id;
  if (nameEl) nameEl.value = account.name;
  if (typeEl) typeEl.value = account.type;
  if (institutionEl) institutionEl.value = account.institution || '';
  closeModal('modal-add-account');
  openModal('modal-edit-account');
}

function openEditHoldingModal(accountId, holdingId) {
  const account = state.accounts.find(a => a.id === accountId);
  if (!account) return;
  const holding = account.holdings && account.holdings.find(h => h.id === holdingId);
  if (!holding) return;
  const isSecurity = isSecurityType(account.type);
  document.getElementById('edit-holding-account-id').value = accountId;
  document.getElementById('edit-holding-id').value = holdingId;
  document.getElementById('edit-holding-field-balance').classList.toggle('hidden', isSecurity);
  document.getElementById('edit-holding-fields-security').classList.toggle('hidden', !isSecurity);
  if (isSecurity) {
    document.getElementById('edit-holding-ticker').value = holding.ticker || '';
    document.getElementById('edit-holding-quantity').value = holding.quantity != null ? holding.quantity : '';
    document.getElementById('edit-holding-purchase-price').value = holding.purchasePrice != null ? holding.purchasePrice : '';
    var currentPriceEl = document.getElementById('edit-holding-current-price');
    if (currentPriceEl) currentPriceEl.value = holding.priceOverride != null && !Number.isNaN(holding.priceOverride) ? holding.priceOverride : '';
  } else {
    document.getElementById('edit-holding-balance').value = holding.balance != null ? holding.balance : '';
  }
  openModal('modal-edit-holding');
}

// ——— Event handlers ———

function init() {
  render();

  // Ensure CSV template download works when app is under /wealth/ (Clerk) or at root
  var base = window.location.pathname.indexOf('/wealth') !== -1 ? '/wealth/' : '';
  var templateLink = document.getElementById('download-template-btn');
  if (templateLink) templateLink.setAttribute('href', base + 'import-template.csv');
  var templateLinkAddAccount = document.getElementById('download-template-add-account');
  if (templateLinkAddAccount) templateLinkAddAccount.setAttribute('href', base + 'import-template.csv');

  document.getElementById('add-account-btn')?.addEventListener('click', () => openModal('modal-add-account'));

  document.getElementById('account-list')?.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-edit-holding]');
    if (btn) {
      const accountId = btn.getAttribute('data-account-id');
      const holdingId = btn.getAttribute('data-holding-id');
      if (accountId && holdingId) openEditHoldingModal(accountId, holdingId);
    }
  });

  document.getElementById('import-csv-add-account')?.addEventListener('click', function () {
    document.getElementById('csv-file-input-add-account')?.click();
  });
  document.getElementById('csv-file-input-add-account')?.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    var inputEl = e.target;
    reader.onload = function () {
      try {
        var rows = parseCSV(reader.result);
        if (!rows.length) {
          alert('CSV is empty or has no data rows.');
          inputEl.value = '';
          return;
        }
        var type = document.getElementById('account-type').value;
        pendingAddAccountHoldings = parseCSVRowsToHoldings(rows, type);
        var count = pendingAddAccountHoldings.length;
        alert(count ? 'Imported ' + count + ' holding(s). Enter account name and click Add Account to create.' : 'No holdings found. Use columns: Ticker, Quantity, Average Cost Basis.');
      } catch (err) {
        alert('Could not parse CSV: ' + (err.message || err));
      }
      inputEl.value = '';
    };
    reader.readAsText(file);
  });

  document.getElementById('import-csv-btn')?.addEventListener('click', () => document.getElementById('csv-file-input')?.click());
  document.getElementById('csv-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const accountId = document.getElementById('holding-account-id')?.value?.trim();
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCSV(reader.result);
        if (!rows.length) { alert('CSV is empty or has no data rows.'); e.target.value = ''; return; }
        if (accountId) {
          const added = importFromCSVIntoAccount(rows, accountId);
          alert(added ? 'Import complete. ' + added + ' holding(s) added to this account.' : 'No matching holdings found for this account type.');
          if (added && state.apiKey) refreshAllPrices();
        } else {
          const before = state.accounts.length;
          importFromCSV(rows);
          const added = state.accounts.length - before;
          alert('Import complete. ' + added + ' account(s) added.');
          if (added && state.apiKey) refreshAllPrices();
        }
      } catch (err) {
        alert('Could not parse CSV: ' + (err.message || err));
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  document.getElementById('close-add-account')?.addEventListener('click', () => closeModal('modal-add-account', document.getElementById('add-account-btn')));
  document.getElementById('form-add-account')?.addEventListener('submit', (e) => {
    e.preventDefault();
    window.submitAddAccount?.();
  });

  document.getElementById('close-edit-account')?.addEventListener('click', () => closeModal('modal-edit-account', document.body));
  document.getElementById('form-edit-account')?.addEventListener('submit', (e) => {
    e.preventDefault();
    window.submitEditAccount?.();
  });
  document.getElementById('delete-account-btn')?.addEventListener('click', () => {
    const accountId = document.getElementById('account-edit-id')?.value;
    if (!accountId) return;
    if (!confirm('Delete this account and all its holdings? This cannot be undone.')) return;
    state.accounts = state.accounts.filter(a => a.id !== accountId);
    saveState();
    closeModal('modal-edit-account', document.body);
    render();
  });

  document.getElementById('close-add-holding')?.addEventListener('click', () => closeModal('modal-add-holding', document.body));
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
    saveState();
    document.getElementById('form-add-holding').reset();
    closeModal('modal-add-holding');
    render();
  });

  document.getElementById('close-edit-holding')?.addEventListener('click', () => closeModal('modal-edit-holding', document.body));
  document.getElementById('form-edit-holding')?.addEventListener('submit', function (e) {
    e.preventDefault();
    const accountId = document.getElementById('edit-holding-account-id')?.value;
    const holdingId = document.getElementById('edit-holding-id')?.value;
    const account = state.accounts.find(a => a.id === accountId);
    const holding = account && account.holdings && account.holdings.find(h => h.id === holdingId);
    if (!account || !holding) return;
    if (isSecurityType(account.type)) {
      const ticker = document.getElementById('edit-holding-ticker').value.trim();
      const quantity = parseFloat(document.getElementById('edit-holding-quantity').value) || 0;
      const purchasePriceRaw = document.getElementById('edit-holding-purchase-price').value.trim();
      const purchasePrice = purchasePriceRaw ? parseFloat(purchasePriceRaw) : undefined;
      if (!ticker || quantity <= 0) return;
      holding.ticker = ticker;
      holding.quantity = quantity;
      holding.purchasePrice = purchasePrice;
      var currentPriceRaw = document.getElementById('edit-holding-current-price').value.trim();
      if (currentPriceRaw) {
        var override = parseFloat(currentPriceRaw);
        holding.priceOverride = !Number.isNaN(override) && override >= 0 ? override : undefined;
      } else {
        delete holding.priceOverride;
      }
    } else {
      const balance = parseFloat(document.getElementById('edit-holding-balance').value) || 0;
      holding.balance = balance;
    }
    saveState();
    closeModal('modal-edit-holding');
    render();
    if (holding.ticker && state.apiKey) refreshAllPrices();
  });
  document.getElementById('delete-holding-btn')?.addEventListener('click', function () {
    const accountId = document.getElementById('edit-holding-account-id')?.value;
    const holdingId = document.getElementById('edit-holding-id')?.value;
    const account = state.accounts.find(a => a.id === accountId);
    if (!account || !holdingId || !confirm('Delete this holding? This cannot be undone.')) return;
    account.holdings = account.holdings.filter(h => h.id !== holdingId);
    saveState();
    closeModal('modal-edit-holding');
    render();
  });

  document.getElementById('sync-prices-btn')?.addEventListener('click', () => {
    const hasCrypto = state.accounts.some(a => a.type === 'Crypto' && a.holdings?.some(h => h.ticker));
    const hasRetirement = state.accounts.some(a => a.type === 'Retirement' && a.holdings?.some(h => h.ticker));
    if (hasRetirement && !state.apiKey) {
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

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  document.getElementById('record-snapshot-btn')?.addEventListener('click', () => {
    recordSnapshot();
    renderSnapshotList();
  });
  document.getElementById('form-edit-snapshot')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveEditedSnapshot();
  });
  document.getElementById('close-edit-snapshot')?.addEventListener('click', () => closeModal('modal-edit-snapshot', document.body));
  document.getElementById('delete-snapshot-btn')?.addEventListener('click', () => {
    const indexEl = document.getElementById('edit-snapshot-index');
    const index = parseInt(indexEl?.value, 10);
    if (!Number.isNaN(index)) deleteSnapshot(index);
  });

  // Close modals on backdrop click
  document.querySelectorAll('[data-modal]').forEach(modal => {
    modal.addEventListener('click', () => {
      if (modal.id) closeModal(modal.id);
    });
  });
}

const NET_WORTH_HISTORY_KEY = 'horizon60_netWorthHistory';

/** @returns {Array<{ date: string, totalNetWorth: number, accounts: Array<{ id: string, name: string, balance: number }> }>} */
function getNetWorthHistory() {
  try {
    const raw = localStorage.getItem(NET_WORTH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveNetWorthHistory(history) {
  try {
    localStorage.setItem(NET_WORTH_HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    console.warn('Could not save net worth history', e);
  }
}

/** Record current total net worth and each account balance with today's date (YYYY-MM-DD). */
function recordSnapshot() {
  const date = new Date().toISOString().slice(0, 10);
  const totalNetWorth = getTotalNetWorth();
  const accounts = state.accounts.map(a => ({
    id: a.id,
    name: a.name,
    balance: a.type === 'Debt' ? -getAccountBalance(a) : getAccountBalance(a),
  }));
  const history = getNetWorthHistory();
  history.push({ date, totalNetWorth, accounts });
  history.sort((a, b) => a.date.localeCompare(b.date));
  saveNetWorthHistory(history);
  updateNetWorthChart();
}

let netWorthChartInstance = null;

/** Build or update the net worth chart from stored history. Call when History tab is shown or after recording. */
function updateNetWorthChart() {
  const canvas = document.getElementById('net-worth-chart');
  if (!canvas) return;
  const history = getNetWorthHistory();
  if (netWorthChartInstance) {
    netWorthChartInstance.destroy();
    netWorthChartInstance = null;
  }
  if (!history.length) return;
  const labels = history.map(s => s.date);
  const colors = [
    '#0df20d', // primary - total
    '#00d4ff', '#e07a7a', '#fbbf24', '#a78bfa', '#34d399', '#f472b6', '#60a5fa',
  ];
  const datasets = [];
  if (labels.length) {
    datasets.push({
      label: 'Total net worth',
      data: history.map(s => s.totalNetWorth),
      borderColor: colors[0],
      backgroundColor: colors[0] + '20',
      fill: false,
      tension: 0.2,
    });
    const accountIds = new Set();
    for (const s of history) {
      for (const a of s.accounts || []) accountIds.add(a.id);
    }
    const accountList = state.accounts.filter(a => accountIds.has(a.id));
    accountList.forEach((acc, i) => {
      const color = colors[(i + 1) % colors.length];
      const values = history.map(s => {
        const row = (s.accounts || []).find(a => a.id === acc.id);
        return row ? row.balance : null;
      });
      datasets.push({
        label: acc.name,
        data: values,
        borderColor: color,
        backgroundColor: color + '20',
        fill: false,
        tension: 0.2,
      });
    });
  }
  const ctx = canvas.getContext('2d');
  netWorthChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { color: 'rgba(255,255,255,0.6)', maxRotation: 45 },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: {
            color: 'rgba(255,255,255,0.6)',
            callback: (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v),
          },
        },
      },
    },
  });
}

/** Render the snapshot list in the History tab; each row has Edit and Delete. */
function renderSnapshotList() {
  const container = document.getElementById('snapshot-list');
  if (!container) return;
  const history = getNetWorthHistory();
  if (!history.length) {
    container.innerHTML = '<p class="text-white/40 text-sm">No snapshots yet. Record a snapshot to track over time.</p>';
    return;
  }
  container.innerHTML = history
    .map(
      (s, i) => `
    <div class="glass-panel rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-4">
        <span class="text-white font-semibold">${s.date}</span>
        <span class="text-primary font-bold">${formatMoneyFull(s.totalNetWorth)}</span>
      </div>
      <div class="flex items-center gap-2">
        <button type="button" data-snapshot-edit="${i}" class="text-white/70 hover:text-primary hover:bg-white/10 px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1">
          <span class="material-symbols-outlined text-sm">edit</span> Edit
        </button>
        <button type="button" data-snapshot-delete="${i}" class="text-white/70 hover:text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1">
          <span class="material-symbols-outlined text-sm">delete</span> Delete
        </button>
      </div>
    </div>`
    )
    .join('');
  container.querySelectorAll('[data-snapshot-edit]').forEach(btn => {
    btn.addEventListener('click', () => openEditSnapshotModal(parseInt(btn.dataset.snapshotEdit, 10)));
  });
  container.querySelectorAll('[data-snapshot-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteSnapshot(parseInt(btn.dataset.snapshotDelete, 10)));
  });
}

function openEditSnapshotModal(index) {
  const history = getNetWorthHistory();
  const s = history[index];
  if (!s) return;
  document.getElementById('edit-snapshot-index').value = String(index);
  document.getElementById('edit-snapshot-date').value = s.date;
  document.getElementById('edit-snapshot-total').value = String(s.totalNetWorth ?? 0);
  const accountsContainer = document.getElementById('edit-snapshot-accounts');
  accountsContainer.innerHTML = (s.accounts || [])
    .map(
      (a) => `
    <div>
      <label class="block text-sm font-semibold text-white/80 mb-1">${escapeHtml(a.name)} ($)</label>
      <input type="number" step="0.01" data-account-id="${escapeHtml(a.id)}" value="${a.balance ?? 0}" class="edit-snapshot-balance w-full rounded-lg bg-white/10 border border-white/20 px-4 py-2.5 text-white focus:border-primary focus:ring-1 focus:ring-primary"/>
    </div>`
    )
    .join('');
  openModal('modal-edit-snapshot');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function deleteSnapshot(index) {
  const history = getNetWorthHistory();
  if (index < 0 || index >= history.length) return;
  history.splice(index, 1);
  saveNetWorthHistory(history);
  closeModal('modal-edit-snapshot', document.body);
  updateNetWorthChart();
  renderSnapshotList();
}

function saveEditedSnapshot() {
  const indexEl = document.getElementById('edit-snapshot-index');
  const index = parseInt(indexEl?.value, 10);
  const history = getNetWorthHistory();
  const s = history[index];
  if (!s || !s.accounts?.length) {
    const date = document.getElementById('edit-snapshot-date')?.value;
    const total = parseFloat(document.getElementById('edit-snapshot-total')?.value) || 0;
    if (!date) return;
    history[index] = { date, totalNetWorth: total, accounts: [] };
  } else {
    const date = document.getElementById('edit-snapshot-date')?.value;
    const total = parseFloat(document.getElementById('edit-snapshot-total')?.value) || 0;
    const accounts = s.accounts.map((a) => {
      const input = document.querySelector(`.edit-snapshot-balance[data-account-id="${a.id}"]`);
      const balance = input ? parseFloat(input.value) : a.balance;
      return { id: a.id, name: a.name, balance: Number.isNaN(balance) ? a.balance : balance };
    });
    history[index] = { date, totalNetWorth: total, accounts };
  }
  history.sort((a, b) => a.date.localeCompare(b.date));
  saveNetWorthHistory(history);
  closeModal('modal-edit-snapshot', document.body);
  updateNetWorthChart();
  renderSnapshotList();
}

function showTab(tabId) {
  ['overview', 'history', 'forecast'].forEach(id => {
    const panel = document.getElementById('panel-' + id);
    const btn = document.querySelector('.tab-btn[data-tab="' + id + '"]');
    if (panel) panel.classList.toggle('hidden', id !== tabId);
    if (btn) {
      if (id === tabId) {
        btn.classList.add('bg-primary', 'text-background-dark');
        btn.classList.remove('text-white/60');
      } else {
        btn.classList.remove('bg-primary', 'text-background-dark');
        btn.classList.add('text-white/60');
      }
    }
  });
  if (tabId === 'history') {
    updateNetWorthChart();
    renderSnapshotList();
  }
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

// Expose for Clerk/embedding: open Add Account modal from outside
window.openAddAccountModal = function () {
  openModal('modal-add-account');
};

// Run from form onsubmit so Add Account works even if init() listeners attach late
window.submitAddAccount = function () {
  const nameEl = document.getElementById('account-name');
  const typeEl = document.getElementById('account-type');
  const institutionEl = document.getElementById('account-institution');
  if (!nameEl || !typeEl) return;
  const name = nameEl.value.trim();
  const type = typeEl.value;
  const institution = institutionEl ? institutionEl.value.trim() : '';
  if (!name || !type) return;
  const holdings = [];
  for (var i = 0; i < pendingAddAccountHoldings.length; i++) {
    var h = pendingAddAccountHoldings[i];
    holdings.push(h.ticker != null ? { id: id(), ticker: h.ticker, quantity: h.quantity, purchasePrice: h.purchasePrice } : { id: id(), balance: h.balance });
  }
  state.accounts.push({
    id: id(),
    name,
    type,
    institution: institution || '',
    holdings: holdings,
  });
  pendingAddAccountHoldings = [];
  saveState();
  if (document.getElementById('form-add-account')) document.getElementById('form-add-account').reset();
  closeModal('modal-add-account', document.getElementById('add-account-btn'));
  render();
  if (holdings.some(function (h) { return h.ticker; }) && state.apiKey) refreshAllPrices();
};

window.submitEditAccount = function () {
  const accountId = document.getElementById('account-edit-id')?.value;
  const name = document.getElementById('account-edit-name')?.value?.trim();
  const type = document.getElementById('account-edit-type')?.value;
  const institution = document.getElementById('account-edit-institution')?.value?.trim() ?? '';
  if (!accountId || !name || !type) return;
  const account = state.accounts.find(a => a.id === accountId);
  if (!account) return;
  account.name = name;
  account.type = type;
  account.institution = institution;
  saveState();
  closeModal('modal-edit-account', document.body);
  render();
};

loadState();
init();
