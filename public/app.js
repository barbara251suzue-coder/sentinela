// Sentinela · lógica del mapa conectada a la API (/api/auth y /api/reportes).

const center = [-39.8142, -73.2459];
const SESSION_KEY = 'sentinela.sesion';

const typeNames = {
    espacio_seguro: 'Espacio seguro',
    iluminacion_deficiente: 'Iluminación deficiente',
    acoso_callejero: 'Acoso callejero',
    otro: 'Otra situación'
};
const levelNames = { safe: 'Zona segura', care: 'Precaución', risk: 'Zona de riesgo' };
const dateFormat = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' });

let session = loadSession();
let reports = [];
let selectedLocation = [...center];
let activeFilter = 'all';
let choosingLocation = false;
let toastTimer;

// ---------- Sesión ----------
// Se guarda en sessionStorage: el token desaparece al cerrar la pestaña.
function loadSession() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));
        return saved && saved.token ? saved : null;
    } catch {
        return null;
    }
}

function saveSession(value) {
    session = value;
    try {
        if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
        else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* sin almacenamiento: la sesión vive solo en memoria */ }
}

// ---------- Cliente de la API ----------
class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && session) headers.Authorization = `Bearer ${session.token}`;

    let response;
    try {
        response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
        throw new ApiError(0, 'No se pudo conectar con el servidor. Revisa que esté encendido.');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (auth && response.status === 401) {
            logout('Tu sesión expiró. Vuelve a ingresar.');
        }
        throw new ApiError(response.status, describeError(response.status, data));
    }
    return data;
}

function describeError(status, data) {
    const fieldNames = { email: 'Correo', 'contraseña': 'Contraseña', nombre: 'Nombre', descripcion: 'Descripción', lat: 'Ubicación', lng: 'Ubicación', tipo: 'Tipo' };
    if (status === 400 && Array.isArray(data.detalles) && data.detalles.length) {
        const first = data.detalles[0];
        if (/Valdivia/.test(first.mensaje)) return 'Elige una ubicación dentro de la comuna de Valdivia.';
        return `${fieldNames[first.campo] || 'Dato'} no válido: revisa ese campo.`;
    }
    if (status === 409) return 'Ya existe una cuenta con ese correo.';
    if (status === 429) return data.error || 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
    return data.error || 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}

