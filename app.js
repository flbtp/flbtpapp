/* FLBTP — Ma journée
 * Application web installable. Aucune dépendance : tout est ici.
 *
 * Principes :
 *  - chaque envoi porte un identifiant (idEnvoi) : rejoué après une coupure, il n'est pas compté deux fois ;
 *  - sans réseau, les envois partent dans une file d'attente gardée sur le téléphone, vidée dès que ça capte ;
 *  - le serveur refait tous les contrôles : ceux du téléphone ne servent qu'à prévenir plus tôt.
 */
'use strict';

/**
 * Numéro affiché en bas de l'accueil et de l'écran de connexion.
 * À augmenter à chaque dépôt de nouveaux fichiers sur GitHub : c'est le seul numéro à changer.
 */
const VERSION_APPLI = '30';

// ---------------------------------------------------------------------------
// Petits outils
// ---------------------------------------------------------------------------

const $ = (sel, racine = document) => racine.querySelector(sel);
const $$ = (sel, racine = document) => [...racine.querySelectorAll(sel)];
const APP = () => $('#app');

function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const stock = {
  lire(cle, defaut = null) { try { const v = localStorage.getItem('flbtp.' + cle); return v === null ? defaut : JSON.parse(v); } catch (e) { return defaut; } },
  ecrire(cle, v) { try { localStorage.setItem('flbtp.' + cle, JSON.stringify(v)); } catch (e) { toast("Mémoire du téléphone pleine : envoie tes données dès que possible."); } },
  effacer(cle) { try { localStorage.removeItem('flbtp.' + cle); } catch (e) { /* rien */ } },
};

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function aujourdhui() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateLongue(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  const t = new Date(a, m - 1, j).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function jourCourt(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  const t = new Date(a, m - 1, j).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function minutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

function duree(min) { return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`; }

let minuteurToast;
function toast(texte) {
  const t = $('#toast');
  t.textContent = texte; t.hidden = false;
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => { t.hidden = true; }, 4000);
}

const ICONES = {
  retour: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/></svg>',
  sortie: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  ok: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  horloge: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  attention: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5"/><path d="M12 18h.01"/></svg>',
  photo: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  horsReseau: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M10.7 5.1A15 15 0 0 1 22 8.8"/><path d="M5 12.6a10 10 0 0 1 5.2-2.7"/><path d="M14.8 10.3A10 10 0 0 1 19 12.6"/><path d="M12 20h.01"/></svg>',
};

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------

class HorsReseau extends Error {}
class RefusServeur extends Error {}

const LECTURES = ['accueil', 'equipe', 'rapport', 'referentiels', 'liste_personnes'];
const enVol = new Map();

/** Garde les 30 derniers appels pour l'écran de diagnostic (appui sur le numéro de version). */
function tracer(action, debut, issue) {
  const t = stock.lire('diag', []);
  t.unshift({ h: new Date().toLocaleTimeString('fr-FR'), action, ms: Date.now() - debut, issue });
  stock.ecrire('diag', t.slice(0, 30));
}

/** Deux écrans qui demandent la même chose au même moment partagent le même appel au lieu d'en lancer deux. */
function appel(action, donnees = {}, idEnvoi) {
  if (!LECTURES.includes(action)) return appelServeur(action, donnees, idEnvoi);
  const cle = action + JSON.stringify(donnees);
  if (enVol.has(cle)) return enVol.get(cle);
  const p = appelServeur(action, donnees, idEnvoi).finally(() => enVol.delete(cle));
  enVol.set(cle, p);
  return p;
}

/**
 * Un appel Apps Script passe par deux adresses : script.google.com exécute, puis redirige vers
 * script.googleusercontent.com où se trouve la réponse. La seconde échoue parfois ponctuellement.
 * On relance donc UNE fois un appel qui échoue vite. Sans risque : les lectures ne modifient rien,
 * et chaque envoi porte un identifiant (idEnvoi) que le serveur reconnaît s'il le reçoit deux fois.
 */
const DELAI_ESSAI_MS = 25000;

async function appelServeur(action, donnees, idEnvoi) {
  try {
    return await unEssai(action, donnees, idEnvoi, 1);
  } catch (e) {
    if (!(e instanceof HorsReseau) || !e.relancable || !navigator.onLine) throw e;
    await new Promise(ok => setTimeout(ok, 1200));
    return unEssai(action, donnees, idEnvoi, 2);
  }
}

function hote(url) { try { return new URL(url).hostname; } catch (e) { return '?'; } }

async function unEssai(action, donnees, idEnvoi, essai) {
  const session = stock.lire('session');
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), DELAI_ESSAI_MS);
  const debut = Date.now();
  const nom = essai > 1 ? `${action} (2e essai)` : action;
  let rep, r;
  try {
    rep = await fetch(SERVEUR, {
      method: 'POST',
      // text/plain : évite la requête préalable CORS, que le serveur Google ne sait pas traiter.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, donnees, jeton: session && session.jeton, idEnvoi }),
      signal: ctrl.signal,
    });
    if (!rep.ok) {
      // Le serveur peut expliquer son refus (503 : Google saturé) : on garde son message s'il y en a un.
      let explication = '';
      try { explication = (await rep.clone().json()).erreur || ''; } catch (e) { /* page d'erreur, pas du JSON */ }
      const err = new HorsReseau(explication || `Le serveur a renvoyé une erreur ${rep.status}.`);
      err.detail = `${rep.status} sur ${hote(rep.url)}`;
      err.relancable = rep.status === 404 || rep.status === 429 || rep.status >= 500;
      throw err;
    }
    r = await rep.json();
  } catch (e) {
    let err;
    if (e instanceof HorsReseau) err = e;
    else if (e.name === 'AbortError') { err = new HorsReseau(`Le serveur n'a pas répondu en ${DELAI_ESSAI_MS / 1000} secondes.`); err.detail = 'délai dépassé'; }
    else if (e instanceof SyntaxError) { err = new HorsReseau("Le serveur a renvoyé une page d'erreur au lieu d'une réponse."); err.detail = `page d'erreur sur ${rep ? hote(rep.url) : '?'}`; err.relancable = true; }
    // Une erreur Google arrive souvent sous forme de page illisible par le navigateur : elle ressemble à une coupure réseau.
    else if (navigator.onLine) { err = new HorsReseau("Le serveur n'a pas répondu correctement."); err.detail = `requête bloquée (${e.name})`; err.relancable = true; }
    else { err = new HorsReseau('Pas de réseau.'); err.detail = 'téléphone hors ligne'; }
    tracer(nom, debut, 'ÉCHEC — ' + err.detail);
    throw err;
  } finally {
    clearTimeout(minuteur);
  }
  tracer(nom, debut, r.ok ? 'ok' : 'refus — ' + r.erreur);
  if (!r.ok) {
    if (r.session) { deconnecter(); throw new RefusServeur(r.erreur); }
    throw new RefusServeur(r.erreur || 'Refusé par le serveur.');
  }
  return r;
}

// ---------------------------------------------------------------------------
// File d'attente hors réseau
// ---------------------------------------------------------------------------

function file() { return stock.lire('file', []); }

/** Envoie tout de suite ; sans réseau, met en file et renvoie { enAttente: true }. */
async function envoyer(action, donnees, libelle) {
  const element = { action, donnees, idEnvoi: uuid(), libelle, date: new Date().toISOString() };
  try {
    const r = await appel(action, donnees, element.idEnvoi);
    return { envoye: true, reponse: r };
  } catch (e) {
    if (e instanceof HorsReseau) {
      stock.ecrire('file', [...file(), element]);
      majBandeau();
      return { enAttente: true };
    }
    throw e;
  }
}

let videEnCours = false;
async function viderFile() {
  if (videEnCours || !stock.lire('session')) return;
  videEnCours = true;
  try {
    for (const el of file()) {
      try {
        await appel(el.action, el.donnees, el.idEnvoi);
        stock.ecrire('file', file().filter(x => x.idEnvoi !== el.idEnvoi));
      } catch (e) {
        if (e instanceof HorsReseau) break;          // on réessaiera plus tard
        // Refus définitif (journée déjà validée, par exemple) : on le retire et on prévient.
        stock.ecrire('file', file().filter(x => x.idEnvoi !== el.idEnvoi));
        stock.ecrire('refus', [...stock.lire('refus', []), { libelle: el.libelle, erreur: e.message }]);
      }
    }
  } finally {
    videEnCours = false;
    majBandeau();
  }
}

function majBandeau() {
  const n = file().length;
  const b = $('#bandeau');
  if (n) {
    b.textContent = `${n} envoi${n > 1 ? 's' : ''} en attente de réseau — partira tout seul`;
    b.hidden = false;
  } else {
    b.hidden = true;
  }
}

window.addEventListener('online', viderFile);
setInterval(viderFile, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) viderFile(); });

// ---------------------------------------------------------------------------
// Navigation (le bouton retour du téléphone fonctionne)
// ---------------------------------------------------------------------------

const ROUTES = {};
function aller(chemin) { if (location.hash === '#' + chemin) route(); else location.hash = chemin; }
window.addEventListener('hashchange', route);

