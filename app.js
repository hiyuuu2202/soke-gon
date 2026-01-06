const LEDGER_URL = "data/ledger.txt";

const el = (id) => document.getElementById(id);

function parseAmount(raw) {
  let s = String(raw).trim().toLowerCase();
  const unitMatch = s.match(/^([0-9][0-9.,\s]*)([km])$/i);
  let unit = null;
  if (unitMatch) {
    s = unitMatch[1];
    unit = unitMatch[2];
  }
  const clean = s.replace(/[,\s]/g, "").replace(/\.(?=\d{3}\b)/g, "");
  const n = Number(clean);
  if (!Number.isFinite(n)) throw new Error(`Số tiền không hợp lệ: "${raw}"`);
  if (unit === "k") return Math.round(n * 1000);
  if (unit === "m") return Math.round(n * 1000000);
  return n;
}

function toISODate(ddmmyyyy) {
  const s = String(ddmmyyyy).trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) throw new Error(`Ngày không hợp lệ (dd/mm/yyyy): "${ddmmyyyy}"`);
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function toDDMMYYYY(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return String(iso);
  const [, yyyy, mm, dd] = m;
  return `${dd}/${mm}/${yyyy}`;
}

function monthKeyFromISODate(iso) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(iso));
  return m ? `${m[1]}-${m[2]}` : "unknown";
}

function parseLedgerText(text) {
  const lines = text.split(/\r?\n/);
  let currentDateISO = null;
  const items = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) continue;
    if (line.startsWith("#")) continue;

    if (line.startsWith("*")) {
      const datePart = line.slice(1).trim();
      currentDateISO = toISODate(datePart);
      continue;
    }

    const txMatch = /^([+-])\s*([0-9][0-9.,\s]*|[0-9]+(?:\.[0-9]+)?[kKmM]?)\s*(?::\s*(.*))?$/.exec(line);
    if (txMatch) {
      if (!currentDateISO) {
        throw new Error(`Dòng ${i + 1}: Có giao dịch nhưng chưa có ngày (*dd/mm/yyyy)\n> ${rawLine}`);
      }
      const sign = txMatch[1];
      const amountAbs = parseAmount(txMatch[2]);
      const note = (txMatch[3] ?? "").trim();

      items.push({
        date: currentDateISO,
        type: sign === "+" ? "income" : "expense",
        amount: amountAbs,
        note
      });
      continue;
    }

    throw new Error(`Dòng ${i + 1} không đúng định dạng:\n> ${rawLine}`);
  }

  return items;
}

function formatMoneyVND(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("vi-VN");
}

function setError(msg) {
  const box = el("errorBox");
  if (!msg) {
    box.classList.add("hidden");
    box.textContent = "";
    return;
  }
  box.classList.remove("hidden");
  box.textContent = msg;
}

function buildMonthOptions(items) {
  const months = Array.from(new Set(items.map(x => monthKeyFromISODate(x.date))))
    .filter(m => m !== "unknown")
    .sort((a, b) => b.localeCompare(a));

  const sel = el("monthFilter");
  sel.innerHTML = "";

  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "Tất cả";
  sel.appendChild(optAll);

  for (const m of months) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    sel.appendChild(opt);
  }
}

function applyFilterAndSort(items) {
  const month = el("monthFilter").value;
  const sortMode = el("sortMode").value;

  let out = items.slice();

  if (month && month !== "all") {
    out = out.filter(x => monthKeyFromISODate(x.date) === month);
  }

  if (sortMode === "dateAsc") {
    out.sort((a, b) => (a.date + a.type + a.note).localeCompare(b.date + b.type + b.note));
  } else if (sortMode === "dateDesc") {
    out.sort((a, b) => (b.date + b.type + b.note).localeCompare(a.date + a.type + a.note));
  }

  return out;
}

function renderChart(items) {
  const canvas = el("chartCanvas");
  canvas.innerHTML = "";

  if (items.length === 0) {
    canvas.innerHTML = '<div class="emptyState">Chưa có dữ liệu</div>';
    return;
  }

  // Group by date
  const byDate = {};
  items.forEach(x => {
    if (!byDate[x.date]) byDate[x.date] = { income: 0, expense: 0 };
    if (x.type === "income") byDate[x.date].income += x.amount;
    else byDate[x.date].expense += x.amount;
  });

  const dates = Object.keys(byDate).sort();
  const maxAmount = Math.max(...dates.map(d => Math.max(byDate[d].income, byDate[d].expense)));

  dates.forEach(date => {
    const data = byDate[date];
    const incomeHeight = maxAmount > 0 ? (data.income / maxAmount) * 100 : 0;
    const expenseHeight = maxAmount > 0 ? (data.expense / maxAmount) * 100 : 0;

    const barContainer = document.createElement("div");
    barContainer.className = "chartBar";

    const barGroup = document.createElement("div");
    barGroup.className = "barGroup";

    const incomeBar = document.createElement("div");
    incomeBar.className = "bar barIncome";
    incomeBar.style.height = `${incomeHeight}%`;
    incomeBar.title = `Thu: ${formatMoneyVND(data.income)}`;

    const expenseBar = document.createElement("div");
    expenseBar.className = "bar barExpense";
    expenseBar.style.height = `${expenseHeight}%`;
    expenseBar.title = `Chi: ${formatMoneyVND(data.expense)}`;

    barGroup.appendChild(incomeBar);
    barGroup.appendChild(expenseBar);

    const label = document.createElement("div");
    label.className = "barLabel";
    label.textContent = toDDMMYYYY(date);

    barContainer.appendChild(barGroup);
    barContainer.appendChild(label);
    canvas.appendChild(barContainer);
  });
}

