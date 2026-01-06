const LEDGER_URL = "data/ledger.txt";

const el = (id) => document.getElementById(id);

function parseAmount(raw) {
  // Supports: 50000 | 50,000 | 50.000 | 20k | 1.2m
  let s = String(raw).trim().toLowerCase();

  const unitMatch = s.match(/^([0-9][0-9.,\s]*)([km])$/i);
  let unit = null;
  if (unitMatch) {
    s = unitMatch[1];
    unit = unitMatch[2];
  }

  const clean = s.replace(/[,\s]/g, "").replace(/\.(?=\d{3}\b)/g, ""); // remove thousand dots like 50.000
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
  // yyyy-mm
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

    // Date line: *01/01/2025 (allow spaces after *)
    if (line.startsWith("*")) {
      const datePart = line.slice(1).trim();
      currentDateISO = toISODate(datePart);
      continue;
    }

    // Tx line: + 50000: Note (colon optional; note optional)
    // Also accept: +50000: Note
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
    .sort((a, b) => b.localeCompare(a)); // newest first

  const sel = el("monthFilter");
  sel.innerHTML = "";

  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "Tất cả";
  sel.appendChild(optAll);

  for (const m of months) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m; // yyyy-mm
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
  } // "file" = keep original order

  return out;
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
  el("sumCount").textContent = String(filtered.length);

  const tbody = el("tbody");
  tbody.innerHTML = "";

  for (const x of filtered) {
    const tr = document.createElement("tr");

    const tdDate = document.createElement("td");
    tdDate.textContent = toDDMMYYYY(x.date);

    const tdType = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge " + (x.type === "income" ? "badgeIncome" : "badgeExpense");
    badge.textContent = (x.type === "income" ? "Thu" : "Chi");
    tdType.appendChild(badge);

    const tdAmt = document.createElement("td");
    tdAmt.className = "right";
    const sign = x.type === "income" ? "+" : "-";
    tdAmt.textContent = `${sign} ${formatMoneyVND(x.amount)}`;

    const tdNote = document.createElement("td");
    tdNote.textContent = x.note || "";

    tr.appendChild(tdDate);
    tr.appendChild(tdType);
    tr.appendChild(tdAmt);
    tr.appendChild(tdNote);

    tbody.appendChild(tr);
  }
}

async function fetchLedgerText() {
  // cache-bust để tránh GitHub Pages cache cũ quá lâu
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
  // feedback nhỏ
  const btn = el("btnCopy");
  const old = btn.textContent;
  btn.textContent = "Đã copy ✓";
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
      // fallback nếu clipboard bị chặn
      el("rawInput").select();
      document.execCommand("copy");
    });
  });
}

(function bootstrap(){
  wireEvents();

  loadFromRepo().catch(err => {
    // Khi mở file trực tiếp bằng file:// thì fetch thường bị chặn
    setError(
      "Không tải được dữ liệu từ repo.\n" +
      "Nếu bạn đang mở bằng file://, hãy deploy lên GitHub Pages hoặc chạy local server.\n\n" +
      "Chi tiết: " + err.message
    );
  });
})();