function route() {
  mesurerEcran();
  clearTimeout(minuteurLent);
  const session = stock.lire('session');
  const [nom, ...reste] = location.hash.replace(/^#\/?/, '').split('/');
  const param = reste.join('/');                       // ex. « 2026-09-23/WILL%20F »
  if (!session) return ecranConnexion();
  const f = ROUTES[nom] || ROUTES.accueil;
  window.scrollTo(0, 0);
  ecranAffiche = nom || 'accueil';
  f(param);
}

/**
 * Un écran qui attend le serveur ne doit se dessiner que si l'utilisateur est toujours dessus.
 * Sinon une réponse tardive redessine l'écran quitté par-dessus celui où l'on est.
 */
function ecranCourant() {
  const ici = location.hash;
  return () => location.hash === ici;
}

let minuteurLent = null;
let ecranAffiche = '';

/**
 * Garde les dimensions de l'écran qu'on QUITTE : c'est lui qu'on cherche quand un défilement surprend.
 * On se fie au nom retenu au dernier affichage, pas à l'adresse, qui a déjà changé à cet instant.
 */
function mesurerEcran() {
  const ici = ecranAffiche;
  if (!ici || ici === 'diagnostic') return;
  stock.ecrire('mesures', {
    contenu: document.documentElement.scrollHeight,
    ecran: window.innerHeight,
    largeur: window.innerWidth,
    densite: window.devicePixelRatio,
  });
  stock.ecrire('dernierEcran', ici);
}

function chargement(texte = 'Chargement…') {
  clearTimeout(minuteurLent);
  const ecran = ecranCourant();
  APP().innerHTML = `<div class="chargement"><div class="centre"><p>${esc(texte)}</p><p class="discret" id="lent" hidden>Le serveur est lent à répondre, patiente encore un peu.</p></div></div>`;
  // Ce minuteur ne concerne que CE chargement : il ne doit pas se déclencher sur l'écran suivant.
  minuteurLent = setTimeout(() => { const l = $('#lent'); if (l && ecran()) l.hidden = false; }, 4000);
}

function deconnecter() {
  stock.effacer('session');
  ['accueil', 'jours', 'dernierEnvoi'].forEach(stock.effacer);
  aller('/');
}

// ---------------------------------------------------------------------------
// Référentiels (gardés sur le téléphone pour fonctionner sans réseau)
// ---------------------------------------------------------------------------

const SIX_HEURES = 6 * 3600 * 1000;

/** Communes, trajets, repas : changent rarement. Redemandés au serveur au plus toutes les 6 heures. */
async function referentiels() {
  const garde = stock.lire('ref');
  if (garde && Date.now() - (garde._recu || 0) < SIX_HEURES) return garde;
  const frais = appel('referentiels').then(r => { r._recu = Date.now(); stock.ecrire('ref', r); return r; });
  if (garde) { frais.catch(() => { /* on garde la version du téléphone */ }); return garde; }
  return frais;
}

function age(donnee) { return Date.now() - ((donnee && donnee._recu) || 0); }

// ---------------------------------------------------------------------------
// Écran : connexion
// ---------------------------------------------------------------------------

async function ecranConnexion() {
  let personnes = stock.lire('personnes');
  let choisi = stock.lire('dernierNom');
  let code = '';
  let enCours = false;
  let erreur = '';

  const dessiner = () => {
    if (!choisi) {
      APP().innerHTML = `
        <img class="logo" src="logo.png" alt="Freyssinet-Laligand BTP">
        <div><h1>Ma journée</h1><p class="discret">Saisie des heures de chantier</p></div>
        <div class="champ"><span class="etiquette">Qui es-tu ?</span>
          ${!personnes ? '<p class="discret">Connexion au serveur…</p>'
            : personnes.length ? `<div class="liste-noms">${personnes.map(p => `<button type="button" data-nom="${esc(p)}">${esc(p)}</button>`).join('')}</div>`
            : '<p class="discret">Aucune personne n\'a encore de code. Demande à Quentin.</p>'}
        </div>
        ${erreur ? `<p class="erreur-champ">${esc(erreur)}</p>` : ''}
        <p class="version pied">Version ${esc(VERSION_APPLI)}</p>`;
      $$('[data-nom]').forEach(b => b.onclick = () => { choisi = b.dataset.nom; code = ''; erreur = ''; dessiner(); });
      return;
    }
    const complet = code.length === 4;
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Changer de nom" id="changer" ${enCours ? 'disabled' : ''}>${ICONES.retour}</button>
        <div><p class="discret">Bonjour</p><h1>${esc(choisi)}</h1></div>
      </div>
      <div class="champ">
        <span class="etiquette" id="lib-code">Ton code à 4 chiffres</span>
        <div class="cases-code" aria-labelledby="lib-code">
          ${[0, 1, 2, 3].map(i => `<div class="${i < code.length ? 'pleine' : (i === code.length ? 'active' : '')}">${i < code.length ? '•' : ''}</div>`).join('')}
        </div>
        <p class="discret">Donné par Quentin. Pas ton nom ? Touche la flèche.</p>
        <p class="erreur-champ" id="erreur" role="alert">${esc(erreur)}</p>
      </div>
      <div class="pied">
        <div class="clavier" ${enCours ? 'aria-disabled="true" style="opacity:.4;pointer-events:none"' : ''}>
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-c="${n}">${n}</button>`).join('')}
          <button type="button" class="vide" tabindex="-1" aria-hidden="true"></button>
          <button type="button" data-c="0">0</button>
          <button type="button" data-c="x" aria-label="Effacer">⌫</button>
        </div>
        <button class="btn btn-principal" type="button" id="valider" ${complet && !enCours ? '' : 'disabled'}>
          ${enCours ? 'Vérification du code…' : 'Se connecter'}</button>
      </div>`;
    $('#changer').onclick = () => { choisi = null; code = ''; erreur = ''; stock.effacer('dernierNom'); dessiner(); };
    $$('[data-c]').forEach(b => b.onclick = () => taper(b.dataset.c));
    $('#valider').onclick = valider;
  };

  const taper = c => {
    if (enCours) return;
    erreur = '';
    if (c === 'x') code = code.slice(0, -1);
    else if (code.length < 4) code += c;
    dessiner();
  };

  const valider = async () => {
    if (enCours || code.length !== 4) return;
    enCours = true; dessiner();
    try {
      const r = await appel('connexion', { personne: choisi, code });
      // Ce qui reste d'une session précédente n'a rien à faire ici : on repart propre.
      ['accueil', 'jours', 'ref', 'dernierEnvoi'].forEach(stock.effacer);
      stock.ecrire('session', { jeton: r.jeton, personne: r.personne, type: r.type, prenom: r.prenom });
      stock.ecrire('dernierNom', choisi);
      aller('/accueil');
    } catch (e) {
      enCours = false; code = '';
      erreur = e instanceof HorsReseau ? 'Connexion au serveur impossible. Vérifie ton réseau et réessaie.' : e.message;
      dessiner();
    }
  };

  dessiner();
  try {
    const r = await appel('liste_personnes');
    personnes = r.personnes;
    stock.ecrire('personnes', personnes);
    if (!choisi && !stock.lire('session')) dessiner();
  } catch (e) {
    if (!personnes) { erreur = e instanceof HorsReseau ? 'Connexion au serveur impossible. Vérifie ton réseau et réessaie.' : e.message; if (!choisi) dessiner(); }
  }
}

// ---------------------------------------------------------------------------
// Journées gardées sur le téléphone, par date (les 10 plus récentes)
// ---------------------------------------------------------------------------

function jourGarde(date) {
  const acc = stock.lire('accueil');
  if (acc && acc.date === date) return acc;
  return stock.lire('jours', {})[date] || null;
}

/**
 * Corrige tout de suite le résumé du chef gardé sur le téléphone, pour que l'accueil affiche
 * le bon état sans attendre le serveur (qui est redemandé juste après, via oublierJour).
 */
function majChef(date, modif) {
  const acc = stock.lire('accueil');
  if (!acc || acc.date !== date || !acc.chef) return;
  Object.assign(acc.chef, modif);
  stock.ecrire('accueil', acc);
}

/** Après une action qui change l'état du jour, la copie du téléphone doit être redemandée. */
function oublierJour(date) {
  const jours = stock.lire('jours', {});
  if (jours[date]) { jours[date]._recu = 0; stock.ecrire('jours', jours); }
  const acc = stock.lire('accueil');
  if (acc && acc.date === date) { acc._recu = 0; stock.ecrire('accueil', acc); }
}

function garderJour(a) {
  if (!a || !a.date) return;
  if (!a._recu) a._recu = Date.now();
  const jours = stock.lire('jours', {});
  jours[a.date] = a;
  const dates = Object.keys(jours).sort().reverse();
  dates.slice(10).forEach(d => delete jours[d]);
  stock.ecrire('jours', jours);
  if (a.date === aujourdhui()) stock.ecrire('accueil', a);
}

// ---------------------------------------------------------------------------
// Écran : accueil
// ---------------------------------------------------------------------------

/** À l'écran, le numéro du chantier n'apporte rien : « 0002 · IGUACEL / JUGEALS » devient « IGUACEL / JUGEALS ». */
function nomCourt(libelle) {
  return String(libelle || '').replace(/^\s*\d+\s*·\s*/, '');
}

/** Le libellé complet du chantier (numéro, client, commune) ; les communes seules avant la bascule. */
function libellesChantiers(bloc) {
  if (!bloc) return [];
  return (bloc.chantiers && bloc.chantiers.length) ? bloc.chantiers.map(c => c.libelle) : (bloc.villes || []);
}

const LIBELLES_STATUT = {
  SAISIE: ['Envoyée', 'saisie'], SIGNALEE: ['Envoyée', 'saisie'], VALIDEE_CHEF: ['Validée', 'ok'],
  VALIDEE_BUREAU: ['Validée', 'ok'], EXPORTEE: ['Validée', 'ok'], NON_SAISIE: ['À saisir', 'a-faire'], A_VENIR: ['—', ''],
};

ROUTES.accueil = async function () {
  const toujoursIci = ecranCourant();
  const session = stock.lire('session');
  const date = aujourdhui();
  let a = stock.lire('accueil');
  if (a && a.date !== date) a = null;
  if (a) dessinerAccueil(a, session); else chargement();
  if (a && age(a) < 90 * 1000) { viderFile(); return; }        // à jour : inutile de redemander
  try {
    const frais = await appel('accueil', { date });
    frais._recu = Date.now();
    garderJour(frais);
    if (toujoursIci()) dessinerAccueil(frais, session);
    a = frais;
  } catch (e) {
    if (!a && toujoursIci()) {
      const texte = e instanceof HorsReseau
        ? `${e.message} Le planning n'a pas pu être chargé, mais tu peux quand même saisir ta journée : elle partira dès que possible.`
        : e.message;
      APP().innerHTML = `
        <div class="entete"><div><p class="discret">Bonjour ${esc(session.prenom || session.personne)}</p><h1>${esc(dateLongue(date))}</h1></div></div>
        <div class="alerte jaune">${ICONES.horsReseau}<span>${esc(texte)}</span></div>
        <div class="pied"><button class="btn btn-principal" type="button" onclick="aller('/saisie/${date}')">Saisir ma journée</button></div>`;
    }
  }
  viderFile();
};

/** Ce que le chef doit voir sans ouvrir d'écran : ce qui l'attend, et ce qui est déjà fait. */
function resumeChef(a, moi) {
  const c = a.chef || { aValider: 0, manquants: [], validees: 0, rapportEnvoye: false };
  // Une seule ligne, séparée par des points : l'accueil du chef est déjà chargé.
  const lignes = [];
  if (c.aValider) lignes.push(`<b>${c.aValider} à valider</b>`);
  const autres = c.manquants.filter(n => n !== moi);
  if (c.manquants.includes(moi)) lignes.push('ta journée manque');
  if (autres.length) lignes.push(`${autres.length} sans saisie (${esc(autres.join(', '))})`);
  if (!c.rapportEnvoye) lignes.push('rapport à envoyer');
  const rienAFaire = !lignes.length;
  if (rienAFaire) lignes.push(`Équipe validée (${c.validees}) et rapport envoyé. Rien à faire.`);

  return `
    <div class="alerte ${rienAFaire ? 'vert' : (c.aValider ? 'jaune' : 'rouge')}">
      ${rienAFaire ? ICONES.ok : ICONES.attention}<span>${lignes.join(' · ')}</span>
    </div>
    <div class="duo">
      <button class="btn ${c.rapportEnvoye ? 'btn-sombre' : 'btn-principal'} btn-petit" type="button" onclick="aller('/rapport/${a.date}')">Rapport de chantier</button>
      <button class="btn ${c.aValider ? 'btn-principal' : 'btn-sombre'} btn-petit" type="button" onclick="aller('/equipe/${a.date}')">Valider mon équipe</button>
    </div>`;
}

function dessinerAccueil(a, session) {
  const j = a.journee;
  const refus = stock.lire('refus', []);
  const bloc = a.bloc;

  let action;
  if (!j) action = `<button class="btn btn-principal" type="button" onclick="aller('/saisie/${a.date}')">Saisir ma journée</button>`;
  else if (j.enAttente) action = `<div class="alerte jaune">${ICONES.horloge}<span>Journée gardée sur ton téléphone : ${esc(j.hEmbauche)}–${esc(j.hPause)} · ${esc(j.hReprise)}–${esc(j.hDebauche)}. Elle partira dès que possible.</span></div>`;
  else if (j.modifiable) action = `<div class="alerte vert">${ICONES.ok}<span>${j.statut === 'VALIDEE_CHEF' ? 'Journée validée' : 'Journée envoyée'} : ${esc(j.hEmbauche)}–${esc(j.hPause)} · ${esc(j.hReprise)}–${esc(j.hDebauche)}</span></div>
    <button class="btn btn-clair btn-petit" type="button" onclick="aller('/saisie/${a.date}')">Corriger ma journée</button>`;
  else if (j.parBureau && a.estResponsable) action = `<div class="alerte vert">${ICONES.ok}<span>Journée validée par le bureau. Pour la modifier, adresse-toi au bureau.</span></div>`;
  else action = `<div class="alerte vert">${ICONES.ok}<span>Journée validée. Pour une correction, vois avec ton chef ou le bureau.</span></div>`;

  // Le bureau ne saisit pas d'heures : son accueil mène directement à son écran.
  if (a.estBureau && !a.bloc && !j) {
    APP().innerHTML = `
      <div class="entete">
        <img class="embleme" src="embleme.png" alt="" aria-hidden="true">
        <div><p class="discret">Bonjour ${esc(session.prenom || session.personne)}</p><h1>${esc(dateLongue(a.date))}</h1></div>
        <button class="icone-btn" type="button" aria-label="Se déconnecter" id="sortir">${ICONES.sortie}</button>
      </div>
      <section class="bloc"><p>Contrôle des journées et envoi dans le Suivi RH.</p></section>
      <button class="btn btn-principal" type="button" onclick="aller('/bureau/${a.date}')">Écran bureau</button>
      <div class="pied"><button type="button" class="version" onclick="aller('/diagnostic')">Version ${esc(VERSION_APPLI)}</button></div>`;
    $('#sortir').onclick = () => { if (confirm('Se déconnecter de ce téléphone ?')) { stock.effacer('dernierNom'); deconnecter(); } };
    return;
  }

  APP().innerHTML = `
    <div class="entete">
      <img class="embleme" src="embleme.png" alt="" aria-hidden="true">
      <div><p class="discret">Bonjour ${esc(session.prenom || session.personne)}</p><h1>${esc(dateLongue(a.date))}</h1></div>
      <button class="icone-btn" type="button" aria-label="Se déconnecter" id="sortir">${ICONES.sortie}</button>
    </div>
    ${refus.length ? `<div class="alerte rouge">${ICONES.attention}<span>${refus.map(r => `<b>${esc(r.libelle)}</b> refusé : ${esc(r.erreur)}`).join('<br>')}</span></div>` : ''}
    ${bloc ? `
      <section class="bloc">
        <div class="bloc-titre">Prévu au planning</div>
        <div>${libellesChantiers(bloc).map(c => `<div class="chantier">${esc(nomCourt(c))}</div>`).join('')}</div>
        ${bloc.taches ? `<div class="sep taches-jour"><span class="sous">Tâches du jour</span><p class="a-faire">${esc(bloc.taches)}</p></div>` : ''}
        <details class="sep depliant">
          <summary>Équipe (${bloc.equipe.length})</summary>
          ${bloc.equipe.map(n => `<div class="equipier">
            <span class="qui">${esc(n)}${n === bloc.responsable ? ' <span class="discret">(chef)</span>' : ''}</span>
            <span class="quoi"></span>
          </div>`).join('')}
        </details>
      </section>`
      : `<section class="bloc"><p>${a.planningTrouve ? "Tu n'es pas au planning aujourd'hui." : "Pas de planning pour aujourd'hui."}</p>
         <p class="discret">${a.planningTrouve ? 'Si tu as travaillé, saisis quand même ta journée.'
           : 'Saisis ta journée en choisissant tes chantiers : tu pourras ensuite faire le rapport et valider ceux qui étaient avec toi.'}</p></section>`}
    ${action}
    ${a.estResponsable ? resumeChef(a, session.personne) : ''}
    ${a.estBureau ? `<button class="btn btn-clair btn-petit" type="button" onclick="aller('/bureau/${a.date}')">Écran bureau</button>` : ''}
    <div class="pied">
      <span class="sous">Ma semaine</span>
      <div class="semaine">
        ${a.semaine.map(s => {
          const [lib, cls] = LIBELLES_STATUT[s.statut] || ['—', ''];
          // Une journée validée d'office (celle du chef) reste corrigeable : le serveur le dit avec « modifiable ».
          const cliquable = ['NON_SAISIE', 'SIGNALEE', 'SAISIE'].includes(s.statut) || s.modifiable === true;
          return `<button type="button" class="jour ${cls}" ${cliquable ? `data-jour="${s.date}"` : 'disabled'} aria-label="${esc(dateLongue(s.date))} : ${esc(lib)}">
            <b>${esc(jourCourt(s.date))}</b>${cls === 'ok' ? ICONES.ok : '<span style="height:18px"></span>'}<small>${esc(lib)}</small></button>`;
        }).join('')}
      </div>
      <button type="button" class="version" onclick="aller('/diagnostic')">Version ${esc(VERSION_APPLI)}</button>
    </div>`;
  $('#sortir').onclick = () => { if (confirm('Se déconnecter de ce téléphone ?')) { stock.effacer('dernierNom'); deconnecter(); } };
  $$('[data-jour]').forEach(b => b.onclick = () => aller('/saisie/' + b.dataset.jour));
  if (refus.length) stock.effacer('refus');
}

// ---------------------------------------------------------------------------
// Formulaire de journée (partagé par la saisie et l'ajout d'intérimaire)
// ---------------------------------------------------------------------------

/**
 * Réglages venus de l'onglet PARAMETRES (par le serveur, avec les référentiels) : horaires proposés
 * par défaut, durée maximale d'une journée et des tâches avant chantier. Valeurs de secours sinon.
 */
function reglages() {
  const p = (stock.lire('ref') || {}).parametres || {};
  return {
    horaires: p.horaires || { hEmbauche: '08:00', hPause: '12:00', hReprise: '13:30', hDebauche: '17:30' },
    journeeMaxMin: p.journeeMaxMin || 12 * 60,
    tachesAvantMaxMin: p.tachesAvantMaxMin || 240,
  };
}

function etatInitial(date, journee, bloc) {
  const j = journee || {};
  const chantiers = j.chantiers && j.chantiers.length ? j.chantiers : ((bloc && bloc.lieux) || []);
  return {
    date,
    chantiers: [...chantiers],
    lieuEmbauche: j.lieuEmbauche || chantiers[0] || '',
    // « CHANTIER = 1:30 » : on relit des minutes, jamais des pourcentages.
    parts: (() => {
      const p = {};
      String(j.repartition || '').split(' ; ').filter(Boolean).forEach(x => {
        const i = x.lastIndexOf(' = ');
        if (i > 0) p[x.slice(0, i)] = minutes(x.slice(i + 3)) || 0;
      });
      return p;
    })(),
    hEmbauche: j.hEmbauche || reglages().horaires.hEmbauche,
    hPause: j.hPause || reglages().horaires.hPause,
    hReprise: j.hReprise || reglages().horaires.hReprise,
    hDebauche: j.hDebauche || reglages().horaires.hDebauche,
    trajet: j.trajet || '',
    avecTaches: j.tachesSuppMin ? true : (journee ? false : null),
    tachesSupp: j.tachesSupp || '', tachesSuppMin: j.tachesSuppMin || '',
    repas: j.repas || '',
    nomInterimaire: j.nomInterimaire || '', agence: j.agence || '',
  };
}

/**
 * Minutes par chantier. Les premiers sont réglés au quart d'heure, le dernier prend le reste :
 * le total tombe toujours juste, sans que personne ait à faire l'addition.
 */
function partsMinutes(e, total) {
  const n = e.chantiers.length;
  const debut = e.chantiers.slice(0, n - 1).map(c => {
    const v = e.parts[c];
    return v === undefined ? Math.round(total / n / 15) * 15 : v;
  });
  return [...debut, total - debut.reduce((a, b) => a + b, 0)];
}

/** Réaffiche les heures de chaque chantier après un changement d'horaires. */
function majRepartition(e, total) {
  const sorties = $$('[data-repartition]');
  if (!sorties.length) return;
  const parts = partsMinutes(e, total);
  sorties.forEach((o, i) => {
    o.textContent = duree(Math.max(0, parts[i]));
    o.className = parts[i] < 0 ? 'erreur-champ' : '';
  });
  const trop = $('#trop-reparti');
  if (trop) trop.hidden = !parts.some(m => m < 0);
}

function choix(nom, options, valeur, n) {
  return `<div class="choix" style="--n:${n || options.length}" role="group">
    ${options.map(([v, lib]) => `<button type="button" data-choix="${nom}" data-v="${esc(v)}" aria-pressed="${String(valeur) === String(v)}">${esc(lib)}</button>`).join('')}
  </div>`;
}

/**
 * options.chantiersPossibles : les chantiers du chef, à cocher (intérimaire : au moins un) au lieu de
 * la liste de tous les chantiers. options.nomVerrouille : correction d'un intérimaire, son nom ne change pas.
 */
function formulaireJournee(e, ref, interimaire, options = {}) {
  const communes = ref.lieux.filter(l => l.type !== 'DEPOT');
  const chantiers = ref.chantiers && ref.chantiers.length ? ref.chantiers : communes.map(l => ({ libelle: l.libelle }));
  const total = (() => {
    const [a, b, c, d] = [e.hEmbauche, e.hPause, e.hReprise, e.hDebauche].map(minutes);
    if ([a, b, c, d].some(x => x === null) || !(a < b && b <= c && c < d)) return null;
    return (b - a) + (d - c);
  })();
  const durees = [10, 15, 30];
  const autreDuree = e.tachesSuppMin && !durees.includes(Number(e.tachesSuppMin));

  return `
    ${interimaire ? `
    <section class="bloc">
      <div class="champ"><label for="nomInterimaire">Nom de l'intérimaire</label>
        <input id="nomInterimaire" type="text" autocomplete="off" value="${esc(e.nomInterimaire)}" data-champ="nomInterimaire" ${options.nomVerrouille ? 'readonly' : ''}></div>
      <div class="champ"><label for="agence">Agence</label>
        <input id="agence" type="text" autocomplete="off" value="${esc(e.agence)}" data-champ="agence" placeholder="Randstad, Adéquat, Temporis…"></div>
    </section>` : ''}

    <section class="bloc">
      ${options.chantiersPossibles ? `
      <div class="champ">
        <span class="etiquette">Chantiers (au moins un)</span>
        <div class="coches">${options.chantiersPossibles.map(c => `<label class="case"><input type="checkbox" data-coche-chantier="${esc(c)}" ${e.chantiers.includes(c) ? 'checked' : ''}> ${esc(nomCourt(c))}</label>`).join('')}</div>
      </div>` : `
      <div class="champ">
        <span class="etiquette">${e.chantiers.length > 1 ? 'Chantiers' : 'Chantier'}</span>
        <div class="chips">${e.chantiers.map(c => `<span class="chip">${esc(nomCourt(c))}<button type="button" data-retirer="${esc(c)}" aria-label="Retirer ${esc(c)}">×</button></span>`).join('') || '<span class="discret">Aucun chantier choisi</span>'}</div>
        <select id="ajoutChantier" aria-label="Ajouter un chantier">
          <option value="">+ Ajouter un chantier</option>
          ${chantiers.filter(c => !e.chantiers.includes(c.libelle)).map(c => `<option value="${esc(c.libelle)}">${esc(nomCourt(c.libelle))}</option>`).join('')}
        </select>
      </div>`}
      <div class="champ">
        <label for="lieuEmbauche">${interimaire ? 'Où a-t-il embauché ?' : 'Où as-tu embauché ?'}</label>
        <select id="lieuEmbauche" data-champ="lieuEmbauche">
          ${e.lieuEmbauche ? '' : '<option value="">Choisir…</option>'}
          ${e.chantiers.length ? `<optgroup label="Sur le chantier">${e.chantiers.map(c => `<option value="${esc(c)}" ${c === e.lieuEmbauche ? 'selected' : ''}>${esc(nomCourt(c))}</option>`).join('')}</optgroup>` : ''}
          <optgroup label="Au dépôt"><option value="${esc(ref.depot)}" ${e.lieuEmbauche === ref.depot ? 'selected' : ''}>Dépôt d'Objat</option></optgroup>
          <optgroup label="Ailleurs (fournisseur, autre commune)">
            ${communes.filter(l => !e.chantiers.includes(l.libelle)).map(l => `<option ${l.libelle === e.lieuEmbauche ? 'selected' : ''}>${esc(l.libelle)}</option>`).join('')}
          </optgroup>
        </select>
      </div>
    </section>

    ${e.chantiers.length > 1 && total !== null ? `
    <section class="bloc">
      <h2>Temps passé sur chaque chantier</h2>
      <p class="discret">Par quarts d'heure. Le dernier chantier prend automatiquement ce qui reste.</p>
      ${e.chantiers.map((c, i) => {
        const parts = partsMinutes(e, total);
        const dernier = i === e.chantiers.length - 1;
        return `<div class="ligne">
          <div class="ligne-tete"><span>${esc(nomCourt(c))}</span>
            <div class="pas">
              ${dernier ? '' : `<button type="button" data-part="${i}" data-sens="-1" aria-label="Moins un quart d'heure">−</button>`}
              <output data-repartition="${i}" class="${parts[i] < 0 ? 'erreur-champ' : ''}">${duree(Math.max(0, parts[i]))}</output>
              ${dernier ? '' : `<button type="button" data-part="${i}" data-sens="1" aria-label="Plus un quart d'heure">+</button>`}
            </div>
          </div>
          ${dernier ? '<p class="discret">Le reste de la journée.</p>' : ''}
        </div>`;
      }).join('')}
      <p class="erreur-champ" id="trop-reparti" ${partsMinutes(e, total).some(m => m < 0) ? '' : 'hidden'}>Tu as réparti plus que ta journée : enlève du temps ailleurs.</p>
    </section>` : ''}

    <section class="bloc">
      <h2>Horaires</h2>
      <div class="grille-2">
        ${[['hEmbauche', 'Embauche'], ['hPause', 'Pause repas'], ['hReprise', 'Reprise'], ['hDebauche', 'Débauche']]
          .map(([k, lib]) => `<div class="champ"><label for="${k}" class="sous">${lib}</label><input id="${k}" type="time" value="${esc(e[k])}" data-champ="${k}"></div>`).join('')}
      </div>
      <div class="total"><span class="discret">Total</span><b id="total">${total === null ? '—' : duree(total)}</b></div>
    </section>

    <section class="bloc">
      <h2>Trajet</h2>
      ${choix('trajet', [['PASSAGER', 'Passager'], ['FOURGON', 'Fourgon'], ['3T5', '3T5'], ['PL', 'PL']], e.trajet)}
    </section>

    <section class="bloc">
      <h2>Tâches avant chantier</h2>
      <p class="discret">Chargement au dépôt, plein, attelage…</p>
      ${choix('avecTaches', [['false', 'Non'], ['true', 'Oui']], e.avecTaches === null ? '' : String(e.avecTaches))}
      ${e.avecTaches ? `
        <div class="champ"><label for="tachesSupp" class="sous">Quoi ?</label>
          <input id="tachesSupp" type="text" value="${esc(e.tachesSupp)}" data-champ="tachesSupp" placeholder="Ex. chargement GNT 18 t"></div>
        <div class="champ"><span class="sous">Combien de temps ?</span>
          ${choix('tachesSuppMin', [...durees.map(d => [d, d + ' min']), ['autre', 'Autre']], autreDuree ? 'autre' : e.tachesSuppMin, 4)}
          ${autreDuree || e.tachesSuppMin === 'autre' ? `<input type="number" inputmode="numeric" min="1" max="${reglages().tachesAvantMaxMin}" aria-label="Durée en minutes" placeholder="Minutes" value="${autreDuree ? esc(e.tachesSuppMin) : ''}" data-champ="tachesSuppMinAutre">` : ''}
        </div>` : ''}
    </section>

    <section class="bloc">
      <h2>Repas du midi</h2>
      ${choix('repas', [['AUCUN', 'Aucun'], ['PANIER', 'Panier'], ['RESTAURANT', 'Restaurant']], e.repas)}
    </section>
    <p class="erreur-champ" id="erreur" role="alert"></p>`;
}

/** Branche les champs du formulaire sur l'état ; redessine seulement si la structure change. */
function brancherFormulaire(e, redessiner) {
  $$('[data-champ]').forEach(el => {
    el.addEventListener('input', () => {
      const k = el.dataset.champ;
      if (k === 'tachesSuppMinAutre') e.tachesSuppMin = el.value; else e[k] = el.value;
      const [a, b, c, d] = [e.hEmbauche, e.hPause, e.hReprise, e.hDebauche].map(minutes);
      const bon = ![a, b, c, d].some(x => x === null) && a < b && b <= c && c < d;
      const total = bon ? (b - a) + (d - c) : null;
      const t = $('#total');
      if (t) t.textContent = total === null ? '—' : duree(total);
      // La répartition dépend du total : elle doit suivre le changement d'horaires, sans redessiner
      // l'écran, ce qui interromprait la saisie en cours.
      if (total !== null) majRepartition(e, total);
    });
  });
  $$('[data-choix]').forEach(b => b.onclick = () => {
    const k = b.dataset.choix; let v = b.dataset.v;
    if (k === 'avecTaches') { e.avecTaches = v === 'true'; if (!e.avecTaches) { e.tachesSupp = ''; e.tachesSuppMin = ''; } }
    else if (k === 'tachesSuppMin') e.tachesSuppMin = v === 'autre' ? 'autre' : Number(v);
    else e[k] = v;
    redessiner();
  });
  $$('[data-part]').forEach(b => b.onclick = () => {
    const [a2, b2, c2, d2] = [e.hEmbauche, e.hPause, e.hReprise, e.hDebauche].map(minutes);
    const total = (b2 - a2) + (d2 - c2);
    const i = +b.dataset.part;
    const actuelles = partsMinutes(e, total);
    e.parts[e.chantiers[i]] = Math.max(0, actuelles[i] + 15 * Number(b.dataset.sens));
    redessiner();
  });
  const ajout = $('#ajoutChantier');
  if (ajout) ajout.onchange = () => {
    if (ajout.value) { e.chantiers.push(ajout.value); if (!e.lieuEmbauche) e.lieuEmbauche = ajout.value; redessiner(); }
  };
  $$('[data-coche-chantier]').forEach(b => b.onchange = () => {
    const tous = $$('[data-coche-chantier]').map(x => x.dataset.cocheChantier);
    const coches = new Set($$('[data-coche-chantier]').filter(x => x.checked).map(x => x.dataset.cocheChantier));
    e.chantiers = tous.filter(c => coches.has(c));            // dans l'ordre du planning
    if (!e.chantiers.includes(e.lieuEmbauche) && !(e.lieuEmbauche && !tous.includes(e.lieuEmbauche))) e.lieuEmbauche = e.chantiers[0] || '';
    redessiner();
  });
  $$('[data-retirer]').forEach(b => b.onclick = () => {
    e.chantiers = e.chantiers.filter(c => c !== b.dataset.retirer);
    if (e.lieuEmbauche === b.dataset.retirer) e.lieuEmbauche = e.chantiers[0] || '';
    redessiner();
  });
}

/** Mêmes règles que le serveur, pour prévenir avant l'envoi. */
function controler(e, interimaire) {
  if (interimaire && e.nomInterimaire.trim().length < 3) return "Indique le nom de l'intérimaire.";
  if (!e.chantiers.length) return 'Choisis au moins un chantier.';
  if (!e.lieuEmbauche) return "Indique où tu as embauché.";
  const h = [e.hEmbauche, e.hPause, e.hReprise, e.hDebauche].map(minutes);
  if (h.some(x => x === null)) return 'Remplis les quatre horaires.';
  const [a, b, c, d] = h;
  if (!(a < b && b <= c && c < d)) return 'Les horaires doivent se suivre : embauche, pause, reprise, débauche.';
  const max = reglages().journeeMaxMin;
  if ((b - a) + (d - c) > max) return `Plus de ${String(max / 60).replace('.', ',')} heures dans la journée : vérifie les horaires.`;
  if (!e.trajet) return 'Choisis le trajet.';
  if (e.avecTaches === null) return 'Indique si tu as fait des tâches avant le chantier.';
  if (e.avecTaches) {
    if (!e.tachesSupp.trim()) return 'Décris la tâche avant chantier.';
    const m = Number(e.tachesSuppMin);
    if (!(m > 0 && m <= reglages().tachesAvantMaxMin)) return `Indique la durée de la tâche (en minutes, ${reglages().tachesAvantMaxMin} au plus).`;
  }
  if (!e.repas) return 'Choisis le repas du midi.';
  if (e.chantiers.length > 1) {
    const total = (b - a) + (d - c);
    if (partsMinutes(e, total).some(m => m < 0)) return 'Tu as réparti plus de temps que ta journée.';
  }
  return null;
}

function donneesJournee(e) {
  return {
    date: e.date, chantiers: e.chantiers, lieuEmbauche: e.lieuEmbauche,
    repartition: (() => {
      const [a, b, c, d] = [e.hEmbauche, e.hPause, e.hReprise, e.hDebauche].map(minutes);
      if ([a, b, c, d].some(x => x === null)) return [];
      const total = (b - a) + (d - c);
      const m = partsMinutes(e, total);
      return e.chantiers.map((ch, i) => ({ chantier: ch, part: Math.max(0, m[i]) }));
    })(),
    hEmbauche: e.hEmbauche, hPause: e.hPause, hReprise: e.hReprise, hDebauche: e.hDebauche,
    trajet: e.trajet, tachesSupp: e.avecTaches ? e.tachesSupp.trim() : '',
    tachesSuppMin: e.avecTaches ? Number(e.tachesSuppMin) : 0, repas: e.repas,
    nomInterimaire: e.nomInterimaire.trim(), agence: e.agence.trim(),
  };
}

// ---------------------------------------------------------------------------
// Écran : saisie de ma journée
// ---------------------------------------------------------------------------

ROUTES.saisie = async function (date) {
  date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : aujourdhui();
  const toujoursIci = ecranCourant();
  chargement();
  let a = jourGarde(date);
  let ref;
  try { ref = await referentiels(); } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;
  if (a) {
    // Déjà connue du téléphone : affichage immédiat. Mise à jour discrète seulement si la copie date de plus de 5 minutes.
    if (age(a) > 5 * 60 * 1000) {
      appel('accueil', { date }).then(frais => { frais._recu = Date.now(); garderJour(frais); })
        .catch(() => { /* on garde ce qu'on a */ });
    }
  } else {
    try {
      a = await appel('accueil', { date });
      a._recu = Date.now();
      garderJour(a);
      if (!toujoursIci()) return;
    } catch (err) {
      if (!toujoursIci()) return;
      // Sans réseau, on laisse saisir la journée du jour. Pour un autre jour, on ne montre JAMAIS un formulaire vide :
      // il ferait croire que les heures déjà envoyées sont perdues.
      if (!(err instanceof HorsReseau && date === aujourdhui())) {
        return erreurEcran(err, `Impossible de charger ta journée du ${dateLongue(date).toLowerCase()}. Tes heures déjà envoyées ne sont pas perdues : réessaie dans un instant.`);
      }
      a = null;
    }
  }
  if (a && a.journee && !a.journee.modifiable) { toast('Journée déjà validée.'); return aller('/accueil'); }

  const e = etatInitial(date, a && a.journee, a && a.bloc);
  const dessiner = () => {
    const y = window.scrollY;
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="history.back()">${ICONES.retour}</button>
        <div><h1>Ma journée</h1><p class="discret">${esc(dateLongue(date))}</p></div>
      </div>
      ${formulaireJournee(e, ref, false)}
      <div class="pied"><button class="btn btn-principal" type="button" id="envoyer">Envoyer ma journée</button></div>`;
    brancherFormulaire(e, dessiner);
    $('#envoyer').onclick = soumettre;
    window.scrollTo(0, y);
  };
  const soumettre = async () => {
    const probleme = controler(e, false);
    if (probleme) { $('#erreur').textContent = probleme; $('#erreur').scrollIntoView({ block: 'center' }); return; }
    const bouton = $('#envoyer'); bouton.disabled = true; bouton.textContent = 'Envoi…';
    try {
      const r = await envoyer('enregistrer_journee', donneesJournee(e), `Journée du ${dateLongue(date)}`);
      stock.ecrire('dernierEnvoi', { etat: e, enAttente: !!r.enAttente,
        valideeDOffice: !!(r.reponse && r.reponse.journee && r.reponse.journee.statut === 'VALIDEE_CHEF') });
      memoriserJournee(date, e, r);
      aller('/envoye');
    } catch (err) {
      bouton.disabled = false; bouton.textContent = 'Envoyer ma journée';
      $('#erreur').textContent = err.message;
    }
  };
  dessiner();
};

/** Met à jour ce que le téléphone garde : le retour à l'accueil et la réouverture du jour sont instantanés. */
function memoriserJournee(date, e, r) {
  const [a, b, c, d] = [e.hEmbauche, e.hPause, e.hReprise, e.hDebauche].map(minutes);
  const journee = Object.assign((r.reponse && r.reponse.journee) || {
    date, chantiers: e.chantiers, lieuEmbauche: e.lieuEmbauche, hEmbauche: e.hEmbauche, hPause: e.hPause,
    hReprise: e.hReprise, hDebauche: e.hDebauche, total: duree((b - a) + (d - c)), trajet: e.trajet,
    tachesSupp: e.tachesSupp, tachesSuppMin: e.avecTaches ? e.tachesSuppMin : '', repas: e.repas,
    statut: 'SAISIE', modifiable: true,
  }, { enAttente: !!r.enAttente });

  const jour = jourGarde(date);
  if (jour) { jour.journee = journee; garderJour(jour); }

  const acc = stock.lire('accueil');
  if (acc) {
    if (acc.date === date) {
      acc.journee = journee;
      // Le chef qui saisit sa journée : elle ne manque plus, et elle est validée d'office.
      const moi = (stock.lire('session') || {}).personne;
      if (acc.chef && acc.chef.manquants.includes(moi)) {
        acc.chef.manquants = acc.chef.manquants.filter(n => n !== moi);
        if (journee.statut === 'VALIDEE_CHEF') acc.chef.validees += 1;
      }
    }
    acc.semaine = (acc.semaine || []).map(s => (s.date === date
      ? { ...s, statut: journee.statut || 'SAISIE', modifiable: journee.modifiable !== false } : s));
    stock.ecrire('accueil', acc);
  }
}

// ---------------------------------------------------------------------------
// Écran : envoyé / en attente
// ---------------------------------------------------------------------------

ROUTES.envoye = function () {
  const d = stock.lire('dernierEnvoi');
  if (!d) return aller('/accueil');
  const e = d.etat;
  const [a, b, c, f] = [e.hEmbauche, e.hPause, e.hReprise, e.hDebauche].map(minutes);
  APP().innerHTML = `
    <div class="centre" style="display:flex;flex-direction:column;gap:14px;margin-top:24px">
      <div class="rond ${d.enAttente ? '' : 'vert'}">${d.enAttente ? ICONES.horsReseau : ICONES.ok.replace(/18/g, '36')}</div>
      <h1>${d.enAttente ? 'Journée gardée sur ton téléphone' : 'Journée envoyée'}</h1>
      <p class="discret">${d.enAttente ? "Pas de réseau pour l'instant. Elle partira toute seule dès que le téléphone capte. Tu n'as rien à refaire."
        : d.valideeDOffice ? "Tu es le chef : elle est validée d'office." : 'Ton chef la validera ce soir.'}</p>
    </div>
    <section class="bloc">
      <div class="resume"><span>Jour</span><span>${esc(dateLongue(e.date))}</span></div>
      <div class="resume"><span>Chantier</span><span>${esc(e.chantiers.join(', '))}</span></div>
      <div class="resume"><span>Horaires</span><span>${esc(e.hEmbauche)}–${esc(e.hPause)} · ${esc(e.hReprise)}–${esc(e.hDebauche)}</span></div>
      <div class="resume"><span>Total</span><span>${duree((b - a) + (f - c))}</span></div>
      <div class="resume"><span>Trajet</span><span>${esc(e.trajet)}</span></div>
      <div class="resume"><span>Tâches avant chantier</span><span>${e.avecTaches ? esc(e.tachesSuppMin) + ' min' : 'Non'}</span></div>
      <div class="resume"><span>Repas</span><span>${esc({ AUCUN: 'Aucun', PANIER: 'Panier', RESTAURANT: 'Restaurant' }[e.repas])}</span></div>
    </section>
    <div class="pied"><button class="btn btn-sombre" type="button" onclick="aller('/accueil')">Retour à ma semaine</button></div>`;
};

// ---------------------------------------------------------------------------
// Écran : rapport de chantier (responsable du bloc)
// ---------------------------------------------------------------------------

/** Les matériaux sont classés par famille : la liste en compte plus de cent. */
function optionsMateriaux(liste, choisi) {
  const familles = {};
  liste.forEach(x => { (familles[x.categorie || 'AUTRES'] = familles[x.categorie || 'AUTRES'] || []).push(x); });
  return Object.keys(familles).map(f => `<optgroup label="${esc(f)}">${familles[f]
    .map(x => `<option ${x.materiau === choisi ? 'selected' : ''}>${esc(x.materiau)}</option>`).join('')}</optgroup>`).join('');
}

/**
 * Petites vignettes (≈ 10 Ko) des BL envoyés depuis ce téléphone. Le serveur ne renvoie que des liens
 * Drive, illisibles sans compte : sans elles, un BL déjà envoyé n'apparaîtrait qu'en case grise.
 * Gardées pour les 10 derniers jours ; si la mémoire manque, on s'en passe.
 */
const CLE_APERCUS = 'flbtp.apercusBl';
function apercusBl(date, chantier) {
  try { return (JSON.parse(localStorage.getItem(CLE_APERCUS) || '{}')[date + '|' + chantier]) || []; } catch (e) { return []; }
}
function garderApercu(date, chantier, apercu) {
  try {
    const tous = JSON.parse(localStorage.getItem(CLE_APERCUS) || '{}');
    const cle = date + '|' + chantier;
    tous[cle] = [...(tous[cle] || []), apercu].slice(-12);
    const dates = [...new Set(Object.keys(tous).map(k => k.slice(0, 10)))].sort().reverse();
    Object.keys(tous).forEach(k => { if (!dates.slice(0, 10).includes(k.slice(0, 10))) delete tous[k]; });
    localStorage.setItem(CLE_APERCUS, JSON.stringify(tous));
  } catch (e) { /* mémoire pleine : pas de vignette, rien de grave */ }
}

async function redimensionner(fichier, cote = 1600, qualite = 0.78) {
  const url = URL.createObjectURL(fichier);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    const r = Math.min(1, cote / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', qualite);
  } finally { URL.revokeObjectURL(url); }
}

ROUTES.rapport = async function (param) {
  const [dateBrute, responsableEncode] = String(param || '').split('/');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateBrute || '') ? dateBrute : aujourdhui();
  const auNomDe = responsableEncode ? decodeURIComponent(responsableEncode) : null;   // le bureau remplit pour un chef
  const toujoursIci = ecranCourant();
  chargement();
  let d;
  try { d = await appel('rapport', { date, auNomDe }); } catch (err) { if (toujoursIci()) erreurEcran(err, "Le rapport a besoin du réseau pour s'ouvrir."); return; }
  if (!toujoursIci()) return;

  const e = {
    restaurant: (d.rapport && d.rapport.restaurant) || '',
    repasPayes: d.rapport ? Number(d.rapport.repasPayes) || 0 : 0,
    // Chaque chantier a son avancement, ses matériaux, ses bons de livraison et ses remarques.
    chantiers: d.chantiers.map(c => ({
      libelle: c.libelle, client: c.client, commune: c.commune, remarques: c.remarques || '',
      avancement: c.avancement.map(x => ({ ...x })), materiaux: c.materiaux.map(x => ({ ...x })),
      blEnvoyes: c.bl.length, photos: [],
    })),
    ouvert: 0,
  };
  const unites = Object.fromEntries(d.listeMateriaux.map(m => [m.materiau, m.unite]));

  const sectionChantier = (c, i) => `
    <section class="bloc">
      <div class="bloc-titre">${esc(nomCourt(c.libelle))}</div>
      <h2>Avancement</h2>
      ${c.avancement.map((t, k) => `
        <div class="ligne">
          <input type="text" aria-label="Tâche" value="${esc(t.tache)}" data-ch="${i}" data-av="${k}" data-k="tache" placeholder="Ex. bicouche">
          <div class="choix" style="--n:2">
            <button type="button" data-mode="${i}-${k}" data-v="POURCENTAGE" aria-pressed="${t.mode !== 'QUANTITE'}">En %</button>
            <button type="button" data-mode="${i}-${k}" data-v="QUANTITE" aria-pressed="${t.mode === 'QUANTITE'}">En quantité</button>
          </div>
          ${t.mode === 'QUANTITE' ? `
            <div class="materiau" style="grid-template-columns:1fr 1fr 44px">
              <input type="text" inputmode="decimal" aria-label="Quantité faite" value="${esc(t.quantite || '')}" data-ch="${i}" data-av="${k}" data-k="quantite" placeholder="Ex. 120">
              <select aria-label="Unité" data-ch="${i}" data-av="${k}" data-k="unite">${['m2', 'ml', 'm3', 't', 'un'].map(u => `<option ${u === (t.unite || 'm2') ? 'selected' : ''}>${u}</option>`).join('')}</select>
              <button class="suppr" type="button" data-suppr-av="${i}-${k}" aria-label="Retirer la tâche">×</button>
            </div>`
          : `<div class="ligne-tete"><input type="range" min="0" max="100" step="5" value="${Number(t.pourcentage) || 0}" data-ch="${i}" data-av="${k}" data-k="pourcentage" aria-label="Avancement en pourcent" style="flex:1">
              <b class="valeur" style="min-width:52px;text-align:right">${Number(t.pourcentage) || 0} %</b>
              <button class="suppr" type="button" data-suppr-av="${i}-${k}" aria-label="Retirer la tâche">×</button></div>
            <div class="barre"><i class="${Number(t.pourcentage) >= 100 ? 'fini' : ''}" style="width:${Number(t.pourcentage) || 0}%"></i></div>`}
        </div>`).join('')}
      <button class="btn btn-ajout" type="button" data-ajout-tache="${i}">${ICONES.plus} Ajouter une tâche</button>

      <h2>Matériaux utilisés</h2>
      ${c.materiaux.map((m, k) => `
        <div class="materiau">
          <select aria-label="Matériau" data-ch="${i}" data-mat="${k}" data-k="materiau">${optionsMateriaux(d.listeMateriaux, m.materiau)}</select>
          <input type="text" inputmode="decimal" aria-label="Quantité" value="${esc(m.quantite)}" data-ch="${i}" data-mat="${k}" data-k="quantite">
          <select aria-label="Unité" data-ch="${i}" data-mat="${k}" data-k="unite">${['m3', 't', 'litres', 'm2', 'ml', 'un'].map(u => `<option ${u === m.unite ? 'selected' : ''}>${u}</option>`).join('')}</select>
          <button class="suppr" type="button" data-suppr-mat="${i}-${k}" aria-label="Retirer le matériau">×</button>
        </div>`).join('')}
      <button class="btn btn-ajout" type="button" data-ajout-mat="${i}">${ICONES.plus} Ajouter un matériau</button>

      <h2>Bons de livraison</h2>
      <div class="photos">
        ${Array.from({ length: c.blEnvoyes }).map((_, k) => {
          const vu = apercusBl(date, c.libelle)[k];
          return `<div class="vignette" ${vu ? `style="background-image:url('${vu}')"` : ''}><em>Envoyé</em></div>`;
        }).join('')}
        ${c.photos.map(ph => `<div class="vignette ${ph.etat}" ${ph.apercu ? `style="background-image:url('${ph.apercu}')"` : ''}>
          <em>${{ prep: 'Préparation…', envoi: 'Envoi…', ok: 'Envoyé', attente: 'En attente', echec: 'Échec' }[ph.etat]}</em></div>`).join('')}
        <label class="prendre">${ICONES.photo}Photo<input type="file" accept="image/*" capture="environment" data-photo="${i}"></label>
      </div>

      <div class="champ"><label for="rem${i}">Remarques sur ce chantier</label>
        <textarea id="rem${i}" data-ch="${i}" data-k="remarques" placeholder="Ex. redescendu 4,5 m3 de 10/14 au dépôt">${esc(c.remarques)}</textarea></div>
    </section>`;

  const dessiner = () => {
    const y = window.scrollY;
    const envoye = !!(d.rapport && d.rapport.statut === 'ENVOYE');
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="history.back()">${ICONES.retour}</button>
        <div><h1>Rapport de chantier</h1><p class="discret">${esc(dateLongue(date))}${auNomDe ? ` — au nom de ${esc(auNomDe)}` : ''}</p></div>
      </div>
      ${envoye ? `<div class="alerte vert">${ICONES.ok}<span>Rapport envoyé. Tu peux le compléter et le renvoyer autant de fois que nécessaire.</span></div>`
        : `<div class="alerte jaune">${ICONES.attention}<span>Rapport pas encore envoyé. Le bouton en bas l'envoie, même s'il n'y a que les repas.</span></div>`}

      <section class="bloc">
        <h2>Restaurant et repas</h2>
        <p class="discret">Pour toute la journée, tous chantiers confondus.</p>
        <div class="champ"><label for="resto" class="sous">Nom</label><input id="resto" type="text" value="${esc(e.restaurant)}"></div>
        <div class="ligne-tete"><span>Repas payés</span>
          <div class="pas"><button type="button" id="moins" aria-label="Un repas de moins">−</button><output id="nbRepas">${e.repasPayes}</output><button type="button" id="plus" aria-label="Un repas de plus">+</button></div>
        </div>
      </section>

      ${e.chantiers.length > 1 ? `<div class="choix" style="--n:${e.chantiers.length}">
        ${e.chantiers.map((c, i) => `<button type="button" data-onglet="${i}" aria-pressed="${e.ouvert === i}">${esc(nomCourt(c.libelle).split(' / ')[0])}</button>`).join('')}
      </div>` : ''}
      ${e.chantiers.length ? sectionChantier(e.chantiers[e.ouvert], e.ouvert)
        : '<section class="bloc"><p class="discret">Aucun chantier au planning pour cette journée.</p></section>'}

      <p class="erreur-champ" id="erreur" role="alert"></p>
      <div class="pied"><button class="btn btn-principal" type="button" id="envoyer">${envoye ? 'Renvoyer le rapport' : 'Envoyer le rapport'}</button></div>`;

    $('#resto').oninput = ev => { e.restaurant = ev.target.value; };
    $('#moins').onclick = () => { e.repasPayes = Math.max(0, e.repasPayes - 1); $('#nbRepas').textContent = e.repasPayes; };
    $('#plus').onclick = () => { e.repasPayes = Math.min(20, e.repasPayes + 1); $('#nbRepas').textContent = e.repasPayes; };
    $$('[data-onglet]').forEach(b => b.onclick = () => { e.ouvert = +b.dataset.onglet; dessiner(); });

    $$('[data-av]').forEach(el => el.oninput = () => {
      const c = e.chantiers[+el.dataset.ch], t = c.avancement[+el.dataset.av];
      t[el.dataset.k] = el.dataset.k === 'pourcentage' ? Number(el.value) : el.value;
      if (el.dataset.k !== 'pourcentage') return;
      // On met à jour le texte et la barre à la main : redessiner couperait le glissement en cours.
      const ligne = el.closest('.ligne');
      ligne.querySelector('.valeur').textContent = `${el.value} %`;
      const barre = ligne.querySelector('.barre i');
      barre.style.width = el.value + '%';
      barre.className = Number(el.value) >= 100 ? 'fini' : '';
    });
    $$('[data-mat]').forEach(el => el.oninput = el.onchange = () => {
      const c = e.chantiers[+el.dataset.ch], m = c.materiaux[+el.dataset.mat];
      m[el.dataset.k] = el.value;
      if (el.dataset.k === 'materiau' && unites[el.value]) { m.unite = unites[el.value]; dessiner(); }
    });
    $$('[data-k="remarques"]').forEach(el => el.oninput = () => { e.chantiers[+el.dataset.ch].remarques = el.value; });
    $$('[data-mode]').forEach(b => b.onclick = () => {
      const [i, k] = b.dataset.mode.split('-').map(Number);
      e.chantiers[i].avancement[k].mode = b.dataset.v; dessiner();
    });
    $$('[data-suppr-av]').forEach(b => b.onclick = () => {
      const [i, k] = b.dataset.supprAv.split('-').map(Number);
      e.chantiers[i].avancement.splice(k, 1); dessiner();
    });
    $$('[data-suppr-mat]').forEach(b => b.onclick = () => {
      const [i, k] = b.dataset.supprMat.split('-').map(Number);
      e.chantiers[i].materiaux.splice(k, 1); dessiner();
    });
    $$('[data-ajout-tache]').forEach(b => b.onclick = () => {
      e.chantiers[+b.dataset.ajoutTache].avancement.push({ tache: '', pourcentage: 0, mode: 'POURCENTAGE' }); dessiner();
    });
    $$('[data-ajout-mat]').forEach(b => b.onclick = () => {
      const m = d.listeMateriaux[0] || { materiau: '', unite: 'm3' };
      e.chantiers[+b.dataset.ajoutMat].materiaux.push({ materiau: m.materiau, quantite: '', unite: m.unite }); dessiner();
    });
    $$('[data-photo]').forEach(input => input.onchange = async ev => {
      const f = ev.target.files[0]; if (!f) return;
      const c = e.chantiers[+input.dataset.photo];
      // La vignette apparaît TOUT DE SUITE, avec son état : le dépôt dans Drive peut prendre plusieurs
      // secondes, et sans rien à l'écran on croit que ça n'a pas marché et on renvoie la même photo.
      const ph = { apercu: '', etat: 'prep' };
      c.photos.push(ph);
      dessiner();
      const redessiner = () => { if (toujoursIci()) dessiner(); };
      try {
        const [image, apercu] = await Promise.all([redimensionner(f), redimensionner(f, 240, 0.6)]);
        ph.apercu = apercu; ph.etat = 'envoi'; redessiner();
        // Une photo = un envoi : si le réseau coupe, on ne perd pas tout le rapport.
        const r = await envoyer('ajouter_bl', { date, auNomDe, chantier: c.libelle, image }, `Photo de BL — ${c.libelle}`);
        ph.etat = r.enAttente ? 'attente' : 'ok';
        if (!r.enAttente) garderApercu(date, c.libelle, apercu);
        toast(r.enAttente ? 'Photo gardée, elle partira avec le réseau.' : 'Photo envoyée.');
      } catch (err) {
        ph.etat = 'echec';
        toast(`Photo non envoyée : ${err.message}`);
      }
      redessiner();
    });
    $('#envoyer').onclick = soumettre;
    window.scrollTo(0, y);
  };

  const soumettre = async () => {
    for (const c of e.chantiers) {
      const vide = c.avancement.find(t => !String(t.tache).trim());
      if (vide) { e.ouvert = e.chantiers.indexOf(c); dessiner(); $('#erreur').textContent = `${c.libelle} : donne un nom à chaque tâche, ou retire-la.`; return; }
      const sansQuantite = c.avancement.find(t => t.mode === 'QUANTITE' && !(Number(String(t.quantite).replace(',', '.')) > 0));
      if (sansQuantite) { e.ouvert = e.chantiers.indexOf(c); dessiner(); $('#erreur').textContent = `${c.libelle} : indique la quantité faite pour « ${sansQuantite.tache} ».`; return; }
      const sansQte = c.materiaux.find(m => !(Number(String(m.quantite).replace(',', '.')) > 0));
      if (sansQte) { e.ouvert = e.chantiers.indexOf(c); dessiner(); $('#erreur').textContent = `${c.libelle} : indique la quantité de chaque matériau, ou retire-le.`; return; }
    }
    const bouton = $('#envoyer'); bouton.disabled = true; bouton.textContent = 'Envoi…';
    try {
      const r = await envoyer('enregistrer_rapport', {
        date, auNomDe, restaurant: e.restaurant.trim(), repasPayes: e.repasPayes,
        chantiers: e.chantiers.map(c => ({
          libelle: c.libelle, remarques: c.remarques.trim(), avancement: c.avancement,
          materiaux: c.materiaux.map(m => ({ ...m, quantite: String(m.quantite).replace(',', '.') })),
        })),
      }, `Rapport du ${dateLongue(date)}`);
      if (!r.enAttente) majChef(date, { rapportEnvoye: true });
      oublierJour(date);
      toast(r.enAttente ? 'Rapport gardé, il partira avec le réseau.' : 'Rapport envoyé.');
      aller(auNomDe ? apresCorrectionBureau(date) : '/accueil');
    } catch (err) {
      bouton.disabled = false; bouton.textContent = 'Envoyer le rapport';
      $('#erreur').textContent = err.message;
    }
  };
  dessiner();
};

// ---------------------------------------------------------------------------
// Écran : valider mon équipe (responsable du bloc)
// ---------------------------------------------------------------------------

ROUTES.equipe = async function (date) {
  date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : aujourdhui();
  const toujoursIci = ecranCourant();
  chargement();
  let d;
  try { d = await appel('equipe', { date }); } catch (err) { if (toujoursIci()) erreurEcran(err, 'La validation a besoin du réseau.'); return; }
  if (!toujoursIci()) return;
  const aValiderStatut = s => s === 'SAISIE' || s === 'SIGNALEE';

  const carte = m => {
    const j = m.journee;
    if (!j && m.estMoi) return `
      <section class="bloc"><div class="ligne-tete"><span>${esc(m.personne)} <span class="discret">(chef)</span></span><span class="pastille rouge">Pas saisie</span></div>
        <p class="discret">Ta propre journée n'est pas encore saisie.</p>
        <button class="btn btn-principal btn-petit" type="button" onclick="aller('/saisie/${date}')">Saisir ma journée</button></section>`;
    if (!j) return `
      <section class="bloc"><div class="ligne-tete"><span>${esc(m.personne)}</span><span class="pastille rouge">Pas saisie</span></div>
        <p class="discret">Prévu au planning sur ce chantier, aucune journée reçue.</p>
        <button class="btn btn-clair btn-petit" type="button" data-saisir="${esc(m.personne)}">Saisir sa journée</button></section>`;
    const pastille = j.parBureau ? ['Validée bureau', 'vert']
      : ({ SAISIE: ['À valider', 'attente'], SIGNALEE: ['À valider', 'attente'], VALIDEE_CHEF: ['Validée', 'vert'],
        VALIDEE_BUREAU: ['Validée bureau', 'vert'], EXPORTEE: ['Validée bureau', 'vert'] }[j.statut] || [j.statut, '']);
    const aValider = !j.parBureau && aValiderStatut(j.statut);
    // Validée ou modifiée par le bureau : plus de bouton, le chef doit savoir à qui s'adresser.
    const bureau = j.parBureau ? `<p class="alerte jaune mini">${ICONES.attention}<span>${m.estMoi ? 'Ta journée a été validée ou modifiée' : 'Validée ou modifiée'} par le bureau : pour toute modification, adresse-toi au bureau.</span></p>` : '';
    return `
      <section class="bloc" ${aValider ? 'style="border:2px solid var(--jaune)"' : ''}>
        <div class="ligne-tete"><span>${esc(m.personne)}${m.estMoi ? ' <span class="discret">(chef)</span>' : ''}${m.interimaire ? ' <span class="discret">(intérim)</span>' : ''}</span>
          <span class="pastille ${pastille[1]}">${esc(pastille[0])}</span></div>
        <p>${esc(j.hEmbauche)}–${esc(j.hPause)} · ${esc(j.hReprise)}–${esc(j.hDebauche)} · <b>${esc(j.total)}</b></p>
        <p class="discret">${esc([j.trajet, j.tachesSuppMin ? `${j.tachesSuppMin} min ${j.tachesSupp}` : '', { AUCUN: 'Pas de repas', PANIER: 'Panier', RESTAURANT: 'Restaurant' }[j.repas]].filter(Boolean).join(' — '))}</p>

        ${bureau}
        ${!j.parBureau && !aValider && j.statut === 'VALIDEE_CHEF' ? (m.estMoi
          // Sa propre journée, validée d'office : il la corrige directement, elle reste validée.
          ? `<button class="btn btn-clair btn-petit" type="button" onclick="aller('/saisie/${date}')">Corriger ma journée</button>`
          : `<button class="btn btn-clair btn-petit" type="button" data-devalider="${esc(m.personne)}">Dévalider pour correction</button>`) : ''}
        ${aValider ? (m.estMoi
            ? `<div class="duo"><button class="btn btn-clair btn-petit" type="button" onclick="aller('/saisie/${date}')">Corriger</button>
            <button class="btn btn-vert btn-petit" type="button" data-valider="${esc(m.personne)}">Valider ma journée</button></div>`
            : `<div class="duo"><button class="btn btn-clair btn-petit" type="button" ${m.interimaire ? `data-corriger-interim="${esc(m.personne)}"` : `data-corriger="${esc(m.personne)}"`}>Corriger</button>
            <button class="btn btn-vert btn-petit" type="button" data-valider="${esc(m.personne)}">Valider</button></div>`) : ''}
      </section>`;
  };

  const dessiner = () => {
    const aValider = d.membres.filter(m => m.journee && aValiderStatut(m.journee.statut));
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="aller('/accueil')">${ICONES.retour}</button>
        <div><h1>Valider mon équipe</h1><p class="discret">${esc(libellesChantiers(d.bloc).map(nomCourt).join(' + '))} — ${esc(dateLongue(date))}</p></div>
      </div>
      ${d.membres.map(carte).join('')}
      ${d.repas.payes === null ? `<div class="alerte jaune">${ICONES.attention}<span>Rapport de chantier pas encore envoyé : les repas ne peuvent pas être contrôlés.</span></div>`
        : d.repas.ecart ? `<div class="alerte rouge">${ICONES.attention}<span><b>Repas :</b> ${d.repas.payes} payés au rapport, ${d.repas.equipe} déclarés par l'équipe.</span></div>`
        : `<div class="alerte vert">${ICONES.ok}<span>Repas : ${d.repas.payes} payés, ${d.repas.equipe} déclarés. Ça correspond.</span></div>`}
      <p class="erreur-champ" id="erreur" role="alert"></p>
      <div class="pied">
        <button class="btn btn-ajout" type="button" onclick="aller('/interimaire/${date}')">${ICONES.plus} Ajouter un intérimaire</button>
        <button class="btn btn-vert" type="button" id="toutValider" ${aValider.length ? '' : 'disabled'}>${aValider.length ? `Tout valider (${aValider.length})` : 'Rien à valider'}</button>
      </div>`;

    $$('[data-valider]').forEach(b => b.onclick = () => decider([b.dataset.valider], 'VALIDER'));
    $$('[data-devalider]').forEach(b => b.onclick = () => decider([b.dataset.devalider], 'DEVALIDER'));
    $$('[data-corriger]').forEach(b => b.onclick = () => aller(`/chef-journee/${date}/${encodeURIComponent(b.dataset.corriger)}`));
    $$('[data-saisir]').forEach(b => b.onclick = () => aller(`/chef-journee/${date}/${encodeURIComponent(b.dataset.saisir)}`));
    $$('[data-corriger-interim]').forEach(b => b.onclick = () => aller(`/interimaire/${date}/-/${encodeURIComponent(b.dataset.corrigerInterim)}`));
    $('#toutValider').onclick = () => decider(aValider.map(m => m.personne), 'VALIDER');
  };

  const decider = async (personnes, decision) => {
    $$('button').forEach(b => { b.disabled = true; });
    try {
      for (const p of personnes) await appel('valider', { date, personne: p, decision });
      d = await appel('equipe', { date });
      majChef(date, {
        aValider: d.membres.filter(m => m.journee && aValiderStatut(m.journee.statut)).length,
        manquants: d.manquants,
        validees: d.membres.filter(m => m.journee && !aValiderStatut(m.journee.statut)).length,
      });
      oublierJour(date);
      toast({ VALIDER: personnes.length > 1 ? 'Journées validées.' : 'Journée validée.',
        DEVALIDER: 'Journée rouverte : touche « Corriger » pour la modifier.' }[decision]);
    } catch (err) {
      toast(err instanceof HorsReseau ? 'Pas de réseau : réessaie quand ça capte.' : err.message);
    }
    if (toujoursIci()) dessiner();
  };
  dessiner();
};

// ---------------------------------------------------------------------------
// Écran : le chef corrige la journée d'un gars de son équipe (après l'avoir dévalidée)
// ---------------------------------------------------------------------------

ROUTES['chef-journee'] = async function (param) {
  const toujoursIci = ecranCourant();
  const [date, personneEncodee] = String(param || '').split('/');
  const personne = decodeURIComponent(personneEncodee || '');
  chargement();
  let ref, d;
  try {
    ref = await referentiels();
    d = await appel('equipe', { date });
  } catch (err) { if (toujoursIci()) erreurEcran(err, 'La correction a besoin du réseau.'); return; }
  if (!toujoursIci()) return;

  const m = d.membres.find(x => x.personne === personne);
  if (m && m.interimaire) return aller(`/interimaire/${date}/-/${encodeURIComponent(personne)}`);
  if (!m) { toast(`${personne} n'est pas dans ton équipe ce jour-là.`); return aller('/equipe/' + date); }
  // Pas de journée reçue : le chef la saisit à la place du gars, avec les chantiers et horaires habituels du jour.
  const nouvelle = !m.journee;
  if (!nouvelle && m.journee.statut !== 'SAISIE' && m.journee.statut !== 'SIGNALEE') {
    toast("Journée validée : dévalide-la d'abord pour la corriger."); return aller('/equipe/' + date);
  }
  const e = etatInitial(date, m.journee, d.bloc);
  const idEnvoi = uuid();          // un enregistrement relancé après une coupure n'est pas compté deux fois

  const dessiner = () => {
    const y = window.scrollY;
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="aller('/equipe/${date}')">${ICONES.retour}</button>
        <div><h1>${esc(personne)}</h1><p class="discret">${esc(dateLongue(date))} — ${nouvelle ? 'saisie' : 'correction'} par le chef</p></div>
      </div>
      <div class="alerte jaune">${ICONES.attention}<span>Une fois enregistrée, la journée est validée à ton nom.</span></div>
      ${formulaireJournee(e, ref, false)}
      <div class="pied"><button class="btn btn-principal" type="button" id="envoyer">Enregistrer et valider</button></div>`;
    brancherFormulaire(e, dessiner);
    $('#envoyer').onclick = async () => {
      const probleme = controler(e, false);
      if (probleme) { $('#erreur').textContent = probleme; $('#erreur').scrollIntoView({ block: 'center' }); return; }
      const b = $('#envoyer'); b.disabled = true; b.textContent = 'Enregistrement…';
      try {
        await appel('chef_journee', Object.assign({ personne }, donneesJournee(e)), idEnvoi);
        oublierJour(date);
        toast(nouvelle ? 'Journée saisie et validée.' : 'Journée corrigée et validée.');
        aller('/equipe/' + date);
      } catch (err) {
        b.disabled = false; b.textContent = 'Enregistrer et valider';
        $('#erreur').textContent = err instanceof HorsReseau ? 'Pas de réseau : réessaie quand ça capte.' : err.message;
      }
    };
    window.scrollTo(0, y);
  };
  dessiner();
};

// ---------------------------------------------------------------------------
// Écran : ajouter un intérimaire (responsable du bloc)
// ---------------------------------------------------------------------------

/**
 * Journée d'un intérimaire. /interimaire/<date> : le chef ajoute ;
 * /interimaire/<date>/<chef> : le bureau ajoute au nom de ce chef ;
 * /interimaire/<date>/<chef ou ->/<INTERIM NOM> : correction (même écran, nom verrouillé).
 * Ses chantiers sont cochés parmi ceux du chef : il compte dans son équipe et ses repas, partout.
 */
ROUTES.interimaire = async function (param) {
  const [dateBrute, chefEncode, libelleEncode] = String(param || '').split('/');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateBrute || '') ? dateBrute : aujourdhui();
  const auNomDe = chefEncode && chefEncode !== '-' ? decodeURIComponent(chefEncode) : null;
  const libelle = libelleEncode ? decodeURIComponent(libelleEncode) : null;
  const toujoursIci = ecranCourant();
  chargement();
  let ref, d;
  try {
    ref = await referentiels();
    d = await appel('equipe', auNomDe ? { date, auNomDe } : { date });
  } catch (err) { if (toujoursIci()) erreurEcran(err, "L'ajout d'un intérimaire a besoin du réseau."); return; }
  if (!toujoursIci()) return;
  const possibles = libellesChantiers(d.bloc);
  const existant = libelle ? d.membres.find(m => m.interimaire && m.personne === libelle) : null;
  if (libelle && !existant) { toast(`${libelle} introuvable ce jour-là.`); return aller(auNomDe ? apresCorrectionBureau(date) : '/equipe/' + date); }
  const e = etatInitial(date, existant ? existant.journee : null, null);
  if (!existant) {
    // Rien de coché par défaut s'il y a plusieurs chantiers : le chef choisit.
    e.chantiers = possibles.length === 1 ? [possibles[0]] : [];
    e.lieuEmbauche = e.chantiers[0] || '';
  } else {
    e.chantiers = e.chantiers.filter(c => possibles.includes(c));
  }
  const retour = () => (auNomDe ? apresCorrectionBureau(date) : '/equipe/' + date);
  const dessiner = () => {
    const y = window.scrollY;
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="history.back()">${ICONES.retour}</button>
        <div><h1>${existant ? esc(libelle) : "Journée d'un intérimaire"}</h1>
          <p class="discret">${esc(dateLongue(date))} — ${auNomDe ? `équipe de ${esc(auNomDe)}` : 'tu la saisis et la valides pour lui'}</p></div>
      </div>
      ${formulaireJournee(e, ref, true, { chantiersPossibles: possibles, nomVerrouille: !!existant })}
      <div class="pied"><button class="btn btn-principal" type="button" id="envoyer">Enregistrer sa journée</button></div>`;
    brancherFormulaire(e, dessiner);
    $('#envoyer').onclick = async () => {
      const probleme = controler(e, true);
      if (probleme) { $('#erreur').textContent = probleme; $('#erreur').scrollIntoView({ block: 'center' }); return; }
      const bouton = $('#envoyer'); bouton.disabled = true; bouton.textContent = 'Envoi…';
      try {
        const donnees = Object.assign(donneesJournee(e), auNomDe ? { auNomDe } : {}, existant ? { correction: true } : {});
        const r = await envoyer('enregistrer_interimaire', donnees, `Intérimaire ${e.nomInterimaire}`);
        oublierJour(date);
        toast(r.enAttente ? 'Gardée, partira avec le réseau.' : 'Journée enregistrée.');
        aller(retour());
      } catch (err) {
        bouton.disabled = false; bouton.textContent = 'Enregistrer sa journée';
        $('#erreur').textContent = err.message;
      }
    };
    window.scrollTo(0, y);
  };
  dessiner();
};

// ---------------------------------------------------------------------------
// Écrans du bureau : voir, saisir, corriger et valider à la place de n'importe qui
// ---------------------------------------------------------------------------

const ETIQUETTES = {
  SAISIE: ['Saisie', 'attente'], SIGNALEE: ['Saisie', 'attente'], VALIDEE_CHEF: ['Validée chef', 'vert'],
  VALIDEE_BUREAU: ['Validée bureau', 'vert'], EXPORTEE: ['Envoyée en paie', 'vert'],
};

/**
 * Une correction ouverte depuis la liste des contrôles y ramène une fois enregistrée :
 * le bureau enchaîne les points à corriger sans repasser par l'écran du jour.
 */
let retourControles = false;
function apresCorrectionBureau(date) {
  const vers = retourControles ? '/controles' : '/bureau/' + date;
  retourControles = false;
  return vers;
}

ROUTES.bureau = async function (date) {
  retourControles = false;
  const toujoursIci = ecranCourant();
  date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : aujourdhui();
  chargement();
  let d;
  try { d = await appel('bureau_jour', { date }); } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;

  const jour = n => {
    const t = new Date(date + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };

  const ctl = d.controles;
  const pointsDe = nom => ctl.duJour.filter(c => c.personne === nom)
    .map(c => `<p class="point-controle ${c.cat}">${c.cat === 'corriger' ? '⚠' : '•'} ${esc(c.titre.split(' — ')[0])}</p>`).join('');
  const carte = x => {
    const j = x.journee;
    const [lib, couleur] = j ? (ETIQUETTES[x.exportee ? 'EXPORTEE' : (x.valideBureau ? 'VALIDEE_BUREAU' : j.statut)] || [j.statut, ''])
      : ['Pas saisie', 'rouge'];
    return `
      <div class="ligne">
        <div class="ligne-tete">
          <span>${esc(x.personne)}${x.auPlanning ? '' : ' <span class="discret">(hors planning)</span>'}</span>
          <span class="pastille ${couleur}">${esc(lib)}</span>
        </div>
        ${j ? `<p>${esc(j.hEmbauche)}–${esc(j.hPause)} · ${esc(j.hReprise)}–${esc(j.hDebauche)} · <b>${esc(j.total)}</b>
               <span class="discret">— ${esc([j.trajet, { AUCUN: 'sans repas', PANIER: 'panier', RESTAURANT: 'restaurant' }[j.repas], j.zone ? 'zone ' + j.zone : 'pas de zone'].filter(Boolean).join(', '))}</span>
               ${j.repartition ? `<br><span class="discret">Heures : ${esc(j.repartition.split(' ; ').map(nomCourt).join(' ; '))}</span>` : ''}</p>` : ''}
        ${pointsDe(x.personne)}
        ${x.exportee ? '<p class="discret">Déjà envoyée au Suivi RH.</p>' : `
          <div class="duo">
            <button class="btn btn-clair btn-petit" type="button" ${x.interimaire ? `data-modifier-interim="${esc(x.personne)}" data-chef="${esc(x.responsable || '')}"` : `data-modifier="${esc(x.personne)}"`}>${j ? 'Corriger' : 'Saisir'}</button>
            ${!j ? ''
              : (j.statut === 'SAISIE' || j.statut === 'SIGNALEE')
                ? `<button class="btn btn-vert btn-petit" type="button" data-valider-chef="${esc(x.personne)}">Valider</button>`
                : `<button class="btn btn-petit ${x.valideBureau ? 'btn-clair' : 'btn-principal'}" type="button" data-bureau="${esc(x.personne)}" data-valeur="${x.valideBureau ? 'non' : 'oui'}">${x.valideBureau ? 'Retirer de l\'envoi' : 'Bon pour la paie'}</button>`}
          </div>`}
      </div>`;
  };

  const aCorriger = c => ctl.duJour.filter(x => x.cat === 'corriger'
    && (c.journees.some(j => j.personne === x.personne) || (!x.personne && x.responsable === c.responsable))).length;
  /** Un chantier entier : son rapport, son équipe, et le passage en paie de tout le monde d'un coup. */
  const carteChantier = c => {
    const prets = c.journees.filter(x => x.journee && !x.exportee && !x.valideBureau
      && x.journee.statut !== 'SAISIE' && x.journee.statut !== 'SIGNALEE').map(x => x.personne);
    const aValider = c.journees.filter(x => x.journee && (x.journee.statut === 'SAISIE' || x.journee.statut === 'SIGNALEE')).length;
    const manquantes = c.journees.filter(x => !x.journee).length;
    return `
      <section class="bloc">
        <div class="bloc-titre">${esc(c.villes.map(nomCourt).join(' + '))}</div>
        <div class="ligne-tete">
          <span class="discret">Chef : ${esc(c.responsable || '—')}</span>
          <span class="pastille ${c.rapport.envoye ? 'vert' : 'rouge'}">Rapport ${c.rapport.envoye ? 'envoyé' : 'manquant'}</span>
        </div>
        <p class="discret">${c.journees.length} personne${c.journees.length > 1 ? 's' : ''}${manquantes ? ` · ${manquantes} sans saisie` : ''}${aValider ? ` · ${aValider} à valider` : ''}${aCorriger(c) ? ` · <b class="rouge">${aCorriger(c)} à corriger</b>` : ''}</p>
        ${c.rapport.ecartRepas ? `<div class="alerte rouge">${ICONES.attention}<span><b>Repas :</b> ${esc(String(c.rapport.repasPayes))} payés au rapport, ${c.rapport.repasDeclares} déclarés par l'équipe.</span></div>`
          : (c.rapport.envoye ? `<p class="discret">Repas : ${esc(String(c.rapport.repasPayes))} payés, ${c.rapport.repasDeclares} déclarés.</p>` : '')}
        ${c.journees.map(carte).join('')}
        <button class="btn btn-clair btn-petit" type="button" onclick="aller('/rapport/${date}/${encodeURIComponent(c.responsable || '')}')">
          ${c.rapport.envoye ? `Rapport : ${esc(c.rapport.restaurant || 'sans restaurant')}, ${esc(String(c.rapport.repasPayes))} repas, ${c.rapport.nbBl} BL` : 'Remplir le rapport'}</button>
        ${prets.length ? `<button class="btn btn-principal btn-petit" type="button" data-chantier="${esc(prets.join('|'))}">Tout le chantier bon pour la paie (${prets.length})</button>` : ''}
        ${c.responsable ? `<button class="btn btn-ajout btn-petit" type="button" data-ajout-interim="${esc(c.responsable)}">${ICONES.plus} Ajouter un intérimaire</button>` : ''}
      </section>`;
  };

  const dessiner = () => {
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="aller('/accueil')">${ICONES.retour}</button>
        <div><h1>Écran bureau</h1><p class="discret">${esc(dateLongue(date))}</p></div>
      </div>
      <div class="duo">
        <button class="btn btn-clair btn-petit" type="button" onclick="aller('/bureau/${jour(-1)}')">← Veille</button>
        <button class="btn btn-clair btn-petit" type="button" onclick="aller('/bureau/${jour(1)}')">Lendemain →</button>
      </div>

      <div class="compteurs">
        <button type="button" class="compteur rouge" data-filtre="corriger"><b>${ctl.compteurs.corriger}</b><span>à corriger</span></button>
        <button type="button" class="compteur jaune" data-filtre="verifier"><b>${ctl.compteurs.verifier}</b><span>à vérifier</span></button>
        <div class="compteur vert"><b>${ctl.compteurs.prets}</b><span>prêtes paie</span></div>
      </div>
      <div class="semaine-bureau">
        ${ctl.semaine.map(j => `<button type="button" data-jour-bureau="${j.date}" aria-current="${j.date === date}"
            class="${j.avenir ? 'avenir' : j.enCours ? 'en-cours' : j.corriger ? 'probleme' : 'ok'}">
            <b>${esc(jourCourt(j.date))}</b>${j.avenir ? '—' : j.enCours ? 'en cours' : j.corriger ? `${j.corriger} ⚠` : j.nonTravaille ? 'non trav.' : '✓'}</button>`).join('')}
      </div>
      ${ctl.compteurs.corriger + ctl.compteurs.verifier + ctl.compteurs.referentiel
        ? `<button class="btn btn-principal" type="button" onclick="aller('/controles')">Voir les ${ctl.compteurs.corriger + ctl.compteurs.verifier + ctl.compteurs.referentiel} contrôles</button>`
        : `<div class="alerte vert">${ICONES.ok}<span>Aucun point à corriger${ctl.compteurs.justifies ? ` (${ctl.compteurs.justifies} justifié${ctl.compteurs.justifies > 1 ? 's' : ''})` : ''}.</span></div>`}

      ${d.chantiers.length ? d.chantiers.map(carteChantier).join('')
        : '<section class="bloc"><p class="discret">Aucun chantier au planning ce jour-là.</p></section>'}

      ${d.horsChantier.length ? `<h2>Hors chantier</h2>${d.horsChantier.map(x => `<section class="bloc">${carte(x)}</section>`).join('')}` : ''}
      <button class="btn btn-ajout" type="button" id="ajouter">${ICONES.plus} Saisir pour quelqu'un d'autre</button>

      <div class="pied">
        <div class="alerte ${d.aImporter ? 'jaune' : 'vert'}">${d.aImporter ? ICONES.horloge : ICONES.ok}<span>
          ${d.aImporter ? `<b>${d.aImporter} journée${d.aImporter > 1 ? 's' : ''}</b> prête${d.aImporter > 1 ? 's' : ''} à partir dans le Suivi RH, toutes dates confondues.`
            : 'Rien en attente d\'envoi dans le Suivi RH.'}
          ${d.bloqueesPaie ? `<br><b>${d.bloqueesPaie}</b> autre${d.bloqueesPaie > 1 ? 's' : ''} attend${d.bloqueesPaie > 1 ? 'ent' : ''} qu'un point à corriger soit réglé.` : ''}</span></div>
        <button class="btn ${d.aImporter ? 'btn-principal' : 'btn-sombre'}" type="button" id="importer" ${d.aImporter ? '' : 'disabled'}>Envoyer dans le Suivi RH</button>
      </div>`;

    $$('[data-modifier]').forEach(b => b.onclick = () => aller(`/bureau-journee/${date}/${encodeURIComponent(b.dataset.modifier)}`));
    $$('[data-ajout-interim]').forEach(b => b.onclick = () => aller(`/interimaire/${date}/${encodeURIComponent(b.dataset.ajoutInterim)}`));
    $$('[data-modifier-interim]').forEach(b => b.onclick = () => aller(`/interimaire/${date}/${encodeURIComponent(b.dataset.chef || '-')}/${encodeURIComponent(b.dataset.modifierInterim)}`));
    $$('[data-valider-chef]').forEach(b => b.onclick = () => agir({ date, quoi: 'CHEF', personnes: [b.dataset.validerChef] }));
    $$('[data-bureau]').forEach(b => b.onclick = () => agir({ date, quoi: 'BUREAU', valeur: b.dataset.valeur === 'oui', personnes: [b.dataset.bureau] }));
    $$('[data-chantier]').forEach(b => b.onclick = () => agir({ date, quoi: 'BUREAU', valeur: true, personnes: b.dataset.chantier.split('|') }));
    $('#ajouter').onclick = () => {
      const nom = prompt('Nom de la personne, tel qu\'il apparaît au planning :\n\n' + d.personnesConnues.join(', '));
      if (nom && d.personnesConnues.includes(nom.trim().toUpperCase())) aller(`/bureau-journee/${date}/${encodeURIComponent(nom.trim().toUpperCase())}`);
      else if (nom) toast('Nom inconnu. Reprends-le exactement comme au planning.');
    };
    $('#importer').onclick = importer;
    $$('[data-jour-bureau]').forEach(b => b.onclick = () => aller('/bureau/' + b.dataset.jourBureau));
    $$('[data-filtre]').forEach(b => b.onclick = () => { stock.ecrire('filtreControles', b.dataset.filtre); aller('/controles'); });
  };

  const agir = async donnees => {
    $$('button').forEach(b => { b.disabled = true; });
    try {
      await appel('bureau_valider', donnees);
      d = await appel('bureau_jour', { date });
      oublierJour(date);
      toast('Fait.');
    } catch (err) { toast(err.message); }
    if (toujoursIci()) dessiner();
  };

  const importer = async () => {
    if (!confirm(`Envoyer ${d.aImporter} journée(s) dans le Suivi RH ?`)) return;
    const b = $('#importer'); b.disabled = true; b.textContent = 'Envoi…';
    try {
      const r = await appel('bureau_import');
      d = await appel('bureau_jour', { date });
      toast(`${r.ecrites} journée(s) écrite(s) dans le Suivi RH${r.horsSuivi ? `, ${r.horsSuivi} hors Suivi RH` : ''}.`);
      if (r.ignorees && r.ignorees.length) alert('Non envoyées :\n\n' + r.ignorees.join('\n'));
    } catch (err) { toast(err.message); }
    if (toujoursIci()) dessiner();
  };

  dessiner();
};

/** Saisie ou correction d'une journée par le bureau, pour n'importe qui. */
// ---------------------------------------------------------------------------
// Écran : contrôles avant paie (bureau)
// ---------------------------------------------------------------------------

const CATEGORIES_CONTROLES = [['corriger', 'À corriger'], ['verifier', 'À vérifier'], ['referentiel', 'Référentiels'], ['justifies', 'Justifiés']];

ROUTES.controles = async function () {
  const toujoursIci = ecranCourant();
  chargement();
  let d;
  try { d = await appel('bureau_controles'); } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;
  let filtre = stock.lire('filtreControles', 'corriger');
  let ouvert = null;                       // contrôle dont le formulaire « Justifier » est déplié

  // Le même chantier le même jour : journées manquantes de l'équipe et rapport manquant de son chef.
  const voisins = c => {
    const chef = c.type === 'RAPPORT_MANQUANT' ? c.cible : c.responsable;
    if (!chef || !['JOURNEE_MANQUANTE', 'RAPPORT_MANQUANT'].includes(c.type)) return [c];
    return d.controles.filter(x => x.date === c.date && !x.justification
      && ((x.type === 'JOURNEE_MANQUANTE' && x.responsable === chef) || (x.type === 'RAPPORT_MANQUANT' && x.cible === chef)));
  };
  const decrireVoisins = v => {
    const n = v.filter(x => x.type === 'JOURNEE_MANQUANTE').length;
    const r = v.some(x => x.type === 'RAPPORT_MANQUANT');
    return [n ? `${n} journée${n > 1 ? 's' : ''} manquante${n > 1 ? 's' : ''}` : '', r ? 'le rapport' : ''].filter(Boolean).join(' et ');
  };
  const dansFiltre = c => (filtre === 'justifies' ? !!c.justification : !c.justification && c.cat === filtre);
  const nombre = f => d.controles.filter(c => (f === 'justifies' ? !!c.justification : !c.justification && c.cat === f)).length;
  const BOUTONS = {
    saisir: c => `<button class="btn btn-principal" type="button" data-act="saisir" data-id="${esc(c.id)}">Saisir sa journée</button>`,
    ouvrir: c => `<button class="btn btn-clair" type="button" data-act="ouvrir" data-id="${esc(c.id)}">Ouvrir la journée</button>`,
    valider: c => `<button class="btn btn-vert" type="button" data-act="valider" data-id="${esc(c.id)}">Valider</button>`,
    rapport: c => `<button class="btn btn-clair" type="button" data-act="rapport" data-id="${esc(c.id)}">${c.type === 'RAPPORT_MANQUANT' ? 'Remplir à sa place' : 'Ouvrir le rapport'}</button>`,
    jour: c => `<button class="btn btn-clair" type="button" data-act="jour" data-id="${esc(c.id)}">Voir l'équipe</button>`,
    justifier: c => `<button class="btn btn-clair" type="button" data-act="justifier" data-id="${esc(c.id)}">Justifier…</button>`,
  };
  const carte = c => `
    <div class="ctl ${c.cat}" data-controle="${esc(c.id)}">
      <div class="t">${esc(c.titre)}</div>
      <div class="d">${esc(c.detail || '')}</div>
      ${c.aide ? `<div class="d aide">À faire : ${esc(c.aide)}</div>` : ''}
      ${c.justification ? `<div class="d">${c.type === 'JOUR_NON_TRAVAILLE' ? 'Déclarée' : 'Justifié'} : ${esc(c.justification)}</div>
        <div class="a"><button class="btn btn-clair" type="button" data-act="rouvrir" data-id="${esc(c.id)}">Annuler la justification</button></div>`
      : ouvert === c.id ? `
        <div class="choix" style="--n:2">${d.motifs.map(m => `<button type="button" data-motif="${esc(m)}">${esc(m)}</button>`).join('')}</div>
        ${voisins(c).length > 1 ? `<label class="case"><input type="checkbox" id="toutChantier">
          Tout le chantier de ${esc(c.responsable || c.cible)} : ${decrireVoisins(voisins(c))}</label>` : ''}
        <input type="text" id="commentaire" placeholder="Commentaire (facultatif)" maxlength="300">
        <div class="a"><button class="btn btn-clair" type="button" data-act="fermer">Annuler</button>
          <button class="btn btn-principal" type="button" data-act="enregistrer-justif" data-id="${esc(c.id)}" disabled>Enregistrer</button></div>`
      : (c.actions && c.actions.length ? `<div class="a">${c.actions.map(a => BOUTONS[a](c)).join('')}</div>` : '')}
    </div>`;

  // Jour chômé (férié, pont) alors qu'un planning existe : déclaré une fois pour tout le jour.
  let jourOuvert = null;
  const enTeteJour = dt => {
    if (filtre === 'justifies' || !d.joursPlanning.includes(dt)) return '';
    if (!d.controles.some(c => c.date === dt && !c.justification && (c.type === 'JOURNEE_MANQUANTE' || c.type === 'RAPPORT_MANQUANT'))) return '';
    if (jourOuvert !== dt) return `<button class="btn btn-ajout btn-petit" type="button" data-jour-nt="${dt}">Jour chômé (férié, pont…)</button>`;
    return `<div class="ctl verifier">
      <div class="t">Jour chômé pour tout le monde</div>
      <div class="d">Efface les journées et rapports manquants de ce jour. Ceux qui ont travaillé saisissent leur journée normalement.</div>
      <div class="choix" style="--n:3">${d.motifsJour.map(m => `<button type="button" data-motif="${esc(m)}">${esc(m)}</button>`).join('')}</div>
      <input type="text" id="commentaire" placeholder="Commentaire (facultatif)" maxlength="300">
      <div class="a"><button class="btn btn-clair" type="button" data-act="fermer">Annuler</button>
        <button class="btn btn-principal" type="button" data-act="enregistrer-jour" data-date="${dt}" disabled>Enregistrer</button></div></div>`;
  };

  const dessiner = () => {
    const visibles = d.controles.filter(dansFiltre);
    const dates = [...new Set(visibles.map(c => c.date))].sort().reverse();
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="aller('/bureau')">${ICONES.retour}</button>
        <div><h1>Contrôles</h1><p class="discret">Journées pas encore envoyées en paie, sur les trois dernières semaines</p></div>
      </div>
      <div class="filtres">${CATEGORIES_CONTROLES.map(([k, lib]) => `<button type="button" data-cat="${k}" aria-pressed="${k === filtre}">${lib} ${nombre(k)}</button>`).join('')}</div>
      ${filtre === 'corriger' ? '<p class="discret">Ces points bloquent l\'envoi dans le Suivi RH des journées concernées.</p>' : ''}
      ${dates.length ? dates.map(dt => `<p class="jour-titre">${esc(dateLongue(dt))}</p>${enTeteJour(dt)}${visibles.filter(c => c.date === dt).map(carte).join('')}`).join('')
        : `<div class="alerte vert">${ICONES.ok}<span>Rien dans cette catégorie.</span></div>`}`;
    $$('[data-cat]').forEach(b => b.onclick = () => { filtre = b.dataset.cat; ouvert = null; stock.ecrire('filtreControles', filtre); dessiner(); });
    $$('[data-motif]').forEach(b => b.onclick = () => {
      $$('[data-motif]').forEach(x => x.setAttribute('aria-pressed', x === b));
      $$('[data-act="enregistrer-justif"], [data-act="enregistrer-jour"]').forEach(x => { x.disabled = false; });
    });
    $$('[data-jour-nt]').forEach(b => b.onclick = () => { jourOuvert = b.dataset.jourNt; ouvert = null; dessiner(); });
    $$('[data-act="enregistrer-jour"]').forEach(b => b.onclick = async () => {
      const motif = ($('[data-motif][aria-pressed="true"]') || {}).dataset.motif;
      $$('button').forEach(x => { x.disabled = true; });
      try {
        await appel('bureau_justifier', { type: 'JOUR_NON_TRAVAILLE', date: b.dataset.date, cible: '', motif, commentaire: $('#commentaire').value });
        jourOuvert = null;
        return recharger('Jour déclaré chômé.');
      } catch (err) { toast(err.message); dessiner(); }
    });
    $$('[data-act]:not([data-act="enregistrer-jour"])').forEach(b => b.onclick = () => agir(b.dataset.act, d.controles.find(c => c.id === b.dataset.id)));
  };

  const recharger = async message => {
    try { d = await appel('bureau_controles'); if (message) toast(message); } catch (err) { toast(err.message); }
    if (toujoursIci()) dessiner();
  };

  const agir = async (act, c) => {
    if (act === 'fermer') { ouvert = null; jourOuvert = null; return dessiner(); }
    if (act === 'justifier') { ouvert = c.id; jourOuvert = null; return dessiner(); }
    retourControles = true;
    if (act === 'saisir' || act === 'ouvrir') return aller(`/bureau-journee/${c.date}/${encodeURIComponent(c.personne)}`);
    if (act === 'rapport') return aller(`/rapport/${c.date}/${encodeURIComponent(c.responsable)}`);
    if (act === 'jour') { retourControles = false; return aller('/bureau/' + c.date); }
    retourControles = false;
    $$('button').forEach(b => { b.disabled = true; });
    try {
      if (act === 'valider') {
        await appel('bureau_valider', { date: c.date, quoi: 'CHEF', personnes: [c.personne] });
        oublierJour(c.date);
        return recharger('Journée validée.');
      }
      const [type, date, ...reste] = c.id.split('|');
      if (act === 'rouvrir') {
        await appel('bureau_justifier', { type, date, cible: reste.join('|'), annuler: true });
        return recharger('Justification annulée.');
      }
      if (act === 'enregistrer-justif') {
        const motif = ($('[data-motif][aria-pressed="true"]') || {}).dataset.motif;
        const tous = $('#toutChantier') && $('#toutChantier').checked ? voisins(c) : [c];
        const elements = tous.map(x => ({ type: x.type, cible: x.cible }));
        await appel('bureau_justifier', { date, elements, motif, commentaire: $('#commentaire').value });
        ouvert = null;
        return recharger(tous.length > 1 ? `${tous.length} points justifiés.` : 'Justifié.');
      }
    } catch (err) {
      toast(err.message);
      if (toujoursIci()) dessiner();
    }
  };
  dessiner();
};

ROUTES['bureau-journee'] = async function (param) {
  const toujoursIci = ecranCourant();
  const [date, personneEncodee] = String(param || '').split('/');
  const personne = decodeURIComponent(personneEncodee || '');
  chargement();
  let ref, d;
  try {
    ref = await referentiels();
    d = await appel('bureau_jour', { date });
  } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;

  const toutes = [...d.chantiers.flatMap(c => c.journees), ...d.horsChantier];
  const ligne = toutes.find(x => x.personne === personne);
  const chantier = d.chantiers.find(c => c.journees.some(x => x.personne === personne));
  const e = etatInitial(date, ligne && ligne.journee, chantier ? { lieux: chantier.villes } : null);

  const dessiner = () => {
    const y = window.scrollY;
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="aller('/bureau/${date}')">${ICONES.retour}</button>
        <div><h1>${esc(personne)}</h1><p class="discret">${esc(dateLongue(date))} — saisie par le bureau</p></div>
      </div>
      <div class="alerte jaune">${ICONES.attention}<span>Cette journée sera marquée « validée » d'office, au nom du bureau.</span></div>
      ${formulaireJournee(e, ref, false)}
      <div class="pied"><button class="btn btn-principal" type="button" id="envoyer">Enregistrer la journée</button></div>`;
    brancherFormulaire(e, dessiner);
    $('#envoyer').onclick = async () => {
      const probleme = controler(e, false);
      if (probleme) { $('#erreur').textContent = probleme; return; }
      const b = $('#envoyer'); b.disabled = true; b.textContent = 'Enregistrement…';
      try {
        await appel('bureau_journee', Object.assign({ personne }, donneesJournee(e)));
        oublierJour(date);
        toast('Journée enregistrée.');
        aller(apresCorrectionBureau(date));
      } catch (err) { b.disabled = false; b.textContent = 'Enregistrer la journée'; $('#erreur').textContent = err.message; }
    };
    window.scrollTo(0, y);
  };
  dessiner();
};

// ---------------------------------------------------------------------------
// Écran : diagnostic (appui sur le numéro de version)
// ---------------------------------------------------------------------------

ROUTES.diagnostic = function () {
  const t = stock.lire('diag', []);
  const f = file();
  APP().innerHTML = `
    <div class="entete">
      <button class="retour" type="button" aria-label="Retour" onclick="aller('/accueil')">${ICONES.retour}</button>
      <div><h1>Diagnostic</h1><p class="discret">Version ${esc(VERSION_APPLI)} — ${navigator.onLine ? 'téléphone en ligne' : 'téléphone hors ligne'}</p></div>
    </div>
    <p class="discret">Les 30 derniers échanges avec le serveur, du plus récent au plus ancien. Fais une capture d'écran pour l'envoyer.</p>
    <p class="discret" style="word-break:break-all;font-size:12px">Serveur : …${esc(SERVEUR.slice(-24))}</p>
    <section class="bloc">
      <h2>Mesures de l'écran</h2>
      <p class="discret">À relever quand un écran défile alors qu'il semble tenir : l'écart entre les deux premières
      lignes dit de combien ça dépasse. Reviens d'abord sur l'écran fautif, puis ouvre ce diagnostic.</p>
      <div class="resume"><span>Hauteur du contenu</span><span id="m1">—</span></div>
      <div class="resume"><span>Hauteur de l'écran</span><span id="m2">—</span></div>
      <div class="resume"><span>Largeur · densité</span><span id="m3">—</span></div>
      <div class="resume"><span>Dernier écran quitté</span><span>${esc(stock.lire('dernierEcran', '—'))}</span></div>
    </section>
    <section class="bloc">
      ${t.length ? t.map(x => `<div class="resume"><span>${esc(x.h)} · ${esc(x.action)}</span><span>${(x.ms / 1000).toFixed(1)} s</span></div>
        <p class="discret" style="margin:-6px 0 4px;${String(x.issue).startsWith('ok') ? '' : 'color:var(--rouge)'}">${esc(x.issue)}</p>`).join('') : '<p class="discret">Aucun échange enregistré.</p>'}
    </section>
    ${f.length ? `<div class="alerte jaune">${ICONES.horloge}<span>${f.length} envoi(s) en attente : ${esc(f.map(x => x.libelle).join(', '))}</span></div>` : ''}
    <div class="pied"><button class="btn btn-clair btn-petit" type="button" id="vider">Effacer le diagnostic</button></div>`;
  $('#vider').onclick = () => { stock.effacer('diag'); route(); };
  const m = stock.lire('mesures', {});
  $('#m1').textContent = m.contenu ? m.contenu + ' px' : '—';
  $('#m2').textContent = m.ecran ? m.ecran + ' px' : '—';
  $('#m3').textContent = m.largeur ? `${m.largeur} px · ×${m.densite}` : '—';
};

// ---------------------------------------------------------------------------

function erreurEcran(err, texteHorsReseau) {
  APP().innerHTML = `
    <div class="entete"><button class="retour" type="button" aria-label="Retour" onclick="aller('/accueil')">${ICONES.retour}</button><div><h1>Impossible d'ouvrir</h1></div></div>
    <div class="alerte ${err instanceof HorsReseau ? 'jaune' : 'rouge'}">${ICONES.attention}<span>${esc(err instanceof HorsReseau ? (texteHorsReseau || 'Pas de réseau.') : err.message)}</span></div>
    <div class="pied"><button class="btn btn-sombre" type="button" onclick="route()">Réessayer</button></div>`;
}

// Démarrage
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* site non sécurisé en local */ });
majBandeau();
route();
