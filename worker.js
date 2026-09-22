/**
 * FLBTP — serveur (Cloudflare Worker)
 * Partie 1 : accès aux Google Sheets, mémoire, lecture du planning.
 *
 * Même base de données qu'avant : le planning de Quentin et le fichier « FLBTP - Données appli ».
 * Ce qui change par rapport à Apps Script : on parle directement à l'API Google, sans redirection
 * ni démarrage à froid, et les écritures sont faites en mode RAW, donc « 08:15 » et « 0449 »
 * restent du texte au lieu d'être convertis en heure et en nombre.
 *
 * Variables attendues (Settings › Variables and Secrets) :
 *   GOOGLE_EMAIL    compte de service (client_email)
 *   GOOGLE_CLE      clé privée du compte de service        [Secret]
 *   SECRET_JETONS   phrase au hasard, signe les connexions [Secret]
 *   ID_PLANNING     identifiant du planning
 *   ID_DONNEES      identifiant de « FLBTP - Données appli »
 *   CLE_EXPORT      clé de la macro Excel
 *   RELAIS_URL      adresse /exec d'Apps Script, pour les photos
 *   RELAIS_CLE      clé du relais photos                   [Secret]
 * Rattachement : KV namespace nommé CACHE.
 */

const FUSEAU = 'Europe/Paris';
const LIBELLE_DEPOT = 'DEPOT OBJAT';

const STATUTS = { SAISIE: 'SAISIE', SIGNALEE: 'SIGNALEE', VALIDEE_CHEF: 'VALIDEE_CHEF', EXPORTEE: 'EXPORTEE' };
const TRAJETS = ['PASSAGER', 'FOURGON', '3T5', 'PL'];
const REPAS = ['AUCUN', 'PANIER', 'RESTAURANT'];

const SESSION_JOURS = 60;
const ECHECS_MAX = 5;
const BLOCAGE_MINUTES = 15;
const DUREE_MAX_MINUTES = 12 * 60;

const CACHE_REFERENTIELS_S = 1800;
const CACHE_PLANNING_S = 900;
const CACHE_CODES_S = 300;

/** Colonnes dont la valeur doit rester du texte (voir remiseEnTexte). */
const COLONNES_TEXTE = {
  JOURNEES: ['ID_JOURNEE', 'DATE', 'ZONE', 'H_EMBAUCHE', 'H_PAUSE', 'H_REPRISE', 'H_DEBAUCHE', 'TOTAL',
    'VALIDE_CHEF_LE', 'EXPORTE_LE', 'CREE_LE', 'MODIFIE_LE', 'ID_ENVOI'],
  RAPPORTS: ['ID_RAPPORT', 'DATE', 'CREE_LE', 'MODIFIE_LE', 'ID_ENVOI'],
  AVANCEMENT: ['ID_RAPPORT', 'DATE'],
  MATERIAUX: ['ID_RAPPORT', 'DATE', 'MATERIAU'],
  BL: ['ID_RAPPORT', 'DATE', 'AJOUTE_LE'],
  REF_MATERIAUX: ['MATERIAU'],
  CODES: ['PERSONNE', 'CODE', 'BLOQUE_JUSQU_A'],
  ALERTES: ['HORODATAGE', 'DATE_CONCERNEE'],
  JOURNAL: ['HORODATAGE'],
};

const PLANNING = {
  PREMIERE_LIGNE: 6, DERNIERE_LIGNE: 45,
  COL_VILLE: 1, COL_CLIENT: 2, COL_TACHES: 4, COL_NOMS: 6,
  MOTS_FIN: ['PERSONNELS', 'TO DO CHANTIERS', 'MATERIAUX', 'MATERIELS'],
};

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

class ErreurMetier extends Error {}
class ErreurSession extends ErreurMetier {
  constructor() { super('Session expirée, reconnecte-toi.'); this.session = true; }
}

// ---------------------------------------------------------------------------
// Dates, heures, texte
// ---------------------------------------------------------------------------

function partiesDate(d) {
  const f = new Intl.DateTimeFormat('fr-FR', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(d);
  const o = {};
  f.forEach(p => { o[p.type] = p.value; });
  return o;
}

function aujourdhui(maintenant) {
  const p = partiesDate(maintenant || new Date());
  return `${p.year}-${p.month}-${p.day}`;
}

function horodatage() {
  const p = partiesDate(new Date());
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}

function verifierDate(texte) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(texte))) throw new ErreurMetier('Date invalide.');
  return String(texte);
}

/** "08:15" -> 495 */
function minutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = +m[1], mn = +m[2];
  return h > 23 || mn > 59 ? null : h * 60 + mn;
}

function hhmm(total) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Numéro de série Google Sheets -> date ou heure (30/12/1899 = 0). */
function depuisSerie(n) {
  const jours = Math.floor(n);
  const ms = Math.round((n - jours) * 86400) * 1000;
  const d = new Date(Date.UTC(1899, 11, 30) + jours * 86400000 + ms);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), heure: iso.slice(11, 16), avantDate: jours < 1 };
}

/**
 * Une valeur lue dans une colonne « texte » peut avoir été convertie par Google
 * (heure, date, nombre) si elle avait été écrite par l'ancien serveur Apps Script.
 * On la remet toujours en texte.
 */
function remiseEnTexte(colonne, v) {
  if (typeof v === 'number') {
    if (colonne === 'CODE') return String(v).padStart(4, '0');
    const s = depuisSerie(v);
    if (s.avantDate) return s.heure;                                   // heure seule
    if (colonne === 'DATE' || colonne === 'DATE_CONCERNEE') return s.date;
    if (colonne.endsWith('_LE') || colonne === 'HORODATAGE') return `${s.date} ${s.heure}:00`;
    return String(v);
  }
  return v === null || v === undefined ? '' : String(v);
}

