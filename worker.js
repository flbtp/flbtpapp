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
 * Les réglages que Quentin peut changer lui-même sont dans l'onglet PARAMETRES du fichier de données
 * (créé tout seul, avec les valeurs par défaut, au premier besoin). Voir parametres().
 * Rattachement : KV namespace nommé CACHE.
 */

const FUSEAU = 'Europe/Paris';
const LIBELLE_DEPOT = 'DEPOT OBJAT';

const STATUTS = { SAISIE: 'SAISIE', SIGNALEE: 'SIGNALEE', VALIDEE_CHEF: 'VALIDEE_CHEF', EXPORTEE: 'EXPORTEE' };
const TRAJETS = ['PASSAGER', 'FOURGON', '3T5', 'PL'];
const REPAS = ['AUCUN', 'PANIER', 'RESTAURANT'];

/**
 * Réglages modifiables dans l'onglet PARAMETRES du fichier de données : PARAMETRE | VALEUR | DESCRIPTION.
 * Relus toutes les 10 minutes. Une valeur vide, effacée ou illisible reprend sa valeur par défaut,
 * et la page de vérification le signale.
 */
const PARAMETRES_DEFAUT = [
  ['CONTROLES_JOURS', 15, 'entier', 1, 60, "Nombre de jours ouvrés contrôlés à l'écran bureau (en plus des journées pas encore envoyées en paie)."],
  ['CONTROLES_DEPUIS', '', 'date', 0, 0, "Jour de mise en service (AAAA-MM-JJ) : aucun contrôle avant cette date. Vide : pas de limite."],
  ['CONTROLES_HEURE', 18, 'entier', 0, 23, "Heure à partir de laquelle la journée du jour est contrôlée (avant, elle est « en cours »)."],
  ['JOURNEE_LONGUE_H', 10, 'nombre', 1, 24, "Au-delà de ce nombre d'heures, la journée est signalée « à vérifier »."],
  ['JOURNEE_MAX_H', 12, 'nombre', 1, 24, "Au-delà de ce nombre d'heures, la saisie est refusée."],
  ['TACHES_AVANT_MAX_MIN', 240, 'entier', 15, 600, "Durée maximale des tâches avant chantier, en minutes."],
  ['HORAIRES_HABITUELS', '08:00 12:00 13:30 17:30', 'horaires', 0, 0, "Horaires proposés par défaut à la saisie : embauche, pause, reprise, débauche."],
  ['CONNEXION_ESSAIS', 5, 'entier', 3, 20, "Nombre de codes faux avant blocage."],
  ['CONNEXION_BLOCAGE_MIN', 15, 'entier', 1, 1440, "Durée du blocage après trop de codes faux, en minutes."],
  ['SESSION_JOURS', 60, 'entier', 1, 365, "Nombre de jours avant de devoir retaper son code."],
];
const CACHE_PARAMETRES_S = 600;

const CACHE_REFERENTIELS_S = 1800;
const CACHE_PLANNING_S = 900;
const CACHE_CODES_S = 300;

/** Colonnes dont la valeur doit rester du texte (voir remiseEnTexte). */
const COLONNES_TEXTE = {
  JOURNEES: ['ID_JOURNEE', 'DATE', 'ZONE', 'H_EMBAUCHE', 'H_PAUSE', 'H_REPRISE', 'H_DEBAUCHE', 'TOTAL',
    'VALIDE_CHEF_LE', 'EXPORTE_LE', 'CREE_LE', 'MODIFIE_LE', 'ID_ENVOI', 'REPARTITION', 'ID_CHANTIERS'],
  RAPPORTS: ['ID_RAPPORT', 'DATE', 'CREE_LE', 'MODIFIE_LE', 'ID_ENVOI'],
  AVANCEMENT: ['ID_RAPPORT', 'DATE', 'MODE', 'UNITE'],
  MATERIAUX: ['ID_RAPPORT', 'DATE', 'MATERIAU'],
  BL: ['ID_RAPPORT', 'DATE', 'AJOUTE_LE'],
  RAPPORT_CHANTIERS: ['ID_RAPPORT', 'DATE', 'CHANTIER', 'REMARQUES'],
  REF_MATERIAUX: ['MATERIAU'],
  CODES: ['PERSONNE', 'CODE', 'BLOQUE_JUSQU_A', 'ROLE'],
  ALERTES: ['HORODATAGE', 'DATE_CONCERNEE'],
  JOURNAL: ['HORODATAGE'],
};

