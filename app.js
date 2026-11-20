// === KONFIGURATION (Hier deine Daten aus Supabase -> Project Settings -> API eintragen) ===
const SUPABASE_URL = 'https://safwpnydpdofqzykecvm.supabase.co/rest/v1/';
const SUPABASE_ANON_KEY = 'sb_publishable__qth2YSfzaB5ixThsJMAeg_hkQ-_QG0';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === ZUSTAND ===
let currentUser = null;
let authMode = 'login'; // 'login' oder 'register'
let profilesMap = {};

// === DOM-ELEMENTE ===
const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const userBadge = document.getElementById('user-badge');
const logoutBtn = document.getElementById('logout-btn');
const statusBanner = document.getElementById('status-banner');

const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const nameFieldGroup = document.getElementById('name-field-group');
const authNameInput = document.getElementById('auth-name');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authForm = document.getElementById('auth-form');

const balancesList = document.getElementById('balances-list');
const myDebtsList = document.getElementById('my-debts-list');
const counterpartSelect = document.getElementById('counterpart-select');
const directionSelect = document.getElementById('direction-select');
const amountInput = document.getElementById('amount-input');
const titleInput = document.getElementById('title-input');
const reasonInput = document.getElementById('reason-input');
const debtForm = document.getElementById('debt-form');
const refreshBtn = document.getElementById('refresh-btn');

// === HILFSFUNKTIONEN ===
const currencyFmt = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR'
});

function showBanner(message, type = 'success') {
  statusBanner.textContent = message;
  statusBanner.className = `banner ${type}`;
  clearTimeout(showBanner._timer);
  showBanner._timer = setTimeout(() => {
    statusBanner.classList.add('hidden');
  }, 4500);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === 'register';
  tabLogin.classList.toggle('active', !isRegister);
  tabRegister.classList.toggle('active', isRegister);
  nameFieldGroup.classList.toggle('hidden', !isRegister);
  authNameInput.required = isRegister;
  authSubmitBtn.textContent = isRegister ? 'Account erstellen' : 'Einloggen';
}

// === AUTH-EVENTS ===
tabLogin.addEventListener('click', () => setAuthMode('login'));
tabRegister.addEventListener('click', () => setAuthMode('register'));

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  const displayName = authNameInput.value.trim();

  if (authMode === 'register') {
    if (displayName.length < 2) {
      showBanner('Bitte gib einen Anzeigenamen mit mindestens 2 Zeichen ein.', 'error');
      return;
    }
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } }
    });

    if (error) {
      showBanner(`Registrierung fehlgeschlagen: ${error.message}`, 'error');
      return;
    }

    if (!data.session) {
      showBanner('Account erstellt! Bitte bestätige ggf. deine E-Mail und logge dich ein.');
      setAuthMode('login');
    } else {
      showBanner('Account erfolgreich erstellt!');
    }
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      showBanner(`Login fehlgeschlagen: ${error.message}`, 'error');
    }
  }
});

logoutBtn.addEventListener('click', async () => {
  await sb.auth.signOut();
  showBanner('Du wurdest abgemeldet.');
});

