const LEDGER_URL = "data/ledger.txt";
const DEBTS_URL = "data/debts.txt";

const el = (id) => document.getElementById(id);

/* =========================
   Utils
========================= */
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

function formatMoneyVND(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("vi-VN");
}

function formatMoneyShort(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return (v / 1000000).toFixed(1) + "tr";
  if (v >= 1000) return (v / 1000).toFixed(0) + "k";
  return v.toString();
}

/* =========================
   Ledger Parser
========================= */
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

/* =========================
   Debts Parser
   @Name
   + amount: they owe me
   - amount: I owe them
========================= */
function parseDebtsText(text) {
  const lines = text.split(/\r?\n/);
  let currentPerson = null;
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) continue;
    if (line.startsWith("#")) continue;

    if (line.startsWith("@")) {
      const name = line.slice(1).trim();
      if (!name) throw new Error(`Dòng ${i + 1}: Thiếu tên sau @\n> ${rawLine}`);
      currentPerson = name;
      continue;
    }

    const m = /^([+-])\s*([0-9][0-9.,\s]*|[0-9]+(?:\.[0-9]+)?[kKmM]?)\s*(?::\s*(.*))?$/.exec(line);
    if (m) {
      if (!currentPerson) {
        throw new Error(`Dòng ${i + 1}: Có công nợ nhưng chưa khai báo người (@Tên)\n> ${rawLine}`);
      }
      const sign = m[1];
      const amountAbs = parseAmount(m[2]);
      const note = (m[3] ?? "").trim();

      entries.push({
        person: currentPerson,
        dir: sign, // + = they owe me, - = I owe them
        amount: amountAbs,
        note
      });
      continue;
    }

    throw new Error(`Dòng ${i + 1} (công nợ) không đúng định dạng:\n> ${rawLine}`);
  }

  return entries;
}

function computeDebts(entries) {
  const map = new Map(); // person -> {recv, pay, items}
  for (const e of entries) {
    if (!map.has(e.person)) map.set(e.person, { recv: 0, pay: 0, items: [] });
    const p = map.get(e.person);
    if (e.dir === "+") p.recv += e.amount;
    else p.pay += e.amount;
    p.items.push(e);
  }

  const persons = [];
  let totalRecv = 0;
  let totalPay = 0;

  for (const [name, v] of map.entries()) {
    const net = v.recv - v.pay;
    totalRecv += v.recv;
    totalPay += v.pay;
    persons.push({
      person: name,
      receivable: v.recv,
      payable: v.pay,
      net,
      count: v.items.length
    });
  }

  persons.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  return {
    totalReceivable: totalRecv,
    totalPayable: totalPay,
    totalNet: totalRecv - totalPay,
    persons
  };
}

/* =========================
   UI Helpers
========================= */
function setError(msg) {
  const box = el("errorBox");
  if (!box) return;

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
  optAll.textContent = "Tất cả các tháng";
  sel.appendChild(optAll);

  for (const m of months) {
    const opt = document.createElement("option");
    opt.value = m;
    const [year, month] = m.split("-");
    opt.textContent = `Tháng ${month}/${year}`;
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

/* =========================
   Ledger Rendering (giữ nguyên logic của bạn)
========================= */
function renderChart(items) {
  const canvas = el("chartCanvas");
  canvas.innerHTML = "";

  if (items.length === 0) {
    canvas.innerHTML = '<div class="emptyState">📊 Chưa có dữ liệu để hiển thị<br><small style="opacity:.6">Thêm giao dịch để xem biểu đồ</small></div>';
    return;
  }

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
    incomeBar.title = `Thu: ${formatMoneyVND(data.income)} ₫`;

    const expenseBar = document.createElement("div");
    expenseBar.className = "bar barExpense";
    expenseBar.style.height = `${expenseHeight}%`;
    expenseBar.title = `Chi: ${formatMoneyVND(data.expense)} ₫`;

    barGroup.appendChild(incomeBar);
    barGroup.appendChild(expenseBar);

    const label = document.createElement("div");
    label.className = "barLabel";
    const dateParts = toDDMMYYYY(date).split("/");
    label.textContent = `${dateParts[0]}/${dateParts[1]}`;

    barContainer.appendChild(barGroup);
    barContainer.appendChild(label);
    canvas.appendChild(barContainer);
  });
}

function renderTransactionList(items) {
  const list = el("transactionList");
  list.innerHTML = "";

  if (items.length === 0) {
    list.innerHTML = '<div class="emptyState">📝 Chưa có giao dịch<br><small style="opacity:.6">Bắt đầu thêm thu chi của bạn</small></div>';
    return;
  }

  const reversedItems = [...items].reverse();

  reversedItems.forEach(x => {
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
    noteDiv.textContent = x.note || "Không có ghi chú";

    item.appendChild(header);
    item.appendChild(amountDiv);
    item.appendChild(noteDiv);

    list.appendChild(item);
  });
}