// ---------- Mapa ----------
const map = L.map('map', { zoomControl: false, scrollWheelZoom: true }).setView(center, 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const layers = { safe: L.layerGroup().addTo(map), care: L.layerGroup().addTo(map), risk: L.layerGroup().addTo(map) };

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

// Convierte un reporte de la API al formato que usa el mapa.
function fromApi(r) {
    return {
        id: r.id,
        lat: r.lat,
        lng: r.lng,
        level: levelNames[r.nivel] ? r.nivel : 'risk',
        type: typeNames[r.tipo_incidente] || 'Otra situación',
        description: r.descripcion,
        anonymous: r.es_anonimo,
        when: dateFormat.format(new Date(r.fecha_creacion))
    };
}

function makeMarker(report) {
    const symbol = report.level === 'safe' ? '+' : report.level === 'risk' ? '!' : '~';
    const icon = L.divIcon({ className: '', html: `<div class="pin ${report.level}" aria-hidden="true"><span>${symbol}</span></div>`, iconSize: [29, 29], iconAnchor: [14, 26], popupAnchor: [0, -25] });
    const marker = L.marker([report.lat, report.lng], { icon, title: `${levelNames[report.level]}: ${report.type}` });
    marker.bindPopup(
        `<div class="popup-title">${escapeHtml(report.type)}</div>` +
        `<div class="popup-meta">${escapeHtml(report.when)} · ${levelNames[report.level]}<br>${escapeHtml(report.description)}</div>` +
        (report.anonymous ? '<span class="popup-tag">Reporte anónimo</span>' : '')
    );
    marker.addTo(layers[report.level]);
    report.marker = marker;
}

function updateSummary() {
    const counts = reports.reduce((total, report) => { total[report.level] += 1; return total; }, { safe: 0, care: 0, risk: 0 });
    document.getElementById('allCount').textContent = reports.length;
    document.getElementById('safeCount').textContent = counts.safe;
    document.getElementById('careCount').textContent = counts.care;
    document.getElementById('riskCount').textContent = counts.risk;
    document.getElementById('safeStat').textContent = counts.safe;
    document.getElementById('careStat').textContent = counts.care;
    document.getElementById('riskStat').textContent = counts.risk;
    document.getElementById('reportCount').textContent = `${reports.length} ${reports.length === 1 ? 'reporte' : 'reportes'}`;
}

function clearReports() {
    Object.values(layers).forEach(layer => layer.clearLayers());
    reports = [];
    updateSummary();
}

async function loadReports() {
    try {
        const data = await api('/api/reportes');
        clearReports();
        reports = data.reportes.map(fromApi);
        reports.forEach(makeMarker);
        updateSummary();
    } catch (error) {
        if (error.status !== 401) showToast(error.message);
    }
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
}

function showError(id, message) {
    const box = document.getElementById(id);
    box.textContent = message || '';
    box.hidden = !message;
}

// ---------- Filtros por nivel ----------
function applyFilter(filter) {
    activeFilter = filter;
    document.querySelectorAll('.filter-button').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.filter === filter)));
    Object.entries(layers).forEach(([level, layer]) => {
        if (filter === 'all' || filter === level) map.addLayer(layer);
        else map.removeLayer(layer);
    });
}
document.querySelectorAll('.filter-button').forEach(button => {
    button.addEventListener('click', () => applyFilter(button.dataset.filter));
});

// ---------- Login y registro ----------
const authModal = document.getElementById('authModal');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

function selectTab(name) {
    const isLogin = name === 'login';
    document.getElementById('tabLogin').setAttribute('aria-selected', String(isLogin));
    document.getElementById('tabRegister').setAttribute('aria-selected', String(!isLogin));
    loginForm.hidden = !isLogin;
    registerForm.hidden = isLogin;
    showError('loginError');
    showError('registerError');
    (isLogin ? document.getElementById('loginEmail') : document.getElementById('registerName')).focus();
}
document.getElementById('tabLogin').addEventListener('click', () => selectTab('login'));
document.getElementById('tabRegister').addEventListener('click', () => selectTab('register'));

function openAuth() {
    authModal.classList.add('open');
    selectTab('login');
}

function renderSession() {
    const loggedIn = Boolean(session);
    document.getElementById('userChip').hidden = !loggedIn;
    document.getElementById('logoutButton').hidden = !loggedIn;
    document.getElementById('userName').textContent = loggedIn ? session.usuario.nombre : '';
    if (loggedIn) authModal.classList.remove('open');
    else openAuth();
}

// Validación en el cliente (la API vuelve a validar todo en el servidor).
function validateCredentials(email, password) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Ingresa un correo válido.';
    if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (new TextEncoder().encode(password).length > 72) return 'La contraseña es demasiado larga.';
    return null;
}

async function login(email, password) {
    const data = await api('/api/auth/login', { method: 'POST', body: { email, 'contraseña': password }, auth: false });
    saveSession({ token: data.token, usuario: data.usuario });
    renderSession();
    await loadReports();
}

async function withBusy(form, task) {
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
        await task();
    } finally {
        button.disabled = false;
    }
}

loginForm.addEventListener('submit', event => {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const problem = validateCredentials(email, password);
    if (problem) return showError('loginError', problem);

    withBusy(loginForm, async () => {
        try {
            await login(email, password);
            loginForm.reset();
            showToast(`Hola, ${session.usuario.nombre}.`);
        } catch (error) {
            showError('loginError', error.status === 401 ? 'Correo o contraseña incorrectos.' : error.message);
        }
    });
});