const PLANNING = {
  PREMIERE_LIGNE: 6, DERNIERE_LIGNE: 45,
  // Les colonnes A, B et C portent chacune un chantier : une équipe peut en faire trois dans la journée.
  COLS_CHANTIER: [1, 2, 3],
  COL_TACHES: 4, COL_NOMS: 6,
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

/**
 * Google refuse parfois un appel sans qu'on y soit pour rien :
 *  - 429 : quota dépassé. Le compte de service compte pour UN seul utilisateur, limité à 60 lectures
 *    et 60 écritures par minute pour toute l'entreprise. Un appel refusé ainsi n'a rien fait : on le rejoue.
 *  - 500, 502, 503 : panne passagère. Rejoué seulement pour une lecture : une écriture a pu être faite.
 * Au-delà de quelques secondes, on renonce avec une ErreurGoogleSaturee, que le routeur transforme
 * en réponse 503 : le téléphone garde alors l'envoi et le repasse tout seul un peu plus tard.
 */
const ATTENTES_GOOGLE_MS = [500, 1500, 3000];

class ErreurGoogleSaturee extends Error {}

async function sheets(env, idFichier, chemin, options = {}) {
  const methode = options.methode || 'GET';
  for (let essai = 0; ; essai++) {
    const jeton = await accesGoogle(env);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${idFichier}${chemin}`;
    const rep = await fetch(url, {
      method: methode,
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: options.corps ? JSON.stringify(options.corps) : undefined,
    });
    if (rep.ok) return rep.json();
    const detail = (await rep.text()).slice(0, 300);
    const passager = rep.status === 429 || (methode === 'GET' && [500, 502, 503].includes(rep.status));
    if (passager && essai < ATTENTES_GOOGLE_MS.length) {
      console.log(`Google ${rep.status} sur ${chemin.slice(0, 60)} : nouvel essai dans ${ATTENTES_GOOGLE_MS[essai]} ms`);
      await new Promise(ok => setTimeout(ok, ATTENTES_GOOGLE_MS[essai]));
      continue;
    }
    if (passager) throw new ErreurGoogleSaturee(`Google ${rep.status} sur ${chemin} : ${detail}`);
    throw new Error(`Google Sheets ${rep.status} sur ${chemin} : ${detail}`);
  }
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

function versTable(nom, brut) {
  brut = brut.slice();
  const entetes = (brut.shift() || []).map(String);
  const texte = COLONNES_TEXTE[nom] || [];
  const lignes = [];
  brut.forEach((v, i) => {
    // Écarter d'abord les lignes vides (ou seulement des cases décochées) : JOURNEES en compte des
    // milliers, et construire un objet pour chacune coûte du temps de calcul pour rien.
    if (!v || !v.some(x => x !== '' && x !== null && x !== false && x !== undefined)) return;
    const obj = {};
    entetes.forEach((e, j) => { if (e) obj[e] = texte.includes(e) ? remiseEnTexte(e, v[j]) : (v[j] === undefined ? '' : v[j]); });
    if (Object.values(obj).some(x => x !== '' && x !== null && x !== false)) lignes.push({ obj, ligne: i + 2 });
  });
  return new Table(nom, entetes, lignes);
}

async function table(env, nom) {
  return versTable(nom, await lirePlage(env, env.ID_DONNEES, nom, 'A1:AZ'));
}

/** Plusieurs tables du fichier de données en UN seul appel à Google (une lecture au lieu de six). */
async function tables(env, noms) {
  const params = noms.map(n => `ranges=${encodeURIComponent(plage(n, 'A1:AZ'))}`).join('&');
  const r = await sheets(env, env.ID_DONNEES,
    `/values:batchGet?${params}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  const res = {};
  noms.forEach((n, i) => { res[n] = versTable(n, ((r.valueRanges || [])[i] || {}).values || []); });
  return res;
}

/**
 * Écrit une nouvelle ligne À LA SUITE des données.
 * On calcule nous-mêmes la ligne plutôt que d'utiliser l'ajout automatique de Google : celui-ci
 * considère qu'une colonne porteuse de cases à cocher fait partie du tableau, et écrit alors
 * des milliers de lignes plus bas, laissant un trou que chaque lecture doit traverser.
 * La grille est allongée d'une ligne dans la même requête : dans le vrai fichier, la dernière ligne
 * remplie d'ALERTES était la dernière de la grille, et écrire dessous était refusé
 * (« exceeds grid limits », v26, à l'ajout d'un intérimaire).
 */
async function ajouterLigne(env, t, obj) {
  const ids = await idsOnglets(env, [t.nom]);
  const requetes = requetesRemplacer(ids[t.nom], t, () => false, [obj]);
  await sheets(env, env.ID_DONNEES, ':batchUpdate', { methode: 'POST', corps: { requests: requetes } });
  const ligne = t.lignes.length ? Math.max(...t.lignes.map(l => l.ligne)) + 1 : 2;
  t.lignes.push({ obj: Object.assign({}, obj), ligne });      // la table reste juste pour la suite de l'appel
}

async function majLigne(env, t, entree, champs) {
  Object.assign(entree.obj, champs);
  const derniere = colonneLettre(t.entetes.length);
  await sheets(env, env.ID_DONNEES,
    `/values/${encodeURIComponent(plage(t.nom, `A${entree.ligne}:${derniere}${entree.ligne}`))}?valueInputOption=RAW`,
    { methode: 'PUT', corps: { values: [t.valeurs(entree.obj)] } });
}

/** Plusieurs lignes existantes réécrites en UN appel (au lieu d'un par ligne : quota Google). */
async function majLignes(env, t, modifs) {
  if (!modifs.length) return;
  const derniere = colonneLettre(t.entetes.length);
  const data = modifs.map(([entree, champs]) => {
    Object.assign(entree.obj, champs);
    return { range: plage(t.nom, `A${entree.ligne}:${derniere}${entree.ligne}`), values: [t.valeurs(entree.obj)] };
  });
  await sheets(env, env.ID_DONNEES, '/values:batchUpdate', {
    methode: 'POST', corps: { valueInputOption: 'RAW', data },
  });
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

/** Une case pour batchUpdate, écrite telle quelle (l'équivalent de RAW : « 08:15 » reste du texte). */
function caseBrute(v) {
  if (v === '' || v === null || v === undefined) return {};
  if (typeof v === 'number') return { userEnteredValue: { numberValue: v } };
  if (typeof v === 'boolean') return { userEnteredValue: { boolValue: v } };
  return { userEnteredValue: { stringValue: String(v) } };
}

function ligneBrute(t, obj) { return { values: t.valeurs(obj).map(caseBrute) }; }

/** Requête batchUpdate qui réécrit une ligne existante, à sa place. */
function requeteMaj(idOnglet, t, entree, champs) {
  Object.assign(entree.obj, champs);
  return { updateCells: { start: { sheetId: idOnglet, rowIndex: entree.ligne - 1, columnIndex: 0 },
    rows: [ligneBrute(t, entree.obj)], fields: 'userEnteredValue' } };
}

/**
 * Requêtes batchUpdate qui remplacent, dans une table, les lignes répondant à `pred` par `nouveaux` :
 * suppression des anciennes du bas vers le haut, puis écriture des nouvelles juste sous la dernière
 * ligne restante — ligne calculée ici, jamais laissée à Google (voir ajouterLigne).
 * La grille est d'abord agrandie d'autant de lignes qu'on en écrit : une suppression la raccourcit,
 * et écrire au-delà de la dernière ligne de la grille est refusé par Google.
 * Toutes les requêtes d'un même batchUpdate s'appliquent ensemble, ou aucune.
 */
function requetesRemplacer(idOnglet, t, pred, nouveaux) {
  const req = [];
  const supprimees = t.lignes.filter(l => pred(l.obj)).map(l => l.ligne).sort((a, b) => a - b);
  const restantes = t.lignes.filter(l => !pred(l.obj)).map(l => l.ligne);
  const plages = [];
  supprimees.forEach(n => {
    const d = plages[plages.length - 1];
    if (d && d[1] === n - 1) d[1] = n; else plages.push([n, n]);
  });
  plages.reverse().forEach(([a, b]) => req.push({
    deleteDimension: { range: { sheetId: idOnglet, dimension: 'ROWS', startIndex: a - 1, endIndex: b } },
  }));
  if (nouveaux.length) {
    // Position de chaque ligne restante une fois les suppressions faites.
    const derniere = restantes.length
      ? Math.max(...restantes.map(n => n - supprimees.filter(x => x < n).length)) : 1;
    req.push({ appendDimension: { sheetId: idOnglet, dimension: 'ROWS', length: nouveaux.length } });
    req.push({ updateCells: { start: { sheetId: idOnglet, rowIndex: derniere, columnIndex: 0 },
      rows: nouveaux.map(o => ligneBrute(t, o)), fields: 'userEnteredValue' } });
  }
  return req;
}

/** Identifiants des onglets du fichier de données, nécessaires aux requêtes batchUpdate. */
async function idsOnglets(env, noms) {
  const liste = await onglets(env, env.ID_DONNEES);
  const ids = {};
  for (const n of noms) {
    const o = liste.find(x => x.titre === n);
    if (!o) throw new ErreurMetier(`Onglet introuvable dans le fichier de données : ${n}`);
    ids[n] = o.id;
  }
  return ids;
}

/** Une valeur lue dans PARAMETRES, vérifiée ; null si elle n'est pas utilisable. */
function valeurParametre(genre, min, max, v) {
  if (v === '' || v === null || v === undefined) return genre === 'date' ? '' : null;
  if (genre === 'date') {
    if (typeof v === 'number') return depuisSerie(v).date;               // date tapée dans la feuille
    const t = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    return fr ? `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}` : null;
  }
  if (genre === 'horaires') {
    const h = String(v).trim().split(/[\s;,]+/);
    const m = h.map(minutes);
    return h.length === 4 && m.every(x => x !== null) && m[0] < m[1] && m[1] <= m[2] && m[2] < m[3] ? h.map(x => hhmm(minutes(x))).join(' ') : null;
  }
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return genre === 'entier' ? Math.round(n) : n;
}

async function creerOngletParametres(env) {
  try {
    await sheets(env, env.ID_DONNEES, ':batchUpdate', { methode: 'POST',
      corps: { requests: [{ addSheet: { properties: { title: 'PARAMETRES' } } }] } });
  } catch (e) {
    if (/already exists/i.test(e.message)) return;          // créé entre-temps : surtout ne rien écraser
    throw e;
  }
  await sheets(env, env.ID_DONNEES, `/values/${encodeURIComponent(plage('PARAMETRES', `A1:C${PARAMETRES_DEFAUT.length + 1}`))}?valueInputOption=RAW`, {
    methode: 'PUT',
    corps: { values: [['PARAMETRE', 'VALEUR', 'DESCRIPTION'], ...PARAMETRES_DEFAUT.map(([cle, v, , , , desc]) => [cle, v, desc])] },
  });
  await onglets(env, env.ID_DONNEES, true);
  await journaliser(env, '', 'PARAMETRES_CREES', 'PARAMETRES', `${PARAMETRES_DEFAUT.length} réglages par défaut`);
}

/**
 * Les réglages en vigueur : { CLE: valeur, _anomalies: [...] }. L'onglet PARAMETRES est créé avec les
 * valeurs par défaut s'il n'existe pas encore. Gardés 10 minutes en mémoire.
 */
async function parametres(env, forcer) {
  if (!forcer) {
    const garde = await memoire(env, 'parametres');
    if (garde) return garde;
  }
  let lues = {};
  const existe = (await onglets(env, env.ID_DONNEES, forcer)).some(o => o.titre === 'PARAMETRES');
  if (!existe) await creerOngletParametres(env);
  else {
    (await lirePlage(env, env.ID_DONNEES, 'PARAMETRES', 'A2:B100')).forEach(l => {
      if (String(l[0] || '').trim()) lues[String(l[0]).trim().toUpperCase()] = l[1];
    });
  }
  const res = { _anomalies: [] };
  for (const [cle, defaut, genre, min, max] of PARAMETRES_DEFAUT) {
    if (!(cle in lues)) { res[cle] = defaut; if (existe) res._anomalies.push(`${cle} absent : ${defaut === '' ? 'vide' : defaut} par défaut`); continue; }
    const v = valeurParametre(genre, min, max, lues[cle]);
    if (v === null) { res[cle] = defaut; res._anomalies.push(`${cle} = « ${lues[cle]} » illisible : ${defaut} par défaut`); }
    else res[cle] = v;
  }
  await memoire(env, 'parametres', res, CACHE_PARAMETRES_S);
  return res;
}

/** Ce que le téléphone doit connaître des réglages, pour prévenir avant l'envoi comme le serveur. */
function parametresTelephone(par) {
  const [e, p, r, d] = par.HORAIRES_HABITUELS.split(' ');
  return { journeeMaxMin: Math.round(par.JOURNEE_MAX_H * 60), tachesAvantMaxMin: par.TACHES_AVANT_MAX_MIN,
    horaires: { hEmbauche: e, hPause: p, hReprise: r, hDebauche: d } };
}

function colonneLettre(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function onglets(env, idFichier, forcer) {
  const cle = 'onglets_' + idFichier;
  const garde = forcer ? null : await memoire(env, cle);
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

/**
 * La mémoire n'est qu'une économie d'appels : si Cloudflare la refuse (plus d'une écriture par seconde
 * sur une même clé, quota du jour atteint), on continue sans elle au lieu d'échouer.
 */
async function memoire(env, cle, valeur, secondes) {
  if (valeur === undefined) {
    try {
      const v = await env.CACHE.get(cle, 'json');
      return v === null ? null : v;
    } catch (e) {
      console.log(`mémoire illisible (${cle}) : ${e.message}`);
      return null;
    }
  }
  try {
    await env.CACHE.put(cle, JSON.stringify(valeur), { expirationTtl: Math.max(60, secondes) });
  } catch (e) {
    console.log(`mémoire non écrite (${cle}) : ${e.message}`);
  }
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
  // Les six onglets en UNE lecture (quota Google), seulement ceux qui existent : une plage vers un
  // onglet absent ferait refuser toute la lecture groupée.
  const existants = (await onglets(env, env.ID_PLANNING, forcer)).map(o => o.titre);
  if (!['ZONES', 'PERSONNES', 'LIEUX'].every(n => existants.includes(n))) {
    throw new ErreurMetier("Les référentiels ne sont pas dans le planning : importer PERSONNES, LIEUX et ZONES.");
  }
  const noms = ['ZONES', 'PERSONNES', 'LIEUX', 'CLIENTS', 'CHANTIERS', 'MATERIAUX'].filter(n => existants.includes(n));
  const params = noms.map(n => `ranges=${encodeURIComponent(plage(n, 'A1:AZ'))}`).join('&');
  const lu = await sheets(env, env.ID_PLANNING,
    `/values:batchGet?${params}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  const bruts = {};
  noms.forEach((n, i) => { bruts[n] = ((lu.valueRanges || [])[i] || {}).values || []; });
  const lire = async nom => {
    if (!bruts[nom]) throw new Error(`onglet ${nom} absent du planning`);
    const brut = bruts[nom].slice();
    const entetes = (brut.shift() || []).map(String);
    return brut.filter(l => String(l[0] || '').trim() !== '')
      .map(l => { const o = {}; entetes.forEach((e, i) => { o[e] = l[i]; }); return o; });
  };

  const zonesBrutes = await lire('ZONES');
  const zones = {};
  zonesBrutes.forEach(z => { zones[String(z.ZONE).trim()] = String(z.CODE_RH).trim(); });

  const ref = {
    personnes: (await lire('PERSONNES')).map(p => ({
      libelle: String(p.LIBELLE_PLANNING).trim(),
      type: String(p.TYPE || '').trim(),
      nom: String(p.NOM || '').trim(),
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
  // Clients et chantiers : le chantier est l'unité qui pilote tout. Le client et la commune
  // en découlent, et la commune porte la zone.
  const clients = {};
  try {
    (await lire('CLIENTS')).forEach(c => { clients[String(c.ID).trim()] = String(c.NOM || '').trim(); });
  } catch (e) { /* référentiel pas encore en place */ }
  const zoneDe = commune => {
    const l = ref.lieux.find(x => normaliser(x.libelle) === normaliser(commune));
    return l ? { zone: l.zone, codeRh: l.codeRh, commune: l.libelle } : { zone: '', codeRh: '', commune: String(commune || '').trim() };
  };
  try {
    ref.chantiers = (await lire('CHANTIERS'))
      .filter(c => String(c.ACTIF || 'OUI').trim().toUpperCase() !== 'NON')
      .map(c => {
        const z = zoneDe(c.COMMUNE);
        return {
          id: String(c.ID).trim(),
          libelle: String(c.LIBELLE || '').trim(),
          client: String(c.CLIENT || clients[String(c.ID_CLIENT || '').trim()] || '').trim(),
          commune: z.commune, zone: z.zone, codeRh: z.codeRh,
        };
      })
      .filter(c => c.libelle);
  } catch (e) {
    ref.chantiers = null;                 // on retombe sur les communes, comme avant
  }

  // Matériaux : référentiel tenu dans le planning avec les autres. Absent = on se rabat
  // sur l'onglet REF_MATERIAUX du fichier de données (ancienne place).
  try {
    ref.materiaux = (await lire('MATERIAUX'))
      .filter(m => String(m.ACTIF || 'OUI').toUpperCase() !== 'NON')
      .map(m => ({
        categorie: String(m.CATEGORIE || '').trim(),
        materiau: String(m.MATERIAU).trim(),
        unite: String(m.UNITE || '').trim().toLowerCase(),
      }));
  } catch (e) {
    ref.materiaux = null;
  }
  await memoire(env, 'referentiels', ref, CACHE_REFERENTIELS_S);
  return ref;
}

/**
 * La ligne générique « INTERIMAIRE » de PERSONNES (type INTERIMAIRE, nom vide) : Quentin la met au planning quand
 * il sait qu'il y aura un intérimaire sans savoir qui. Ce n'est pas une personne : ignorée partout (version 38).
 */
function estGenerique(p) {
  return !!p && (normaliser(p.libelle) === 'INTERIMAIRE' || (p.nom !== undefined && p.type === 'INTERIMAIRE' && !p.nom));
}

/** Les façons d'écrire une personne : libellé du planning, anciennes graphies, nom, prénom + nom dans les deux sens. */
function clesPersonne(p) {
  const cles = [p.libelle, ...(p.anciennes || [])];
  if (p.nom) cles.push(p.nom, `${p.prenom} ${p.nom}`, `${p.nom} ${p.prenom}`);
  if (p.ongletRh) cles.push(p.ongletRh);          // l'onglet du Suivi RH tapé tel quel (« RONGIER M ») — version 39
  return [...new Set(cles.map(normaliser).filter(Boolean))];
}

/** Quelqu'un de PERSONNES (hors prestataires et ligne générique) dont le nom tapé correspond — actif ou non. */
function personneCorrespondante(ref, texte) {
  const n = normaliser(texte);
  if (!n) return null;
  return ref.personnes.find(p => p.type !== 'PRESTATAIRE' && !estGenerique(p) && clesPersonne(p).includes(n)) || null;
}
function messageDejaPersonne(p, nom, pourBureau) {
  return p.actif
    ? `${nom} est dans la liste des personnes (${p.libelle}) : utilise « ${pourBureau ? "Saisir pour quelqu'un" : 'Ajouter un gars'} ».`
    : `${nom} est dans la liste des personnes (${p.libelle}) mais inactif : à réactiver dans PERSONNES, demande au bureau.`;
}

function personneParLibelle(ref, texte) {
  const n = normaliser(texte);
  return ref.personnes.find(p => normaliser(p.libelle) === n || p.anciennes.some(a => normaliser(a) === n)) || null;
}

/** Un chantier se reconnaît à son libellé complet, ou à son seul numéro. */
function chantierParLibelle(ref, texte) {
  if (!ref.chantiers) return null;
  const n = normaliser(texte);
  if (!n) return null;
  return ref.chantiers.find(c => normaliser(c.libelle) === n)
    || ref.chantiers.find(c => n === normaliser(c.id))
    || null;
}

function lieuParLibelle(ref, texte) {
  const n = normaliser(texte);
  return ref.lieux.find(l => normaliser(l.libelle) === n) || null;
}

/**
 * Index des onglets du planning : date en A2 -> nom de l'onglet.
 * Lu en une seule requête (batchGet) pour tous les onglets au nom numérique, puis gardé 2 heures.
 * On passe par la date parce que le nom ne suffit pas : « 111 » peut être le 1er novembre ou le 11 janvier.
 */
async function indexPlanning(env, forcer) {
  if (!forcer) {
    const garde = await memoire(env, 'index_planning');
    if (garde) return garde;
  }
  // Aucune hypothèse sur les noms : on lit la date de TOUS les onglets, sauf les référentiels.
  const REFERENTIELS = ['PERSONNES', 'LIEUX', 'ZONES'];
  const titres = (await onglets(env, env.ID_PLANNING)).map(o => o.titre).filter(t => !REFERENTIELS.includes(t));
  const index = {};
  for (let i = 0; i < titres.length; i += 100) {            // l'API limite le nombre de plages par appel
    const lot = titres.slice(i, i + 100);
    const params = lot.map(t => `ranges=${encodeURIComponent(plage(t, 'A2'))}`).join('&');
    const r = await sheets(env, env.ID_PLANNING,
      `/values:batchGet?${params}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
    (r.valueRanges || []).forEach((v, n) => {
      const brut = v.values && v.values[0] && v.values[0][0];
      if (typeof brut === 'number') index[depuisSerie(brut).date] = lot[n];
    });
  }
  await memoire(env, 'index_planning', index, 7200);
  return index;
}

async function ongletDuJour(env, dateTxt, forcer) {
  const index = await indexPlanning(env, forcer);
  if (index[dateTxt]) return index[dateTxt];
  // Onglet créé depuis la dernière lecture de l'index : on relit une fois.
  if (!forcer) {
    const frais = await indexPlanning(env, true);
    if (frais[dateTxt]) return frais[dateTxt];
  }
  return null;
}

async function planningDuJour(env, dateTxt, forcer) {
  const cle = 'planning_' + dateTxt;
  if (!forcer) {
    const garde = await memoire(env, cle);
    if (garde) return garde;
  }
  const titre = await ongletDuJour(env, dateTxt, forcer);
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

  // La tâche est portée par la LIGNE, donc par la personne de cette ligne.
  const tacheDe = ligne => String((ligne || [])[PLANNING.COL_TACHES - 1] || '').trim();

  const cellules = ligne => PLANNING.COLS_CHANTIER
    .map(c => String((ligne || [])[c - 1] || '').trim())
    .filter(Boolean)
    // On accepte encore les anciennes cases à plusieurs valeurs, séparées par virgule ou retour à la ligne.
    .flatMap(v => v.split(/[\n,]+/).map(x => x.trim()).filter(Boolean));

  for (const ligne of valeurs) {
    const noms = String((ligne || [])[PLANNING.COL_NOMS - 1] || '').trim();
    const chantiers = cellules(ligne);
    if (chantiers.some(v => PLANNING.MOTS_FIN.includes(v.toUpperCase()))) break;

    if (chantiers.length) {
      courant = { libelles: chantiers, taches: [], noms: [] };
      blocs.push(courant);
    }
    // Les tâches décrivent le chantier, pas la personne : on récolte celles de tout le bloc.
    const tache = tacheDe(ligne);
    if (tache && courant && !courant.taches.includes(tache)) courant.taches.push(tache);
    if (noms && courant) courant.noms.push(noms);
  }

  const utiles = [];
  for (const b of blocs) {
    b.chantiers = [];
    b.inconnus = [];
    b.libelles.forEach(v => {
      const c = ref.chantiers ? chantierParLibelle(ref, v) : null;
      if (c) { if (!b.chantiers.some(x => x.id === c.id)) b.chantiers.push(c); return; }
      // Sans référentiel chantiers, ou libellé inconnu : on retombe sur la commune.
      const l = lieuParLibelle(ref, v);
      if (l) b.chantiers.push({ id: '', libelle: l.libelle, client: '', commune: l.libelle, zone: l.zone, codeRh: l.codeRh });
      else { b.inconnus.push(v); anomalies.push({ type: 'CHANTIER_INCONNU', valeur: v }); }
    });
    b.villes = b.chantiers.map(c => c.commune || c.libelle);     // pour les écrans et les messages
    b.client = [...new Set(b.chantiers.map(c => c.client).filter(Boolean))].join(' / ');
    b.lieux = b.chantiers.map(c => c.libelle);

    b.equipe = [];
    b.noms.forEach(nom => {
      const p = personneParLibelle(ref, nom);
      if (!p) { anomalies.push({ type: 'NOM_INCONNU', valeur: nom }); return; }
      if (p.type === 'PRESTATAIRE' || estGenerique(p)) return;      // « INTERIMAIRE » : on ne sait pas encore qui (v38)
      if (!b.equipe.includes(p.libelle)) b.equipe.push(p.libelle);
    });
    b.taches = b.taches.join(' · ');
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
  const jours = (await parametres(env)).SESSION_JOURS;
  const charge = base64url(new TextEncoder().encode(JSON.stringify({
    p: personne, e: Date.now() + jours * 86400000,
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

/**
 * Le bureau (Quentin) : colonne ROLE de l'onglet CODES, valeur BUREAU.
 * Lu dans la même mémoire que les codes (5 minutes) : l'accueil de chacun demande « est-ce le bureau ? »,
 * et relire CODES à chaque fois coûtait une lecture Google par écran ouvert.
 */
async function exigerBureau(env, moi) {
  if (!(await lireCodes(env)).bureau.includes(moi)) throw new ErreurMetier('Réservé au bureau.');
}

async function estBureau(env, moi) {
  try { await exigerBureau(env, moi); return true; } catch (e) { return false; }
}

async function lireCodes(env, forcer) {
  if (!forcer) {
    const garde = await memoire(env, 'codes');
    if (garde && garde.actifs) return garde;
  }
  const t = await table(env, 'CODES');
  const actifs = t.filtrer(c => c.ACTIF !== 'NON' && c.ACTIF !== false);
  const codes = {
    actifs: actifs.map(c => String(c.PERSONNE)),
    bureau: actifs.filter(c => String(c.ROLE || '').trim().toUpperCase() === 'BUREAU').map(c => String(c.PERSONNE)),
  };
  await memoire(env, 'codes', codes, CACHE_CODES_S);
  return codes;
}

async function codesActifs(env, forcer) {
  return (await lireCodes(env, forcer)).actifs;
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
    const par = await parametres(env);
    if (echecs >= par.CONNEXION_ESSAIS) {
      champs.ECHECS = 0;
      const fin = new Date(Date.now() + par.CONNEXION_BLOCAGE_MIN * 60000);
      const p = partiesDate(fin);
      champs.BLOQUE_JUSQU_A = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
      await journaliser(env, personne, 'BLOCAGE', 'CODES', `${par.CONNEXION_ESSAIS} échecs`);
    }
    await majLigne(env, t, entree, champs);
    throw new ErreurMetier('Nom ou code incorrect.');
  }
  if (Number(entree.obj.ECHECS) || entree.obj.BLOQUE_JUSQU_A) {
    await majLigne(env, t, entree, { ECHECS: 0, BLOQUE_JUSQU_A: '' });
  }
  const p = personneParLibelle(ref, personne);
  await journaliser(env, personne, 'CONNEXION', '', '');
  return { jeton: await creerJeton(env, personne), personne, type: p ? p.type : '', prenom: p ? p.prenom : '',
    bureau: await estBureau(env, personne) };
}

// ---------------------------------------------------------------------------
// Journées
// ---------------------------------------------------------------------------

function idJournee(date, personne) { return `${date}|${personne}`; }
function idRapport(date, responsable) { return `${date}|${responsable}`; }

/**
 * Le chef d'un intérimaire : RESPONSABLE, enregistré à la saisie (chef, ou bureau au nom d'un chef).
 * Les journées d'avant la version 30 n'ont que SAISI_PAR.
 */
function chefInterimaire(o) {
  return String(o.RESPONSABLE || o.SAISI_PAR || '').replace(/ \((bureau|chef)\)$/, '');
}
function estInterimaireDe(o, chef) {
  return o.TYPE_PERSONNE === 'INTERIMAIRE' && chefInterimaire(o) === chef;
}

function estValidee(o) {
  return o.STATUT === STATUTS.VALIDEE_CHEF || o.STATUT === STATUTS.EXPORTEE || o.VALIDE_BUREAU === true;
}

/**
 * LES ÉQUIPES DU JOUR (version 34). Le planning donne la direction du matin ; ensuite chacun fait au
 * mieux, et l'équipe d'un gars se déduit des chantiers qu'il déclare. Toute sa journée (heures, repas,
 * validation) va à UN seul chef :
 *   1. intérimaire : le chef qui l'a saisi (RESPONSABLE) ;
 *   2. chef d'un bloc du planning : son bloc, toujours ;
 *   3. journée validée : figée chez le chef enregistré à la validation (RESPONSABLE) — une validation
 *      ne se déplace jamais d'un chef à l'autre ;
 *   4. sinon, d'après ses chantiers : au planning et un de ses chantiers dans son bloc → son chef ;
 *      sinon le chef du premier chantier déclaré qui est au planning (le premier bloc s'il y en a
 *      plusieurs) ; sinon, s'il était au planning, son chef prévu ;
 *   5. ni au planning, ni aucun chantier au planning : CHEF DE FAIT. Les gars dans ce cas qui partagent
 *      un chantier forment une équipe, dont le chef est le premier à avoir envoyé sa journée (ou celui
 *      déjà validé comme tel). C'est aussi la règle des jours sans planning.
 * Renvoie { blocs (ceux du planning puis ceux de fait, chacun avec son équipe complète), chef, prevu }.
 */
function equipesDuJour(pl, journees, ref, extra) {
  const blocsPl = pl.blocs || [];
  const chefsPlanning = new Set(blocsPl.map(b => b.responsable));
  const prevu = {};
  blocsPl.forEach(b => b.equipe.forEach(nom => { if (!prevu[nom]) prevu[nom] = b.responsable; }));
  const proprietaires = lib => blocsPl.filter(b => b.chantiers.some(c => normaliser(c.libelle) === normaliser(lib)));
  const chantiersDe = j => String(j.CHANTIERS || '').split(' ; ').map(x => x.trim()).filter(Boolean);
  // Aucun de ses chantiers au planning : il est sur un chantier que personne n'avait (version 35 : même s'il
  // était prévu dans une équipe ce matin).
  const horsPlanning = j => !chantiersDe(j).some(c => proprietaires(c).length);
  const chef = {};
  const sansChef = [];                       // candidats « chef de fait » : { j, fige }
  for (const j of journees) {
    const p = j.PERSONNE;
    if (j.TYPE_PERSONNE === 'INTERIMAIRE') { chef[p] = chefInterimaire(j); continue; }
    if (chefsPlanning.has(p)) { chef[p] = p; continue; }
    if (estValidee(j) && (String(j.RESPONSABLE || '').trim() || /\(bureau\)$/.test(String(j.SAISI_PAR || '')))) {
      chef[p] = String(j.RESPONSABLE || '').trim();            // '' : le bureau l'a mis hors équipe
      if (horsPlanning(j)) sansChef.push({ j, fige: true });
      continue;
    }
    const cs = chantiersDe(j);
    const P = prevu[p] ? blocsPl.find(b => b.responsable === prevu[p]) : null;
    if (P && cs.some(c => proprietaires(c).includes(P))) { chef[p] = P.responsable; continue; }
    const premier = cs.map(proprietaires).find(o => o.length);
    if (premier) { chef[p] = premier[0].responsable; continue; }
    if (P && !cs.length) { chef[p] = P.responsable; continue; }
    sansChef.push({ j, fige: false });
  }
  // Chefs de fait : regroupement des gars hors planning qui partagent un chantier.
  const parent = {};
  const racine = x => (parent[x] === x ? x : (parent[x] = racine(parent[x])));
  sansChef.forEach(({ j }) => { parent[j.PERSONNE] = j.PERSONNE; });
  const premierSur = {};
  sansChef.forEach(({ j }) => chantiersDe(j).forEach(c => {
    const k = normaliser(c);
    if (premierSur[k]) parent[racine(j.PERSONNE)] = racine(premierSur[k]); else premierSur[k] = j.PERSONNE;
  }));
  const groupes = {};
  sansChef.forEach(x => { (groupes[racine(x.j.PERSONNE)] = groupes[racine(x.j.PERSONNE)] || []).push(x); });
  Object.values(groupes).forEach(g => {
    g.sort((a, b) => String(a.j.CREE_LE || '').localeCompare(String(b.j.CREE_LE || '')) || a.j.PERSONNE.localeCompare(b.j.PERSONNE));
    const deja = g.find(x => x.fige && chef[x.j.PERSONNE] === x.j.PERSONNE);      // chef de fait déjà validé comme tel
    const r = deja ? deja.j.PERSONNE : g[0].j.PERSONNE;
    g.forEach(x => { if (!x.fige) chef[x.j.PERSONNE] = r; });
  });

  const journeeDe = nom => journees.find(x => x.PERSONNE === nom);
  const chantierLibre = l => (ref && chantierParLibelle(ref, l)) || { id: '', libelle: l, client: '', commune: l, zone: '', codeRh: '' };
  const abs = (extra && extra.abs) || {};
  const date = (extra && extra.date) || (journees[0] && journees[0].DATE) || '';
  const parSaisie = (a, b) => String(a.CREE_LE || '').localeCompare(String(b.CREE_LE || '')) || a.PERSONNE.localeCompare(b.PERSONNE);
  const blocs = blocsPl.map(b => {
    const equipe = b.equipe.filter(nom => { const j = journeeDe(nom); return !j || chef[nom] === b.responsable; });
    journees.forEach(j => { if (chef[j.PERSONNE] === b.responsable && !equipe.includes(j.PERSONNE)) equipe.push(j.PERSONNE); });
    // Un gars de l'équipe a aussi déclaré un chantier que personne n'avait au planning : il reste dans
    // cette équipe (un seul chef pour sa journée) et ce chantier s'ajoute au rapport du chef (version 35).
    const hors = [];
    equipe.forEach(nom => { const j = journeeDe(nom); if (j) chantiersDe(j).forEach(l => {
      if (proprietaires(l).length) return;
      let h = hors.find(x => normaliser(x.libelle) === normaliser(l));
      if (!h) hors.push(h = Object.assign({}, chantierLibre(l), { hors: true, declarePar: [] }));
      if (!h.declarePar.includes(nom)) h.declarePar.push(nom);
    }); });
    const res = Object.assign({}, b, { equipe, deFait: false, chantiers: [...b.chantiers, ...hors], chefAbsent: false, remplacant: '' });
    // Chef absent (justifié par le bureau) : un gars de l'équipe le remplace. Par défaut le premier à avoir
    // envoyé sa journée ; le bureau peut en choisir un autre. L'équipe et le rapport restent ceux du chef.
    // Version 36 : tous les gars de l'équipe sont proposés, qu'ils aient saisi ou non (le bureau peut désigner
    // le remplaçant dès le matin) — sauf intérimaires et absents justifiés. Sans choix du bureau : le premier
    // à avoir envoyé sa journée ; si personne n'a encore saisi, « remplaçant à choisir ».
    if (!journeeDe(b.responsable) && date && absenceDe(abs, date, b.responsable)) {
      const interim = nom => { const j = journeeDe(nom); return j ? j.TYPE_PERSONNE === 'INTERIMAIRE' : !!(ref && (personneParLibelle(ref, nom) || {}).type === 'INTERIMAIRE'); };
      const candidats = equipe.filter(nom => nom !== b.responsable && !interim(nom) && (journeeDe(nom) || !absenceDe(abs, date, nom)));
      const choisi = abs[`R|${date}|${b.responsable}`];
      const premier = candidats.map(journeeDe).filter(Boolean).sort(parSaisie)[0];
      const r = candidats.includes(choisi) ? choisi : (premier ? premier.PERSONNE : '');
      Object.assign(res, { chefAbsent: true, remplacant: r, candidatsRemplacant: candidats });
    }
    return res;
  });
  const chefsFait = [...new Set(Object.values(chef))].filter(r => r && !chefsPlanning.has(r) && journeeDe(r));
  Object.keys(chef).forEach(p => { if (chef[p] && !chefsPlanning.has(chef[p]) && !chefsFait.includes(chef[p])) chef[p] = ''; });
  chefsFait.forEach(r => {
    const membres = journees.filter(j => chef[j.PERSONNE] === r).map(j => j.PERSONNE);
    const equipe = [r, ...membres.filter(n => n !== r)];
    const libs = [];
    equipe.forEach(n => chantiersDe(journeeDe(n)).forEach(l => { if (!proprietaires(l).length && !libs.includes(l)) libs.push(l); }));
    const chantiers = libs.map(chantierLibre);
    blocs.push({ responsable: r, equipe, chantiers, deFait: true, lieux: chantiers.map(c => c.libelle),
      villes: chantiers.map(c => c.commune || c.libelle), libelles: libs, taches: '',
      client: [...new Set(chantiers.map(c => c.client).filter(Boolean))].join(' / ') });
  });
  return { blocs, chef, prevu };
}

/** Le bloc qu'un chef mène ce jour-là : le sien au planning, celui qu'il remplace, ou celui dont il est chef de fait. */
function blocMenePar(eq, nom) {
  return eq.blocs.find(b => b.responsable === nom) || eq.blocs.find(b => b.remplacant === nom) || null;
}

/** D'où vient un membre de l'équipe, s'il n'était pas prévu dans ce bloc ce matin (texte court, ou ''). */
function origineDe(j, nom, bloc, eq) {
  if (!j || j.TYPE_PERSONNE === 'INTERIMAIRE' || nom === bloc.responsable || eq.prevu[nom] === bloc.responsable) return '';
  if (/\(bureau\)$/.test(String(j.SAISI_PAR || ''))) return 'ajouté par le bureau';
  if (/\(chef\)$/.test(String(j.SAISI_PAR || ''))) return 'ajouté par le chef';
  return eq.prevu[nom] ? `venu de l'équipe de ${eq.prevu[nom]}` : 'hors planning';
}

/** Prévus ce matin dans ce bloc, partis travailler avec un autre chef (ou seuls sur un chantier hors planning). */
function partisDe(eq, bloc) {
  return Object.keys(eq.prevu).filter(n => eq.prevu[n] === bloc.responsable && n !== bloc.responsable
    && eq.chef[n] !== undefined && eq.chef[n] !== bloc.responsable)
    .map(n => ({ personne: n, chez: eq.chef[n] || '', seul: eq.chef[n] === n }));
}

/** Le chef que la règle donnerait à cette journée si elle n'était pas encore validée (pour la figer). */
function chefCalcule(pl, journeesDuJour, obj, ref, abs) {
  const essai = Object.assign({}, obj, { STATUT: STATUTS.SAISIE, VALIDE_BUREAU: false, SAISI_PAR: '', RESPONSABLE: '' });
  const liste = journeesDuJour.filter(x => x.PERSONNE !== obj.PERSONNE).concat([essai]);
  return equipesDuJour(pl, liste, ref, { abs, date: obj.DATE }).chef[obj.PERSONNE] || '';
}

/** Planning, journées et équipes d'un jour. `t` : table JOURNEES déjà lue, pour éviter une lecture. */
async function equipesLues(env, date, t) {
  const [pl, tj, ref, abs] = await Promise.all([planningDuJour(env, date), t ? Promise.resolve(t) : table(env, 'JOURNEES'),
    referentiels(env), absencesJustifiees(env)]);
  return { pl, t: tj, abs, ref, eq: equipesDuJour(pl, tj.filtrer(x => x.DATE === date), ref, { abs, date }) };
}

/**
 * LA PAIE SE FAIT PAR JOUR ENTIER (version 35). Un jour est dans l'envoi quand toutes ses journées pas
 * encore envoyées sont cochées bon pour la paie (le bureau le fait d'un seul bouton, seulement si le jour
 * est complet) ; envoyé quand tout est parti ; ou traité hors appli (déclaré par le bureau, rien n'est
 * écrit). Dans ces trois cas le jour est verrouillé pour tout le monde, bureau compris : plus de saisie,
 * de correction, de rapport ni d'ajout. Pour corriger, le bureau retire le jour de l'envoi.
 */
function etatPaieJour(journeesDuJour, abs, date) {
  if (abs && abs[`H|${date}`]) return 'HORS_APPLI';
  const reste = journeesDuJour.filter(j => !j.EXPORTE_LE && j.STATUT !== STATUTS.EXPORTEE);
  if (journeesDuJour.length && !reste.length) return 'ENVOYE';
  if (reste.length && reste.every(j => j.VALIDE_BUREAU === true)) return 'ENVOI';
  return '';
}
const MESSAGE_EN_PAIE = "Ce jour est passé en paie : plus rien ne se modifie pour cette date. Adresse-toi au bureau.";
const MESSAGE_EN_PAIE_BUREAU = "Ce jour est dans l'envoi en paie (ou déjà traité) : retire-le d'abord de l'envoi pour le modifier.";
/** Refuse toute écriture sur un jour verrouillé. `t` : table JOURNEES déjà lue. */
async function exigerJourOuvert(env, date, t, bureau) {
  const abs = await absencesJustifiees(env);
  if (etatPaieJour(t.filtrer(x => x.DATE === date), abs, date)) throw new ErreurMetier(bureau ? MESSAGE_EN_PAIE_BUREAU : MESSAGE_EN_PAIE);
}

/** Validée ou modifiée par le bureau : le chef ne peut plus y toucher, il doit s'adresser au bureau. */
function parBureau(o) {
  return o.VALIDE_BUREAU === true || o.STATUT === STATUTS.EXPORTEE || /\(bureau\)$/.test(String(o.VALIDE_CHEF_PAR || ''));
}
const MESSAGE_BUREAU = 'Validée ou modifiée par le bureau : adresse-toi au bureau pour toute modification.';

function statutAffiche(o) {
  if (o.STATUT === STATUTS.EXPORTEE) return 'EXPORTEE';
  if (o.VALIDE_BUREAU === true) return 'VALIDEE_BUREAU';
  return o.STATUT;
}

/**
 * Journée du chef, validée d'office à sa saisie (VALIDE_CHEF_PAR = lui-même) : il reste libre de la
 * corriger tant que le bureau ne l'a pas validée — elle reste alors validée.
 */
function estAutoValidee(o) {
  return o.STATUT === STATUTS.VALIDEE_CHEF && !!o.PERSONNE && o.VALIDE_CHEF_PAR === o.PERSONNE;
}

function estModifiable(o) {
  if (o.VALIDE_BUREAU === true || o.STATUT === STATUTS.EXPORTEE) return false;
  return o.STATUT !== STATUTS.VALIDEE_CHEF || estAutoValidee(o);
}

function versClient(o) {
  return {
    date: o.DATE, personne: o.PERSONNE, chantiers: String(o.CHANTIERS || '').split(' ; ').filter(Boolean),
    lieuEmbauche: o.LIEU_EMBAUCHE, zone: o.ZONE,
    hEmbauche: o.H_EMBAUCHE, hPause: o.H_PAUSE, hReprise: o.H_REPRISE, hDebauche: o.H_DEBAUCHE,
    total: o.TOTAL, trajet: o.TRAJET, tachesSupp: o.TACHES_SUPP, tachesSuppMin: o.TACHES_SUPP_MIN,
    repas: o.REPAS, repartition: o.REPARTITION, statut: statutAffiche(o), signalement: o.SIGNALEMENT,
    nomInterimaire: o.NOM_INTERIMAIRE, agence: o.AGENCE, modifiable: estModifiable(o), parBureau: parBureau(o),
  };
}

/**
 * Absences justifiées par le bureau : journée manquante justifiée (congé, intempéries…) et jours chômés.
 * { 'date|personne': motif, 'date|': motif du jour chômé }. Lues par l'accueil de chacun : gardées
 * 10 minutes en mémoire, et rafraîchies à chaque justification du bureau.
 */
function motifSeul(detail) {
  return String(detail || '').replace(/\s*\([^()]*\)\s*$/, '').trim() || 'Justifiée';
}
function carteAbsences(tAlertes) {
  const res = {};
  tAlertes.filtrer(a => a.TRAITEE === true).forEach(a => {
    if (a.TYPE === 'JOURNEE_MANQUANTE') res[`${a.DATE_CONCERNEE}|${a.PERSONNE}`] = motifSeul(a.DETAIL);
    else if (a.TYPE === 'JOUR_NON_TRAVAILLE') res[`${a.DATE_CONCERNEE}|`] = motifSeul(a.DETAIL);
    else if (a.TYPE === 'REMPLACANT') res[`R|${a.DATE_CONCERNEE}|${a.PERSONNE}`] = motifSeul(a.DETAIL);   // chef absent → remplaçant choisi
    else if (a.TYPE === 'JOUR_HORS_APPLI') res[`H|${a.DATE_CONCERNEE}`] = motifSeul(a.DETAIL);           // jour traité hors appli
  });
  return res;
}
async function absencesJustifiees(env, forcer) {
  if (!forcer) {
    const garde = await memoire(env, 'absences');
    if (garde) return garde;
  }
  const res = carteAbsences(await table(env, 'ALERTES'));
  await memoire(env, 'absences', res, 600);
  return res;
}
function absenceDe(abs, date, personne) {
  return abs[`${date}|${personne}`] || abs[`${date}|`] || null;
}
const MESSAGE_ABSENCE = motif => `Journée justifiée par le bureau (${motif}) : vois avec le bureau si nécessaire.`;

/** La semaine de quelqu'un, du lundi au dimanche (le samedi et le dimanche se saisissent aussi — version 35). */
function semaine(moi, date, t, abs) {
  const lundi = lundiDe(date);
  return [0, 1, 2, 3, 4, 5, 6].map(n => {
    const d = ajouterJours(lundi, n);
    const j = t.trouver(x => x.ID_JOURNEE === idJournee(d, moi));
    const absence = !j && absenceDe(abs, d, moi);
    if (absence) return { date: d, statut: 'JUSTIFIEE', justification: absence, modifiable: false };
    const verrou = !!etatPaieJour(t.filtrer(x => x.DATE === d), abs, d);
    return { date: d, statut: j ? statutAffiche(j.obj) : (d > aujourdhui() ? 'A_VENIR' : 'NON_SAISIE'),
      modifiable: !verrou && (j ? estModifiable(j.obj) : d <= aujourdhui()), weekend: n >= 5 };
  });
}

/**
 * L'équipe réelle du jour telle que l'accueil l'affiche (version 35) : la même que « Valider mon équipe »
 * — ajoutés, venus d'une autre équipe — plus ceux partis ailleurs, barrés.
 */
function equipeAffichee(eq, bloc, t, date) {
  if (!bloc) return null;
  const jDe = nom => { const x = t.trouver(y => y.ID_JOURNEE === idJournee(date, nom)); return x ? x.obj : null; };
  return {
    responsable: bloc.responsable, deFait: !!bloc.deFait, chefAbsent: !!bloc.chefAbsent, remplacant: bloc.remplacant || '',
    membres: bloc.equipe.map(nom => ({ personne: nom, chef: nom === bloc.responsable, remplacant: nom === bloc.remplacant,
      origine: origineDe(jDe(nom), nom, bloc, eq), interimaire: !!(jDe(nom) && jDe(nom).TYPE_PERSONNE === 'INTERIMAIRE') })),
    partis: partisDe(eq, bloc),
  };
}

async function accueil(env, moi, date) {
  date = verifierDate(date || aujourdhui());
  const [t, abs] = await Promise.all([table(env, 'JOURNEES'), absencesJustifiees(env)]);
  const { pl, eq } = await equipesLues(env, date, t);
  const bloc = blocDe(pl, moi);                    // ce que le planning prévoyait pour lui ce matin
  const j = t.trouver(x => x.ID_JOURNEE === idJournee(date, moi));
  const sansPlanning = !pl.trouve;
  // Chef : du planning, remplaçant d'un chef absent, ou chef de fait (ses chantiers ne sont pas au planning).
  const monBloc = blocMenePar(eq, moi);
  const estResponsable = !!monBloc;
  const blocDuJour = monBloc || eq.blocs.find(b => b.equipe.includes(moi)) || null;
  return {
    date, personne: moi, planningTrouve: pl.trouve, sansPlanning, bloc, estResponsable,
    chefDeFait: !!(monBloc && monBloc.deFait), remplace: monBloc && monBloc.remplacant === moi ? monBloc.responsable : '',
    chefDuJour: j ? (eq.chef[moi] || '') : (bloc ? bloc.responsable : ''),
    equipeDuJour: equipeAffichee(eq, blocDuJour, t, date),
    jourEnPaie: !!etatPaieJour(t.filtrer(x => x.DATE === date), abs, date),
    estBureau: await estBureau(env, moi),
    journee: j ? versClient(j.obj) : null,
    justification: j ? null : absenceDe(abs, date, moi),
    semaine: semaine(moi, date, t, abs),
    chef: estResponsable ? await resumeChef(env, moi, date, monBloc, t, abs, eq) : null,
  };
}

/** De quoi dire au chef, dès l'accueil, ce qui l'attend : à valider, manquant, rapport envoyé ou non. */
async function resumeChef(env, moi, date, bloc, t, abs, eq) {
  const duJour = t.filtrer(x => x.DATE === date);
  const noms = bloc.equipe;
  moi = bloc.responsable;                          // un remplaçant voit le résumé de l'équipe qu'il mène
  const journees = noms.map(nom => t.trouver(x => x.ID_JOURNEE === idJournee(date, nom)));
  const tr = await table(env, 'RAPPORTS');
  return {
    aValider: journees.filter(x => x && (x.obj.STATUT === STATUTS.SAISIE || x.obj.STATUT === STATUTS.SIGNALEE)).length,
    manquants: noms.filter((nom, i) => !journees[i] && !absenceDe(abs || {}, date, nom)),
    validees: journees.filter(x => x && x.obj.STATUT !== STATUTS.SAISIE && x.obj.STATUT !== STATUTS.SIGNALEE).length,
    enPaie: !!etatPaieJour(duJour, abs, date),
    partis: partisDe(eq, bloc),
    rapportEnvoye: !!tr.trouver(r => r.ID_RAPPORT === idRapport(date, moi) && r.STATUT === 'ENVOYE'),
  };
}

/** Contrôles identiques à ceux du téléphone : le serveur ne fait confiance à personne. */
function controlerJournee(d, ref, par) {
  const h = ['hEmbauche', 'hPause', 'hReprise', 'hDebauche'].map(k => minutes(d[k]));
  if (h.some(x => x === null)) throw new ErreurMetier('Les quatre horaires sont obligatoires.');
  const [emb, pause, rep, deb] = h;
  if (!(emb < pause && pause <= rep && rep < deb)) {
    throw new ErreurMetier('Les horaires doivent se suivre : embauche, pause, reprise, débauche.');
  }
  const total = (pause - emb) + (deb - rep);
  if (total > par.JOURNEE_MAX_H * 60) throw new ErreurMetier(`Plus de ${String(par.JOURNEE_MAX_H).replace('.', ',')} heures dans la journée : vérifie les horaires.`);
  if (!TRAJETS.includes(d.trajet)) throw new ErreurMetier('Choisis le trajet.');
  if (!REPAS.includes(d.repas)) throw new ErreurMetier('Choisis le repas.');

  const chantiers = (d.chantiers || []).map(c => {
    const ch = chantierParLibelle(ref, c);
    if (ch) return ch;
    const l = lieuParLibelle(ref, c);                       // avant la bascule : une commune
    if (l) return { id: '', libelle: l.libelle, commune: l.libelle, zone: l.zone, codeRh: l.codeRh };
    throw new ErreurMetier(`Chantier inconnu : ${c}`);
  });
  if (!chantiers.length) throw new ErreurMetier('Choisis au moins un chantier.');

  // Le lieu d'embauche est une COMMUNE : c'est elle qui donne la zone. On accepte qu'il soit
  // désigné par un chantier (« j'ai embauché sur place »), auquel cas on prend sa commune.
  const chantierEmbauche = chantierParLibelle(ref, d.lieuEmbauche);
  const embauche = chantierEmbauche
    ? { libelle: chantierEmbauche.commune, zone: chantierEmbauche.zone, codeRh: chantierEmbauche.codeRh }
    : lieuParLibelle(ref, d.lieuEmbauche);
  if (!embauche) throw new ErreurMetier("Choisis le lieu d'embauche.");
  const auDepot = embauche.libelle === LIBELLE_DEPOT;

  const supp = Math.max(0, Math.round(Number(d.tachesSuppMin) || 0));
  if (supp > par.TACHES_AVANT_MAX_MIN) throw new ErreurMetier(`Plus de ${par.TACHES_AVANT_MAX_MIN} minutes de tâches avant chantier : vérifie la durée.`);

  // Plusieurs chantiers dans la journée : on garde la part de chacun, pour savoir plus tard
  // combien d'heures ont été passées où. Les parts sont ramenées à 100 % quoi qu'il arrive.
  // Répartition en MINUTES, jamais en pourcentage : c'est ce que le téléphone envoie, ce qu'on
  // enregistre et ce qu'on relit. Le dernier chantier absorbe l'écart pour que le total tombe juste.
  let repartition = '';
  if (chantiers.length > 1) {
    const parts = chantiers.map(c => {
      const p = (d.repartition || []).find(x => normaliser(x.chantier) === normaliser(c.libelle));
      return Math.max(0, Math.round(Number(p && p.part) || 0));
    });
    const somme = parts.reduce((a, b) => a + b, 0);
    if (somme === 0) {
      const part = Math.round(total / chantiers.length);
      chantiers.forEach((c, i) => { parts[i] = i === chantiers.length - 1 ? total - part * (chantiers.length - 1) : part; });
    } else if (somme !== total) {
      parts[parts.length - 1] += total - somme;
      if (parts[parts.length - 1] < 0) throw new ErreurMetier('Le temps réparti dépasse la journée.');
    }
    repartition = chantiers.map((c, i) => `${c.libelle} = ${hhmm(parts[i])}`).join(' ; ');
  }

  return {
    chantiers: chantiers.map(c => c.libelle),
    idsChantiers: chantiers.map(c => c.id).filter(Boolean),
    lieuEmbauche: embauche.libelle, repartition,
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
  if (await estBureau(env, moi)) throw new ErreurMetier("Compte du bureau : pas de journée à saisir (un compte à part pour apparaître au planning).");
  if (date > aujourdhui()) throw new ErreurMetier('Impossible de saisir une journée à venir.');
  const ref = await referentiels(env);
  const p = personneParLibelle(ref, moi);
  const [pl, t] = await Promise.all([planningDuJour(env, date), table(env, 'JOURNEES')]);
  const bloc = blocDe(pl, moi);

  // Envoi rejoué après une coupure : déjà enregistré, on ne refait rien.
  if (idEnvoi && t.trouver(x => x.ID_ENVOI === idEnvoi)) return { ok: true, dejaRecu: true };

  const existante = t.trouver(x => x.ID_JOURNEE === idJournee(date, moi));
  if (existante && !estModifiable(existante.obj)) {
    throw new ErreurMetier(bloc && bloc.responsable === moi && parBureau(existante.obj)
      ? 'Ta journée a été validée ou modifiée par le bureau : adresse-toi au bureau pour la modifier.'
      : 'Journée déjà validée : demande à ton chef ou au bureau pour la corriger.');
  }
  if (!existante) {
    const absence = absenceDe(await absencesJustifiees(env), date, moi);
    if (absence) throw new ErreurMetier(MESSAGE_ABSENCE(absence));
  }
  await exigerJourOuvert(env, date, t);
  // Contrôle du contenu après celui du statut : à une journée verrouillée, on dit d'abord qui la tient.
  const c = controlerJournee(d, ref, await parametres(env));

  const champs = {
    ID_JOURNEE: idJournee(date, moi), DATE: date, PERSONNE: moi,
    ONGLET_RH: p ? p.ongletRh : '', TYPE_PERSONNE: p ? p.type : '',
    SAISI_PAR: moi, CHANTIERS: c.chantiers.join(' ; '), ID_CHANTIERS: c.idsChantiers.join(' ; '), RESPONSABLE: bloc ? bloc.responsable : '',
    LIEU_EMBAUCHE: c.lieuEmbauche, ZONE: c.zone, CODE_RH_ZONE: c.codeRh,
    H_EMBAUCHE: c.heures[0], H_PAUSE: c.heures[1], H_REPRISE: c.heures[2], H_DEBAUCHE: c.heures[3],
    TOTAL: c.total, TRAJET: c.trajet, TACHES_SUPP: c.tachesSupp, TACHES_SUPP_MIN: c.tachesSuppMin,
    REPAS: c.repas, REPARTITION: c.repartition, STATUT: STATUTS.SAISIE, SIGNALEMENT: '', MODIFIE_LE: horodatage(), ID_ENVOI: idEnvoi || '',
    VALIDE_CHEF_PAR: '', VALIDE_CHEF_LE: '',
  };
  // Le chef (premier nom du bloc au planning) n'a pas à valider sa propre journée : validée d'office.
  // Pas pour le « chef de fait » d'une journée sans planning : chacun le serait, et plus personne ne contrôlerait.
  if (bloc && bloc.responsable === moi) {
    Object.assign(champs, { STATUT: STATUTS.VALIDEE_CHEF, VALIDE_CHEF_PAR: moi, VALIDE_CHEF_LE: horodatage() });
  }
  const avant = existante ? existante.obj.CHANTIERS : '';
  if (existante) {
    await majLigne(env, t, existante, champs);
    await journaliser(env, moi, 'CORRECTION_JOURNEE', champs.ID_JOURNEE, champs);
  } else {
    champs.CREE_LE = champs.MODIFIE_LE;
    champs.VALIDE_BUREAU = false;
    await ajouterLigne(env, t, champs);
    await journaliser(env, moi, 'SAISIE_JOURNEE', champs.ID_JOURNEE, champs);
  }
  await apresChangementDeChantiers(env, moi, date, t, pl, avant, champs.CHANTIERS);
  // Son équipe du jour, tout de suite : le téléphone met l'accueil à jour et prévient un nouveau chef de fait.
  const { eq } = await equipesLues(env, date, t);
  const mene = blocMenePar(eq, moi);
  return { ok: true, journee: versClient(champs), equipe: {
    chefDuJour: eq.chef[moi] || '', chefDeFait: !!(mene && mene.deFait), remplace: mene && mene.remplacant === moi ? mene.responsable : '',
    chantiers: mene ? mene.chantiers.map(c => c.libelle) : [] } };
}

/**
 * Un chantier hors planning retiré d'une journée : le rapport qui en parlait devient obsolète. Ses lignes
 * (avancement, matériaux, remarques, photos de BL) sont supprimées si plus personne de cette équipe ne
 * déclare ce chantier ; le rapport d'un chef de fait qui n'en est plus un est supprimé en entier. Tout
 * est gardé au JOURNAL (les photos restent dans le Drive). Version 35.
 */
async function apresChangementDeChantiers(env, moi, date, t, pl, avant, apres) {
  const liste = x => String(x || '').split(' ; ').map(y => y.trim()).filter(Boolean);
  const garde = new Set(liste(apres).map(normaliser));
  const auPlanning = l => (pl.blocs || []).some(b => b.chantiers.some(c => normaliser(c.libelle) === normaliser(l)));
  const retires = liste(avant).filter(l => !garde.has(normaliser(l)) && !auPlanning(l));
  if (!retires.length) return;
  await purgerRapportsObsoletes(env, moi, date, t, retires);
}

async function purgerRapportsObsoletes(env, moi, date, t, retires) {
  const NOMS = ['RAPPORTS', 'AVANCEMENT', 'MATERIAUX', 'RAPPORT_CHANTIERS', 'BL'];
  const [tt, ref, abs, pl] = await Promise.all([tables(env, NOMS), referentiels(env), absencesJustifiees(env), planningDuJour(env, date)]);
  const eq = equipesDuJour(pl, t.filtrer(x => x.DATE === date), ref, { abs, date });
  const cibles = new Set(retires.map(normaliser));
  const communes = new Set(retires.map(l => { const c = chantierParLibelle(ref, l); return c && c.commune ? normaliser(c.commune) : ''; }).filter(Boolean));
  const rapports = tt.RAPPORTS.filtrer(r => r.DATE === date);
  const aSupprimer = {};                  // onglet → prédicat
  const supprimes = [];
  const rapportsEntiers = [];
  for (const r of rapports) {
    const bloc = eq.blocs.find(b => idRapport(date, b.responsable) === r.ID_RAPPORT);
    const encore = new Set(bloc ? bloc.chantiers.map(c => normaliser(c.libelle)) : []);
    const obsolete = l => cibles.has(normaliser(l)) && !encore.has(normaliser(l));
    const obsoleteBl = x => obsolete(x.CHANTIER) || (!bloc && communes.has(normaliser(String(x.CHANTIER || '').split(';')[0])));
    if (!bloc) {
      // Plus personne ne mène ce rapport (un chef de fait retourné dans une équipe) : il disparaît en entier
      // s'il ne portait que sur des chantiers retirés.
      const siens = String(r.CHANTIERS || '').split(' ; ').filter(Boolean);
      if (siens.length && siens.every(obsolete)) rapportsEntiers.push(r.ID_RAPPORT);
    }
    const id = r.ID_RAPPORT;
    const entier = rapportsEntiers.includes(id);
    for (const nom of ['AVANCEMENT', 'MATERIAUX', 'RAPPORT_CHANTIERS', 'BL']) {
      const lignes = tt[nom].filtrer(x => x.ID_RAPPORT === id && (entier || (nom === 'BL' ? obsoleteBl(x) : obsolete(x.CHANTIER))));
      if (lignes.length) supprimes.push(...lignes.map(x => ({ onglet: nom, ligne: x })));
    }
  }
  if (!supprimes.length && !rapportsEntiers.length) return;
  const ids = await idsOnglets(env, NOMS);
  const requetes = [];
  for (const nom of ['AVANCEMENT', 'MATERIAUX', 'RAPPORT_CHANTIERS', 'BL']) {
    const lignes = new Set(supprimes.filter(x => x.onglet === nom).map(x => x.ligne));
    if (lignes.size) requetes.push(...requetesRemplacer(ids[nom], tt[nom], x => lignes.has(x), []));
  }
  if (rapportsEntiers.length) requetes.push(...requetesRemplacer(ids.RAPPORTS, tt.RAPPORTS, x => rapportsEntiers.includes(x.ID_RAPPORT), []));
  await sheets(env, env.ID_DONNEES, ':batchUpdate', { methode: 'POST', corps: { requests: requetes } });
  await journaliser(env, moi, 'RAPPORT_OBSOLETE', date, { chantiers: retires, rapportsSupprimes: rapportsEntiers,
    lignes: supprimes.map(x => Object.assign({ onglet: x.onglet }, x.ligne)) });
}

/** Le bloc (équipe complète) dont `moi` est le chef ce jour-là : du planning, ou chef de fait. */
async function exigerResponsable(env, moi, date, t) {
  const { pl, eq, t: tj } = await equipesLues(env, date, t);
  const bloc = blocMenePar(eq, moi);
  if (bloc) return bloc;
  if (!pl.trouve && !tj.trouver(x => x.ID_JOURNEE === idJournee(date, moi))) {
    throw new ErreurMetier("Pas de planning ce jour-là : saisis d'abord ta journée.");
  }
  throw new ErreurMetier("Tu n'es pas responsable d'un chantier ce jour-là.");
}

/** L'équipe d'un chef ce jour-là. Le bureau peut la demander au nom d'un chef (ajout d'intérimaire). */
async function equipe(env, moi, date, auNomDe) {
  date = verifierDate(date);
  const [tt, abs, ref] = await Promise.all([tables(env, ['JOURNEES', 'RAPPORTS']), absencesJustifiees(env), referentiels(env)]);
  const t = tt.JOURNEES, tr = tt.RAPPORTS;                     // une seule lecture Google
  const bloc = await blocPour(env, moi, date, auNomDe, t);
  const moiMeme = auNomDe || moi;
  moi = bloc.responsable;                          // l'équipe est celle du chef, même quand un remplaçant la mène
  const { pl, eq } = await equipesLues(env, date, t);
  const bureauNoms = (await lireCodes(env)).bureau;

  const duJour = t.filtrer(x => x.DATE === date);
  const membres = bloc.equipe.map(nom => {
    const j = t.trouver(x => x.ID_JOURNEE === idJournee(date, nom));
    const interimaire = !!(j && j.obj.TYPE_PERSONNE === 'INTERIMAIRE');
    const origine = origineDe(j ? j.obj : null, nom, bloc, eq);     // s'il n'était pas prévu ici ce matin
    return { personne: nom, estMoi: nom === moiMeme, journee: j ? versClient(j.obj) : null, interimaire, origine,
      ajoute: origine === 'ajouté par le bureau', remplacant: nom === bloc.remplacant,
      justification: j ? null : absenceDe(abs, date, nom) };
  });
  // Prévus avec lui ce matin, partis travailler avec un autre chef : il le sait, il n'a pas à les attendre.
  const partis = partisDe(eq, bloc);
  // Pour « Ajouter un gars » : ceux qui n'ont rien saisi aujourd'hui, hors chefs du planning, comptes du
  // bureau et absences justifiées.
  const saisis = new Set(duJour.map(x => x.PERSONNE));
  const disponibles = ref.personnes.filter(p => p.actif && p.type !== 'PRESTATAIRE' && !estGenerique(p)
    && !saisis.has(p.libelle) && !pl.blocs.some(b => b.responsable === p.libelle) && !absenceDe(abs, date, p.libelle)
    && !bureauNoms.includes(p.libelle) && !bloc.equipe.includes(p.libelle)).map(p => p.libelle).sort();

  const repasEquipe = membres.filter(m => m.journee && m.journee.repas === 'RESTAURANT').length;
  const rapport = tr.trouver(r => r.ID_RAPPORT === idRapport(date, moi));
  const repasPayes = rapport ? Number(rapport.obj.REPAS_PAYES) || 0 : null;

  return {
    date, bloc, membres, partis, disponibles, chefDeFait: !!bloc.deFait, enPaie: !!etatPaieJour(duJour, abs, date),
    remplace: bloc.remplacant === moiMeme ? bloc.responsable : '',
    repas: { equipe: repasEquipe, payes: repasPayes, ecart: repasPayes !== null && repasPayes !== repasEquipe },
    manquants: membres.filter(m => !m.journee && !m.justification).map(m => m.personne),
  };
}

async function validerJournee(env, moi, date, personne, decision, motif) {
  date = verifierDate(date);
  if (!['VALIDER', 'DEVALIDER'].includes(decision)) throw new ErreurMetier('Décision inconnue.');
  const t = await table(env, 'JOURNEES');
  const bloc = await exigerResponsable(env, moi, date, t);
  const j = t.trouver(x => x.ID_JOURNEE === idJournee(date, personne));
  if (!j) throw new ErreurMetier(`${personne} n'a pas encore saisi sa journée.`);
  if (!bloc.equipe.includes(personne)) {
    throw new ErreurMetier(`${personne} n'est pas dans ton équipe ce jour-là.`);
  }
  if (parBureau(j.obj)) throw new ErreurMetier(MESSAGE_BUREAU);
  await exigerJourOuvert(env, date, t);
  if (personne === moi && bloc.responsable !== moi) throw new ErreurMetier('Ta propre journée est validée par le bureau.');

  if (decision === 'VALIDER') {
    // RESPONSABLE fige l'équipe : une journée validée reste chez ce chef, quoi qu'il arrive ensuite.
    await majLigne(env, t, j, { STATUT: STATUTS.VALIDEE_CHEF, SIGNALEMENT: '', VALIDE_CHEF_PAR: moi,
      VALIDE_CHEF_LE: horodatage(), MODIFIE_LE: horodatage(), RESPONSABLE: bloc.responsable });
  } else {
    // Rouvre la journée : le chef (ou le gars) peut la corriger, le chef la revalide ensuite.
    await majLigne(env, t, j, { STATUT: STATUTS.SAISIE, SIGNALEMENT: '', VALIDE_CHEF_PAR: '', VALIDE_CHEF_LE: '',
      MODIFIE_LE: horodatage() });
  }
  await journaliser(env, moi, decision, j.obj.ID_JOURNEE, '');
  return { ok: true };
}

/**
 * Le chef corrige la journée d'un gars de son équipe, une fois dévalidée (ou pas encore validée),
 * ou la saisit à sa place s'il n'a rien envoyé. Dans les deux cas elle repart validée par le chef.
 */
async function chefCorrigerJournee(env, moi, d, idEnvoi) {
  const date = verifierDate(d.date);
  if (date > aujourdhui()) throw new ErreurMetier('Impossible de saisir une journée à venir.');
  const personne = String(d.personne || '').trim();
  const t = await table(env, 'JOURNEES');
  const bloc = await exigerResponsable(env, moi, date, t);
  if (idEnvoi && t.trouver(x => x.ID_ENVOI === idEnvoi)) return { ok: true, dejaRecu: true };
  const j = t.trouver(x => x.ID_JOURNEE === idJournee(date, personne));
  if (j && j.obj.TYPE_PERSONNE === 'INTERIMAIRE') {
    throw new ErreurMetier("Un intérimaire se corrige par son propre écran (nom, agence) : touche « Corriger » sur sa carte.");
  }
  if (d.ajout) {
    // « Ajouter un gars » : quelqu'un qui n'a rien saisi aujourd'hui rejoint cette équipe, sur ses chantiers.
    if (j) throw new ErreurMetier(`${personne} a déjà une journée ce jour-là : c'est son chef qui la voit.`);
    const ref0 = await referentiels(env);
    const connu = personneParLibelle(ref0, personne);
    if (!connu || !connu.actif || connu.type === 'PRESTATAIRE' || estGenerique(connu)) throw new ErreurMetier(`${personne} : inconnu dans PERSONNES.`);
    if ((await planningDuJour(env, date)).blocs.some(b => b.responsable === personne)) throw new ErreurMetier(`${personne} est chef ce jour-là : il reste avec son équipe.`);
    if ((await lireCodes(env)).bureau.includes(personne)) throw new ErreurMetier(`${personne} est un compte du bureau.`);
    const permis = bloc.chantiers.map(x => normaliser(x.libelle));
    const siens = (d.chantiers || []).map(normaliser);
    if (!siens.length || siens.some(x => !permis.includes(x))) throw new ErreurMetier('Choisis ses chantiers parmi ceux de ton équipe ce jour-là.');
  } else if (!bloc.equipe.includes(personne)) {
    throw new ErreurMetier(`${personne} n'est pas dans ton équipe ce jour-là.`);
  }
  if (personne === moi && bloc.responsable !== moi) throw new ErreurMetier('Ta propre journée est validée par le bureau : saisis-la depuis ton accueil.');
  if (j && parBureau(j.obj)) throw new ErreurMetier(MESSAGE_BUREAU);
  await exigerJourOuvert(env, date, t);
  if (!j) {
    const absence = absenceDe(await absencesJustifiees(env), date, personne);
    if (absence) throw new ErreurMetier(`Journée de ${personne} justifiée par le bureau (${absence}) : vois avec le bureau si nécessaire.`);
  }
  if (j && j.obj.STATUT === STATUTS.VALIDEE_CHEF) {
    throw new ErreurMetier("Journée validée : dévalide-la d'abord pour la corriger.");
  }
  const ref = await referentiels(env);
  const c = controlerJournee(d, ref, await parametres(env));

  const champs = {
    CHANTIERS: c.chantiers.join(' ; '), ID_CHANTIERS: c.idsChantiers.join(' ; '),
    LIEU_EMBAUCHE: c.lieuEmbauche, ZONE: c.zone, CODE_RH_ZONE: c.codeRh,
    H_EMBAUCHE: c.heures[0], H_PAUSE: c.heures[1], H_REPRISE: c.heures[2], H_DEBAUCHE: c.heures[3],
    TOTAL: c.total, TRAJET: c.trajet, TACHES_SUPP: c.tachesSupp, TACHES_SUPP_MIN: c.tachesSuppMin,
    REPAS: c.repas, REPARTITION: c.repartition, SIGNALEMENT: '',
    STATUT: STATUTS.VALIDEE_CHEF, VALIDE_CHEF_PAR: moi, VALIDE_CHEF_LE: horodatage(), MODIFIE_LE: horodatage(),
    ID_ENVOI: idEnvoi || '', RESPONSABLE: bloc.responsable,
  };
  const avant = j ? j.obj.CHANTIERS : '';
  if (j) {
    await majLigne(env, t, j, champs);
    await journaliser(env, moi, 'CHEF_CORRECTION', j.obj.ID_JOURNEE, champs);
  } else {
    // Le gars n'a rien envoyé : le chef saisit pour lui. SAISI_PAR garde la trace de qui a saisi.
    const p = personneParLibelle(ref, personne);
    Object.assign(champs, {
      ID_JOURNEE: idJournee(date, personne), DATE: date, PERSONNE: personne,
      ONGLET_RH: p ? p.ongletRh : '', TYPE_PERSONNE: p ? p.type : '',
      SAISI_PAR: `${moi} (chef)`, RESPONSABLE: bloc.responsable, CREE_LE: champs.MODIFIE_LE, VALIDE_BUREAU: false,
    });
    await ajouterLigne(env, t, champs);
    await journaliser(env, moi, d.ajout ? 'CHEF_AJOUT' : 'CHEF_SAISIE', champs.ID_JOURNEE, champs);
  }
  await apresChangementDeChantiers(env, moi, date, t, await planningDuJour(env, date), avant, champs.CHANTIERS);
  return { ok: true };
}

/**
 * Journée d'un intérimaire, saisie par son chef ou par le bureau au nom d'un chef (auNomDe).
 * Ses chantiers sont choisis parmi ceux du chef ce jour-là : il est ainsi compté dans l'équipe,
 * les repas et le chantier du chef, partout. Validée d'office. Corriger = même écran, même nom.
 */
async function enregistrerInterimaire(env, moi, d, idEnvoi) {
  const date = verifierDate(d.date);
  const bureau = !!d.auNomDe && d.auNomDe !== moi;
  const t = await table(env, 'JOURNEES');
  const bloc = await blocPour(env, moi, date, d.auNomDe, t);
  const chef = bloc.responsable;
  const nom = String(d.nomInterimaire || '').trim();
  if (nom.length < 3) throw new ErreurMetier("Indique le nom de l'intérimaire.");
  const ref = await referentiels(env);
  const c = controlerJournee(d, ref, await parametres(env));
  const permis = bloc.chantiers.map(x => normaliser(x.libelle));
  if (!c.chantiers.length || c.chantiers.some(x => !permis.includes(normaliser(x)))) {
    throw new ErreurMetier(`Choisis ses chantiers parmi ceux de ${bureau ? chef : 'ton équipe'} ce jour-là.`);
  }
  const libelle = 'INTERIM ' + nom.toUpperCase();
  const connu = personneParLibelle(ref, nom);
  // Déjà dans PERSONNES (un intérimaire régulier, un salarié…) : pas de saisie libre, sinon doublon dans le
  // Suivi RH. Seulement à la création : une journée INTERIM déjà enregistrée reste corrigeable (version 38).
  const deja = personneCorrespondante(ref, nom);
  if (deja && !t.trouver(x => x.ID_JOURNEE === idJournee(date, libelle))) throw new ErreurMetier(messageDejaPersonne(deja, nom, bureau));

  if (idEnvoi && t.trouver(x => x.ID_ENVOI === idEnvoi)) return { ok: true, dejaRecu: true };
  await exigerJourOuvert(env, date, t, bureau);
  const existante = t.trouver(x => x.ID_JOURNEE === idJournee(date, libelle));
  if (existante) {
    if (existante.obj.EXPORTE_LE || existante.obj.STATUT === STATUTS.EXPORTEE) throw new ErreurMetier('Journée déjà envoyée au Suivi RH.');
    if (!bureau) {
      if (chefInterimaire(existante.obj) !== chef) throw new ErreurMetier(`${libelle} est déjà saisi ce jour-là par ${chefInterimaire(existante.obj)}.`);
      if (parBureau(existante.obj)) throw new ErreurMetier(MESSAGE_BUREAU);
      if (existante.obj.STATUT === STATUTS.VALIDEE_CHEF && !d.correction) {
        throw new ErreurMetier(`${libelle} est déjà saisi et validé ce jour-là : dévalide-le pour le corriger.`);
      }
    }
  }
  const valideur = bureau ? `${moi} (bureau)` : moi;
  const champs = {
    ID_JOURNEE: idJournee(date, libelle), DATE: date, PERSONNE: libelle,
    ONGLET_RH: connu ? connu.ongletRh : '', TYPE_PERSONNE: 'INTERIMAIRE',
    NOM_INTERIMAIRE: nom, AGENCE: String(d.agence || '').trim(),
    SAISI_PAR: valideur, CHANTIERS: c.chantiers.join(' ; '), ID_CHANTIERS: c.idsChantiers.join(' ; '), RESPONSABLE: chef,
    LIEU_EMBAUCHE: c.lieuEmbauche, ZONE: c.zone, CODE_RH_ZONE: c.codeRh,
    H_EMBAUCHE: c.heures[0], H_PAUSE: c.heures[1], H_REPRISE: c.heures[2], H_DEBAUCHE: c.heures[3],
    TOTAL: c.total, TRAJET: c.trajet, TACHES_SUPP: c.tachesSupp, TACHES_SUPP_MIN: c.tachesSuppMin,
    REPAS: c.repas, REPARTITION: c.repartition, STATUT: STATUTS.VALIDEE_CHEF, SIGNALEMENT: '',
    VALIDE_CHEF_PAR: valideur, VALIDE_CHEF_LE: horodatage(), MODIFIE_LE: horodatage(), ID_ENVOI: idEnvoi || '',
  };
  if (existante) await majLigne(env, t, existante, champs);
  else { champs.CREE_LE = champs.MODIFIE_LE; champs.VALIDE_BUREAU = false; await ajouterLigne(env, t, champs); }
  await journaliser(env, moi, existante ? 'CORRECTION_INTERIMAIRE' : 'SAISIE_INTERIMAIRE', champs.ID_JOURNEE, champs);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rapports de chantier
// ---------------------------------------------------------------------------

/** Le bureau peut ouvrir et modifier le rapport d'un chef ; les autres, seulement le leur. */
async function blocPour(env, moi, date, auNomDe, t) {
  if (!auNomDe || auNomDe === moi) return exigerResponsable(env, moi, date, t);
  await exigerBureau(env, moi);
  const { eq } = await equipesLues(env, date, t);
  const bloc = eq.blocs.find(b => b.responsable === auNomDe);
  if (!bloc) throw new ErreurMetier(`${auNomDe} n'est responsable d'aucun chantier ce jour-là.`);
  return bloc;
}

async function lireRapport(env, moi, date, auNomDe) {
  date = verifierDate(date);
  // Une seule lecture Google pour les six onglets (quota de 60 lectures par minute pour toute l'entreprise).
  const tt = await tables(env, ['JOURNEES', 'RAPPORTS', 'AVANCEMENT', 'MATERIAUX', 'BL', 'RAPPORT_CHANTIERS']);
  const bloc = await blocPour(env, moi, date, auNomDe, tt.JOURNEES);
  moi = bloc.responsable;
  const id = idRapport(date, moi);
  const [tr, ta, tm, tb, trc, ref, tj] = [tt.RAPPORTS, tt.AVANCEMENT, tt.MATERIAUX, tt.BL, tt.RAPPORT_CHANTIERS, await referentiels(env), tt.JOURNEES];
  // Jour passé en paie : le rapport ne se lit plus qu'en lecture, pour tout le monde (bureau compris).
  const verrouille = !!etatPaieJour(tj.filtrer(x => x.DATE === date), await absencesJustifiees(env), date);
  const r = tr.trouver(x => x.ID_RAPPORT === id);

  // Un rapport par journée pour le restaurant et les repas ; tout le reste appartient à un chantier.
  const chantiers = bloc.chantiers.map(c => {
    const sien = x => normaliser(x.CHANTIER) === normaliser(c.libelle);
    const rc = trc.trouver(x => x.ID_RAPPORT === id && sien(x));
    return {
      libelle: c.libelle, client: c.client, commune: c.commune, hors: !!c.hors, declarePar: c.declarePar || [],
      remarques: rc ? rc.obj.REMARQUES : '',
      avancement: ta.filtrer(x => x.ID_RAPPORT === id && sien(x)).map(x => ({
        tache: x.TACHE, pourcentage: x.POURCENTAGE, mode: x.MODE || 'POURCENTAGE', quantite: x.QUANTITE, unite: x.UNITE,
      })),
      materiaux: tm.filtrer(x => x.ID_RAPPORT === id && sien(x)).map(x => ({
        materiau: x.MATERIAU, quantite: x.QUANTITE, unite: x.UNITE,
      })),
      bl: tb.filtrer(x => x.ID_RAPPORT === id && chantierDuBl(bloc, x) === c).map(x => ({ lien: x.LIEN_DRIVE, ajoute: x.AJOUTE_LE })),
    };
  });

  return {
    bloc,
    chantiers,
    rapport: r ? { restaurant: r.obj.RESTAURANT, repasPayes: r.obj.REPAS_PAYES, statut: r.obj.STATUT } : null,
    listeMateriaux: ref.materiaux && ref.materiaux.length ? ref.materiaux : await materiauxAnciens(env),
    verrouille,
  };
}

/**
 * Chantier d'une photo de BL. Le relais Apps Script n'écrit pas toujours le libellé exact du chantier :
 * dans le vrai fichier on trouve « JUGEALS ; NOAILLES » (les communes du bloc). Sans ce rattachement,
 * la photo déposée n'apparaissait sous aucun chantier du rapport.
 */
function chantierDuBl(bloc, bl) {
  const n = normaliser(bl.CHANTIER);
  const parties = String(bl.CHANTIER || '').split(';').map(normaliser).filter(Boolean);
  return bloc.chantiers.find(c => n === normaliser(c.libelle))
    || bloc.chantiers.find(c => c.commune && parties[0] === normaliser(c.commune))
    || bloc.chantiers.find(c => c.commune && parties.includes(normaliser(c.commune)))
    || bloc.chantiers[0];
}

/**
 * Repli quand le planning n'a pas d'onglet MATERIAUX : l'ancien onglet du fichier de données.
 * Il a pu être renommé ou supprimé : son absence ne doit jamais empêcher d'ouvrir un rapport.
 */
async function materiauxAnciens(env) {
  for (const nom of ['REF_MATERIAUX', 'REF_MATERIAUX_OLD']) {
    try {
      const t = await table(env, nom);
      return t.filtrer(m => m.ACTIF !== 'NON').map(m => ({ categorie: '', materiau: String(m.MATERIAU), unite: m.UNITE_DEFAUT }));
    } catch (e) { /* onglet absent : on essaie le suivant */ }
  }
  return [];
}

async function enregistrerRapport(env, moi, d, idEnvoi) {
  const date = verifierDate(d.date);
  const bloc = await blocPour(env, moi, date, d.auNomDe);
  const auteur = moi;
  moi = bloc.responsable;
  const id = idRapport(date, moi);
  const repas = Math.round(Number(d.repasPayes));
  if (!(repas >= 0 && repas <= 20)) throw new ErreurMetier('Nombre de repas invalide.');

  // Contrôles de tout le rapport avant la moindre écriture.
  const parChantier = (d.chantiers || []).map(c => {
    const connu = bloc.chantiers.find(x => normaliser(x.libelle) === normaliser(c.libelle));
    if (!connu) throw new ErreurMetier(`Chantier qui n'est plus celui de l'équipe ce jour-là : ${c.libelle}. Rouvre le rapport.`);
    return {
      libelle: connu.libelle,
      remarques: String(c.remarques || '').slice(0, 1000),
      avancement: (c.avancement || []).map(a => {
        if (!String(a.tache || '').trim()) throw new ErreurMetier("Une tâche sans nom dans l'avancement.");
        const tache = String(a.tache).trim().slice(0, 120);
        if (a.mode === 'QUANTITE') {
          const q = Number(String(a.quantite).replace(',', '.'));
          if (!(q > 0)) throw new ErreurMetier(`Indique la quantité faite pour « ${tache} ».`);
          return { CHANTIER: connu.libelle, TACHE: tache, POURCENTAGE: '', MODE: 'QUANTITE', QUANTITE: q, UNITE: String(a.unite || '').slice(0, 6) };
        }
        const pct = Math.round(Number(a.pourcentage));
        if (!(pct >= 0 && pct <= 100)) throw new ErreurMetier('Avancement entre 0 et 100 %.');
        return { CHANTIER: connu.libelle, TACHE: tache, POURCENTAGE: pct, MODE: 'POURCENTAGE', QUANTITE: '', UNITE: '' };
      }),
      materiaux: (c.materiaux || []).map(m => {
        const q = Number(String(m.quantite).replace(',', '.'));
        if (!m.materiau || !(q > 0)) throw new ErreurMetier('Un matériau sans quantité.');
        return { CHANTIER: connu.libelle, MATERIAU: String(m.materiau), QUANTITE: q, UNITE: m.unite || '' };
      }),
    };
  });

  // Une seule lecture pour tout ce dont on a besoin, puis une seule écriture : Google limite le compte
  // de service à 60 lectures et 60 écritures par minute, pour toute l'entreprise. L'ancienne version
  // faisait une écriture par ligne (jusqu'à 35 appels pour un rapport) et dépassait ce quota,
  // d'où les « Erreur du serveur » — en laissant parfois un rapport à moitié réécrit.
  const NOMS = ['RAPPORTS', 'AVANCEMENT', 'MATERIAUX', 'RAPPORT_CHANTIERS', 'JOURNEES'];
  const [t, ids] = await Promise.all([tables(env, NOMS), idsOnglets(env, [...NOMS, 'JOURNAL'])]);
  const tr = t.RAPPORTS;
  if (etatPaieJour(t.JOURNEES.filtrer(x => x.DATE === date), await absencesJustifiees(env), date)) {
    throw new ErreurMetier(d.auNomDe ? MESSAGE_EN_PAIE_BUREAU : MESSAGE_EN_PAIE);
  }
  if (idEnvoi && tr.trouver(x => x.ID_ENVOI === idEnvoi)) return { ok: true, dejaRecu: true };

  const champs = {
    ID_RAPPORT: id, DATE: date, RESPONSABLE: moi, CHANTIERS: bloc.chantiers.map(c => c.libelle).join(' ; '),
    CLIENT: bloc.client, RESTAURANT: String(d.restaurant || '').slice(0, 80), REPAS_PAYES: repas,
    REMARQUES: parChantier.map(c => c.remarques).filter(Boolean).join(' | ').slice(0, 1000),
    STATUT: 'ENVOYE', MODIFIE_LE: horodatage(), ID_ENVOI: idEnvoi || '',
  };
  const requetes = [];
  const existant = tr.trouver(x => x.ID_RAPPORT === id);
  if (existant) {
    champs.NB_BL = existant.obj.NB_BL;
    requetes.push(requeteMaj(ids.RAPPORTS, tr, existant, champs));
  } else {
    champs.CREE_LE = champs.MODIFIE_LE; champs.NB_BL = 0;
    requetes.push(...requetesRemplacer(ids.RAPPORTS, tr, () => false, [champs]));
  }
  const duRapport = x => x.ID_RAPPORT === id;
  requetes.push(...requetesRemplacer(ids.AVANCEMENT, t.AVANCEMENT, duRapport,
    parChantier.flatMap(c => c.avancement.map(a => Object.assign({ ID_RAPPORT: id, DATE: date }, a)))));
  requetes.push(...requetesRemplacer(ids.MATERIAUX, t.MATERIAUX, duRapport,
    parChantier.flatMap(c => c.materiaux.map(m => Object.assign({ ID_RAPPORT: id, DATE: date }, m)))));
  requetes.push(...requetesRemplacer(ids.RAPPORT_CHANTIERS, t.RAPPORT_CHANTIERS, duRapport,
    parChantier.filter(c => c.remarques).map(c => ({ ID_RAPPORT: id, DATE: date, CHANTIER: c.libelle, REMARQUES: c.remarques }))));

  // L'écart de repas n'est plus écrit en alerte : les contrôles du bureau le calculent en direct.
  // Le journal n'a pas de cases à cocher : l'ajout « après la dernière ligne remplie » de Google y est
  // fiable, comme pour journaliser(). Ça évite de relire tout le journal.
  requetes.push({ appendCells: { sheetId: ids.JOURNAL, fields: 'userEnteredValue', rows: [{ values: [
    horodatage(), auteur, existant ? 'CORRECTION_RAPPORT' : 'RAPPORT', id,
    JSON.stringify({ pour: moi, repas, chantiers: parChantier.map(c => c.libelle),
      taches: parChantier.reduce((n, c) => n + c.avancement.length, 0),
      materiaux: parChantier.reduce((n, c) => n + c.materiaux.length, 0) }).slice(0, 2000),
  ].map(caseBrute) }] } });

  await sheets(env, env.ID_DONNEES, ':batchUpdate', { methode: 'POST', corps: { requests: requetes } });
  return { ok: true };
}

/**
 * Photos de bons de livraison : transmises à Apps Script, qui les dépose dans le Drive de Quentin.
 * Un compte de service n'a pas d'espace de stockage à lui, et on veut garder les photos dans Drive
 * pour un futur rapprochement avec les devis.
 */
async function ajouterBl(env, moi, d, idEnvoi) {
  const date = verifierDate(d.date);
  const tj = await table(env, 'JOURNEES');
  const bloc = await blocPour(env, moi, date, d.auNomDe, tj);   // le bureau peut déposer au nom d'un chef
  await exigerJourOuvert(env, date, tj, !!d.auNomDe);
  moi = bloc.responsable;
  const chantier = bloc.chantiers.find(c => normaliser(c.libelle) === normaliser(d.chantier)) || bloc.chantiers[0];
  if (!chantier) throw new ErreurMetier('Aucun chantier au planning pour rattacher la photo.');
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

/** Écart entre repas payés au rapport et repas déclarés par l'équipe ; null s'il n'y en a pas. */
function ecartRepas(tJournees, date, responsable, bloc, payes) {
  const duJour = tJournees.filtrer(j => j.DATE === date);
  const declares = duJour.filter(j => j.REPAS === 'RESTAURANT' && bloc.equipe.includes(j.PERSONNE)).length;
  return payes !== declares ? `${payes} payés au rapport, ${declares} déclarés par l'équipe` : null;
}

// ---------------------------------------------------------------------------
// Contrôles avant paie (bureau)
//
// Calculés en direct à partir des données, à chaque ouverture de l'écran bureau : un problème réglé
// disparaît tout seul. Rien n'est écrit, sauf les justifications (« absent, congé… ») que le bureau
// donne pour un contrôle normal : une ligne dans ALERTES, TRAITEE = VRAI.
// Remplace les alertes écrites par le contrôle du soir (supprimé en version 27).
// ---------------------------------------------------------------------------

/**
 * Intempéries : justification individuelle, ou pour tout un chantier d'un coup (case « tout le
 * chantier » du formulaire) — une partie des équipes peut travailler pendant que l'autre est arrêtée.
 */
// « Retiré du planning » : la personne ne devait pas y être ce jour-là. Le planning n'est pas touché ;
// la journée n'est simplement plus attendue (version 33).
const MOTIFS_JUSTIFICATION = ['Intempéries', 'Absent', 'Congé', 'Maladie', 'Retiré du planning', 'Autre'];
/**
 * Version 37 : seule une journée manquante se justifie (absence, intempéries…), plus le jour chômé. Le reste
 * se corrige : valider, remplir le rapport, corriger les repas, compléter PERSONNES ou LIEUX.
 */
const JUSTIFIABLES = ['JOURNEE_MANQUANTE', 'JOUR_NON_TRAVAILLE'];
/**
 * Jour chômé (férié, pont) alors qu'un planning existe : déclaré une fois par le bureau, il efface
 * les « journée manquante » et « rapport manquant » du jour. Ceux qui ont quand même travaillé
 * saisissent leur journée, contrôlée normalement. Un férié sans planning ni saisie ne produit rien.
 * (Les déclarations « Intempéries » des versions précédentes restent valables.)
 */
const MOTIFS_JOUR = ['Férié', 'Pont', 'Autre'];

/** Onglet du Suivi RH d'une journée : celui enregistré, sinon celui que PERSONNES donne aujourd'hui. */
function ongletRhDe(ref, j) {
  if (String(j.ONGLET_RH || '').trim()) return String(j.ONGLET_RH).trim();
  const p = personneParLibelle(ref, j.PERSONNE) || (j.NOM_INTERIMAIRE ? personneParLibelle(ref, j.NOM_INTERIMAIRE) : null);
  return p ? p.ongletRh : '';
}

/** Plusieurs jours de planning en une seule lecture Google (un batchGet), mémoire d'une heure pour le passé. */
async function planningsDesJours(env, dates) {
  const res = {};
  const manquants = [];
  for (const d of dates) {
    const garde = await memoire(env, 'planning_' + d);
    if (garde) res[d] = garde; else manquants.push(d);
  }
  if (!manquants.length) return res;
  const [index, ref] = await Promise.all([indexPlanning(env), referentiels(env)]);
  const avecOnglet = manquants.filter(d => index[d]);
  manquants.filter(d => !index[d]).forEach(d => { res[d] = { date: d, trouve: false, blocs: [], anomalies: [] }; });
  if (avecOnglet.length) {
    const params = avecOnglet.map(d => `ranges=${encodeURIComponent(plage(index[d], `A${PLANNING.PREMIERE_LIGNE}:F${PLANNING.DERNIERE_LIGNE}`))}`).join('&');
    const r = await sheets(env, env.ID_PLANNING,
      `/values:batchGet?${params}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
    for (let i = 0; i < avecOnglet.length; i++) {
      const d = avecOnglet[i];
      res[d] = Object.assign({ date: d, trouve: true, onglet: index[d] },
        lireBlocs(((r.valueRanges || [])[i] || {}).values || [], ref));
      await memoire(env, 'planning_' + d, res[d], d < aujourdhui() ? 3600 : CACHE_PLANNING_S);
    }
  }
  return res;
}

function joursOuvresAvant(date, n) {
  const out = [];
  const [a, m, j] = date.split('-').map(Number);
  let d = new Date(Date.UTC(a, m - 1, j));
  while (out.length < n) {
    const jour = d.getUTCDay();
    if (jour !== 0 && jour !== 6) out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() - 86400000);
  }
  return out;
}

/** Tout ce que les contrôles lisent : trois onglets en une lecture, les plannings en une autre. */
async function donneesControles(env, dateEnPlus) {
  const auj = aujourdhui();
  const [t, ref, codes, par] = await Promise.all([tables(env, ['JOURNEES', 'RAPPORTS', 'ALERTES']), referentiels(env), codesActifs(env), parametres(env)]);
  // La fenêtre des contrôles (jours ouvrés, plus les samedis et dimanches qu'elle couvre), et TOUS les jours
  // qui ont encore des journées pas envoyées, quel que soit leur âge : un jour ne part en paie que contrôlé.
  const ouvres = joursOuvresAvant(auj, par.CONTROLES_JOURS);
  const dates = new Set();
  for (let d = ouvres[ouvres.length - 1]; d <= auj; d = ajouterJours(new Date(d + 'T00:00:00Z'), 1)) dates.add(d);
  t.JOURNEES.tous().forEach(j => { if (!j.EXPORTE_LE && j.STATUT !== STATUTS.EXPORTEE && j.DATE && j.DATE <= auj) dates.add(j.DATE); });
  if (dateEnPlus && dateEnPlus <= auj) dates.add(dateEnPlus);
  // Rien avant la mise en service : les jours d'essai feraient des centaines de « journées manquantes ».
  const liste = [...dates].filter(d => d >= (par.CONTROLES_DEPUIS || '')).sort();
  return { t, ref, codes, par, dates: liste, plannings: await planningsDesJours(env, liste) };
}

/**
 * La liste des contrôles. Chacun dit ce qui ne va pas, où (jour, personne, chantier) et ce qu'on peut
 * faire : ouvrir la journée, le rapport, valider, justifier. Catégories :
 *   corriger    — bloque l'envoi en paie des journées concernées ;
 *   verifier    — à regarder, ne bloque pas ;
 *   referentiel — à corriger dans le planning ou ses onglets de référence.
 */
function calculerControles(env, don) {
  const { t, ref, codes, par, dates, plannings } = don;
  const auj = aujourdhui();
  const heure = Number(partiesDate(new Date()).hour);
  const enCours = heure < par.CONTROLES_HEURE;                  // avant l'heure réglée (18 h par défaut), la journée du jour est « en cours »
  const justifs = {};
  t.ALERTES.tous().filter(a => a.TRAITEE === true)
    .forEach(a => { justifs[`${a.TYPE}|${a.DATE_CONCERNEE}|${a.PERSONNE}`] = a.DETAIL || 'Justifié'; });

  const liste = [];
  const refDejaVus = new Set();
  const ajouter = c => {
    c.id = `${c.type}|${c.date}|${c.cible}`;
    if (c.cat === 'referentiel') {
      const cle = `${c.type}|${c.cible}`;
      if (refDejaVus.has(cle)) return;                         // un nom inconnu n'est signalé qu'une fois
      refDejaVus.add(cle);
    }
    c.justification = JUSTIFIABLES.includes(c.type) ? (justifs[c.id] || null) : null;
    c.journees = c.journees || [];
    liste.push(c);
  };
  const libelles = b => b.chantiers.map(c => c.libelle.replace(/^\s*\d+\s*·\s*/, '')).join(' + ') || b.villes.join(' + ');
  const horaires = j => `${j.H_EMBAUCHE}–${j.H_PAUSE} · ${j.H_REPRISE}–${j.H_DEBAUCHE} · ${j.TOTAL}`;

  const abs = carteAbsences(t.ALERTES);
  for (const date of [...dates].reverse()) {
    if (justifs[`JOUR_HORS_APPLI|${date}|`]) continue;           // traité hors appli : plus rien à contrôler
    const nonTravaille = justifs[`JOUR_NON_TRAVAILLE|${date}|`] || null;
    if (nonTravaille) {
      ajouter({ type: 'JOUR_NON_TRAVAILLE', cat: 'verifier', date, cible: '', titre: 'Jour chômé (férié, pont…)',
        detail: 'Les journées manquantes et rapports manquants de ce jour ne sont pas signalés.' });
    }
    if (date === auj && enCours) continue;
    const pl = plannings[date] || { trouve: false, blocs: [], anomalies: [] };
    const journees = t.JOURNEES.filtrer(j => j.DATE === date);
    const eq = equipesDuJour(pl, journees, ref, { abs, date });
    const aEnvoyer = journees.filter(j => !j.EXPORTE_LE && j.STATUT !== STATUTS.EXPORTEE);

    if (!pl.trouve && journees.length) {
      ajouter({ type: 'PLANNING_ABSENT', cat: 'referentiel', date, cible: '', titre: 'Planning du jour introuvable',
        detail: "Aucun onglet du planning ne porte cette date en A2 : les journées manquantes ne peuvent pas être repérées.",
        aide: "Dans le planning, vérifier la date en cellule A2 de l'onglet du jour." });
    }
    pl.anomalies.forEach(a => {
      if (a.type === 'NOM_INCONNU') ajouter({ type: 'NOM_INCONNU', cat: 'referentiel', date, cible: a.valeur, personne: a.valeur,
        titre: `Nom inconnu au planning — ${a.valeur}`, detail: "Absent de l'onglet PERSONNES : sa journée ne peut pas être attendue.",
        aide: "Ajouter la personne dans PERSONNES, ou corriger l'orthographe dans le planning (colonne ANCIENNES_GRAPHIES pour une variante)." });
      if (a.type === 'CHANTIER_INCONNU') ajouter({ type: 'CHANTIER_INCONNU', cat: 'referentiel', date, cible: a.valeur,
        titre: `Chantier inconnu — ${a.valeur}`, detail: 'Absent du référentiel CHANTIERS.',
        aide: "Ajouter le chantier dans CHANTIERS (il apparaîtra alors dans les listes du planning), ou corriger la case du planning." });
    });

    for (const b of pl.blocs) {
      for (const nom of b.equipe) {
        if (!codes.includes(nom)) ajouter({ type: 'SANS_CODE', cat: 'referentiel', date, cible: nom, personne: nom,
          titre: `Pas de code de connexion — ${nom}`, detail: "Au planning, mais sans ligne dans CODES : il ne peut pas saisir sa journée.",
          aide: "Ajouter une ligne dans l'onglet CODES du fichier de données, puis lui donner son code." });
        const j = journees.find(x => x.PERSONNE === nom);
        if (!j && !nonTravaille) ajouter({ type: 'JOURNEE_MANQUANTE', cat: 'corriger', date, cible: nom, personne: nom, responsable: b.responsable,
          titre: `Journée manquante — ${nom}`, detail: `Au planning sur ${libelles(b)}, chef ${b.responsable}. Rien reçu.`,
          actions: ['saisir', 'justifier'] });
      }
    }
    for (const b of eq.blocs) {
      const r = t.RAPPORTS.trouver(x => x.ID_RAPPORT === idRapport(date, b.responsable));
      const aTravaille = journees.some(j => b.equipe.includes(j.PERSONNE));
      // Version 35 : le rapport (au moins les repas) est exigé pour que le jour parte en paie, chef de fait compris.
      if (!r && !nonTravaille && aTravaille) {
        const qui = b.deFait ? ' (chef de fait)' : b.remplacant ? ` (remplacé par ${b.remplacant})` : '';
        ajouter({ type: 'RAPPORT_MANQUANT', cat: 'corriger', date, cible: b.responsable, responsable: b.responsable,
          titre: `Rapport manquant — ${b.responsable}${qui}`, detail: `${libelles(b)}. Sans rapport, les repas ne peuvent pas être contrôlés : le jour ne peut pas partir en paie.`,
          actions: ['rapport'] });
      } else if (r && r.obj.REPAS_PAYES !== '' && r.obj.REPAS_PAYES !== null) {
        const payes = Number(r.obj.REPAS_PAYES) || 0;
        if (ecartRepas(t.JOURNEES, date, b.responsable, b, payes)) {
          const equipe = journees.filter(j => b.equipe.includes(j.PERSONNE));
          const declares = equipe.filter(j => j.REPAS === 'RESTAURANT').length;
          ajouter({ type: 'ECART_REPAS', cat: 'corriger', date, cible: b.responsable, responsable: b.responsable,
            titre: `Repas : ${payes} payé${payes > 1 ? 's' : ''}, ${declares} déclaré${declares > 1 ? 's' : ''}`,
            detail: `Rapport de ${b.responsable} — ${libelles(b)}. Corriger le rapport ou les journées de l'équipe.`,
            actions: ['rapport', 'jour'], journees: equipe.map(j => j.ID_JOURNEE) });
        }
      }
    }

    for (const j of aEnvoyer) {
      const chef = eq.chef[j.PERSONNE] || '';
      const interim = j.TYPE_PERSONNE === 'INTERIMAIRE';
      const remplace = eq.blocs.find(b => b.remplacant === j.PERSONNE);
      if (j.STATUT === STATUTS.SAISIE || j.STATUT === STATUTS.SIGNALEE) {
        ajouter({ type: 'NON_VALIDEE', cat: 'corriger', date, cible: j.PERSONNE, personne: j.PERSONNE, responsable: chef,
          titre: `Pas validée par le chef — ${j.PERSONNE}`,
          detail: `${horaires(j)}${chef === j.PERSONNE ? ' — chef de fait : sa journée est validée par le bureau'
            : remplace ? ` — remplace ${remplace.responsable} (absent) : sa journée est validée par le bureau`
            : chef ? ` — chef ${chef}` : ' — sans équipe : à valider par le bureau'}`,
          actions: ['valider', 'ouvrir'], journees: [j.ID_JOURNEE] });
      }
      // Intérimaire sans onglet RH : c'est normal (seuls les réguliers en ont un, comme Pascal B) — ses heures ne
      // vont simplement pas dans le Suivi RH. Un salarié sans onglet est à corriger dans PERSONNES (version 37).
      if (!interim && !ongletRhDe(ref, j)) {
        ajouter({ type: 'SANS_ONGLET_RH', cat: 'corriger', date, cible: j.PERSONNE, personne: j.PERSONNE,
          titre: `Personne sans onglet RH — ${j.PERSONNE}`,
          detail: "L'envoi dans le Suivi RH la laisserait de côté.",
          aide: `Renseigner la colonne ONGLET_RH de ${j.PERSONNE} dans PERSONNES (planning). Pris en compte sous 30 minutes.`,
          actions: [], journees: [j.ID_JOURNEE] });
      }
      if (j.LIEU_EMBAUCHE && normaliser(j.LIEU_EMBAUCHE) !== normaliser(LIBELLE_DEPOT) && !String(j.ZONE || '').trim()) {
        ajouter({ type: 'ZONE_INCONNUE', cat: 'corriger', date, cible: j.PERSONNE, personne: j.PERSONNE,
          titre: `Zone inconnue — ${j.PERSONNE}`, detail: `Embauche à ${j.LIEU_EMBAUCHE} : cette commune n'a pas de zone dans LIEUX.`,
          aide: "Compléter la zone de la commune dans LIEUX, puis ouvrir la journée et l'enregistrer à nouveau pour recalculer la zone.",
          actions: ['ouvrir'], journees: [j.ID_JOURNEE] });
      }
      // (Plus de contrôle « hors planning » : après le planning du matin, chacun fait au mieux — version 34.)
      const duree = minutes(j.TOTAL);
      if (duree !== null && duree > par.JOURNEE_LONGUE_H * 60) {
        ajouter({ type: 'DUREE_LONGUE', cat: 'verifier', date, cible: j.PERSONNE, personne: j.PERSONNE,
          titre: `Journée de ${j.TOTAL.replace(':', ' h ')} — ${j.PERSONNE}`, detail: horaires(j), actions: ['ouvrir'] });
      }
    }
  }
  return liste;
}

/**
 * L'état de paie de chaque jour (version 35) — un seul par jour, dans l'ordre de la chaîne :
 *   REGLER     au moins un point à corriger ;
 *   A_COCHER   complet (tout le monde saisi ou justifié, tout validé, rapports envoyés, aucun point) ;
 *   ENVOI      coché bon pour la paie, partira au prochain envoi ;
 *   ENVOYE     tout est parti dans le Suivi RH ;   HORS_APPLI  traité hors appli par le bureau.
 * Et, hors chaîne : AVENIR, EN_COURS (avant l'heure des contrôles), VIDE (rien de saisi ni d'attendu),
 * CHOME (jour chômé), HORS_CONTROLE (avant la mise en service, CONTROLES_DEPUIS).
 */
function etatsJours(don, liste, voulues) {
  const auj = aujourdhui();
  const enCours = Number(partiesDate(new Date()).hour) < don.par.CONTROLES_HEURE;
  const abs = carteAbsences(don.t.ALERTES);
  const ouverts = liste.filter(c => !c.justification && c.cat !== 'referentiel');
  const res = {};
  for (const d of voulues) {
    const duJour = don.t.JOURNEES.filtrer(j => j.DATE === d);
    const reste = duJour.filter(j => !j.EXPORTE_LE && j.STATUT !== STATUTS.EXPORTEE);
    const points = ouverts.filter(c => c.date === d && c.cat === 'corriger').length;
    const paie = etatPaieJour(duJour, abs, d);
    let etat;
    if (d > auj) etat = 'AVENIR';
    else if (paie) etat = paie;
    else if (d === auj && enCours) etat = 'EN_COURS';
    else if (!don.dates.includes(d)) etat = reste.length ? 'HORS_CONTROLE' : (duJour.length ? 'ENVOYE' : 'VIDE');
    else if (points) etat = 'REGLER';
    else if (reste.length) etat = 'A_COCHER';
    else etat = abs[`${d}|`] ? 'CHOME' : 'VIDE';
    const jour = new Date(d + 'T12:00:00Z').getUTCDay();
    res[d] = { date: d, etat, points, journees: (paie === 'ENVOYE' ? duJour : reste).length,
      minutes: (paie === 'ENVOYE' ? duJour : reste).reduce((n, j) => n + (minutes(j.TOTAL) || 0), 0),
      weekend: jour === 0 || jour === 6, horsAppli: abs[`H|${d}`] || '',
      verifier: ouverts.filter(c => c.date === d && c.cat === 'verifier' && c.type !== 'JOUR_NON_TRAVAILLE').length };
  }
  return res;
}

/** Résumé pour l'écran bureau : la chaîne de paie par jour, la bande de jours et les points du jour affiché. */
function resumeControles(env, don, liste, date) {
  const ouverts = liste.filter(c => !c.justification);
  const auj = aujourdhui();
  // Bande : quatre semaines entières, du lundi au dimanche, jusqu'à la fin de la semaine en cours (et le jour affiché).
  const lundi = lundiDe(date > auj ? date : auj);              // lundiDe rend une Date
  const fin = ajouterJours(lundi, 6);
  const debut = [ajouterJours(lundi, -21), ajouterJours(lundiDe(date), 0)].sort()[0];
  const bande = [];
  for (let d = debut; d <= fin; d = ajouterJours(new Date(d + 'T00:00:00Z'), 1)) bande.push(d);
  const toutes = [...new Set([...don.dates, ...bande, date])].sort();
  const etats = etatsJours(don, liste, toutes);
  const chaine = (etat) => {
    const js = don.dates.filter(d => etats[d].etat === etat).map(d => Object.assign({}, etats[d], etat !== 'REGLER' ? {} : {
      titres: ouverts.filter(c => c.date === d && c.cat === 'corriger').map(c => c.titre).slice(0, 3) }));
    return { jours: js.length, points: js.reduce((n, x) => n + x.points, 0), journees: js.reduce((n, x) => n + x.journees, 0),
      minutes: js.reduce((n, x) => n + x.minutes, 0), liste: js.slice().reverse() };
  };
  return {
    compteurs: {
      corriger: ouverts.filter(c => c.cat === 'corriger').length,
      verifier: ouverts.filter(c => c.cat === 'verifier').length,
      referentiel: ouverts.filter(c => c.cat === 'referentiel').length,
      justifies: liste.length - ouverts.length,
    },
    paie: { regler: chaine('REGLER'), aCocher: chaine('A_COCHER'), envoi: chaine('ENVOI') },
    jours: bande.map(d => etats[d]),
    jour: etats[date],
    duJour: ouverts.filter(c => c.date === date && c.cat !== 'referentiel')
      .map(c => ({ type: c.type, cat: c.cat, titre: c.titre, personne: c.personne || '', responsable: c.responsable || '' })),
  };
}

async function bureauControles(env, moi) {
  await exigerBureau(env, moi);
  const don = await donneesControles(env);
  const liste = calculerControles(env, don);
  // Jours contrôlés où l'on peut déclarer « journée non travaillée » : ceux qui ont un planning.
  const joursPlanning = don.dates.filter(d => (don.plannings[d] || {}).trouve);
  return { ok: true, controles: liste, motifs: MOTIFS_JUSTIFICATION, motifsJour: MOTIFS_JOUR, joursPlanning,
    resume: resumeControles(env, don, liste, aujourdhui()) };
}

/**
 * Justifier un ou plusieurs contrôles d'un même jour (« intempéries » pour tout un chantier, par
 * exemple), ou annuler une justification. Toutes les lignes s'écrivent en un seul appel.
 */
async function bureauJustifier(env, moi, d) {
  await exigerBureau(env, moi);
  const date = verifierDate(d.date);
  const elements = (Array.isArray(d.elements) && d.elements.length ? d.elements : [{ type: d.type, cible: d.cible }])
    .map(e => ({ type: String(e.type || ''), cible: String(e.cible || '') }));
  if (elements.length > 40 || elements.some(e => !/^[A-Z_]+$/.test(e.type) || ['REMPLACANT', 'JOUR_HORS_APPLI'].includes(e.type))) throw new ErreurMetier('Contrôle inconnu.');
  if (!d.annuler && elements.some(e => !JUSTIFIABLES.includes(e.type))) {
    throw new ErreurMetier("Seule une journée manquante se justifie. Ce point se corrige : valider, remplir le rapport, corriger les repas ou compléter le planning.");
  }
  await exigerJourOuvert(env, date, await table(env, 'JOURNEES'), true);
  const t = await table(env, 'ALERTES');
  const deja = e => t.lignes.filter(l => l.obj.TYPE === e.type && l.obj.DATE_CONCERNEE === date && l.obj.PERSONNE === e.cible && l.obj.TRAITEE === true);
  if (d.annuler) {
    await majLignes(env, t, elements.flatMap(deja).map(l => [l, { TRAITEE: false }]));
    await journaliser(env, moi, 'CONTROLE_ROUVERT', date, elements.map(e => `${e.type}|${e.cible}`).join(' ; '));
    await memoire(env, 'absences', carteAbsences(t), 600);        // majLignes a mis la table à jour
    return { ok: true };
  }
  const motif = String(d.motif || '').trim();
  for (const e of elements) {
    const jour = e.type === 'JOUR_NON_TRAVAILLE';
    if (jour ? (!MOTIFS_JOUR.includes(motif) || e.cible !== '') : !MOTIFS_JUSTIFICATION.includes(motif)) throw new ErreurMetier('Choisis un motif.');
  }
  const commentaire = String(d.commentaire || '').trim().slice(0, 300);
  const detail = `${motif}${commentaire ? ' — ' + commentaire : ''} (${moi}, ${horodatage().slice(0, 16)})`;
  const nouveaux = elements.filter(e => !deja(e).length)
    .map(e => ({ HORODATAGE: horodatage(), TYPE: e.type, DATE_CONCERNEE: date, PERSONNE: e.cible, DETAIL: detail, TRAITEE: true }));
  if (!nouveaux.length) return { ok: true, dejaFait: true };
  const ids = await idsOnglets(env, ['ALERTES']);
  await sheets(env, env.ID_DONNEES, ':batchUpdate', { methode: 'POST',
    corps: { requests: requetesRemplacer(ids.ALERTES, t, () => false, nouveaux) } });
  await journaliser(env, moi, 'CONTROLE_JUSTIFIE', date, `${nouveaux.map(e => `${e.TYPE}|${e.PERSONNE}`).join(' ; ')} : ${detail}`);
  // Les accueils des gars et des chefs le voient tout de suite : la mémoire des absences est refaite.
  nouveaux.forEach(o => t.lignes.push({ obj: o, ligne: 0 }));
  await memoire(env, 'absences', carteAbsences(t), 600);
  return { ok: true, justifies: nouveaux.length };
}

// ---------------------------------------------------------------------------
// Écrans du bureau : voir, saisir, corriger et valider à la place de n'importe qui
// ---------------------------------------------------------------------------

/** Tout ce qui concerne une journée, vu du bureau. */
async function bureauJour(env, moi, date) {
  await exigerBureau(env, moi);
  date = verifierDate(date || aujourdhui());
  // Les contrôles lisent déjà JOURNEES, RAPPORTS, ALERTES et les plannings : on s'en sert pour tout l'écran.
  const don = await donneesControles(env, date);
  const pl = don.plannings[date] || await planningDuJour(env, date);
  const t = don.t.JOURNEES, tr = don.t.RAPPORTS, ref = don.ref;
  const liste = calculerControles(env, don);
  const controles = resumeControles(env, don, liste, date);
  const abs = carteAbsences(don.t.ALERTES);
  const bureauNoms = (await lireCodes(env)).bureau;

  const saisies = t.filtrer(j => j.DATE === date);
  const eq = equipesDuJour(pl, saisies, ref, { abs, date });
  const auPlanning = [];
  pl.blocs.forEach(b => b.equipe.forEach(nom => { if (!auPlanning.includes(nom)) auPlanning.push(nom); }));
  const personnes = [...new Set([...auPlanning, ...saisies.map(j => j.PERSONNE)])];

  const fiche = nom => {
    const j = saisies.find(x => x.PERSONNE === nom);
    const bloc = eq.blocs.find(b => b.equipe.includes(nom));
    return {
      personne: nom,
      auPlanning: auPlanning.includes(nom),
      chantier: bloc ? bloc.chantiers.map(c => c.libelle).join(' + ') : (j ? j.CHANTIERS : ''),
      responsable: bloc ? bloc.responsable : '',
      estChef: pl.blocs.some(b => b.responsable === nom),
      journee: j ? versClient(j) : null,
      valideBureau: j ? j.VALIDE_BUREAU === true : false,
      exportee: j ? !!j.EXPORTE_LE : false,
      interimaire: !!(j && j.TYPE_PERSONNE === 'INTERIMAIRE'),
      // Intérimaire présent dans PERSONNES mais sans ONGLET_RH : ses heures ne vont pas au Suivi RH — à signaler au
      // bureau, au cas où l'onglet serait à créer. Saisie libre (INTERIM X, absent de PERSONNES) : rien (version 38).
      sansOngletRh: !!(j && j.TYPE_PERSONNE === 'INTERIMAIRE' && !ongletRhDe(ref, j)
        && (personneParLibelle(ref, j.PERSONNE) || (j.NOM_INTERIMAIRE && personneCorrespondante(ref, j.NOM_INTERIMAIRE)))),
      // Absence justifiée : type et cible pour pouvoir l'annuler d'ici.
      justification: j ? null : (abs[`${date}|${nom}`] ? { motif: abs[`${date}|${nom}`], type: 'JOURNEE_MANQUANTE', cible: nom }
        : abs[`${date}|`] ? { motif: abs[`${date}|`], type: 'JOUR_NON_TRAVAILLE', cible: '' } : null),
    };
  };

  // Regroupé par chantier : le bureau contrôle un chantier d'un bloc, comme sur le papier.
  const chantiers = eq.blocs.map(b => {
    const r = tr.trouver(x => x.ID_RAPPORT === idRapport(date, b.responsable));
    return {
      villes: b.chantiers.map(c => c.libelle), client: b.client, responsable: b.responsable,
      horsPlanning: b.chantiers.filter(c => c.hors).map(c => ({ libelle: c.libelle, declarePar: c.declarePar })),
      // Les intérimaires rangés sous le chantier de leur chef, pas « hors chantier ».
      journees: b.equipe.map(fiche), deFait: !!b.deFait,
      chefAbsent: !!b.chefAbsent, remplacant: b.remplacant || '', candidatsRemplacant: b.candidatsRemplacant || [],
      rapport: (() => {
        const payes = r && r.obj.REPAS_PAYES !== '' && r.obj.REPAS_PAYES !== null ? Number(r.obj.REPAS_PAYES) : null;
        const declares = saisies.filter(x => b.equipe.includes(x.PERSONNE) && x.REPAS === 'RESTAURANT').length;
        return {
          envoye: !!(r && r.obj.STATUT === 'ENVOYE'),
          restaurant: r ? r.obj.RESTAURANT : '', repasPayes: payes === null ? '' : payes,
          repasDeclares: declares,
          ecartRepas: payes !== null && payes !== declares,
          nbBl: r ? Number(r.obj.NB_BL) || 0 : 0,
        };
      })(),
    };
  });
  const dansUnChantier = new Set(chantiers.flatMap(c => c.journees.map(j => j.personne)));
  const horsChantier = personnes.filter(n => !dansUnChantier.has(n)).map(fiche);

  return {
    date,
    planningTrouve: pl.trouve,
    chantiers,
    horsChantier,
    controles,
    personnesConnues: ref.personnes.filter(p => p.actif && p.type !== 'PRESTATAIRE' && !estGenerique(p) && !bureauNoms.includes(p.libelle)).map(p => p.libelle).sort(),
    motifs: MOTIFS_JUSTIFICATION, motifsJour: MOTIFS_JOUR,
    jour: controles.jour,
    // Ce qui a été justifié ce jour-là (annulable d'ici) et les points à corriger avec leurs actions (version 36 :
    // plus d'écran « contrôles », tout se fait depuis le jour).
    justifies: liste.filter(c => c.date === date && c.justification && c.cat !== 'referentiel')
      .map(c => ({ type: c.type, cible: c.cible, titre: c.titre, justification: c.justification })),
    points: liste.filter(c => c.date === date && !c.justification && c.cat === 'corriger')
      .map(c => ({ type: c.type, cible: c.cible, titre: c.titre, detail: c.detail || '', personne: c.personne || '', responsable: c.responsable || '' })),
    referentiels: liste.filter(c => c.cat === 'referentiel' && !c.justification).length,
  };
}

/** Le bureau saisit ou corrige la journée de n'importe qui, sans passer par le planning. */
async function bureauEnregistrerJournee(env, moi, d) {
  await exigerBureau(env, moi);
  const date = verifierDate(d.date);
  const personne = String(d.personne || '').trim();
  if (!personne) throw new ErreurMetier('Indique de qui est la journée.');
  const ref = await referentiels(env);
  const p = personneParLibelle(ref, personne);
  const c = controlerJournee(d, ref, await parametres(env));
  const t = await table(env, 'JOURNEES');
  const existante = t.trouver(x => x.ID_JOURNEE === idJournee(date, personne));
  if (existante && existante.obj.EXPORTE_LE) {
    throw new ErreurMetier('Journée déjà envoyée au Suivi RH : la corriger là-bas.');
  }
  await exigerJourOuvert(env, date, t, true);
  if ((await lireCodes(env)).bureau.includes(personne)) throw new ErreurMetier(`${personne} est un compte du bureau : pas de journée.`);
  // « Saisir pour quelqu'un d'autre » : le bureau choisit dans quelle équipe l'ajouter (version 32).
  let chef = null;
  if (d.chef !== undefined) {
    chef = String(d.chef || '').trim();
    if (chef && !(await planningDuJour(env, date)).blocs.some(b => b.responsable === chef)) {
      throw new ErreurMetier(`${chef} n'est chef d'aucun chantier ce jour-là.`);
    }
  }

  const champs = {
    ID_JOURNEE: idJournee(date, personne), DATE: date, PERSONNE: personne,
    ONGLET_RH: p ? p.ongletRh : (existante ? existante.obj.ONGLET_RH : ''),
    TYPE_PERSONNE: p ? p.type : (existante ? existante.obj.TYPE_PERSONNE : ''),
    SAISI_PAR: `${moi} (bureau)`, CHANTIERS: c.chantiers.join(' ; '), ID_CHANTIERS: c.idsChantiers.join(' ; '),
    LIEU_EMBAUCHE: c.lieuEmbauche, ZONE: c.zone, CODE_RH_ZONE: c.codeRh,
    H_EMBAUCHE: c.heures[0], H_PAUSE: c.heures[1], H_REPRISE: c.heures[2], H_DEBAUCHE: c.heures[3],
    TOTAL: c.total, TRAJET: c.trajet, TACHES_SUPP: c.tachesSupp, TACHES_SUPP_MIN: c.tachesSuppMin,
    REPAS: c.repas, REPARTITION: c.repartition, SIGNALEMENT: '', MODIFIE_LE: horodatage(),
    STATUT: STATUTS.VALIDEE_CHEF, VALIDE_CHEF_PAR: `${moi} (bureau)`, VALIDE_CHEF_LE: horodatage(),
  };
  // Équipe : celle choisie par le bureau (« Saisir pour quelqu'un »), sinon celle que donnent ses chantiers.
  const pl = await planningDuJour(env, date);
  if (chef === null) {
    chef = chefCalcule(pl, t.filtrer(x => x.DATE === date), Object.assign({ PERSONNE: personne, DATE: date, TYPE_PERSONNE: champs.TYPE_PERSONNE }, champs),
      ref, await absencesJustifiees(env));
  }
  champs.RESPONSABLE = chef;
  const avant = existante ? existante.obj.CHANTIERS : '';
  if (existante) await majLigne(env, t, existante, champs);
  else {
    champs.CREE_LE = champs.MODIFIE_LE;
    champs.VALIDE_BUREAU = false;
    await ajouterLigne(env, t, champs);
  }
  await journaliser(env, moi, existante ? 'BUREAU_CORRECTION' : 'BUREAU_SAISIE', champs.ID_JOURNEE, champs);
  await apresChangementDeChantiers(env, moi, date, t, pl, avant, champs.CHANTIERS);
  return { ok: true };
}

/**
 * Le bureau efface une journée saisie (remise à zéro : mauvaise personne, mauvaise équipe, doublon).
 * Jamais celle d'un chef du jour, jamais une journée déjà envoyée au Suivi RH. Tout le contenu de la
 * ligne est gardé au JOURNAL. Une personne au planning redevient attendue (à justifier si besoin).
 */
async function bureauSupprimerJournee(env, moi, d) {
  await exigerBureau(env, moi);
  const date = verifierDate(d.date);
  const personne = String(d.personne || '').trim();
  const [t, pl] = await Promise.all([table(env, 'JOURNEES'), planningDuJour(env, date)]);
  const j = t.trouver(x => x.ID_JOURNEE === idJournee(date, personne));
  if (!j) throw new ErreurMetier(`Aucune journée de ${personne} ce jour-là.`);
  if (pl.blocs.some(b => b.responsable === personne)) throw new ErreurMetier(`${personne} est chef ce jour-là : sa journée ne s'efface pas.`);
  if (j.obj.EXPORTE_LE || j.obj.STATUT === STATUTS.EXPORTEE) throw new ErreurMetier("Journée déjà envoyée au Suivi RH : elle ne s'efface plus.");
  await exigerJourOuvert(env, date, t, true);
  const ids = await idsOnglets(env, ['JOURNEES']);
  await sheets(env, env.ID_DONNEES, ':batchUpdate', { methode: 'POST',
    corps: { requests: requetesRemplacer(ids.JOURNEES, t, x => x.ID_JOURNEE === j.obj.ID_JOURNEE, []) } });
  await journaliser(env, moi, 'BUREAU_EFFACEMENT', j.obj.ID_JOURNEE, j.obj);
  t.lignes = t.lignes.filter(l => l !== j);
  await apresChangementDeChantiers(env, moi, date, t, pl, j.obj.CHANTIERS, '');
  return { ok: true, auPlanning: pl.blocs.some(b => b.equipe.includes(personne)) };
}

/** Validation à la place du chef, ou validation bureau (celle qui autorise l'envoi en paie). */
async function bureauValider(env, moi, d) {
  await exigerBureau(env, moi);
  const date = verifierDate(d.date);
  const t = await table(env, 'JOURNEES');
  const { pl, abs } = await equipesLues(env, date, t);
  const ref = await referentiels(env);
  const duJour = t.filtrer(x => x.DATE === date);
  if (d.quoi !== 'CHEF') throw new ErreurMetier('La paie se coche par jour entier : « Journée bon pour la paie » en tête du jour.');
  await exigerJourOuvert(env, date, t, true);
  const modifs = [];
  for (const personne of d.personnes || []) {
    const j = t.trouver(x => x.ID_JOURNEE === idJournee(date, personne));
    if (!j || j.obj.EXPORTE_LE) continue;
    const champs = { MODIFIE_LE: horodatage() };
    if (d.quoi === 'CHEF') {
      champs.STATUT = STATUTS.VALIDEE_CHEF; champs.SIGNALEMENT = '';
      champs.VALIDE_CHEF_PAR = `${moi} (bureau)`; champs.VALIDE_CHEF_LE = horodatage();
      // Validée : l'équipe est figée là où la règle la place maintenant (intérimaire : son chef).
      champs.RESPONSABLE = j.obj.TYPE_PERSONNE === 'INTERIMAIRE' ? chefInterimaire(j.obj) : chefCalcule(pl, duJour, j.obj, ref, abs);
    } else {
      throw new ErreurMetier('Validation inconnue.');
    }
    modifs.push([j, champs]);
  }
  await majLignes(env, t, modifs);
  const n = modifs.length;
  await journaliser(env, moi, 'BUREAU_VALIDATION', date, { quoi: d.quoi, personnes: d.personnes, appliquees: n });
  return { ok: true, appliquees: n };
}

/**
 * La paie d'un jour entier (version 35) : le cocher bon pour la paie (seulement s'il est complet), l'en
 * retirer, le déclarer traité hors appli (saisi à la main dans le Suivi RH, jour d'avant la mise en
 * service…) ou annuler cette déclaration. Rien d'autre ne change les cases « bon pour la paie ».
 */
async function bureauPaieJour(env, moi, d) {
  await exigerBureau(env, moi);
  const date = verifierDate(d.date);
  const action = String(d.action || '');
  const don = await donneesControles(env, date);
  const liste = calculerControles(env, don);
  const etat = etatsJours(don, liste, [date])[date];
  const t = don.t.JOURNEES;
  const reste = t.lignes.filter(l => l.obj.DATE === date && !l.obj.EXPORTE_LE && l.obj.STATUT !== STATUTS.EXPORTEE);
  if (action === 'COCHER') {
    if (etat.etat !== 'A_COCHER') {
      const pts = liste.filter(c => c.date === date && c.cat === 'corriger' && !c.justification).map(c => c.titre);
      throw new ErreurMetier(etat.etat === 'REGLER' ? `Le jour n'est pas complet : ${pts.slice(0, 4).join(' ; ')}${pts.length > 4 ? '…' : ''}`
        : 'Ce jour ne peut pas être coché (rien à envoyer, déjà dans l\'envoi, ou en cours).');
    }
    await majLignes(env, t, reste.map(l => [l, { VALIDE_BUREAU: true, MODIFIE_LE: horodatage() }]));
  } else if (action === 'RETIRER') {
    if (etat.etat !== 'ENVOI') throw new ErreurMetier("Ce jour n'est pas dans l'envoi.");
    await majLignes(env, t, reste.map(l => [l, { VALIDE_BUREAU: false, MODIFIE_LE: horodatage() }]));
  } else if (action === 'HORS_APPLI' || action === 'ANNULER_HORS_APPLI') {
    const ta = don.t.ALERTES;
    const lignes = ta.lignes.filter(l => l.obj.TYPE === 'JOUR_HORS_APPLI' && l.obj.DATE_CONCERNEE === date && l.obj.TRAITEE === true);
    if (action === 'HORS_APPLI') {
      if (lignes.length) return { ok: true, dejaFait: true };
      if (etat.etat === 'ENVOYE') throw new ErreurMetier('Ce jour est déjà parti dans le Suivi RH.');
      const commentaire = String(d.commentaire || '').trim().slice(0, 300);
      const ligne = { HORODATAGE: horodatage(), TYPE: 'JOUR_HORS_APPLI', DATE_CONCERNEE: date, PERSONNE: '',
        DETAIL: `Traité hors appli${commentaire ? ' — ' + commentaire : ''} (${moi}, ${horodatage().slice(0, 16)})`, TRAITEE: true };
      const ids = await idsOnglets(env, ['ALERTES']);
      await sheets(env, env.ID_DONNEES, ':batchUpdate', { methode: 'POST', corps: { requests: requetesRemplacer(ids.ALERTES, ta, () => false, [ligne]) } });
      ta.lignes.push({ obj: ligne, ligne: 0 });
    } else {
      if (!lignes.length) throw new ErreurMetier("Ce jour n'était pas traité hors appli.");
      await majLignes(env, ta, lignes.map(l => [l, { TRAITEE: false }]));
    }
    await memoire(env, 'absences', carteAbsences(ta), 600);
  } else {
    throw new ErreurMetier('Action inconnue.');
  }
  await journaliser(env, moi, 'PAIE_JOUR', date, { action, journees: reste.length });
  return { ok: true };
}

/** Chef absent : le bureau choisit qui le remplace ce jour-là (par défaut, le premier qui a envoyé sa journée). */
async function bureauRemplacant(env, moi, d) {
  await exigerBureau(env, moi);
  const date = verifierDate(d.date);
  const chef = String(d.chef || '').trim();
  const remplacant = String(d.remplacant || '').trim();
  const { eq, t: tj } = await equipesLues(env, date);
  await exigerJourOuvert(env, date, tj, true);
  const bloc = eq.blocs.find(b => b.responsable === chef && b.chefAbsent);
  if (!bloc) throw new ErreurMetier(`${chef} n'est pas un chef absent ce jour-là (justifie d'abord son absence).`);
  if (!(bloc.candidatsRemplacant || []).includes(remplacant)) throw new ErreurMetier(`${remplacant} n'est pas dans l'équipe de ${chef} ce jour-là.`);
  const ta = await table(env, 'ALERTES');
  const anciennes = ta.lignes.filter(l => l.obj.TYPE === 'REMPLACANT' && l.obj.DATE_CONCERNEE === date && l.obj.PERSONNE === chef && l.obj.TRAITEE === true);
  await majLignes(env, ta, anciennes.map(l => [l, { TRAITEE: false }]));
  const ligne = { HORODATAGE: horodatage(), TYPE: 'REMPLACANT', DATE_CONCERNEE: date, PERSONNE: chef,
    DETAIL: `${remplacant} (${moi}, ${horodatage().slice(0, 16)})`, TRAITEE: true };
  const ids = await idsOnglets(env, ['ALERTES']);
  await sheets(env, env.ID_DONNEES, ':batchUpdate', { methode: 'POST', corps: { requests: requetesRemplacer(ids.ALERTES, ta, () => false, [ligne]) } });
  ta.lignes.push({ obj: ligne, ligne: 0 });
  await memoire(env, 'absences', carteAbsences(ta), 600);
  await journaliser(env, moi, 'REMPLACANT', date, `${chef} → ${remplacant}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Export vers le Suivi RH (macro Excel)
// ---------------------------------------------------------------------------

async function journeesAExporter(env, cle) {
  if (!cle || cle !== env.CLE_EXPORT) throw new ErreurMetier("Clé d'export invalide.");
  const don = await donneesControles(env);
  const etats = etatsJours(don, calculerControles(env, don), don.dates);
  const t = don.t.JOURNEES;
  return t.filtrer(j => j.STATUT === STATUTS.VALIDEE_CHEF && j.VALIDE_BUREAU === true && !j.EXPORTE_LE
    && etats[j.DATE] && etats[j.DATE].etat === 'ENVOI' && !etats[j.DATE].points)
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
  const modifs = [];
  for (const id of ids || []) {
    const j = t.trouver(x => x.ID_JOURNEE === id);
    if (j && j.obj.VALIDE_BUREAU === true && !j.obj.EXPORTE_LE) modifs.push([j, { STATUT: STATUTS.EXPORTEE, EXPORTE_LE: quand }]);
  }
  await majLignes(env, t, modifs);
  const n = modifs.length;
  await journaliser(env, 'IMPORT_RH', 'EXPORT', '', `${n} journée(s)`);
  return { ok: true, marquees: n };
}

/**
 * Envoi dans le Suivi RH (Google Sheet). Pour chaque journée validée par le bureau :
 * on cherche la ligne de la date dans la colonne C de l'onglet du salarié, puis on écrit
 * D, E, F, G (horaires), L (tâches avant chantier), P (zone), AC/AD (repas) et AG (jour travaillé).
 * USER_ENTERED : « 08:15 » devient une vraie heure, sinon les formules du Suivi RH ne calculent plus.
 */
async function importerSuiviRh(env, moi) {
  await exigerBureau(env, moi);
  if (!env.ID_SUIVI_RH) throw new ErreurMetier("Le Suivi RH n'est pas configuré (ID_SUIVI_RH).");
  // Seuls partent les jours entiers dans l'envoi, sans aucun point à corriger (version 35).
  const don = await donneesControles(env);
  const controles = calculerControles(env, don);
  const etats = etatsJours(don, controles, don.dates);
  const bloquantes = {};
  controles.filter(c => c.cat === 'corriger' && !c.justification).forEach(c => {
    t0(c.date).forEach(id => { (bloquantes[id] = bloquantes[id] || []).push(c.titre); });
  });
  function t0(date) { return don.t.JOURNEES.filtrer(j => j.DATE === date).map(j => j.ID_JOURNEE); }
  // Intérimaire sans onglet RH (version 37) : ses heures ne vont pas dans le Suivi RH ; la journée est marquée
  // envoyée, rien n'est écrit. Un intérimaire régulier avec un onglet dans PERSONNES y est écrit normalement.
  const horsSuivi = { has: id => { const j = don.t.JOURNEES.trouver(x => x.ID_JOURNEE === id); return !!(j && j.obj.TYPE_PERSONNE === 'INTERIMAIRE'); } };
  const t = don.t.JOURNEES, ref = don.ref;
  const candidates = t.lignes.filter(l => l.obj.STATUT === STATUTS.VALIDEE_CHEF
    && l.obj.VALIDE_BUREAU === true && !l.obj.EXPORTE_LE && etats[l.obj.DATE] && etats[l.obj.DATE].etat === 'ENVOI');
  const ignorees = [];
  const pretes = candidates.filter(l => {
    const b = bloquantes[l.obj.ID_JOURNEE];
    if (b) ignorees.push(`${l.obj.PERSONNE} (${l.obj.DATE}) : ${b.join(' ; ')}`);
    return !b;
  });
  if (!pretes.length) return { ok: true, ecrites: 0, ignorees, message: 'Rien à envoyer.' };

  const donnees = [];
  const faites = [];
  const sansEcriture = [];              // intérimaires sans onglet RH : marqués envoyés, rien d'écrit
  const datesParOnglet = {};

  for (const l of pretes) {
    const j = l.obj;
    const onglet = ongletRhDe(ref, j);
    if (!onglet && horsSuivi.has(j.ID_JOURNEE)) { sansEcriture.push(l); continue; }
    if (!onglet) { ignorees.push(`${j.PERSONNE} : pas d'onglet RH renseigné`); continue; }
    if (!datesParOnglet[onglet]) {
      try {
        const col = await lirePlage(env, env.ID_SUIVI_RH, onglet, 'C1:C400');
        const index = {};
        col.forEach((v, i) => {
          const brut = v[0];
          if (typeof brut === 'number') index[depuisSerie(brut).date] = i + 1;
        });
        datesParOnglet[onglet] = index;
      } catch (e) {
        datesParOnglet[onglet] = null;
      }
    }
    const index = datesParOnglet[onglet];
    if (!index) { ignorees.push(`${j.PERSONNE} : onglet « ${onglet} » introuvable dans le Suivi RH`); continue; }
    const ligne = index[j.DATE];
    if (!ligne) { ignorees.push(`${j.PERSONNE} : aucune ligne au ${j.DATE} dans l'onglet ${onglet}`); continue; }

    const zone = j.CODE_RH_ZONE === '' || j.CODE_RH_ZONE === null ? '' : Number(j.CODE_RH_ZONE);
    donnees.push(
      { range: plage(onglet, `D${ligne}:G${ligne}`), values: [[j.H_EMBAUCHE, j.H_PAUSE, j.H_REPRISE, j.H_DEBAUCHE]] },
      { range: plage(onglet, `L${ligne}`), values: [[j.TACHES_SUPP_MIN ? hhmm(Number(j.TACHES_SUPP_MIN)) : '']] },
      { range: plage(onglet, `P${ligne}`), values: [[zone]] },
      { range: plage(onglet, `AC${ligne}:AD${ligne}`), values: [[j.REPAS === 'PANIER' ? 1 : '', j.REPAS === 'RESTAURANT' ? 1 : '']] },
      { range: plage(onglet, `AG${ligne}`), values: [[9]] },
    );
    faites.push(l);
  }

  if (donnees.length) {
    await sheets(env, env.ID_SUIVI_RH, '/values:batchUpdate', {
      methode: 'POST', corps: { valueInputOption: 'USER_ENTERED', data: donnees },
    });
  }
  const quand = horodatage();
  await majLignes(env, t, [...faites, ...sansEcriture].map(l => [l, { STATUT: STATUTS.EXPORTEE, EXPORTE_LE: quand }]));
  await journaliser(env, moi, 'IMPORT_SUIVI_RH', '', { ecrites: faites.length, horsSuivi: sansEcriture.length, ignorees });
  return { ok: true, ecrites: faites.length, horsSuivi: sansEcriture.length, ignorees };
}

/**
 * Referme les trous : supprime les lignes entièrement vides des onglets de données.
 * À lancer une fois après la bascule, puis plus jamais (les écritures sont maintenant contiguës).
 */
async function compacter(env, cle) {
  if (!cle || cle !== env.CLE_EXPORT) throw new ErreurMetier("Clé invalide : utiliser la clé d'export.");
  const resultat = {};
  for (const nom of Object.keys(COLONNES_TEXTE)) {
    const brut = await lirePlage(env, env.ID_DONNEES, nom, 'A1:AZ');
    const vides = [];
    for (let i = 1; i < brut.length; i++) {                    // on ne touche jamais à l'en-tête
      const l = brut[i] || [];
      if (l.every(c => c === '' || c === null || c === undefined)) vides.push(i + 1);
    }
    if (!vides.length) { resultat[nom] = 0; continue; }
    // regrouper en plages contiguës, puis supprimer du bas vers le haut
    const plages = [];
    let debut = vides[0], precedent = vides[0];
    for (const n of vides.slice(1)) {
      if (n === precedent + 1) { precedent = n; continue; }
      plages.push([debut, precedent]); debut = n; precedent = n;
    }
    plages.push([debut, precedent]);
    const idOnglet = await idDeLOnglet(env, env.ID_DONNEES, nom);
    await sheets(env, env.ID_DONNEES, ':batchUpdate', {
      methode: 'POST',
      corps: {
        requests: plages.reverse().map(([a, b]) => ({
          deleteDimension: { range: { sheetId: idOnglet, dimension: 'ROWS', startIndex: a - 1, endIndex: b } },
        })),
      },
    });
    resultat[nom] = vides.length;
  }
  return { ok: true, lignes_vides_supprimees: resultat };
}

// ---------------------------------------------------------------------------
// Page de vérification : tout ce qu'il faut pour comprendre un problème sans deviner.
// À ouvrir dans un navigateur : <adresse du Worker>/?action=verif&cle=<CLE_EXPORT>
// ---------------------------------------------------------------------------

async function verification(env, cle) {
  if (!cle || cle !== env.CLE_EXPORT) throw new ErreurMetier("Clé invalide : utiliser la clé d'export.");
  const date = aujourdhui();
  const index = await indexPlanning(env, true);
  const dates = Object.keys(index).sort();
  const ref = await referentiels(env, true);
  const pl = await planningDuJour(env, date, true);

  // Nom et adresse du fichier de données réellement utilisé, et remplissage de chaque onglet :
  // c'est la réponse à « je ne vois rien dans JOURNEES ».
  const info = await sheets(env, env.ID_DONNEES, '?fields=properties.title');
  // Seulement les onglets qui existent : REF_MATERIAUX a été renommé dans le vrai fichier, et une plage
  // vers un onglet absent fait refuser toute la lecture groupée.
  const existants = (await onglets(env, env.ID_DONNEES, true)).map(o => o.titre);
  const noms = Object.keys(COLONNES_TEXTE).filter(n => existants.includes(n));
  const params = noms.map(n => `ranges=${encodeURIComponent(plage(n, 'A:A'))}`).join('&');
  const r = await sheets(env, env.ID_DONNEES, `/values:batchGet?${params}&valueRenderOption=UNFORMATTED_VALUE`);
  const lignes = {};
  noms.forEach((n, i) => {
    const v = (r.valueRanges[i] || {}).values || [];
    lignes[n] = Math.max(0, v.length - 1);          // sans la ligne d'en-têtes
  });

  return {
    ok: true,
    date_du_jour: date,
    fichier_de_donnees: {
      titre: info.properties.title,
      adresse: `https://docs.google.com/spreadsheets/d/${env.ID_DONNEES}/edit`,
      lignes,
    },
    onglet_du_jour: pl.trouve ? pl.onglet : null,
    planning_va_jusquau: dates[dates.length - 1] || null,
    dernieres_dates_au_planning: dates.slice(-5),
    referentiels: { personnes: ref.personnes.length, lieux: ref.lieux.length },
    chantiers_du_jour: pl.blocs.map(b => ({
      libelles: b.chantiers.map(c => c.libelle), villes: b.villes, client: b.client,
      responsable: b.responsable, equipe: b.equipe,
    })),
    anomalies: pl.anomalies,
    dernieres_erreurs: (await memoire(env, 'dernieres_erreurs')) || [],
    parametres: await parametres(env, true),
  };
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

function reponse(objet, ms, action, statut) {
  console.log(`${action || '?'} : ${ms} ms${objet.ok ? '' : ' — ' + objet.erreur}`);
  return new Response(JSON.stringify(objet), { status: statut || 200, headers: ENTETES });
}

/** Quelques mots sur la cause, affichés au téléphone : assez pour la reconnaître sur une capture d'écran. */
function resumeErreur(message) {
  const g = /Google Sheets (\d{3})/.exec(message);
  if (g) return `Google ${g[1]}`;
  return message.replace(/\s+/g, ' ').slice(0, 60);
}

export default {
  async fetch(requete, env) {
    if (requete.method === 'OPTIONS') return new Response(null, { headers: ENTETES });
    const debut = Date.now();
    const url = new URL(requete.url);
    let action = url.searchParams.get('action') || '';

    try {
      if (requete.method === 'GET') {
        if (action === 'compacter') return reponse(await compacter(env, url.searchParams.get('cle')), Date.now() - debut, 'compacter');
        if (action === 'verif') return reponse(await verification(env, url.searchParams.get('cle')), Date.now() - debut, 'verif');
        if (action === 'export') return reponse({ ok: true, journees: await journeesAExporter(env, url.searchParams.get('cle')) }, Date.now() - debut, 'export');
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
          res = { ok: true,
            lieux: ref.lieux.map(l => ({ libelle: l.libelle, type: l.type, zone: l.zone })),
            chantiers: (ref.chantiers || []).map(c => ({ libelle: c.libelle, client: c.client, commune: c.commune })),
            trajets: TRAJETS, repas: REPAS, depot: LIBELLE_DEPOT, parametres: parametresTelephone(await parametres(env)),
            personnesConnues: ref.personnes.filter(p => p.type !== 'PRESTATAIRE' && !estGenerique(p))
              .map(p => ({ libelle: p.libelle, actif: p.actif, cles: clesPersonne(p) })) };
          break;
        }
        case 'enregistrer_journee': res = await enregistrerJournee(env, moi, d, req.idEnvoi); break;
        case 'equipe': res = Object.assign({ ok: true }, await equipe(env, moi, d.date, d.auNomDe)); break;
        case 'valider': res = await validerJournee(env, moi, d.date, d.personne, d.decision, d.motif); break;
        case 'chef_journee': res = await chefCorrigerJournee(env, moi, d, req.idEnvoi); break;
        case 'enregistrer_interimaire': res = await enregistrerInterimaire(env, moi, d, req.idEnvoi); break;
        case 'rapport': res = Object.assign({ ok: true }, await lireRapport(env, moi, d.date, d.auNomDe)); break;
        case 'enregistrer_rapport': res = await enregistrerRapport(env, moi, d, req.idEnvoi); break;
        case 'ajouter_bl': res = await ajouterBl(env, moi, d, req.idEnvoi); break;
        case 'bureau_jour': res = Object.assign({ ok: true }, await bureauJour(env, moi, d.date)); break;
        case 'bureau_journee': res = await bureauEnregistrerJournee(env, moi, d); break;
        case 'bureau_valider': res = await bureauValider(env, moi, d); break;
        case 'bureau_import': res = await importerSuiviRh(env, moi); break;
        case 'bureau_controles': res = await bureauControles(env, moi); break;
        case 'bureau_justifier': res = await bureauJustifier(env, moi, d); break;
        case 'bureau_supprimer': res = await bureauSupprimerJournee(env, moi, d); break;
        case 'bureau_paie_jour': res = await bureauPaieJour(env, moi, d); break;
        case 'bureau_remplacant': res = await bureauRemplacant(env, moi, d); break;
        default: throw new ErreurMetier('Action inconnue.');
      }
      return reponse(res, Date.now() - debut, action);
    } catch (err) {
      if (err instanceof ErreurMetier) {
        return reponse({ ok: false, erreur: err.message, session: !!err.session }, Date.now() - debut, action);
      }
      console.log('ERREUR ' + (err && err.stack || err));
      const message = String(err && err.message || err);
      // La cause reste lisible sans les journaux de Cloudflare : sur la page de vérification
      // (20 dernières erreurs), et dans le JOURNAL quand Google accepte encore d'y écrire.
      const dernieres = (await memoire(env, 'dernieres_erreurs')) || [];
      await memoire(env, 'dernieres_erreurs', [{ quand: horodatage(), action, erreur: message.slice(0, 300) }, ...dernieres].slice(0, 20), 14 * 86400);
      if (err instanceof ErreurGoogleSaturee) {
        // 503 : le téléphone le prend comme une coupure passagère, garde l'envoi et le repasse tout seul.
        return reponse({ ok: false, erreur: "Google est saturé pour l'instant : réessaie dans une minute. Un envoi en cours repartira tout seul.", temporaire: true },
          Date.now() - debut, action, 503);
      }
      await journaliser(env, '', 'ERREUR_SERVEUR', action, message.slice(0, 500));
      return reponse({ ok: false, erreur: `Erreur du serveur (${resumeErreur(message)}). Réessaie plus tard.` }, Date.now() - debut, action);
    }
  },
};