function renderQuickStats(items) {
  const income = items.filter(x => x.type === "income").reduce((s, x) => s + x.amount, 0);
  const expense = items.filter(x => x.type === "expense").reduce((s, x) => s + x.amount, 0);

  const uniqueDates = new Set(items.map(x => x.date)).size;
  const avgIncome = uniqueDates > 0 ? income / uniqueDates : 0;
  const avgExpense = uniqueDates > 0 ? expense / uniqueDates : 0;
  const savingRate = income > 0 ? ((income - expense) / income * 100) : 0;

  el("avgIncome").textContent = formatMoneyShort(avgIncome) + "đ";
  el("avgExpense").textContent = formatMoneyShort(avgExpense) + "đ";
  el("totalDays").textContent = uniqueDates;
  el("savingRate").textContent = savingRate.toFixed(0) + "%";
  el("savingRate").style.color = savingRate >= 0 ? "#86efac" : "#fca5a5";
}

function updateLineCount() {
  const text = el("rawInput").value;
  const lines = text.split("\n").length;
  el("lineCount").textContent = `${lines} dòng`;
}

function updateDebtLineCount() {
  const area = el("debtInput");
  const out = el("debtLineCount");
  if (!area || !out) return;
  const lines = area.value.split("\n").length;
  out.textContent = `${lines} dòng`;
}

function renderLedger(items) {
  const filtered = applyFilterAndSort(items);

  const income = filtered.filter(x => x.type === "income").reduce((s, x) => s + x.amount, 0);
  const expense = filtered.filter(x => x.type === "expense").reduce((s, x) => s + x.amount, 0);
  const net = income - expense;

  el("sumIncome").textContent = formatMoneyVND(income);
  el("sumExpense").textContent = formatMoneyVND(expense);
  el("sumNet").textContent = formatMoneyVND(net);
  el("sumNet").style.color = net >= 0 ? "#86efac" : "#fca5a5";

  const countText = filtered.length === 1 ? "1 giao dịch" : `${filtered.length} giao dịch`;
  el("countText").textContent = countText;

  renderChart(filtered);
  renderTransactionList(filtered);
  renderQuickStats(filtered);
}

/* =========================
   Debts Rendering
========================= */
function renderDebts(entries) {
  const sumRecvEl = el("debtSumReceivable");
  const sumPayEl = el("debtSumPayable");
  const sumNetEl = el("debtSumNet");
  const listEl = el("debtList");
  const countEl = el("debtCountText");

  if (!sumRecvEl || !sumPayEl || !sumNetEl || !listEl || !countEl) return;

  const model = computeDebts(entries);

  sumRecvEl.textContent = formatMoneyVND(model.totalReceivable);
  sumPayEl.textContent = formatMoneyVND(model.totalPayable);
  sumNetEl.textContent = formatMoneyVND(model.totalNet);
  sumNetEl.style.color = model.totalNet >= 0 ? "#86efac" : "#fca5a5";

  countEl.textContent = model.persons.length === 1 ? "1 người" : `${model.persons.length} người`;

  listEl.innerHTML = "";

  if (model.persons.length === 0) {
    listEl.innerHTML = '<div class="emptyState">💳 Chưa có công nợ<br><small style="opacity:.6">Thêm @Tên và + / - để theo dõi</small></div>';
    return;
  }

  for (const p of model.persons) {
    const box = document.createElement("div");
    box.className = "debtPerson";

    const top = document.createElement("div");
    top.className = "debtTop";

    const name = document.createElement("div");
    name.className = "debtName";
    name.textContent = p.person;

    const badge = document.createElement("span");
    badge.className = `badge ${p.net >= 0 ? "badgeIncome" : "badgeExpense"}`;
    const sign = p.net >= 0 ? "+" : "-";
    badge.textContent = `${sign} ${formatMoneyVND(Math.abs(p.net))} ₫`;

    top.appendChild(name);
    top.appendChild(badge);

    const meta = document.createElement("div");
    meta.className = "debtMeta";
    meta.textContent =
      `Họ nợ bạn: ${formatMoneyVND(p.receivable)} ₫ • Bạn nợ: ${formatMoneyVND(p.payable)} ₫ • ${p.count} dòng`;

    box.appendChild(top);
    box.appendChild(meta);

    listEl.appendChild(box);
  }
}

/* =========================
   Fetch
========================= */
async function fetchTextFile(url) {
  const u = `${url}?v=${Date.now()}`; // cache-bust
  const res = await fetch(u, { redirect: "follow" });
  if (!res.ok) throw new Error(`Không đọc được ${url} (HTTP ${res.status})`);
  return await res.text();
}

/* =========================
   State
========================= */
let lastLedgerItems = [];
let lastDebtEntries = [];

/* =========================
   Load & Parse
========================= */
async function loadFromRepo() {
  setError("");

  const [ledgerText, debtsText] = await Promise.all([
    fetchTextFile(LEDGER_URL),
    fetchTextFile(DEBTS_URL).catch(() => "# Công nợ\n\n@Nam\n+ 200k: Ví dụ\n")
  ]);

  el("rawInput").value = ledgerText;
  updateLineCount();

  const debtArea = el("debtInput");
  if (debtArea) {
    debtArea.value = debtsText;
    updateDebtLineCount();
  }

  lastLedgerItems = parseLedgerText(ledgerText);
  lastDebtEntries = parseDebtsText(debtsText);

  buildMonthOptions(lastLedgerItems);
  renderLedger(lastLedgerItems);
  renderDebts(lastDebtEntries);
}