registerForm.addEventListener('submit', event => {
    event.preventDefault();
    const nombre = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    if (!nombre) return showError('registerError', 'Ingresa tu nombre o un apodo.');
    const problem = validateCredentials(email, password);
    if (problem) return showError('registerError', problem);

    withBusy(registerForm, async () => {
        try {
            await api('/api/auth/registro', { method: 'POST', body: { email, 'contraseña': password, nombre }, auth: false });
            await login(email, password);
            registerForm.reset();
            showToast('Cuenta creada. Ya puedes publicar reportes.');
        } catch (error) {
            showError('registerError', error.message);
        }
    });
});

function logout(message) {
    saveSession(null);
    clearReports();
    closeReport();
    renderSession();
    if (message) showToast(message);
}
document.getElementById('logoutButton').addEventListener('click', () => logout('Sesión cerrada.'));

// ---------- Crear reporte ----------
const modal = document.getElementById('reportModal');
function openReport() {
    if (!session) return openAuth();
    showError('reportError');
    modal.classList.add('open');
    document.getElementById('incidentType').focus();
}
function closeReport() {
    modal.classList.remove('open');
    choosingLocation = false;
    document.getElementById('map').style.cursor = '';
}
['openReportTop', 'openReportSide'].forEach(id => document.getElementById(id).addEventListener('click', openReport));
['closeReport', 'cancelReport'].forEach(id => document.getElementById(id).addEventListener('click', closeReport));
modal.addEventListener('click', event => { if (event.target === modal) closeReport(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeReport(); });

document.getElementById('pickLocation').addEventListener('click', () => {
    closeReport();
    choosingLocation = true;
    document.getElementById('map').style.cursor = 'crosshair';
    showToast('Haz clic en el mapa para marcar una ubicación aproximada.');
});
map.on('click', event => {
    if (!choosingLocation) return;
    selectedLocation = [event.latlng.lat, event.latlng.lng];
    document.getElementById('locationText').value = `Ubicación seleccionada (${selectedLocation[0].toFixed(4)}, ${selectedLocation[1].toFixed(4)})`;
    choosingLocation = false;
    document.getElementById('map').style.cursor = '';
    openReport();
    showToast('Ubicación aproximada seleccionada.');
});

const reportForm = document.getElementById('reportForm');
reportForm.addEventListener('submit', event => {
    event.preventDefault();
    const descripcion = document.getElementById('description').value.trim();
    if (!descripcion) return showError('reportError', 'Escribe una breve descripción.');
    if (descripcion.length > 400) return showError('reportError', 'La descripción no puede superar 400 caracteres.');

    const body = {
        tipo: document.getElementById('incidentType').value,
        descripcion,
        lat: selectedLocation[0],
        lng: selectedLocation[1],
        es_anonimo: document.getElementById('anonymous').checked
    };

    withBusy(reportForm, async () => {
        try {
            const data = await api('/api/reportes', { method: 'POST', body });
            const report = fromApi(data.reporte);
            reports.unshift(report);
            makeMarker(report);
            updateSummary();
            closeReport();
            reportForm.reset();
            selectedLocation = [...center];
            if (activeFilter !== 'all' && activeFilter !== report.level) applyFilter('all');
            map.setView([report.lat, report.lng], Math.max(map.getZoom(), 15), { animate: true });
            report.marker.openPopup();
            showToast(body.es_anonimo ? 'Reporte anónimo publicado.' : 'Reporte publicado.');
        } catch (error) {
            if (error.status !== 401) showError('reportError', error.message);
        }
    });
});

// ---------- Controles del mapa ----------
document.getElementById('zoomIn').addEventListener('click', () => map.zoomIn());
document.getElementById('zoomOut').addEventListener('click', () => map.zoomOut());
document.getElementById('centerButton').addEventListener('click', () => map.setView(center, 14, { animate: true }));
window.addEventListener('resize', () => map.invalidateSize());
if (window.lucide) lucide.createIcons();

// ---------- Inicio ----------
updateSummary();
renderSession();
if (session) loadReports();