// === DATEN LADEN ===
async function loadAppData() {
  if (!currentUser) return;

  // 1. Profile laden (für das Dropdown & die Namenszuordnung)
  const { data: profiles, error: profError } = await sb
    .from('profiles')
    .select('id, display_name, email')
    .order('display_name', { ascending: true });

  if (profError) {
    showBanner(`Profile konnten nicht geladen werden: ${profError.message}`, 'error');
    return;
  }

  profilesMap = {};
  counterpartSelect.innerHTML = '';

  const otherProfiles = profiles.filter((p) => p.id !== currentUser.id);
  profiles.forEach((p) => {
    profilesMap[p.id] = p.display_name;
  });

  const myName = profilesMap[currentUser.id] || currentUser.email;
  userBadge.textContent = `Eingeloggt als ${myName}`;

  if (otherProfiles.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Noch keine anderen Mitglieder registriert';
    opt.disabled = true;
    opt.selected = true;
    counterpartSelect.appendChild(opt);
  } else {
    otherProfiles.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.display_name} (${p.email})`;
      counterpartSelect.appendChild(opt);
    });
  }

  // 2. Verrechnete Salden über die sichere Server-Funktion abrufen
  const { data: balances, error: balError } = await sb.rpc('get_my_balances');
  if (balError) {
    showBanner(`Salden konnten nicht berechnet werden: ${balError.message}`, 'error');
  } else {
    renderBalances(balances || []);
  }

  // 3. Ausschließlich eigene Einträge laden (RLS blockiert fremde Einträge serverseitig)
  const { data: myDebts, error: debtError } = await sb
    .from('debts')
    .select('*')
    .order('created_at', { ascending: false });

  if (debtError) {
    showBanner(`Eigene Posten konnten nicht geladen werden: ${debtError.message}`, 'error');
  } else {
    renderMyDebts(myDebts || []);
  }
}

function renderBalances(balances) {
  if (balances.length === 0) {
    balancesList.innerHTML = '<p class="empty-state">Noch keine gemeinsamen Buchungen vorhanden.</p>';
    return;
  }

  balancesList.innerHTML = balances
    .map((row) => {
      const val = Number(row.net_balance);
      let badgeClass = 'badge-zero';
      let label = 'Ausgeglichen';

      if (val > 0.005) {
        badgeClass = 'badge-pos';
        label = `schuldet dir ${currencyFmt.format(val)}`;
      } else if (val < -0.005) {
        badgeClass = 'badge-neg';
        label = `du schuldest ${currencyFmt.format(Math.abs(val))}`;
      }

      return `
        <div class="list-item">
          <div>
            <strong>${escapeHtml(row.other_user_name)}</strong>
            <div class="subtitle">${escapeHtml(row.other_user_email)}</div>
          </div>
          <span class="badge ${badgeClass}">${label}</span>
        </div>
      `;
    })
    .join('');
}

function renderMyDebts(debts) {
  if (debts.length === 0) {
    myDebtsList.innerHTML = '<p class="empty-state">Du hast noch keine eigenen Posten eingetragen.</p>';
    return;
  }

  myDebtsList.innerHTML = debts
    .map((item) => {
      const iAmCreditor = item.creditor_id === currentUser.id;
      const otherId = iAmCreditor ? item.debtor_id : item.creditor_id;
      const otherName = profilesMap[otherId] || 'Unbekannt';
      const directionText = iAmCreditor
        ? `${otherName} schuldet mir`
        : `Ich schulde ${otherName}`;
      const amountClass = iAmCreditor ? 'badge-pos' : 'badge-neg';
      const dateStr = new Date(item.created_at).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      return `
        <div class="list-item debt-item">
          <div class="debt-top">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="badge ${amountClass}">${currencyFmt.format(Number(item.amount))}</span>
          </div>
          <div class="debt-reason">${escapeHtml(item.reason)}</div>
          <div class="debt-meta">
            <span>${escapeHtml(directionText)} · ${dateStr}</span>
            <button class="btn-delete" data-delete-id="${item.id}" type="button">Löschen</button>
          </div>
        </div>
      `;
    })
    .join('');
}

// === NEUEN POSTEN SPEICHERN ===
debtForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const otherId = counterpartSelect.value;
  const direction = directionSelect.value;
  const amount = parseFloat(amountInput.value);
  const title = titleInput.value.trim();
  const reason = reasonInput.value.trim();

  if (!otherId) {
    showBanner('Bitte wähle zuerst eine andere Person aus.', 'error');
    return;
  }
  if (isNaN(amount) || amount <= 0) {
    showBanner('Der Betrag muss größer als 0 sein.', 'error');
    return;
  }
  if (title.length < 2 || reason.length < 3) {
    showBanner('Titel und Begründung sind Pflichtfelder.', 'error');
    return;
  }

  const creditorId = direction === 'owes_me' ? currentUser.id : otherId;
  const debtorId = direction === 'owes_me' ? otherId : currentUser.id;

  const { error } = await sb.from('debts').insert({
    created_by: currentUser.id,
    creditor_id: creditorId,
    debtor_id: debtorId,
    amount: amount.toFixed(2),
    title,
    reason
  });

  if (error) {
    showBanner(`Speichern fehlgeschlagen: ${error.message}`, 'error');
    return;
  }

  debtForm.reset();
  showBanner('Posten gespeichert und Bilanz aktualisiert.');
  await loadAppData();
});

// === EIGENEN POSTEN LÖSCHEN ===
myDebtsList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete-id]');
  if (!btn) return;

  const id = btn.getAttribute('data-delete-id');
  if (!confirm('Diesen eigenen Posten wirklich löschen?')) return;

  const { error } = await sb.from('debts').delete().eq('id', id);
  if (error) {
    showBanner(`Löschen fehlgeschlagen: ${error.message}`, 'error');
    return;
  }

  showBanner('Posten gelöscht.');
  await loadAppData();
});

refreshBtn.addEventListener('click', loadAppData);

// === SESSION-ÜBERWACHUNG ===
sb.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user ?? null;

  if (currentUser) {
    authView.classList.add('hidden');
    appView.classList.remove('hidden');
    userBadge.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    await loadAppData();
  } else {
    authView.classList.remove('hidden');
    appView.classList.add('hidden');
    userBadge.classList.add('hidden');
    logoutBtn.classList.add('hidden');
    balancesList.innerHTML = '';
    myDebtsList.innerHTML = '';
  }
});

// === SERVICE WORKER FÜR PWA REGISTRIEREN ===
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}