function parseFromTextareas() {
  setError("");

  const ledgerText = el("rawInput").value;
  updateLineCount();
  lastLedgerItems = parseLedgerText(ledgerText);

  const debtArea = el("debtInput");
  if (debtArea) {
    const debtsText = debtArea.value;
    updateDebtLineCount();
    lastDebtEntries = parseDebtsText(debtsText);
  } else {
    lastDebtEntries = [];
  }

  buildMonthOptions(lastLedgerItems);
  renderLedger(lastLedgerItems);
  renderDebts(lastDebtEntries);
}

/* =========================
   Download / Copy
========================= */
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

async function copyText(text, buttonEl, okLabel = "Đã sao chép") {
  await navigator.clipboard.writeText(text);
  if (!buttonEl) return;
  const old = buttonEl.innerHTML;
  buttonEl.textContent = okLabel;
  setTimeout(() => (buttonEl.innerHTML = old), 1200);
}

/* =========================
   Quick Input (giữ như bạn)
========================= */
function handleQuickInput() {
  const dateInput = el("inputDate").value; // yyyy-mm-dd
  const type = el("inputType").value;
  const amountRaw = el("inputAmount").value.trim();
  const note = el("inputNote").value.trim();

  if (!dateInput || !amountRaw) {
    alert("Vui lòng nhập đầy đủ ngày và số tiền!");
    return;
  }

  try {
    const amount = parseAmount(amountRaw);

    const [year, month, day] = dateInput.split("-");
    const dateDDMMYYYY = `${day}/${month}/${year}`;

    const sign = type === "income" ? "+" : "-";
    const notePart = note ? `: ${note}` : "";
    const line = `${sign} ${amount}${notePart}`;

    const output = `*${dateDDMMYYYY}\n${line}`;

    el("generatedText").textContent = output;
    el("generatedOutput").classList.remove("hidden");

    navigator.clipboard.writeText(output).catch(() => {});
    el("inputAmount").value = "";
    el("inputNote").value = "";
    el("inputAmount").focus();
  } catch (err) {
    alert("Lỗi: " + err.message);
  }
}

async function copyGeneratedText() {
  const text = el("generatedText").textContent;
  const btn = el("btnCopyGenerated");
  await copyText(text, btn, "OK");
}

/* =========================
   Events
========================= */
function wireEvents() {
  el("btnReload").addEventListener("click", () => {
    loadFromRepo().catch(err => setError(err.message));
  });

  el("btnParse").addEventListener("click", () => {
    try {
      parseFromTextareas();
    } catch (err) {
      setError(String(err.message || err));
    }
  });

  el("monthFilter").addEventListener("change", () => renderLedger(lastLedgerItems));
  el("sortMode").addEventListener("change", () => renderLedger(lastLedgerItems));

  el("btnDownload").addEventListener("click", () => {
    downloadText("ledger.txt", el("rawInput").value);
  });

  el("btnCopy").addEventListener("click", () => {
    copyText(el("rawInput").value, el("btnCopy")).catch(() => {
      el("rawInput").select();
      document.execCommand("copy");
    });
  });

  el("rawInput").addEventListener("input", updateLineCount);

  // Debts buttons (nếu có UI)
  const btnCopyDebt = el("btnCopyDebt");
  const btnDownloadDebt = el("btnDownloadDebt");
  const debtArea = el("debtInput");

  if (btnCopyDebt && debtArea) {
    btnCopyDebt.addEventListener("click", () => {
      copyText(debtArea.value, btnCopyDebt).catch(() => {
        debtArea.select();
        document.execCommand("copy");
      });
    });
  }

  if (btnDownloadDebt && debtArea) {
    btnDownloadDebt.addEventListener("click", () => {
      downloadText("debts.txt", debtArea.value);
    });
  }

  if (debtArea) {
    debtArea.addEventListener("input", updateDebtLineCount);
  }

  // Quick Input Form
  el("quickInputForm").addEventListener("submit", (e) => {
    e.preventDefault();
    handleQuickInput();
  });

  el("btnCopyGenerated").addEventListener("click", () => {
    copyGeneratedText();
  });

  const today = new Date().toISOString().split("T")[0];
  el("inputDate").value = today;
}

/* =========================
   Bootstrap
========================= */
(function bootstrap(){
  wireEvents();

  loadFromRepo().catch(err => {
    setError(
      "⚠️ Không tải được dữ liệu từ repo\n\n" +
      "Nếu bạn đang mở bằng file://, hãy:\n" +
      "• Deploy lên GitHub Pages, hoặc\n" +
      "• Chạy local server (Live Server extension)\n\n" +
      "Chi tiết lỗi: " + err.message
    );
  });
})();