function normaliser(texte) {
  const ABREV = { ST: 'SAINT', STE: 'SAINTE' };
  return String(texte || '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/).filter(Boolean)
    .map(m => ABREV[m] || m).join(' ');
}

function lundiDe(texte) {
  const [a, m, j] = texte.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

function ajouterJours(dUtc, n) {
  const d = new Date(dUtc.getTime() + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Accès Google : jeton du compte de service, puis API Sheets
// ---------------------------------------------------------------------------

let jetonGoogle = null;   // gardé le temps de vie de l'instance

function base64url(octets) {
  let s = '';
  new Uint8Array(octets).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function accesGoogle(env) {
  if (jetonGoogle && jetonGoogle.expire > Date.now() + 60000) return jetonGoogle.valeur;

  const pem = String(env.GOOGLE_CLE).replace(/\\n/g, '\n');
  const corps = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(corps), c => c.charCodeAt(0));
  const cle = await crypto.subtle.importKey('pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);

  const maintenant = Math.floor(Date.now() / 1000);
  const entete = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const charge = base64url(new TextEncoder().encode(JSON.stringify({
    iss: env.GOOGLE_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: maintenant, exp: maintenant + 3600,
  })));
  const signature = base64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cle,
    new TextEncoder().encode(`${entete}.${charge}`)));

  const rep = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${entete}.${charge}.${signature}`,
    }),
  });
  const r = await rep.json();
  if (!r.access_token) throw new Error('Google refuse la clé du compte de service : ' + JSON.stringify(r).slice(0, 200));
  jetonGoogle = { valeur: r.access_token, expire: Date.now() + (r.expires_in - 60) * 1000 };
  return jetonGoogle.valeur;
}

async function sheets(env, idFichier, chemin, options = {}) {
  const jeton = await accesGoogle(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${idFichier}${chemin}`;
  const rep = await fetch(url, {
    method: options.methode || 'GET',
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
    body: options.corps ? JSON.stringify(options.corps) : undefined,
  });
  if (!rep.ok) {
    const detail = (await rep.text()).slice(0, 300);
    throw new Error(`Google Sheets ${rep.status} sur ${chemin} : ${detail}`);
  }
  return rep.json();
}

/**
 * Désigne une plage pour l'API Google. Les guillemets simples sont OBLIGATOIRES :
 * les onglets du planning s'appellent « 239 », « 229 »… et un nom entièrement numérique
 * n'est pas compris sans eux.
 */
function plage(onglet, coords) {
  return `'${String(onglet).replace(/'/g, "''")}'!${coords}`;
}

/** Valeurs brutes d'une plage. Les dates arrivent en numéro de série, remises en texte plus bas. */
async function lirePlage(env, idFichier, onglet, coords) {
  const r = await sheets(env, idFichier,
    `/values/${encodeURIComponent(plage(onglet, coords))}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  return r.values || [];
}

// ---------------------------------------------------------------------------
// Tables du fichier de données
// ---------------------------------------------------------------------------

class Table {
  constructor(nom, entetes, lignes) {
    this.nom = nom;
    this.entetes = entetes;
    this.lignes = lignes;
  }

  tous() { return this.lignes.map(l => l.obj); }
  trouver(pred) { return this.lignes.find(l => pred(l.obj)) || null; }
  filtrer(pred) { return this.lignes.filter(l => pred(l.obj)).map(l => l.obj); }

  valeurs(obj) { return this.entetes.map(e => (obj[e] === undefined || obj[e] === null ? '' : obj[e])); }
}

async function table(env, nom) {
  const brut = await lirePlage(env, env.ID_DONNEES, nom, 'A1:AZ');
  const entetes = (brut.shift() || []).map(String);
  const texte = COLONNES_TEXTE[nom] || [];
  const lignes = brut
    .map((v, i) => {
      const obj = {};
      entetes.forEach((e, j) => { if (e) obj[e] = texte.includes(e) ? remiseEnTexte(e, v[j]) : (v[j] === undefined ? '' : v[j]); });
      return { obj, ligne: i + 2 };
    })
    .filter(l => Object.values(l.obj).some(x => x !== '' && x !== null && x !== false));
  return new Table(nom, entetes, lignes);
}

/** RAW : ce qu'on écrit est stocké tel quel, sans conversion par Google. */
async function ajouterLigne(env, t, obj) {
  await sheets(env, env.ID_DONNEES,
    `/values/${encodeURIComponent(plage(t.nom, 'A1'))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { methode: 'POST', corps: { values: [t.valeurs(obj)] } });
}

async function majLigne(env, t, entree, champs) {
  Object.assign(entree.obj, champs);
  const derniere = colonneLettre(t.entetes.length);
  await sheets(env, env.ID_DONNEES,
    `/values/${encodeURIComponent(plage(t.nom, `A${entree.ligne}:${derniere}${entree.ligne}`))}?valueInputOption=RAW`,
    { methode: 'PUT', corps: { values: [t.valeurs(entree.obj)] } });
}

async function supprimerLignes(env, t, pred) {
  const cibles = t.lignes.filter(l => pred(l.obj)).map(l => l.ligne).sort((a, b) => b - a);
  if (!cibles.length) return;
  const idOnglet = await idDeLOnglet(env, env.ID_DONNEES, t.nom);
  await sheets(env, env.ID_DONNEES, ':batchUpdate', {
    methode: 'POST',
    corps: {
      requests: cibles.map(n => ({
        deleteDimension: { range: { sheetId: idOnglet, dimension: 'ROWS', startIndex: n - 1, endIndex: n } },
      })),
    },
  });
}

function colonneLettre(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function onglets(env, idFichier) {
  const cle = 'onglets_' + idFichier;
  const garde = await memoire(env, cle);
  if (garde) return garde;
  const r = await sheets(env, idFichier, '?fields=sheets.properties(sheetId,title)');
  const liste = r.sheets.map(s => ({ id: s.properties.sheetId, titre: s.properties.title }));
  await memoire(env, cle, liste, 1800);
  return liste;
}

async function idDeLOnglet(env, idFichier, titre) {
  const o = (await onglets(env, idFichier)).find(x => x.titre === titre);
  if (!o) throw new ErreurMetier(`Onglet introuvable : ${titre}`);
  return o.id;
}

// ---------------------------------------------------------------------------
// Mémoire (KV)
// ---------------------------------------------------------------------------

async function memoire(env, cle, valeur, secondes) {
  if (valeur === undefined) {
    const v = await env.CACHE.get(cle, 'json');
    return v === null ? null : v;
  }
  await env.CACHE.put(cle, JSON.stringify(valeur), { expirationTtl: Math.max(60, secondes) });
  return valeur;
}

// ---------------------------------------------------------------------------
// Référentiels et planning (lus dans le fichier de Quentin)
// ---------------------------------------------------------------------------

async function referentiels(env, forcer) {
  if (!forcer) {
    const garde = await memoire(env, 'referentiels');
    if (garde) return garde;
  }
  const lire = async nom => {
    const brut = await lirePlage(env, env.ID_PLANNING, nom, 'A1:AZ');
    const entetes = (brut.shift() || []).map(String);
    return brut.filter(l => String(l[0] || '').trim() !== '')
      .map(l => { const o = {}; entetes.forEach((e, i) => { o[e] = l[i]; }); return o; });
  };

  let zonesBrutes;
  try {
    zonesBrutes = await lire('ZONES');
  } catch (e) {
    throw new ErreurMetier("Les référentiels ne sont pas dans le planning : importer PERSONNES, LIEUX et ZONES.");
  }
  const zones = {};
  zonesBrutes.forEach(z => { zones[String(z.ZONE).trim()] = String(z.CODE_RH).trim(); });

  const ref = {
    personnes: (await lire('PERSONNES')).map(p => ({
      libelle: String(p.LIBELLE_PLANNING).trim(),
      type: String(p.TYPE || '').trim(),
      prenom: String(p.PRENOM || '').trim(),
      ongletRh: String(p.ONGLET_RH || '').trim(),
      actif: String(p.ACTIF || '').trim().toUpperCase() !== 'NON',
      anciennes: String(p.ANCIENNES_GRAPHIES || '').split(',').map(s => s.trim()).filter(Boolean),
    })),
    lieux: (await lire('LIEUX')).map(l => {
      const zone = String(l.ZONE === null || l.ZONE === undefined ? '' : l.ZONE).trim();
      return { libelle: String(l.LIBELLE_PLANNING).trim(), type: String(l.TYPE || '').trim(), zone, codeRh: zones[zone] || '' };
    }),
  };
  await memoire(env, 'referentiels', ref, CACHE_REFERENTIELS_S);
  return ref;
}

function personneParLibelle(ref, texte) {
  const n = normaliser(texte);
  return ref.personnes.find(p => normaliser(p.libelle) === n || p.anciennes.some(a => normaliser(a) === n)) || null;
}

function lieuParLibelle(ref, texte) {
  const n = normaliser(texte);
  return ref.lieux.find(l => normaliser(l.libelle) === n) || null;
}

/** L'onglet du jour est trouvé par la date en A2, jamais par son nom (« 111 » est ambigu). */
async function ongletDuJour(env, dateTxt) {
  const liste = await onglets(env, env.ID_PLANNING);
  const [, m, j] = dateTxt.split('-').map(Number);
  const candidats = [`${j}${m}`, ...liste.map(o => o.titre).filter(t => /^\d{2,4}$/.test(t))];
  const vus = new Set();
  for (const titre of candidats) {
    if (vus.has(titre) || !liste.some(o => o.titre === titre)) continue;
    vus.add(titre);
    const v = await lirePlage(env, env.ID_PLANNING, titre, 'A2');
    const brut = v[0] && v[0][0];
    if (typeof brut === 'number' && depuisSerie(brut).date === dateTxt) return titre;
  }
  return null;
}

async function planningDuJour(env, dateTxt, forcer) {
  const cle = 'planning_' + dateTxt;
  if (!forcer) {
    const garde = await memoire(env, cle);
    if (garde) return garde;
  }
  const titre = await ongletDuJour(env, dateTxt);
  if (!titre) {
    const vide = { date: dateTxt, trouve: false, blocs: [], anomalies: [] };
    await memoire(env, cle, vide, 900);
    return vide;
  }
  const valeurs = await lirePlage(env, env.ID_PLANNING, titre,
    `A${PLANNING.PREMIERE_LIGNE}:F${PLANNING.DERNIERE_LIGNE}`);
  const res = Object.assign({ date: dateTxt, trouve: true, onglet: titre },
    lireBlocs(valeurs, await referentiels(env)));
  await memoire(env, cle, res, CACHE_PLANNING_S);
  return res;
}

/** Découpe les blocs chantier d'une journée. Aucune dépendance : testable seul. */
function lireBlocs(valeurs, ref) {
  const blocs = [];
  const anomalies = [];
  let courant = null;

  for (const ligne of valeurs) {
    const ville = String((ligne || [])[PLANNING.COL_VILLE - 1] || '').trim();
    const nom = String((ligne || [])[PLANNING.COL_NOMS - 1] || '').trim();
    if (PLANNING.MOTS_FIN.includes(ville.toUpperCase())) break;
    if (ville) {
      courant = {
        villes: ville.split(/[\n,]+/).map(s => s.trim()).filter(Boolean),
        client: String((ligne || [])[PLANNING.COL_CLIENT - 1] || '').replace(/\s*\n\s*/g, ' / ').trim(),
        taches: String((ligne || [])[PLANNING.COL_TACHES - 1] || '').trim(),
        noms: [],
      };
      blocs.push(courant);
    }
    if (nom && courant) courant.noms.push(nom);
  }

  const utiles = [];
  for (const b of blocs) {
    b.lieux = []; b.inconnues = [];
    b.villes.forEach(v => {
      const l = lieuParLibelle(ref, v);
      if (l) b.lieux.push(l.libelle); else { b.inconnues.push(v); anomalies.push({ type: 'COMMUNE_INCONNUE', valeur: v }); }
    });
    b.equipe = [];
    b.noms.forEach(n => {
      const p = personneParLibelle(ref, n);
      if (!p) { anomalies.push({ type: 'NOM_INCONNU', valeur: n }); return; }
      if (p.type === 'PRESTATAIRE') return;
      if (!b.equipe.includes(p.libelle)) b.equipe.push(p.libelle);
    });
    b.responsable = b.equipe[0] || null;
    if (b.equipe.length) utiles.push(b);        // un bloc sans personne est un chantier en attente d'équipe
  }
  return { blocs: utiles, anomalies };
}

function blocDe(planning, libelle) {
  return planning.blocs.find(b => b.equipe.includes(libelle)) || null;
}
/**
 * FLBTP — serveur (Cloudflare Worker)
 * Partie 2 : connexion, journées, rapports, export, contrôles et routage.
 * Les règles sont identiques à celles de l'ancien serveur.
 */

// ---------------------------------------------------------------------------
// Journal et alertes
// ---------------------------------------------------------------------------

async function journaliser(env, personne, action, cible, detail) {
  try {
    await sheets(env, env.ID_DONNEES, `/values/${encodeURIComponent(plage('JOURNAL', 'A1'))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      methode: 'POST',
      corps: { values: [[horodatage(), personne || '', action, cible || '',
        String(typeof detail === 'string' ? detail : JSON.stringify(detail || '')).slice(0, 2000)]] },
    });
  } catch (e) {
    console.log('journal indisponible : ' + e.message);
  }
}

async function alerter(env, type, dateConcernee, personne, detail) {
  const t = await table(env, 'ALERTES');
  const existe = t.trouver(a => a.TYPE === type && a.DATE_CONCERNEE === (dateConcernee || '')
    && a.PERSONNE === (personne || '') && a.TRAITEE !== true);
  if (existe) return;
  await ajouterLigne(env, t, {
    HORODATAGE: horodatage(), TYPE: type, DATE_CONCERNEE: dateConcernee || '',
    PERSONNE: personne || '', DETAIL: detail || '', TRAITEE: false,
  });
}

// ---------------------------------------------------------------------------
// Connexion : nom + code, jeton signé
// ---------------------------------------------------------------------------

async function cleHmac(env) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SECRET_JETONS),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function signer(env, texte) {
  return base64url(await crypto.subtle.sign('HMAC', await cleHmac(env), new TextEncoder().encode(texte)));
}

async function creerJeton(env, personne) {
  const charge = base64url(new TextEncoder().encode(JSON.stringify({
    p: personne, e: Date.now() + SESSION_JOURS * 86400000,
  })));
  return `${charge}.${await signer(env, charge)}`;
}

async function verifierJeton(env, jeton) {
  const [charge, signature] = String(jeton || '').split('.');
  if (!charge || !signature || (await signer(env, charge)) !== signature) throw new ErreurSession();
  const data = JSON.parse(new TextDecoder().decode(
    Uint8Array.from(atob(charge.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
  if (Date.now() > data.e) throw new ErreurSession();
  if (!(await codesActifs(env)).includes(data.p)) throw new ErreurSession();
  return data.p;
}

async function codesActifs(env, forcer) {
  if (!forcer) {
    const garde = await memoire(env, 'codes_actifs');
    if (garde) return garde;
  }
  const t = await table(env, 'CODES');
  const liste = t.filtrer(c => c.ACTIF !== 'NON' && c.ACTIF !== false).map(c => String(c.PERSONNE));
  await memoire(env, 'codes_actifs', liste, CACHE_CODES_S);
  return liste;
}

async function connexion(env, personne, code) {
  const ref = await referentiels(env);
  const t = await table(env, 'CODES');
  const entree = t.trouver(c => c.PERSONNE === personne);
  if (!entree || entree.obj.ACTIF === 'NON' || entree.obj.ACTIF === false) throw new ErreurMetier('Nom ou code incorrect.');

  const bloque = String(entree.obj.BLOQUE_JUSQU_A || '');
  if (bloque && bloque > horodatage()) {
    throw new ErreurMetier(`Trop d'essais. Réessaie après ${bloque.slice(11, 16)}.`);
  }
  if (String(entree.obj.CODE).padStart(4, '0') !== String(code)) {
    const echecs = (Number(entree.obj.ECHECS) || 0) + 1;
    const champs = { ECHECS: echecs };
    if (echecs >= ECHECS_MAX) {
      champs.ECHECS = 0;
      const fin = new Date(Date.now() + BLOCAGE_MINUTES * 60000);
      const p = partiesDate(fin);
      champs.BLOQUE_JUSQU_A = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
      await journaliser(env, personne, 'BLOCAGE', 'CODES', `${ECHECS_MAX} échecs`);
    }
    await majLigne(env, t, entree, champs);
    throw new ErreurMetier('Nom ou code incorrect.');
  }
  if (Number(entree.obj.ECHECS) || entree.obj.BLOQUE_JUSQU_A) {
    await majLigne(env, t, entree, { ECHECS: 0, BLOQUE_JUSQU_A: '' });
  }
  const p = personneParLibelle(ref, personne);
  await journaliser(env, personne, 'CONNEXION', '', '');
  return { jeton: await creerJeton(env, personne), personne, type: p ? p.type : '', prenom: p ? p.prenom : '' };
}

// ---------------------------------------------------------------------------
// Journées
// ---------------------------------------------------------------------------

function idJournee(date, personne) { return `${date}|${personne}`; }
function idRapport(date, responsable) { return `${date}|${responsable}`; }

function statutAffiche(o) {
  if (o.STATUT === STATUTS.EXPORTEE) return 'EXPORTEE';
  if (o.VALIDE_BUREAU === true) return 'VALIDEE_BUREAU';
  return o.STATUT;
}

function estModifiable(o) {
  return o.VALIDE_BUREAU !== true && o.STATUT !== STATUTS.EXPORTEE && o.STATUT !== STATUTS.VALIDEE_CHEF;
}

function versClient(o) {
  return {
    date: o.DATE, personne: o.PERSONNE, chantiers: String(o.CHANTIERS || '').split(' ; ').filter(Boolean),
    lieuEmbauche: o.LIEU_EMBAUCHE, zone: o.ZONE,
    hEmbauche: o.H_EMBAUCHE, hPause: o.H_PAUSE, hReprise: o.H_REPRISE, hDebauche: o.H_DEBAUCHE,
    total: o.TOTAL, trajet: o.TRAJET, tachesSupp: o.TACHES_SUPP, tachesSuppMin: o.TACHES_SUPP_MIN,
    repas: o.REPAS, statut: statutAffiche(o), signalement: o.SIGNALEMENT,
    nomInterimaire: o.NOM_INTERIMAIRE, agence: o.AGENCE, modifiable: estModifiable(o),
  };
}

function semaine(moi, date, t) {
  const lundi = lundiDe(date);
  return [0, 1, 2, 3, 4].map(n => {
    const d = ajouterJours(lundi, n);
    const j = t.trouver(x => x.ID_JOURNEE === idJournee(d, moi));
    return { date: d, statut: j ? statutAffiche(j.obj) : (d > aujourdhui() ? 'A_VENIR' : 'NON_SAISIE') };
  });
}

async function accueil(env, moi, date) {
  date = verifierDate(date || aujourdhui());
  const [pl, t] = await Promise.all([planningDuJour(env, date), table(env, 'JOURNEES')]);
  const bloc = blocDe(pl, moi);
  const j = t.trouver(x => x.ID_JOURNEE === idJournee(date, moi));
  return {
    date, planningTrouve: pl.trouve, bloc,
    estResponsable: !!bloc && bloc.responsable === moi,
    journee: j ? versClient(j.obj) : null,
    semaine: semaine(moi, date, t),
  };
}

/** Contrôles identiques à ceux du téléphone : le serveur ne fait confiance à personne. */
function controlerJournee(d, ref) {
  const h = ['hEmbauche', 'hPause', 'hReprise', 'hDebauche'].map(k => minutes(d[k]));
  if (h.some(x => x === null)) throw new ErreurMetier('Les quatre horaires sont obligatoires.');
  const [emb, pause, rep, deb] = h;
  if (!(emb < pause && pause <= rep && rep < deb)) {
    throw new ErreurMetier('Les horaires doivent se suivre : embauche, pause, reprise, débauche.');
  }
  const total = (pause - emb) + (deb - rep);
  if (total > DUREE_MAX_MINUTES) throw new ErreurMetier('Plus de 12 heures dans la journée : vérifie les horaires.');
  if (!TRAJETS.includes(d.trajet)) throw new ErreurMetier('Choisis le trajet.');
  if (!REPAS.includes(d.repas)) throw new ErreurMetier('Choisis le repas.');

  const chantiers = (d.chantiers || []).map(c => {
    const l = lieuParLibelle(ref, c);
    if (!l) throw new ErreurMetier(`Chantier inconnu : ${c}`);
    return l.libelle;
  });
  if (!chantiers.length) throw new ErreurMetier('Choisis au moins un chantier.');

  const embauche = lieuParLibelle(ref, d.lieuEmbauche);
  if (!embauche) throw new ErreurMetier("Choisis le lieu d'embauche.");
  const auDepot = embauche.libelle === LIBELLE_DEPOT;

  const supp = Math.max(0, Math.round(Number(d.tachesSuppMin) || 0));
  if (supp > 240) throw new ErreurMetier('Plus de 4 heures de tâches avant chantier : vérifie la durée.');

  return {
    chantiers, lieuEmbauche: embauche.libelle,
    // Embauche au dépôt = pas de déplacement = pas de zone. Sinon la zone est figée à l'envoi.
    zone: auDepot ? '' : embauche.zone,
    codeRh: auDepot ? '' : embauche.codeRh,
    heures: [d.hEmbauche, d.hPause, d.hReprise, d.hDebauche].map(x => hhmm(minutes(x))),
    total: hhmm(total),
    trajet: d.trajet,
    tachesSupp: supp ? String(d.tachesSupp || '').slice(0, 200) : '',
    tachesSuppMin: supp || '',
    repas: d.repas,
  };
}

async function enregistrerJournee(env, moi, d, idEnvoi) {
  const date = verifierDate(d.date);
  if (date > aujourdhui()) throw new ErreurMetier('Impossible de saisir une journée à venir.');
  const ref = await referentiels(env);
  const p = personneParLibelle(ref, moi);
  const c = controlerJournee(d, ref);
  const [pl, t] = await Promise.all([planningDuJour(env, date), table(env, 'JOURNEES')]);
  const bloc = blocDe(pl, moi);

  // Envoi rejoué après une coupure : déjà enregistré, on ne refait rien.
  if (idEnvoi && t.trouver(x => x.ID_ENVOI === idEnvoi)) return { ok: true, dejaRecu: true };

  const existante = t.trouver(x => x.ID_JOURNEE === idJournee(date, moi));
  if (existante && !estModifiable(existante.obj)) {
    throw new ErreurMetier('Journée déjà validée : demande à ton chef ou au bureau pour la corriger.');
  }

  const champs = {
    ID_JOURNEE: idJournee(date, moi), DATE: date, PERSONNE: moi,
    ONGLET_RH: p ? p.ongletRh : '', TYPE_PERSONNE: p ? p.type : '',
    SAISI_PAR: moi, CHANTIERS: c.chantiers.join(' ; '), RESPONSABLE: bloc ? bloc.responsable : '',
    LIEU_EMBAUCHE: c.lieuEmbauche, ZONE: c.zone, CODE_RH_ZONE: c.codeRh,
    H_EMBAUCHE: c.heures[0], H_PAUSE: c.heures[1], H_REPRISE: c.heures[2], H_DEBAUCHE: c.heures[3],
    TOTAL: c.total, TRAJET: c.trajet, TACHES_SUPP: c.tachesSupp, TACHES_SUPP_MIN: c.tachesSuppMin,
    REPAS: c.repas, STATUT: STATUTS.SAISIE, SIGNALEMENT: '', MODIFIE_LE: horodatage(), ID_ENVOI: idEnvoi || '',
  };
  if (existante) {
    await majLigne(env, t, existante, champs);
    await journaliser(env, moi, 'CORRECTION_JOURNEE', champs.ID_JOURNEE, champs);
  } else {
    champs.CREE_LE = champs.MODIFIE_LE;
    champs.VALIDE_BUREAU = false;
    await ajouterLigne(env, t, champs);
    await journaliser(env, moi, 'SAISIE_JOURNEE', champs.ID_JOURNEE, champs);
  }
  return { ok: true, journee: versClient(champs) };
}

async function exigerResponsable(env, moi, date) {
  const bloc = blocDe(await planningDuJour(env, date), moi);
  if (!bloc || bloc.responsable !== moi) {
    throw new ErreurMetier("Tu n'es pas responsable d'un chantier au planning ce jour-là.");
  }
  return bloc;
}

async function equipe(env, moi, date) {
  date = verifierDate(date);
  const bloc = await exigerResponsable(env, moi, date);
  const [t, tr] = await Promise.all([table(env, 'JOURNEES'), table(env, 'RAPPORTS')]);

  const membres = bloc.equipe.map(nom => {
    const j = t.trouver(x => x.ID_JOURNEE === idJournee(date, nom));
    return { personne: nom, estMoi: nom === moi, journee: j ? versClient(j.obj) : null };
  });
  t.filtrer(x => x.DATE === date && x.TYPE_PERSONNE === 'INTERIMAIRE' && x.SAISI_PAR === moi
      && !bloc.equipe.includes(x.PERSONNE))
    .forEach(o => membres.push({ personne: o.PERSONNE, estMoi: false, interimaire: true, journee: versClient(o) }));

  const repasEquipe = membres.filter(m => m.journee && m.journee.repas === 'RESTAURANT').length;
  const rapport = tr.trouver(r => r.ID_RAPPORT === idRapport(date, moi));
  const repasPayes = rapport ? Number(rapport.obj.REPAS_PAYES) || 0 : null;

  return {
    date, bloc, membres,
    repas: { equipe: repasEquipe, payes: repasPayes, ecart: repasPayes !== null && repasPayes !== repasEquipe },
    manquants: membres.filter(m => !m.journee).map(m => m.personne),
  };
}

async function validerJournee(env, moi, date, personne, decision, motif) {
  date = verifierDate(date);
  const bloc = await exigerResponsable(env, moi, date);
  if (decision !== 'VALIDER' && decision !== 'SIGNALER') throw new ErreurMetier('Décision inconnue.');
  if (decision === 'SIGNALER' && !motif) throw new ErreurMetier('Indique ce qui ne va pas.');

  const t = await table(env, 'JOURNEES');
  const j = t.trouver(x => x.ID_JOURNEE === idJournee(date, personne));
  if (!j) throw new ErreurMetier(`${personne} n'a pas encore saisi sa journée.`);
  if (!(bloc.equipe.includes(personne) || j.obj.SAISI_PAR === moi)) {
    throw new ErreurMetier(`${personne} n'est pas dans ton équipe ce jour-là.`);
  }
  if (j.obj.VALIDE_BUREAU === true || j.obj.STATUT === STATUTS.EXPORTEE) {
    throw new ErreurMetier('Journée déjà validée par le bureau.');
  }

  if (decision === 'VALIDER') {
    await majLigne(env, t, j, { STATUT: STATUTS.VALIDEE_CHEF, SIGNALEMENT: '', VALIDE_CHEF_PAR: moi,
      VALIDE_CHEF_LE: horodatage(), MODIFIE_LE: horodatage() });
  } else {
    await majLigne(env, t, j, { STATUT: STATUTS.SIGNALEE, SIGNALEMENT: String(motif).slice(0, 300),
      VALIDE_CHEF_PAR: '', VALIDE_CHEF_LE: '', MODIFIE_LE: horodatage() });
    await alerter(env, 'JOURNEE_SIGNALEE', date, personne, `${moi} : ${motif}`);
  }
  await journaliser(env, moi, decision, j.obj.ID_JOURNEE, motif || '');
  return { ok: true };
}

async function enregistrerInterimaire(env, moi, d, idEnvoi) {
  const date = verifierDate(d.date);
  await exigerResponsable(env, moi, date);
  const nom = String(d.nomInterimaire || '').trim();
  if (nom.length < 3) throw new ErreurMetier("Indique le nom de l'intérimaire.");
  const ref = await referentiels(env);
  const c = controlerJournee(d, ref);
  const libelle = 'INTERIM ' + nom.toUpperCase();
  const connu = personneParLibelle(ref, nom);

  const t = await table(env, 'JOURNEES');
  if (idEnvoi && t.trouver(x => x.ID_ENVOI === idEnvoi)) return { ok: true, dejaRecu: true };
  const existante = t.trouver(x => x.ID_JOURNEE === idJournee(date, libelle));
  if (existante && existante.obj.VALIDE_BUREAU === true) throw new ErreurMetier('Journée déjà validée par le bureau.');

  const champs = {
    ID_JOURNEE: idJournee(date, libelle), DATE: date, PERSONNE: libelle,
    ONGLET_RH: connu ? connu.ongletRh : '', TYPE_PERSONNE: 'INTERIMAIRE',
    NOM_INTERIMAIRE: nom, AGENCE: String(d.agence || '').trim(),
    SAISI_PAR: moi, CHANTIERS: c.chantiers.join(' ; '), RESPONSABLE: moi,
    LIEU_EMBAUCHE: c.lieuEmbauche, ZONE: c.zone, CODE_RH_ZONE: c.codeRh,
    H_EMBAUCHE: c.heures[0], H_PAUSE: c.heures[1], H_REPRISE: c.heures[2], H_DEBAUCHE: c.heures[3],
    TOTAL: c.total, TRAJET: c.trajet, TACHES_SUPP: c.tachesSupp, TACHES_SUPP_MIN: c.tachesSuppMin,
    REPAS: c.repas, STATUT: STATUTS.VALIDEE_CHEF, SIGNALEMENT: '',
    VALIDE_CHEF_PAR: moi, VALIDE_CHEF_LE: horodatage(), MODIFIE_LE: horodatage(), ID_ENVOI: idEnvoi || '',
  };
  if (existante) await majLigne(env, t, existante, champs);
  else { champs.CREE_LE = champs.MODIFIE_LE; champs.VALIDE_BUREAU = false; await ajouterLigne(env, t, champs); }
  if (!champs.ONGLET_RH) await alerter(env, 'INTERIMAIRE_SANS_ONGLET', date, libelle, `Agence : ${champs.AGENCE || '?'}`);
  await journaliser(env, moi, 'SAISIE_INTERIMAIRE', champs.ID_JOURNEE, champs);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rapports de chantier
// ---------------------------------------------------------------------------

async function lireRapport(env, moi, date) {
  date = verifierDate(date);
  const bloc = await exigerResponsable(env, moi, date);
  const id = idRapport(date, moi);
  const [tr, ta, tm, tb, tref] = await Promise.all([
    table(env, 'RAPPORTS'), table(env, 'AVANCEMENT'), table(env, 'MATERIAUX'),
    table(env, 'BL'), table(env, 'REF_MATERIAUX'),
  ]);
  const r = tr.trouver(x => x.ID_RAPPORT === id);
  return {
    bloc,
    rapport: r ? { restaurant: r.obj.RESTAURANT, repasPayes: r.obj.REPAS_PAYES, remarques: r.obj.REMARQUES, statut: r.obj.STATUT } : null,
    avancement: ta.filtrer(x => x.ID_RAPPORT === id).map(x => ({ chantier: x.CHANTIER, tache: x.TACHE, pourcentage: x.POURCENTAGE })),
    materiaux: tm.filtrer(x => x.ID_RAPPORT === id).map(x => ({ chantier: x.CHANTIER, materiau: x.MATERIAU, quantite: x.QUANTITE, unite: x.UNITE })),
    bl: tb.filtrer(x => x.ID_RAPPORT === id).map(x => ({ lien: x.LIEN_DRIVE, ajoute: x.AJOUTE_LE })),
    listeMateriaux: tref.filtrer(m => m.ACTIF !== 'NON').map(m => ({ materiau: String(m.MATERIAU), unite: m.UNITE_DEFAUT })),
  };
}

async function enregistrerRapport(env, moi, d, idEnvoi) {
  const date = verifierDate(d.date);
  const bloc = await exigerResponsable(env, moi, date);
  const id = idRapport(date, moi);
  const repas = Math.round(Number(d.repasPayes));
  if (!(repas >= 0 && repas <= 20)) throw new ErreurMetier('Nombre de repas invalide.');

  const avancement = (d.avancement || []).map(a => {
    const pct = Math.round(Number(a.pourcentage));
    if (!String(a.tache || '').trim()) throw new ErreurMetier("Une tâche sans nom dans l'avancement.");
    if (!(pct >= 0 && pct <= 100)) throw new ErreurMetier('Avancement entre 0 et 100 %.');
    return { CHANTIER: a.chantier || bloc.lieux[0] || '', TACHE: String(a.tache).trim().slice(0, 120), POURCENTAGE: pct };
  });
  const materiaux = (d.materiaux || []).map(m => {
    const q = Number(String(m.quantite).replace(',', '.'));
    if (!m.materiau || !(q > 0)) throw new ErreurMetier('Un matériau sans quantité.');
    return { CHANTIER: m.chantier || bloc.lieux[0] || '', MATERIAU: String(m.materiau), QUANTITE: q, UNITE: m.unite || '' };
  });

  const tr = await table(env, 'RAPPORTS');
  if (idEnvoi && tr.trouver(x => x.ID_ENVOI === idEnvoi)) return { ok: true, dejaRecu: true };

  const champs = {
    ID_RAPPORT: id, DATE: date, RESPONSABLE: moi, CHANTIERS: bloc.lieux.join(' ; '), CLIENT: bloc.client,
    RESTAURANT: String(d.restaurant || '').slice(0, 80), REPAS_PAYES: repas,
    REMARQUES: String(d.remarques || '').slice(0, 1000), STATUT: 'ENVOYE',
    MODIFIE_LE: horodatage(), ID_ENVOI: idEnvoi || '',
  };
  const existant = tr.trouver(x => x.ID_RAPPORT === id);
  if (existant) { champs.NB_BL = existant.obj.NB_BL; await majLigne(env, tr, existant, champs); }
  else { champs.CREE_LE = champs.MODIFIE_LE; champs.NB_BL = 0; await ajouterLigne(env, tr, champs); }

  const ta = await table(env, 'AVANCEMENT');
  await supprimerLignes(env, ta, x => x.ID_RAPPORT === id);
  for (const a of avancement) await ajouterLigne(env, ta, Object.assign({ ID_RAPPORT: id, DATE: date }, a));
  const tm = await table(env, 'MATERIAUX');
  await supprimerLignes(env, tm, x => x.ID_RAPPORT === id);
  for (const m of materiaux) await ajouterLigne(env, tm, Object.assign({ ID_RAPPORT: id, DATE: date }, m));

  await journaliser(env, moi, existant ? 'CORRECTION_RAPPORT' : 'RAPPORT', id,
    { repas, taches: avancement.length, materiaux: materiaux.length });
  await controlerRepas(env, date, moi);
  return { ok: true };
}

/**
 * Photos de bons de livraison : transmises à Apps Script, qui les dépose dans le Drive de Quentin.
 * Un compte de service n'a pas d'espace de stockage à lui, et on veut garder les photos dans Drive
 * pour un futur rapprochement avec les devis.
 */
async function ajouterBl(env, moi, d, idEnvoi) {
  const date = verifierDate(d.date);
  await exigerResponsable(env, moi, date);
  if (!env.RELAIS_URL) throw new ErreurMetier("Le dépôt des photos n'est pas configuré.");

  const rep = await fetch(env.RELAIS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'photo_relais', donnees: { cle: env.RELAIS_CLE, personne: moi, ...d }, idEnvoi }),
  });
  if (!rep.ok) throw new ErreurMetier("La photo n'a pas pu être déposée, réessaie plus tard.");
  const r = await rep.json();
  if (!r.ok) throw new ErreurMetier(r.erreur || "La photo n'a pas pu être déposée.");
  return { ok: true };
}

async function controlerRepas(env, date, responsable) {
  const [tr, t, pl] = await Promise.all([table(env, 'RAPPORTS'), table(env, 'JOURNEES'), planningDuJour(env, date)]);
  const r = tr.trouver(x => x.ID_RAPPORT === idRapport(date, responsable));
  if (!r || r.obj.REPAS_PAYES === '' || r.obj.REPAS_PAYES === null) return;
  const bloc = blocDe(pl, responsable);
  if (!bloc) return;
  const declares = t.filtrer(j => j.DATE === date && j.REPAS === 'RESTAURANT'
    && (bloc.equipe.includes(j.PERSONNE) || (j.SAISI_PAR === responsable && j.TYPE_PERSONNE === 'INTERIMAIRE'))).length;
  const payes = Number(r.obj.REPAS_PAYES) || 0;
  if (payes !== declares) {
    await alerter(env, 'ECART_REPAS', date, responsable, `${payes} payés au rapport, ${declares} déclarés par l'équipe`);
  }
}

// ---------------------------------------------------------------------------
// Export vers le Suivi RH (macro Excel)
// ---------------------------------------------------------------------------

async function journeesAExporter(env, cle) {
  if (!cle || cle !== env.CLE_EXPORT) throw new ErreurMetier("Clé d'export invalide.");
  const t = await table(env, 'JOURNEES');
  return t.filtrer(j => j.STATUT === STATUTS.VALIDEE_CHEF && j.VALIDE_BUREAU === true && !j.EXPORTE_LE)
    .map(j => ({
      id: j.ID_JOURNEE, date: j.DATE, personne: j.PERSONNE, ongletRh: j.ONGLET_RH,
      D: j.H_EMBAUCHE, E: j.H_PAUSE, F: j.H_REPRISE, G: j.H_DEBAUCHE,
      L: j.TACHES_SUPP_MIN ? hhmm(Number(j.TACHES_SUPP_MIN)) : '',
      P: j.CODE_RH_ZONE === '' || j.CODE_RH_ZONE === null ? '' : Number(j.CODE_RH_ZONE),
      AC: j.REPAS === 'PANIER' ? 1 : '', AD: j.REPAS === 'RESTAURANT' ? 1 : '', AG: 9,
    }));
}

async function marquerExportees(env, cle, ids) {
  if (!cle || cle !== env.CLE_EXPORT) throw new ErreurMetier("Clé d'export invalide.");
  const t = await table(env, 'JOURNEES');
  const quand = horodatage();
  let n = 0;
  for (const id of ids || []) {
    const j = t.trouver(x => x.ID_JOURNEE === id);
    if (j && j.obj.VALIDE_BUREAU === true && !j.obj.EXPORTE_LE) {
      await majLigne(env, t, j, { STATUT: STATUTS.EXPORTEE, EXPORTE_LE: quand });
      n++;
    }
  }
  await journaliser(env, 'IMPORT_RH', 'EXPORT', '', `${n} journée(s)`);
  return { ok: true, marquees: n };
}

// ---------------------------------------------------------------------------
// Contrôle du soir (déclencheur planifié)
// ---------------------------------------------------------------------------

async function controleDuSoir(env) {
  const date = aujourdhui();
  const jour = new Date(date + 'T12:00:00Z').getUTCDay();
  if (jour === 0 || jour === 6) return;

  const pl = await planningDuJour(env, date, true);
  if (!pl.trouve) {
    await alerter(env, 'PLANNING_ABSENT', date, '', "Aucun onglet du planning ne porte la date du jour en A2.");
    return;
  }
  for (const a of pl.anomalies) {
    if (a.type === 'NOM_INCONNU') await alerter(env, 'NOM_INCONNU', date, a.valeur, 'Absent de PERSONNES : ajouter la ligne ou corriger le planning');
    if (a.type === 'COMMUNE_INCONNUE') await alerter(env, 'COMMUNE_INCONNUE', date, '', `${a.valeur} : absente de LIEUX`);
  }
  const [codes, journees, rapports] = await Promise.all([codesActifs(env, true), table(env, 'JOURNEES'), table(env, 'RAPPORTS')]);
  for (const b of pl.blocs) {
    for (const nom of b.equipe) {
      if (!codes.includes(nom)) await alerter(env, 'SANS_CODE', date, nom, 'Au planning mais sans code de connexion : ajouter une ligne dans CODES');
      if (!journees.trouver(j => j.ID_JOURNEE === idJournee(date, nom))) {
        await alerter(env, 'JOURNEE_MANQUANTE', date, nom, `Prévu sur ${b.villes.join(', ')}, rien saisi ce soir`);
      }
    }
    if (b.responsable) {
      if (!rapports.trouver(r => r.ID_RAPPORT === idRapport(date, b.responsable))) {
        await alerter(env, 'RAPPORT_MANQUANT', date, b.responsable, `Rapport de ${b.villes.join(', ')} non envoyé`);
      }
      await controlerRepas(env, date, b.responsable);
    }
  }
}

// ---------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------

const ENTETES = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json;charset=UTF-8',
};

function reponse(objet, ms, action) {
  console.log(`${action || '?'} : ${ms} ms${objet.ok ? '' : ' — ' + objet.erreur}`);
  return new Response(JSON.stringify(objet), { headers: ENTETES });
}

export default {
  async fetch(requete, env) {
    if (requete.method === 'OPTIONS') return new Response(null, { headers: ENTETES });
    const debut = Date.now();
    const url = new URL(requete.url);
    let action = url.searchParams.get('action') || '';

    try {
      if (requete.method === 'GET') {
        if (action === 'export') return reponse({ ok: true, journees: await journeesAExporter(env, url.searchParams.get('cle')) }, Date.now() - debut, 'export');
        if (action === 'controle') { await controleDuSoir(env); return reponse({ ok: true }, Date.now() - debut, 'controle'); }
        return reponse({ ok: true, message: 'Serveur FLBTP en service.', heure: horodatage() }, Date.now() - debut, 'ping');
      }

      const req = await requete.json();
      const d = req.donnees || {};
      action = req.action || '';

      if (action === 'liste_personnes') return reponse({ ok: true, personnes: (await codesActifs(env)).slice().sort() }, Date.now() - debut, action);
      if (action === 'connexion') return reponse(Object.assign({ ok: true }, await connexion(env, d.personne, d.code)), Date.now() - debut, action);
      if (action === 'marquer_exportees') return reponse(await marquerExportees(env, d.cle, d.ids), Date.now() - debut, action);

      const moi = await verifierJeton(env, req.jeton);
      let res;
      switch (action) {
        case 'accueil': res = Object.assign({ ok: true }, await accueil(env, moi, d.date)); break;
        case 'referentiels': {
          const ref = await referentiels(env);
          res = { ok: true, lieux: ref.lieux.map(l => ({ libelle: l.libelle, type: l.type, zone: l.zone })),
            trajets: TRAJETS, repas: REPAS, depot: LIBELLE_DEPOT };
          break;
        }
        case 'enregistrer_journee': res = await enregistrerJournee(env, moi, d, req.idEnvoi); break;
        case 'equipe': res = Object.assign({ ok: true }, await equipe(env, moi, d.date)); break;
        case 'valider': res = await validerJournee(env, moi, d.date, d.personne, d.decision, d.motif); break;
        case 'enregistrer_interimaire': res = await enregistrerInterimaire(env, moi, d, req.idEnvoi); break;
        case 'rapport': res = Object.assign({ ok: true }, await lireRapport(env, moi, d.date)); break;
        case 'enregistrer_rapport': res = await enregistrerRapport(env, moi, d, req.idEnvoi); break;
        case 'ajouter_bl': res = await ajouterBl(env, moi, d, req.idEnvoi); break;
        default: throw new ErreurMetier('Action inconnue.');
      }
      return reponse(res, Date.now() - debut, action);
    } catch (err) {
      if (err instanceof ErreurMetier) {
        return reponse({ ok: false, erreur: err.message, session: !!err.session }, Date.now() - debut, action);
      }
      console.log('ERREUR ' + (err && err.stack || err));
      return reponse({ ok: false, erreur: 'Erreur du serveur. Réessaie plus tard.' }, Date.now() - debut, action);
    }
  },

  /** Déclencheur planifié : contrôle du soir. */
  async scheduled(evenement, env, ctx) {
    ctx.waitUntil(controleDuSoir(env));
  },
};
