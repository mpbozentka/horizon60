# Horizon 60 Wealth Engine Dashboard

A dark-themed wealth and FIRE (Financial Independence, Retire Early) dashboard with aggregate net worth, asset cards, Freedom Engine workspace, and projection chart.

## Run locally

**Option 1 — open in browser**  
Double-click `index.html` or open it from your browser (File → Open).

**Option 2 — local server (recommended)**  
From the project folder:

```bash
npx serve .
```

Then open **http://localhost:3000** in your browser.

## Stack

- **Tailwind CSS** (CDN) with custom theme (primary green, accent blue, glass panels)
- **Manrope** and **Material Symbols Outlined** from Google Fonts
- Single-file HTML; no build step required

## Features

- **Hierarchical portfolio**: Accounts (Name, Type, Institution) each contain multiple holdings.
- **Account types**: Cash, Retirement, Crypto, Debt.
- **Holdings**:  
  - **Cash/Debt**: manual balance only.  
  - **Retirement/Crypto**: Ticker symbol, quantity, cost basis (optional). Live prices via Alpha Vantage (see below).
- **Account detail**: Click an account (e.g. “Fidelity Roth IRA”) to expand and see a table of every holding with current value, weight in the account, and (for securities) price.
- **Aggregate Net Worth**: Sum of all account balances (Debt subtracted). Summary cards show totals by type.
- **Sync Data**: Fetches live prices for all tickers (requires free Alpha Vantage API key). Without a key, cost basis is used as fallback when set.
- **Persistence**: Accounts and holdings are saved in `localStorage`; API key is stored so you only enter it once.
- **Header**: Logo, nav, Freedom Score, Sync Data, profile avatar
- **Freedom Engine Workspace**: LEAN/FAT FIRE toggle, sliders, Time to Freedom
- **Future Horizon Projection**: SVG area chart; **Sidebar**: Encouragement Engine, Horizon Milestones, Asset Pulse

### Live prices (optional)

Get a free API key at [Alpha Vantage](https://www.alphavantage.co/support/#api-key), then click **Sync Data** and enter it when prompted. Prices are fetched via Alpha Vantage’s GLOBAL_QUOTE endpoint (stocks/ETFs). Crypto symbols may work where supported. The app uses a CORS proxy so it works from the browser without a backend.