function renderTransactionList(items) {
  const list = el("transactionList");
  list.innerHTML = "";

  if (items.length === 0) {
    list.innerHTML = '<div class="emptyState">Chưa có giao dịch nào</div>';
    return;
  }

  items.forEach(x => {
    const item = document.createElement("div");
    item.className = "transactionItem";

    const header = document.createElement("div");
    header.className = "transactionHeader";

    const dateSpan = document.createElement("span");
    dateSpan.className = "transactionDate";
    dateSpan.textContent = toDDMMYYYY(x.date);

    const badge = document.createElement("span");
    badge.className = `badge ${x.type === "income" ? "badgeIncome" : "badgeExpense"}`;
    badge.textContent = x.type === "income" ? "Thu" : "Chi";

    header.appendChild(dateSpan);
    header.appendChild(badge);

    const amountDiv = document.createElement("div");
    amountDiv.className = `transactionAmount ${x.type === "income" ? "amountIncome" : "amountExpense"}`;
    const sign = x.type === "income" ? "+" : "-";
    amountDiv.textContent = `${sign} ${formatMoneyVND(x.amount)} ₫`;

    const noteDiv = document.createElement("div");
    noteDiv.className = "transactionNote";
    noteDiv.textContent = x.note || "(Không có ghi chú)";

    item.appendChild(header);
    item.appendChild(amountDiv);
    item.appendChild(noteDiv);

    list.appendChild(item);
  });
}

function render(items) {
  setError("");

  const filtered = applyFilterAndSort(items);

  const income = filtered.filter(x => x.type === "income").reduce((s, x) => s + x.amount, 0);
  const expense = filtered.filter(x => x.type === "expense").reduce((s, x) => s + x.amount, 0);
  const net = income - expense;

  el("sumIncome").textContent = formatMoneyVND(income);
  el("sumExpense").textContent = formatMoneyVND(expense);
  el("sumNet").textContent = formatMoneyVND(net);
  el("sumNet").style.color = net >= 0 ? "#86efac" : "#fca5a5";
  el("countBadge").textContent = `${filtered.length} dòng`;

  renderChart(filtered);
  renderTransactionList(filtered);
}

async function fetchLedgerText() {
  const url = `${LEDGER_URL}?v=${Date.now()}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Không đọc được ${LEDGER_URL} (HTTP ${res.status})`);
  return await res.text();
}

let lastItems = [];
let lastRaw = "";

async function loadFromRepo() {
  setError("");
  const text = await fetchLedgerText();
  lastRaw = text;
  el("rawInput").value = text;

  const items = parseLedgerText(text);
  lastItems = items;

  buildMonthOptions(items);
  render(items);
}

function parseFromTextarea() {
  setError("");
  const text = el("rawInput").value;
  lastRaw = text;

  const items = parseLedgerText(text);
  lastItems = items;

  buildMonthOptions(items);
  render(items);
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

async function copyRaw() {
  const text = el("rawInput").value;
  await navigator.clipboard.writeText(text);
  const btn = el("btnCopy");
  const old = btn.textContent;
  btn.textContent = "✓ Đã copy";
  setTimeout(() => (btn.textContent = old), 900);
}

function wireEvents() {
  el("btnReload").addEventListener("click", () => {
    loadFromRepo().catch(err => setError(err.message));
  });

  el("btnParse").addEventListener("click", () => {
    try {
      parseFromTextarea();
    } catch (err) {
      setError(String(err.message || err));
    }
  });

  el("monthFilter").addEventListener("change", () => render(lastItems));
  el("sortMode").addEventListener("change", () => render(lastItems));

  el("btnDownload").addEventListener("click", () => {
    downloadText("ledger.txt", el("rawInput").value);
  });

  el("btnCopy").addEventListener("click", () => {
    copyRaw().catch(() => {
      el("rawInput").select();
      document.execCommand("copy");
    });
  });
}

(function bootstrap(){
  wireEvents();

  loadFromRepo().catch(err => {
    setError(
      "Không tải được dữ liệu từ repo.\n" +
      "Nếu bạn đang mở bằng file://, hãy deploy lên GitHub Pages hoặc chạy local server.\n\n" +
      "Chi tiết: " + err.message
    );
  });
})();