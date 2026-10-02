/* FLBTP — Saisie des temps
 * Application web installable. Aucune dépendance : tout est ici.
 *
 * Principes :
 *  - chaque envoi porte un identifiant (idEnvoi) : rejoué après une coupure, il n'est pas compté deux fois ;
 *  - sans réseau, les envois partent dans une file d'attente gardée sur le téléphone, vidée dès que ça capte ;
 *  - le serveur refait tous les contrôles : ceux du téléphone ne servent qu'à prévenir plus tôt.
 */
'use strict';

/**
 * Numéro affiché sur l'écran de connexion et l'écran bureau (plus sur l'accueil des gars : version 48).
 * À augmenter à chaque dépôt de nouveaux fichiers sur GitHub : c'est le seul numéro à changer.
 */
const VERSION_APPLI = '62';

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

function dateCourte(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}` : '';
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
  cadenas: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  horloge: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  attention: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5"/><path d="M12 18h.01"/></svg>',
  photo: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  calendrier: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/></svg>',
  horsReseau: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M10.7 5.1A15 15 0 0 1 22 8.8"/><path d="M5 12.6a10 10 0 0 1 5.2-2.7"/><path d="M14.8 10.3A10 10 0 0 1 19 12.6"/><path d="M12 20h.01"/></svg>',
};

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------

class HorsReseau extends Error {}
class RefusServeur extends Error {}

const LECTURES = ['accueil', 'equipe', 'rapport', 'referentiels', 'liste_personnes', 'photo_bl', 'semaine', 'planning', 'bl_gars'];
const enVol = new Map();

/** Garde les 30 derniers appels pour l'écran de diagnostic (voir ROUTES.diagnostic pour y accéder). */
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
async function envoyer(action, donnees, libelle, idEnvoi = uuid()) {
  // L'envoi garde le nom de son auteur : il ne partira jamais sous le compte de quelqu'un d'autre
  // qui se connecterait ensuite sur ce téléphone.
  const element = { action, donnees, idEnvoi, libelle, date: new Date().toISOString(),
    personne: (stock.lire('session') || {}).personne || '' };
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
    const moi = (stock.lire('session') || {}).personne;
    for (const el of file().filter(x => !x.personne || x.personne === moi)) {
      try {
        const r = await appel(el.action, el.donnees, el.idEnvoi);
        stock.ecrire('file', file().filter(x => x.idEnvoi !== el.idEnvoi));
        // Version 55 : un changement de chantier de BL parti de la file : son état sur la ligne du BL.
        if (el.action === 'deplacer_bl') noterDeplacement(el.donnees.id, { chantier: (r && r.chantier) || el.donnees.chantier, etat: 'ok' });
      } catch (e) {
        if (e instanceof HorsReseau) break;          // on réessaiera plus tard
        // Refus définitif (journée déjà validée, par exemple) : on le retire et on prévient.
        stock.ecrire('file', file().filter(x => x.idEnvoi !== el.idEnvoi));
        if (el.action === 'deplacer_bl') noterDeplacement(el.donnees.id, { chantier: el.donnees.chantier, etat: 'echec', erreur: e.message });
        else stock.ecrire('refus', [...stock.lire('refus', []), { libelle: el.libelle, erreur: e.message }]);
      }
    }
  } finally {
    videEnCours = false;
    majBandeau();
  }
}

function majBandeau() {
  const moi = (stock.lire('session') || {}).personne;
  const n = file().filter(x => !x.personne || x.personne === moi).length;
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
  // Version 54 : sur un écran d'ordinateur, les écrans du bureau s'élargissent (styles.css, « profil-bureau ») ;
  // les gars, les chefs et l'écran de connexion gardent le format téléphone.
  document.body.classList.toggle('profil-bureau', !!(session && session.bureau));
  if (!session) return ecranConnexion();
  // Profil BUREAU : pas de journée à lui (version 35) ; son accueil est l'écran bureau.
  const cle = (!nom || nom === 'accueil' || nom === 'ma-journee') && session.bureau ? 'bureau' : nom;
  const f = ROUTES[cle] || ROUTES.accueil;
  document.body.dataset.ecran = ROUTES[cle] ? cle : 'accueil';     // version 54 : mise en page ordinateur par écran (styles.css)
  window.scrollTo(0, 0);
  ecranAffiche = cle || 'accueil';
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
  ['accueil', 'jours', 'dernierEnvoi', 'refus', 'filtreControles', 'planning', 'blGars'].forEach(stock.effacer);
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

// Écoute du clavier de l'écran du code (ordinateur), retirée à chaque nouvel écran de connexion.
let clavierConnexion = null;

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
        <div><h1>Saisie des temps</h1></div>
        <div class="champ">
          ${!personnes ? '<p class="discret">Connexion au serveur…</p>'
            : personnes.length ? `<div class="liste-noms">${personnes.map(p => `<button type="button" data-nom="${esc(p)}">${esc(p)}</button>`).join('')}</div>`
            : '<p class="discret">Aucun compte n\'est encore ouvert. Contacte le bureau.</p>'}
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
        <p class="discret">Code personnel fourni par le bureau. En cas d'oubli, contacte le bureau.</p>
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
      // Rien de la personne d'avant ne doit s'afficher : écrans gardés, refus, filtre du bureau.
      ['accueil', 'jours', 'ref', 'dernierEnvoi', 'refus', 'filtreControles', 'planning', 'blGars'].forEach(stock.effacer);
      stock.ecrire('session', { jeton: r.jeton, personne: r.personne, type: r.type, prenom: r.prenom, bureau: !!r.bureau });
      stock.ecrire('dernierNom', choisi);
      aller('/accueil');
    } catch (e) {
      enCours = false; code = '';
      erreur = e instanceof HorsReseau ? 'Connexion au serveur impossible. Vérifie ton réseau et réessaie.' : e.message;
      dessiner();
    }
  };

  // Sur ordinateur, le code se tape aussi au clavier : chiffres du haut ou pavé numérique (touche physique,
  // donc même Verr. Num désactivé), Retour arrière / Suppr pour effacer, Entrée pour se connecter.
  if (clavierConnexion) document.removeEventListener('keydown', clavierConnexion);
  clavierConnexion = ev => {
    if (!document.querySelector('.cases-code')) {          // plus sur l'écran du code : on n'écoute plus
      if (!document.querySelector('[data-nom]')) { document.removeEventListener('keydown', clavierConnexion); clavierConnexion = null; }
      return;
    }
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const chiffre = /^(Digit|Numpad)([0-9])$/.exec(ev.code || '');
    if (chiffre) taper(chiffre[2]);
    else if (ev.key === 'Backspace' || ev.key === 'Delete') taper('x');
    else if (ev.key === 'Enter') valider();
    else return;
    ev.preventDefault();
  };
  document.addEventListener('keydown', clavierConnexion);

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

/** L'écran de départ : l'accueil, ou l'écran bureau pour un compte du bureau (qui n'a pas de journée). */
function accueilPerso() {
  return (stock.lire('session') || {}).bureau ? '/bureau' : '/accueil';
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

/** Ordre alphabétique du nom affiché (sans numéro), accents et majuscules ignorés (version 47). */
const ordreAlpha = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
const parNomCourt = (a, b) => ordreAlpha.compare(nomCourt(a), nomCourt(b));

/** Le libellé complet du chantier (numéro, client, commune) ; les communes seules avant la bascule. */
function libellesChantiers(bloc) {
  if (!bloc) return [];
  return (bloc.chantiers && bloc.chantiers.length) ? bloc.chantiers.map(c => c.libelle) : (bloc.villes || []);
}

/**
 * Confirmation dans le style de l'appli (au lieu de la fenêtre du navigateur). Renvoie une promesse :
 * vrai si l'on confirme.
 */
function confirmer(titre, texte, libelleOui) {
  return new Promise(resolve => {
    const voile = document.createElement('div');
    voile.className = 'voile';
    voile.innerHTML = `<div class="boite" role="dialog" aria-modal="true" aria-labelledby="boite-titre">
      <h2 id="boite-titre">${esc(titre)}</h2>${texte ? `<p class="discret">${esc(texte)}</p>` : ''}
      <div class="duo"><button class="btn btn-clair btn-petit" type="button" data-non>Annuler</button>
        <button class="btn btn-principal btn-petit" type="button" data-oui>${esc(libelleOui)}</button></div></div>`;
    const fin = v => { voile.remove(); resolve(v); };
    voile.querySelector('[data-non]').onclick = () => fin(false);
    voile.querySelector('[data-oui]').onclick = () => fin(true);
    voile.onclick = ev => { if (ev.target === voile) fin(false); };
    document.body.appendChild(voile);
    voile.querySelector('[data-oui]').focus();
  });
}
async function demanderDeconnexion() {
  if (await confirmer('Se déconnecter ?', 'Il faudra ressaisir ton code à la prochaine ouverture.', 'Se déconnecter')) {
    stock.effacer('dernierNom'); deconnecter();
  }
}

const LIBELLES_STATUT = {
  SAISIE: ['Envoyée', 'saisie'], VALIDEE_CHEF: ['Validée', 'ok'],
  VALIDEE_BUREAU: ['Validée', 'ok'], EXPORTEE: ['Validée', 'ok'], NON_SAISIE: ['À saisir', 'a-faire'], A_VENIR: ['—', ''],
  JUSTIFIEE: ['Justifiée', 'justifiee'], WEEKEND: ['—', 'weekend'],
  BOUCLEE: ['Bouclée', 'bouclee'],
};
// Version 49 : jour dans l'envoi en paie, envoyé ou traité hors appli (le serveur le dit avec « boucle »).
const MESSAGE_BOUCLE = 'Ce jour est bouclé : adresse-toi au bureau pour toute correction.';
// Version 52 : jour d'avant la mise en service (réglage CONTROLES_DEPUIS) — rien à saisir dans l'appli.
const MESSAGE_AVANT_SERVICE = "Jour d'avant la mise en service de l'appli : rien à saisir ici.";
const jourDeSemaine = (a, date) => ((a && a.semaine) || []).find(x => x.date === date) || {};
/**
 * Absence déclarée par le bureau, vue par un gars ou un chef (version 50) : { chome, motif, court }. Le motif
 * n'arrive que pour sa propre absence ou pour un jour chômé ; pour un autre, seulement « absent ».
 */
const messageAbsence = v => v.chome ? `Jour chômé (${v.motif}). Pas de saisie ce jour-là.`
  : v.motif ? `Absent (${v.motif}), déclaré par le bureau. Vois avec le bureau si nécessaire.` : 'Absent, déclaré par le bureau.';

ROUTES.accueil = async function () {
  const toujoursIci = ecranCourant();
  const session = stock.lire('session');
  const date = aujourdhui();
  let a = stock.lire('accueil');
  if (a && (a.date !== date || (a.personne && a.personne !== session.personne))) a = null;
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
  // Version 45 : les gars partis ailleurs ne sont pas une chose à faire (ils restent visibles, barrés, dans
  // « Équipe du jour ») ; « validée » ne compte que les autres membres, jamais la journée du chef.
  if (!c.rapportEnvoye) lignes.push('rapport à envoyer');
  // Version 55 : même règle que le point « à corriger » du bureau.
  if (c.repas) lignes.push(`<b>repas : ${c.repas.payes} payé${c.repas.payes > 1 ? 's' : ''} au rapport, ${c.repas.declares} déclaré${c.repas.declares > 1 ? 's' : ''} par l'équipe</b>`);
  const rienAFaire = !lignes.length;
  if (rienAFaire) lignes.push(c.validees ? `Équipe validée (${c.validees}) et rapport envoyé. Rien à faire.` : 'Rapport envoyé. Rien à faire.');

  return `
    <div class="alerte ${rienAFaire ? 'vert' : (c.aValider ? 'jaune' : 'rouge')}">
      ${rienAFaire ? ICONES.ok : ICONES.attention}<span>${lignes.join(' · ')}</span>
    </div>
    <div class="duo">
      <button class="btn ${c.rapportEnvoye ? 'btn-sombre' : 'btn-principal'} btn-petit" type="button" onclick="aller('/rapport/${a.date}')">Rapport de chantier</button>
      <button class="btn ${c.aValider ? 'btn-principal' : 'btn-sombre'} btn-petit" type="button" id="boutonEquipe" onclick="aller('/equipe/${a.date}')">${c.aValider ? 'Valider mon équipe' : 'Mon équipe'}</button>
    </div>`;
}

/** L'équipe réelle du jour, sur l'accueil : la même liste que « Valider mon équipe », plus ceux partis ailleurs. */
function equipeAccueil(eqj) {
  const qui = m => m.chef ? (eqj.chefAbsent ? ' <span class="discret">(chef, absent)</span>' : eqj.deFait ? ' <span class="discret">(chef)</span>' : ' <span class="discret">(chef)</span>')
    : m.remplacant ? ' <span class="discret">(remplaçant)</span>' : m.interimaire ? ' <span class="discret">(intérim)</span>'
    : m.origine ? ` <span class="discret">(${esc(m.origine)})</span>` : '';
  const n = eqj.membres.length;
  // Version 50 : un absent déclaré par le bureau passe en fin de liste, en gris, « absent » (jamais le motif d'un autre).
  const absent = m => !!m.absence && !(m.chef && eqj.chefAbsent);
  return `<details class="sep depliant">
      <summary>Équipe du jour (${n})</summary>
      ${eqj.membres.filter(m => !absent(m)).map(m => `<div class="equipier"><span class="qui">${esc(m.personne)}${qui(m)}</span><span class="quoi"></span></div>`).join('')}
      ${eqj.membres.filter(absent).map(m => `<div class="equipier parti"><span class="qui">${esc(m.personne)} <span class="discret">(${m.absence.chome ? 'chômé' : 'absent'})</span></span><span class="quoi"></span></div>`).join('')}
      ${(eqj.partis || []).map(x => `<div class="equipier parti"><span class="qui"><s>${esc(x.personne)}</s> <span class="discret">(${x.seul ? 'parti sur un chantier hors planning' : x.chez ? `parti chez ${esc(x.chez)}` : 'sans équipe'})</span></span><span class="quoi"></span></div>`).join('')}
    </details>`;
}

/** Un chantier de l'accueil, une fois la journée saisie (version 42) : seules les exceptions portent un repère. */
function ligneChantierAccueil(c) {
  const qui = c.ajoutePar && c.ajoutePar.length ? `<span class="qui-ajout">ajouté par ${esc(c.ajoutePar.join(', '))}</span>` : '';
  const repere = c.pasFait ? '<span class="repere pas-fait">Prévu, pas fait</span>' : c.hors ? '<span class="repere hors">Hors planning</span>' : '';
  return `<div class="ch-jour${c.pasFait ? ' pas-fait' : ''}"><span class="chantier">${esc(nomCourt(c.libelle))}${qui}</span>${repere}</div>`;
}

/** Tâches du planning qui suivent les chantiers affichés (version 43) : une par bloc, avec son équipe s'il y en a plusieurs. */
function tachesAccueil(groupes) {
  if (!groupes || !groupes.length) return '';
  const plusieurs = groupes.length > 1;
  return `<div class="sep taches-jour"><span class="sous">Tâches du jour (planning)</span>
    ${groupes.map(g => `${plusieurs ? `<span class="sous groupe-taches">Équipe de ${esc(g.responsable)}</span>` : ''}<p class="a-faire">${esc(g.taches)}</p>`).join('')}</div>`;
}

/** Les cases de « Ma semaine » (versions 49 à 51). */
function casesSemaine(semaine) {
  return semaine.map(s => {
          // Version 50 : un jour où il menait une équipe dit s'il lui reste à faire (« À faire » / « Fait »), et s'ouvre
          // sur la page de ce jour ; une absence montre son motif abrégé (CP, Maladie, Férié…).
          const chef = s.chef && !s.boucle && s.statut !== 'JUSTIFIEE' ? s.chef : null;
          const [lib0, cls] = chef ? (chef.aFaire ? ['À faire', 'chef-a-faire'] : ['Fait', 'ok'])
            : LIBELLES_STATUT[s.boucle && s.statut !== 'JUSTIFIEE' ? 'BOUCLEE' : s.weekend && s.statut === 'NON_SAISIE' ? 'WEEKEND' : s.statut] || ['—', ''];
          const lib = s.statut === 'JUSTIFIEE' && s.justification ? s.justification.court : lib0;
          // Version 49 : un jour bouclé (ou que le serveur dit non modifiable) ne s'ouvre plus, même pas saisi.
          const cliquable = !s.boucle && s.modifiable !== false && (['NON_SAISIE', 'SAISIE'].includes(s.statut) || s.modifiable === true);
          const attr = chef ? `data-jour-chef="${s.date}"` : cliquable ? `data-jour="${s.date}"` : 'disabled';
          const texte = s.justification ? messageAbsence(s.justification) : chef ? (chef.aFaire ? `À faire : ${chef.detail}` : 'Rien à faire') : lib;
          return `<button type="button" class="jour ${cls}" ${attr} aria-label="${esc(dateLongue(s.date))} : ${esc(texte)}" ${s.justification ? `title="${esc(messageAbsence(s.justification))}"` : ''}>
            <b>${esc(jourCourt(s.date))}</b>${cls === 'ok' ? ICONES.ok : cls === 'bouclee' ? ICONES.cadenas : cls === 'chef-a-faire' ? ICONES.attention : '<span style="height:18px"></span>'}<small>${esc(lib)}</small></button>`;
  }).join('');
}
function brancherSemaine() {
  $$('[data-jour]').forEach(b => b.onclick = () => aller('/saisie/' + b.dataset.jour));
  $$('[data-jour-chef]').forEach(b => b.onclick = () => aller('/jour/' + b.dataset.jourChef));
}

function dessinerAccueil(a, session) {
  const j = a.journee;
  const refus = stock.lire('refus', []);
  const bloc = a.bloc;

  let action;
  const boucle = !!jourDeSemaine(a, a.date).boucle;
  // Version 52 : avant la mise en service, l'accueil n'offre rien à saisir (ni journée, ni BL, ni rapport, ni équipe)
  // et ne montre pas le planning du jour (encart « Prévu au planning »).
  const avant = !!a.avantService;
  if (avant) action = `<div class="alerte gris">${ICONES.horloge}<span>L'application démarre le ${esc(dateLongue(a.avantService).toLowerCase())}. D'ici là, continue les carnets papier.</span></div>`;
  else if (!j && a.justification) action = `<div class="alerte jaune">${ICONES.attention}<span>${esc(messageAbsence(a.justification))}</span></div>`;
  else if (boucle && !(j && j.enAttente)) action = `<div class="alerte gris">${ICONES.cadenas}<span>${j ? `Journée bouclée : ${esc(j.hEmbauche)}–${esc(j.hPause)} · ${esc(j.hReprise)}–${esc(j.hDebauche)}. Pour toute correction, adresse-toi au bureau.` : esc(MESSAGE_BOUCLE)}</span></div>`;
  else if (!j) action = `<button class="btn btn-principal" type="button" onclick="aller('/saisie/${a.date}')">Saisir ma journée</button>`;
  else if (j.enAttente) action = `<div class="alerte jaune">${ICONES.horloge}<span>Journée gardée sur ton téléphone : ${esc(j.hEmbauche)}–${esc(j.hPause)} · ${esc(j.hReprise)}–${esc(j.hDebauche)}. Elle partira dès que possible.</span></div>`;
  else if (j.modifiable) action = `<div class="alerte vert">${ICONES.ok}<span>${j.statut === 'VALIDEE_CHEF' ? 'Journée validée' : 'Journée envoyée'} : ${esc(j.hEmbauche)}–${esc(j.hPause)} · ${esc(j.hReprise)}–${esc(j.hDebauche)}</span></div>
    <button class="btn btn-clair btn-petit" type="button" onclick="aller('/saisie/${a.date}')">Corriger ma journée</button>`;
  else if (j.parBureau && a.estResponsable) action = `<div class="alerte vert">${ICONES.ok}<span>Journée validée par le bureau. Pour la modifier, adresse-toi au bureau.</span></div>`;
  else action = `<div class="alerte vert">${ICONES.ok}<span>Journée validée. Pour une correction, vois avec ton chef ou le bureau.</span></div>`;

  // Le bureau ne saisit pas d'heures : son accueil est son écran.
  if (a.estBureau) return aller('/bureau');
  const eqj = a.equipeDuJour;

  APP().innerHTML = `
    <div class="entete">
      <img class="embleme" src="embleme.png" alt="" aria-hidden="true">
      <div><p class="discret">Bonjour ${esc(session.prenom || session.personne)}</p><h1>${esc(dateLongue(a.date))}</h1></div>
      <button class="icone-btn" type="button" aria-label="Planning du bureau" id="voirPlanning">${ICONES.calendrier}</button>
      <button class="icone-btn" type="button" aria-label="Se déconnecter" id="sortir">${ICONES.sortie}</button>
    </div>
    ${refus.length ? `<div class="alerte rouge">${ICONES.attention}<span>${refus.map(r => `<b>${esc(r.libelle)}</b> refusé : ${esc(r.erreur)}`).join('<br>')}</span></div>` : ''}
    ${avant ? '' : a.chantiersDuJour && a.chantiersDuJour.length && !(j && j.enAttente) ? `
      <section class="bloc">
        <div class="bloc-titre">${a.estResponsable ? "Chantiers de l'équipe" : 'Mes chantiers du jour'}</div>
        <div>${a.chantiersDuJour.map(ligneChantierAccueil).join('')}</div>
        ${tachesAccueil(a.tachesDuJour)}
        ${eqj && (bloc || eqj.membres.length > 1) ? equipeAccueil(eqj) : ''}
      </section>`
    : bloc ? `
      <section class="bloc">
        <div class="bloc-titre">Prévu au planning</div>
        <div>${libellesChantiers(bloc).map(c => `<div class="chantier">${esc(nomCourt(c))}</div>`).join('')}</div>
        ${bloc.taches ? `<div class="sep taches-jour"><span class="sous">Tâches du jour</span><p class="a-faire">${esc(bloc.taches)}</p></div>` : ''}
        ${eqj ? equipeAccueil(eqj) : ''}
      </section>`
      : `<section class="bloc"><p>${a.planningTrouve ? "Tu n'es pas au planning aujourd'hui." : "Pas de planning pour aujourd'hui."}</p>
         <p class="discret">${a.planningTrouve ? 'Si tu as travaillé, saisis quand même ta journée.'
           : 'Saisis ta journée en choisissant tes chantiers : tu pourras ensuite faire le rapport et valider ceux qui étaient avec toi.'}</p>
         ${eqj && eqj.membres.length > 1 ? equipeAccueil(eqj) : ''}</section>`}
    ${a.journee && bloc && a.chefDuJour && a.chefDuJour !== bloc.responsable && a.chefDuJour !== session.personne
      ? `<div class="alerte jaune">${ICONES.attention}<span>D'après tes chantiers, tu es aujourd'hui dans l'équipe de <b>${esc(a.chefDuJour)}</b> : c'est lui qui valide ta journée.</span></div>` : ''}
    ${a.chefDeFait && !avant ? `<div class="alerte jaune">${ICONES.attention}<span>Personne n'était prévu sur tes chantiers : tu en es le <b>chef</b> aujourd'hui. Tu fais le rapport (au moins les repas) et tu valides ceux qui te rejoignent ; ta propre journée est validée par le bureau.</span></div>` : ''}
    ${a.remplace && !avant ? `<div class="alerte jaune">${ICONES.attention}<span><b>${esc(a.remplace)}</b> est absent : tu le remplaces aujourd'hui. Tu fais le rapport (au moins les repas) et tu valides l'équipe ; ta propre journée est validée par le bureau.</span></div>` : ''}
    ${action}
    ${a.estResponsable && !avant ? resumeChef(a, session.personne) : ''}
    ${avant ? '' : `<div class="duo duo-bl"><label class="btn btn-sombre btn-petit btn-bl" id="boutonBl">${ICONES.photo} Photo de BL<input type="file" accept="image/*" capture="environment" id="photoBl"></label>
      <button class="btn btn-clair btn-petit" type="button" id="mesBl" onclick="aller('/bl')">Mes BL</button></div>`}
    <div class="pied">
      <div class="semaine-nav"><button type="button" class="fleche" id="semPrec" aria-label="Semaine précédente">‹</button>
        <span class="sous" id="semTitre">Ma semaine</span>
        <button type="button" class="fleche" id="semSuiv" aria-label="Semaine suivante">›</button></div>
      <div class="semaine" id="semaine">${casesSemaine(a.semaine)}</div>
    </div>`;
  $('#sortir').onclick = demanderDeconnexion;
  $('#voirPlanning').onclick = () => aller('/planning');
  // Version 52 : BL depuis l'accueil. Version 55 : les chefs aussi (mêmes boutons que les gars, sous Rapport / Équipe),
  // en plus de la photo depuis leur rapport — un gars peut devenir chef de fait, l'écran reste le même.
  if ($('#photoBl')) $('#photoBl').onchange = ev => { photoBlPrise = ev.target.files[0] || null; if (photoBlPrise) aller('/bl'); };
  appuiLong($('.entete .embleme'), () => aller('/diagnostic'));
  brancherSemaine();
  // Version 51 : les flèches font défiler « Ma semaine », de 4 semaines en arrière à 2 en avant (réseau nécessaire).
  let decalage = 0;
  const lundi = n => { const d = new Date(aujourdhui() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7 * n); return d.toISOString().slice(0, 10); };
  const bornes = () => { $('#semPrec').disabled = decalage <= -4; $('#semSuiv').disabled = decalage >= 2; };
  const changer = async sens => {
    const voulu = decalage + sens;
    if (voulu < -4 || voulu > 2) return;
    $('#semaine').style.opacity = '.4';
    try {
      const sem = voulu === 0 ? a.semaine : (await appel('semaine', { date: lundi(voulu) })).semaine;
      if (!document.body.contains($('#semaine'))) return;
      decalage = voulu;
      $('#semaine').innerHTML = casesSemaine(sem);
      $('#semTitre').textContent = decalage === 0 ? 'Ma semaine' : `Semaine du ${lundi(decalage).slice(8, 10)}/${lundi(decalage).slice(5, 7)}`;
      brancherSemaine();
    } catch (err) { toast(err instanceof HorsReseau ? 'Pas de réseau : seule la semaine en cours est affichée.' : err.message); }
    if ($('#semaine')) $('#semaine').style.opacity = '';
    bornes();
  };
  $('#semPrec').onclick = () => changer(-1);
  $('#semSuiv').onclick = () => changer(1);
  bornes();
  if (refus.length) stock.effacer('refus');
}

/**
 * Page d'un jour où il menait une équipe (version 50), ouverte depuis « Ma semaine » : ce qui reste à faire ce
 * jour-là (même alerte que l'accueil), puis « Ma journée », « Rapport de chantier » et « Mon équipe ».
 */
ROUTES.jour = async function (date) {
  date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : aujourdhui();
  const toujoursIci = ecranCourant();
  const session = stock.lire('session');
  chargement();
  let a;
  try { a = await appel('accueil', { date }); } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;
  const j = a.journee;
  const s = jourDeSemaine(a, date);
  const maJournee = s.boucle ? '' : j && j.modifiable ? `<button class="btn btn-clair btn-petit" type="button" id="maJournee">Ma journée : ${esc(j.hEmbauche)}–${esc(j.hDebauche)}, corriger</button>`
    : !j && !a.justification ? '<button class="btn btn-principal btn-petit" type="button" id="maJournee">Saisir ma journée</button>'
    : j ? `<p class="discret">Ma journée : ${esc(j.hEmbauche)}–${esc(j.hPause)} · ${esc(j.hReprise)}–${esc(j.hDebauche)}, validée.</p>` : '';
  APP().innerHTML = `
    <div class="entete">
      <button class="retour" type="button" aria-label="Retour" onclick="aller(accueilPerso())">${ICONES.retour}</button>
      <div><h1>${esc(dateLongue(date))}</h1><p class="discret">${a.chef ? (a.remplace ? `Tu remplaçais ${esc(a.remplace)}` : "Tu menais l'équipe") : ''}</p></div>
    </div>
    ${s.boucle ? `<div class="alerte gris">${ICONES.cadenas}<span>${esc(MESSAGE_BOUCLE)}</span></div>` : ''}
    ${a.chef ? resumeChef(a, session.personne) : '<section class="bloc"><p class="discret">Tu ne menais pas d\'équipe ce jour-là.</p></section>'}
    ${maJournee ? `<div class="pied">${maJournee}</div>` : ''}`;
  if ($('#maJournee')) $('#maJournee').onclick = () => aller('/saisie/' + date);
};

// ---------------------------------------------------------------------------
// Bon de livraison depuis l'accueil (version 52)
// ---------------------------------------------------------------------------

let photoBlPrise = null;                   // photo tout juste prise depuis l'accueil, en attente de son chantier

/** Les chantiers proposés pour un BL : groupe par groupe (les siens, ceux du jour, les récents). */
function optionsChantiersBl(chantiers, actuel) {
  // Version 55 : « Autres chantiers » (écran « BL récents » du bureau) et « Chantier actuel » s'il n'est dans aucun groupe.
  const groupes = [['actuel', 'Chantier actuel'], ['miens', 'Mes chantiers du jour'], ['jour', 'Autres chantiers du jour'], ['recents', 'Chantiers récents'], ['jourBureau', 'Chantiers du jour'], ['tous', 'Autres chantiers']];
  const liste = actuel && !chantiers.some(c => c.libelle === actuel) ? [{ libelle: actuel, groupe: 'actuel' }, ...chantiers] : chantiers;
  return groupes.map(([g, titre]) => {
    const l = liste.filter(c => c.groupe === g);
    return l.length ? `<optgroup label="${esc(titre)}">${l.map(c => `<option value="${esc(c.libelle)}" ${c.libelle === actuel ? 'selected' : ''}>${esc(nomCourt(c.libelle))}</option>`).join('')}</optgroup>` : '';
  }).join('');
}

/**
 * Version 55 : changer le chantier d'un BL. On choisit dans la liste, puis « Ranger ici » (un doigt qui glisse ne
 * déplace plus rien). La demande est gardée dans la file du téléphone AVANT de partir : ni une coupure de réseau,
 * ni l'appli fermée, ni un changement d'écran ne la perdent ; elle repart toute seule. L'état de chaque BL
 * (en cours, en attente de réseau, rangé, échec) est gardé sur le téléphone et affiché sur sa ligne : aucun message
 * n'arrive sur un autre écran. Le serveur répond sans attendre le rangement de la photo dans Drive.
 */
const CLE_DEPLACEMENTS = 'deplacementsBl';
let surDeplacement = null;                 // l'écran affiché qui montre des BL : de quoi le redessiner
function etatsDeplacement() { return stock.lire(CLE_DEPLACEMENTS, {}); }
function noterDeplacement(id, v) {
  const t = etatsDeplacement();
  t[id] = Object.assign({ quand: Date.now() }, v);
  Object.keys(t).forEach(k => { if (Date.now() - t[k].quand > 3 * 86400000) delete t[k]; });
  stock.ecrire(CLE_DEPLACEMENTS, t);
  if (surDeplacement) surDeplacement();
}
async function deplacerBlFiable(id, chantier) {
  const el = { action: 'deplacer_bl', donnees: { id, chantier }, idEnvoi: uuid(), libelle: `BL rangé sous ${nomCourt(chantier)}`,
    date: new Date().toISOString(), personne: (stock.lire('session') || {}).personne || '' };
  stock.ecrire('file', [...file(), el]);
  noterDeplacement(id, { chantier, etat: 'encours' });
  try {
    const r = await appel(el.action, el.donnees, el.idEnvoi);
    stock.ecrire('file', file().filter(x => x.idEnvoi !== el.idEnvoi));
    noterDeplacement(id, { chantier: r.chantier || chantier, etat: 'ok' });
  } catch (e) {
    if (e instanceof HorsReseau) { noterDeplacement(id, { chantier, etat: 'attente' }); majBandeau(); return; }
    stock.ecrire('file', file().filter(x => x.idEnvoi !== el.idEnvoi));
    noterDeplacement(id, { chantier, etat: 'echec', erreur: e.message });
  }
}
/** Le chantier affiché pour un BL : celui demandé s'il est en cours, en attente ou rangé, sinon celui du serveur. */
function chantierAffiche(b) {
  const e = etatsDeplacement()[b.id];
  return e && e.etat !== 'echec' ? e.chantier : b.chantier;
}
/** Liste « Chantier de ce BL », bouton « Ranger ici » (caché tant que rien n'a changé) et état du rangement. */
function champDeplacementBl(b, k, chantiers, modifiable) {
  const e = etatsDeplacement()[b.id];
  const actuel = chantierAffiche(b);
  const etat = !e ? '' : {
    encours: '<span class="bl-etat">Rangement…</span>',
    attente: '<span class="bl-etat attente">En attente de réseau : partira tout seul</span>',
    ok: Date.now() - e.quand < 10 * 60000 ? `<span class="bl-etat ok">Rangé ✓</span>` : '',
    echec: `<span class="bl-etat echec">Échec : ${esc(e.erreur || '')}</span>`,
  }[e.etat];
  return `<select data-bl-deplacer="${k}" aria-label="Chantier de ce BL" ${modifiable && !(e && e.etat === 'encours') ? '' : 'disabled'}>${optionsChantiersBl(chantiers, actuel)}</select>
    <button class="btn btn-sombre btn-petit" type="button" data-bl-ranger="${k}" hidden>Ranger ici</button>
    ${modifiable ? etat : '<span class="discret">Jour bouclé</span>'}`;
}
/** Branche les listes et boutons de champDeplacementBl ; `bls` : les BL dans l'ordre des indices k. */
function brancherDeplacementBl(bls) {
  $$('[data-bl-deplacer]').forEach(sel => {
    const k = +sel.dataset.blDeplacer;
    const bouton = $(`[data-bl-ranger="${k}"]`);
    sel.onchange = () => { bouton.hidden = sel.value === chantierAffiche(bls[k]); };
    bouton.onclick = () => { bouton.hidden = true; deplacerBlFiable(bls[k].id, sel.value); };
  });
}

/** Vignettes (≈ 10 Ko) des BL envoyés depuis l'accueil, par numéro d'envoi, gardées 10 jours au plus. */
const CLE_APERCUS_ENVOI = 'flbtp.apercusBlEnvoi';
function apercuEnvoi(cle) { try { return (JSON.parse(localStorage.getItem(CLE_APERCUS_ENVOI) || '{}')[cle] || {}).a || ''; } catch (e) { return ''; } }
function garderApercuEnvoi(cle, apercu) {
  try {
    const tous = JSON.parse(localStorage.getItem(CLE_APERCUS_ENVOI) || '{}');
    tous[cle] = { a: apercu, t: Date.now() };
    Object.keys(tous).forEach(k => { if (Date.now() - tous[k].t > 10 * 86400000) delete tous[k]; });
    localStorage.setItem(CLE_APERCUS_ENVOI, JSON.stringify(tous));
  } catch (e) { /* mémoire pleine : pas de vignette, rien de grave */ }
}

/**
 * Photo de BL prise depuis l'accueil : on choisit son chantier (les siens du jour en gros boutons ; les autres
 * chantiers du jour et les chantiers récents dans une liste), puis « Envoyer le BL ». En dessous, ses BL des
 * 10 derniers jours, dont il peut encore changer le chantier tant que leur jour n'est pas bouclé.
 */
ROUTES.bl = async function () {
  const date = aujourdhui();
  const toujoursIci = ecranCourant();
  let photo = null, choisi = '', donnees = stock.lire('blGars');
  if (donnees && donnees.date !== date) donnees = null;
  const enAttente = () => file().filter(x => x.action === 'ajouter_bl' && x.personne === (stock.lire('session') || {}).personne).length;
  const prendre = async f => {
    photo = { apercu: '', image: '' }; dessiner();
    const [image, apercu] = await Promise.all([redimensionner(f), redimensionner(f, 240, 0.6)]);
    photo = { image, apercu };
    if (toujoursIci()) dessiner();
  };
  const dessiner = () => {
    const ch = donnees ? donnees.chantiers : [];
    const miens = ch.filter(c => c.groupe === 'miens');
    if (!choisi && miens.length === 1) choisi = miens[0].libelle;
    const autres = ch.filter(c => c.groupe !== 'miens');
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="aller(accueilPerso())">${ICONES.retour}</button>
        <div><h1>Bon de livraison</h1><p class="discret">Aujourd'hui, ${esc(dateLongue(date).toLowerCase())}</p></div>
      </div>
      ${photo ? `
      <section class="bloc">
        <div class="bl-apercu"${photo.apercu ? ` style="background-image:url('${photo.apercu}')"` : ''}>${photo.apercu ? '' : '<span class="discret">Préparation…</span>'}</div>
        <span class="sous">Pour quel chantier ?</span>
        ${!donnees ? '<p class="discret">Chargement des chantiers…</p>' : `
        ${miens.length ? `<div class="choix bl-chantiers" style="--n:1">${miens.map(c => `<button type="button" data-bl-ch="${esc(c.libelle)}" aria-pressed="${c.libelle === choisi}">${esc(nomCourt(c.libelle))}</button>`).join('')}</div>` : ''}
        ${autres.length ? `<select id="blAutre" aria-label="Autre chantier">
          <option value="">${miens.length ? 'Autre chantier…' : 'Choisir le chantier…'}</option>${optionsChantiersBl(autres, miens.some(c => c.libelle === choisi) ? '' : choisi)}</select>` : ''}`}
      </section>
      <p class="erreur-champ" id="erreur" role="alert"></p>
      <div class="pied">
        <button class="btn btn-principal" type="button" id="envoyerBl" ${choisi && photo.image ? '' : 'disabled'}>Envoyer le BL</button>
        <label class="btn btn-clair btn-petit btn-bl">Reprendre la photo<input type="file" accept="image/*" capture="environment" data-reprendre></label>
      </div>` : `
      <label class="btn btn-principal btn-bl">${ICONES.photo} Prendre une photo de BL<input type="file" accept="image/*" capture="environment" data-reprendre></label>`}
      ${enAttente() ? `<div class="alerte jaune">${ICONES.horloge}<span>${enAttente()} BL en attente de réseau : ${enAttente() > 1 ? 'ils partiront' : 'il partira'} tout seul${enAttente() > 1 ? 's' : ''}.</span></div>` : ''}
      ${donnees && donnees.derniers.length ? `
      <section class="bloc">
        <h2>Mes derniers BL</h2>
        ${donnees.derniers.map((b, k) => `
          <div class="bl-ligne">
            <button type="button" class="bl-vignette" data-bl-voir="${k}" aria-label="Voir le bon de livraison"${(b.vignette || apercuEnvoi(b.cle)) ? ` style="background-image:url('${b.vignette || apercuEnvoi(b.cle)}')"` : ''}>${(b.vignette || apercuEnvoi(b.cle)) ? '' : '<span class="voir">Voir</span>'}</button>
            <div class="bl-infos"><span class="sous">${esc(dateLongue(b.date))}</span>
              ${champDeplacementBl(b, k, donnees.chantiers, b.modifiable)}</div>
          </div>`).join('')}
      </section>` : ''}`;
    $$('[data-reprendre]').forEach(i => i.onchange = ev => { const f = ev.target.files[0]; if (f) prendre(f); });
    $$('[data-bl-ch]').forEach(b => b.onclick = () => { choisi = b.dataset.blCh; dessiner(); });
    if ($('#blAutre')) $('#blAutre').onchange = ev => { if (ev.target.value) { choisi = ev.target.value; dessiner(); } };
    if ($('#envoyerBl')) $('#envoyerBl').onclick = envoyerBl;
    if (donnees) brancherDeplacementBl(donnees.derniers);
    // Version 55 : toucher la vignette ouvre le BL en grand (photo lue dans Drive par le serveur).
    $$('[data-bl-voir]').forEach(v => v.onclick = () => {
      const b = donnees.derniers[+v.dataset.blVoir];
      voirPhoto(chantierAffiche(b), () => appel('photo_bl', { date: b.date, id: b.id }).then(r => r.image));
    });
  };
  surDeplacement = () => { if (toujoursIci()) dessiner(); };
  const envoyerBl = async () => {
    const bouton = $('#envoyerBl'); bouton.disabled = true; bouton.textContent = 'Envoi…';
    const cle = uuid();
    try {
      const r = await envoyer('ajouter_bl', { date, chantier: choisi, image: photo.image, apercu: photo.apercu }, `Photo de BL — ${nomCourt(choisi)}`, cle);
      garderApercuEnvoi(cle, photo.apercu);
      toast(r.enAttente ? 'BL gardé, il partira avec le réseau.' : `BL envoyé : ${nomCourt(choisi)}.`);
      aller(accueilPerso());
    } catch (err) {
      $('#erreur').textContent = err.message; bouton.disabled = false; bouton.textContent = 'Envoyer le BL';
    }
  };
  if (photoBlPrise) { const f = photoBlPrise; photoBlPrise = null; prendre(f); } else dessiner();
  try {
    const r = await appel('bl_gars', { date });
    donnees = r; stock.ecrire('blGars', r);
  } catch (err) {
    if (!(err instanceof HorsReseau) && toujoursIci()) toast(err.message);
  }
  if (toujoursIci()) dessiner();
};

// ---------------------------------------------------------------------------
// Planning du bureau (version 52)
// ---------------------------------------------------------------------------

/** Prochain jour du lundi au vendredi après `iso` (même règle que le serveur). */
function prochainJourOuvre(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/**
 * Le planning tel que le bureau l'a écrit, pour aujourd'hui et le prochain jour ouvré : une carte par équipe,
 * la sienne d'abord. Le dernier planning chargé de chaque jour est gardé sur le téléphone (lecture sans réseau).
 */
ROUTES.planning = async function (param) {
  const auj = aujourdhui();
  const suivant = prochainJourOuvre(auj);
  const date = param === suivant ? suivant : auj;
  const toujoursIci = ecranCourant();
  const jj = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const garde = () => { const g = stock.lire('planning', {}); return g[date] || null; };
  const carte = b => `
    <section class="bloc pl-bloc${b.moi ? ' moi' : ''}">
      <div class="bloc-titre"><span>${b.chantiers.map(c => esc(nomCourt(c))).join('<br>')}</span>${b.moi ? '<span class="tag">Ton équipe</span>' : ''}</div>
      ${b.taches ? `<div><span class="sous">Tâches</span><p class="a-faire">${esc(b.taches)}</p></div>` : ''}
      <div class="pl-noms">${[...b.equipe.filter(m => !m.absent), ...b.equipe.filter(m => m.absent)].map(m =>
        `<span class="${m.absent ? 'absent' : ''}">${esc(m.nom)}${m.chef && m.absent ? ` (chef, ${esc(m.absent)})` : m.chef ? ' (chef)' : m.absent ? ` (${esc(m.absent)})` : ''}</span>`).join('')}</div>
      ${b.infos.length ? `<dl class="pl-infos sep">${b.infos.map(x => `<dt>${esc(x.titre)}</dt><dd>${x.lignes.map(l => `<div>${esc(l)}</div>`).join('')}</dd>`).join('')}</dl>` : ''}
    </section>`;
  const dessiner = (g, horsReseau) => {
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="aller(accueilPerso())">${ICONES.retour}</button>
        <div><h1>Planning du bureau</h1></div>
      </div>
      <div class="choix pl-jours" style="--n:2">
        <button type="button" data-jour-pl="${auj}" aria-pressed="${date === auj}">Aujourd'hui<br><small>${esc(jourCourt(auj))} ${jj(auj)}</small></button>
        <button type="button" data-jour-pl="${suivant}" aria-pressed="${date === suivant}">${esc(dateLongue(suivant).split(' ')[0])}<br><small>${jj(suivant)}</small></button>
      </div>
      ${horsReseau ? `<div class="alerte jaune">${ICONES.attention}<span>${g ? 'Pas de réseau : dernier planning chargé sur ce téléphone.' : "Pas de réseau, et ce planning n'a jamais été chargé sur ce téléphone."}</span></div>` : ''}
      ${!g ? '' : g.avantService ? `<section class="bloc"><p>Planning visible à partir du ${esc(dateLongue(g.avantService).toLowerCase())}, jour de démarrage de l'appli.</p></section>`
        : !g.trouve ? '<section class="bloc"><p>Planning pas encore disponible pour ce jour.</p><p class="discret">Le bureau le prépare : reviens plus tard.</p></section>'
        : !g.blocs.length ? '<section class="bloc"><p>Aucune équipe au planning ce jour-là.</p></section>'
        : g.blocs.map(carte).join('')}
      ${g && g._recu ? `<p class="pl-maj">Chargé à ${new Date(g._recu).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>` : ''}`;
    $$('[data-jour-pl]').forEach(b => b.onclick = () => aller('/planning/' + b.dataset.jourPl));
  };
  const g0 = garde();
  if (g0) dessiner(g0); else chargement();
  try {
    const r = await appel('planning', { date });
    r._recu = Date.now();
    const tout = stock.lire('planning', {});
    // Seuls aujourd'hui et le jour suivant restent gardés.
    stock.ecrire('planning', Object.fromEntries(Object.entries(Object.assign(tout, { [date]: r })).filter(([d]) => d === auj || d === suivant)));
    if (toujoursIci()) dessiner(r);
  } catch (err) {
    if (!toujoursIci()) return;
    if (err instanceof HorsReseau) dessiner(g0, true); else erreurEcran(err);
  }
};

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
  const chantiers = ref.chantiers;
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
        <input id="nomInterimaire" type="text" autocomplete="off" value="${esc(e.nomInterimaire)}" data-champ="nomInterimaire" ${options.nomVerrouille ? 'readonly' : ''}>
        <p class="erreur-champ" id="avertNom" role="alert"></p><p class="discret avert-proche" id="procheNom"></p></div>
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
          ${chantiers.filter(c => !e.chantiers.includes(c.libelle)).sort((a, b) => parNomCourt(a.libelle, b.libelle)).map(c => `<option value="${esc(c.libelle)}">${esc(nomCourt(c.libelle))}</option>`).join('')}
        </select>
      </div>`}
      <div class="champ">
        <label for="lieuEmbauche">Lieu d'embauche</label>
        <select id="lieuEmbauche" data-champ="lieuEmbauche">
          ${e.lieuEmbauche ? '' : '<option value="">Choisir…</option>'}
          ${e.chantiers.length ? `<optgroup label="Sur le chantier">${e.chantiers.map(c => `<option value="${esc(c)}" ${c === e.lieuEmbauche ? 'selected' : ''}>${esc(nomCourt(c))}</option>`).join('')}</optgroup>` : ''}
          <optgroup label="Au dépôt"><option value="${esc(ref.depot)}" ${e.lieuEmbauche === ref.depot ? 'selected' : ''}>Dépôt d'Objat</option></optgroup>
          <optgroup label="Ailleurs (fournisseur, autre commune)">
            ${communes.filter(l => !e.chantiers.includes(l.libelle)).sort((a, b) => parNomCourt(a.libelle, b.libelle)).map(l => `<option ${l.libelle === e.lieuEmbauche ? 'selected' : ''}>${esc(l.libelle)}</option>`).join('')}
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

/** Même normalisation que le serveur (majuscules, sans accents ni ponctuation, ST → SAINT). */
function normaliserNom(texte) {
  const ABREV = { ST: 'SAINT', STE: 'SAINTE' };
  return String(texte || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).map(m => ABREV[m] || m).join(' ');
}
/**
 * Intérimaire tapé qui est déjà dans PERSONNES : pas de saisie libre, sinon doublon dans le Suivi RH.
 * Même règle que le serveur (version 40, mot à mot) : forme exacte (libellé, ancienne graphie, onglet RH), ou
 * nom complet + prénom ou initiale, ou prénom complet + initiale du nom. Le serveur refuse aussi.
 */
function correspondPersonne(p, texte) {
  const n = normaliserNom(texte);
  if (!n) return false;
  if (p.exactes.includes(n)) return true;
  const mots = n.split(' '), nom = p.nom || [], prenom = p.prenom || [];
  if (!nom.length) return false;
  const initiale = (m, liste) => m.length === 1 && liste.some(x => x[0] === m);
  if (nom.every(m => mots.includes(m))) return mots.filter(m => !nom.includes(m)).every(m => prenom.includes(m) || initiale(m, prenom));
  if (prenom.length && prenom.every(m => mots.includes(m))) {
    const reste = mots.filter(m => !prenom.includes(m));
    return reste.length > 0 && reste.every(m => initiale(m, nom));
  }
  return false;
}
function ecart(a, b) {                          // nombre de lettres à changer pour passer de a à b
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
function messageDejaPersonne(nom, pourBureau) {
  const personnes = (stock.lire('ref') || {}).personnesConnues || [];
  const p = personnes.find(x => correspondPersonne(x, nom));
  if (!p) return '';
  return p.actif
    ? `${nom.trim()} est dans la liste des personnes (${p.libelle}) : utilise « ${pourBureau ? "Saisir pour quelqu'un" : 'Ajouter un gars'} ».`
    : `${nom.trim()} est dans la liste des personnes (${p.libelle}) mais inactif : à réactiver dans PERSONNES, demande au bureau.`;
}
/** Nom proche d'un nom de famille connu (une lettre près, noms de 4 lettres et plus) : avertir sans bloquer.
 *  Version 41 : le conseil suit l'état de la personne (inactive : à réactiver) et l'écran (bureau : « Saisir pour quelqu'un »). */
function avertissementNomProche(nom, pourBureau) {
  const mots = normaliserNom(nom).split(' ').filter(m => m.length >= 4);
  const p = ((stock.lire('ref') || {}).personnesConnues || []).find(x => (x.nom || []).some(n => n.length >= 4 && mots.some(m => m !== n && ecart(m, n) <= 1)));
  if (!p) return '';
  const qui = `Vouliez-vous dire ${p.libelle} (${(p.nom || []).join(' ')}) ?`;
  return p.actif
    ? `${qui} Si c'est bien lui, utilise « ${pourBureau ? "Saisir pour quelqu'un" : 'Ajouter un gars'} ». Sinon, tu peux continuer.`
    : `${qui} Il est inactif dans PERSONNES : si c'est bien lui, il faut le réactiver${pourBureau ? '' : ' (demande au bureau)'}. Sinon, tu peux continuer.`;
}

/** Mêmes règles que le serveur, pour prévenir avant l'envoi. */
function controler(e, interimaire) {
  if (interimaire && e.nomInterimaire.trim().length < 3) return "Indique le nom de l'intérimaire.";
  if (!e.chantiers.length) return 'Choisis au moins un chantier.';
  if (!e.lieuEmbauche) return "Indique le lieu d'embauche.";
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
  if (jourDeSemaine(a, date).avantService) { toast(MESSAGE_AVANT_SERVICE); return aller(accueilPerso()); }
  if (jourDeSemaine(a, date).boucle) { toast(MESSAGE_BOUCLE); return aller(accueilPerso()); }
  if (a && a.journee && !a.journee.modifiable) { toast('Journée déjà validée.'); return aller(accueilPerso()); }
  const absence = a && !a.journee && (a.justification || ((a.semaine || []).find(x => x.date === date) || {}).justification);
  if (absence) { toast(messageAbsence(absence)); return aller(accueilPerso()); }

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
        valideeDOffice: !!(r.reponse && r.reponse.journee && r.reponse.journee.statut === 'VALIDEE_CHEF'),
        equipe: (r.reponse && r.reponse.equipe) || null, chefPrevu: a && a.bloc ? a.bloc.responsable : '' });
      memoriserJournee(date, e, r);
      // Son équipe a pu changer (chantiers déclarés) : l'accueil sera redemandé au serveur.
      if (!r.enAttente) oublierJour(date);
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
  if (!d) return aller(accueilPerso());
  const e = d.etat;
  const [a, b, c, f] = [e.hEmbauche, e.hPause, e.hReprise, e.hDebauche].map(minutes);
  const eq = d.equipe || {};
  const moi = (stock.lire('session') || {}).personne;
  // Il devient chef ce jour-là sans en avoir l'habitude : on le lui dit clairement, avec le rapport à portée.
  const nouveauChef = !d.enAttente && (eq.chefDeFait || eq.remplace);
  const texte = d.enAttente ? "Pas de réseau pour l'instant. Elle partira toute seule dès que le téléphone capte. Tu n'as rien à refaire."
    : d.valideeDOffice ? "Tu es le chef : elle est validée d'office."
    : nouveauChef ? 'Elle sera validée par le bureau.'
    : eq.chefDuJour && eq.chefDuJour !== moi ? (d.chefPrevu && eq.chefDuJour !== d.chefPrevu
      ? `D'après tes chantiers, tu es aujourd'hui dans l'équipe de ${eq.chefDuJour} : c'est lui qui la validera.` : `${eq.chefDuJour} la validera.`)
    : 'Ton chef la validera.';
  APP().innerHTML = `
    <div class="centre" style="display:flex;flex-direction:column;gap:14px;margin-top:24px">
      <div class="rond ${d.enAttente ? '' : 'vert'}">${d.enAttente ? ICONES.horsReseau : ICONES.ok.replace(/18/g, '36')}</div>
      <h1>${d.enAttente ? 'Journée gardée sur ton téléphone' : 'Journée envoyée'}</h1>
      <p class="discret">${esc(texte)}</p>
    </div>
    ${nouveauChef ? `<div class="alerte jaune">${ICONES.attention}<span>${eq.remplace
      ? `<b>${esc(eq.remplace)}</b> est absent : <b>tu le remplaces aujourd'hui</b>.`
      : `Personne n'était prévu sur ${esc((eq.chantiers || []).map(nomCourt).join(', ') || 'ce chantier')} : <b>tu en es le chef aujourd'hui</b>.`}
      C'est toi qui fais le <b>rapport de chantier</b> (au moins le nombre de repas payés) et qui valides ceux qui travaillent avec toi.</span></div>
      <button class="btn btn-principal" type="button" onclick="aller('/rapport/${e.date}')">Faire le rapport maintenant</button>` : ''}
    <section class="bloc">
      <div class="resume"><span>Jour</span><span>${esc(dateLongue(e.date))}</span></div>
      <div class="resume"><span>Chantier</span><span>${esc(e.chantiers.join(', '))}</span></div>
      <div class="resume"><span>Horaires</span><span>${esc(e.hEmbauche)}–${esc(e.hPause)} · ${esc(e.hReprise)}–${esc(e.hDebauche)}</span></div>
      <div class="resume"><span>Total</span><span>${duree((b - a) + (f - c))}</span></div>
      <div class="resume"><span>Trajet</span><span>${esc(e.trajet)}</span></div>
      <div class="resume"><span>Tâches avant chantier</span><span>${e.avecTaches ? esc(e.tachesSuppMin) + ' min' : 'Non'}</span></div>
      <div class="resume"><span>Repas</span><span>${esc({ AUCUN: 'Aucun', PANIER: 'Panier', RESTAURANT: 'Restaurant' }[e.repas])}</span></div>
    </section>
    <div class="pied"><button class="btn ${nouveauChef ? 'btn-clair' : 'btn-sombre'}" type="button" onclick="aller(accueilPerso())">Retour à ma semaine</button></div>`;
};

// ---------------------------------------------------------------------------
// Écran : rapport de chantier (responsable du bloc)
// ---------------------------------------------------------------------------

/**
 * Liste des matériaux (plus de cent). Version 60 : les matériaux fréquents (FREQUENT = OUI au référentiel) en tête,
 * dans un groupe « Fréquents ». Version 62 : plus de familles, le reste est « Tous les matériaux », par ordre alphabétique
 * (nombres dans l'ordre naturel : 2/4, 4/6, 6/10, 10/14 ; accents et majuscules ignorés). Un fréquent figure aussi dans « Tous ».
 */
const triAlpha = (a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
function groupesMateriaux(liste) {
  // Version 62 : plus de familles ; « Fréquents » en tête, puis tous les matériaux par ordre alphabétique.
  const parNom = l => [...l].sort((a, b) => triAlpha(a.materiau, b.materiau));
  const tous = { libelle: 'Tous les matériaux', materiaux: parNom(liste) };
  const frequents = parNom(liste.filter(x => x.frequent));
  return frequents.length ? [{ libelle: 'Fréquents', materiaux: frequents }, tous] : [tous];
}
/**
 * Version 61 : recherche d'un matériau par morceaux du nom. Accents et majuscules ignorés, point = virgule (0.10 = 0,10) ; chaque mot
 * tapé doit se trouver quelque part dans le nom (« pvc 125 » → « PVC 125 CR8 3ML », « fonte 30 » → « GRILLE FONTE PLATE 30X30 »).
 * Rien de tapé : « Fréquents » puis « Tous les matériaux » (version 62 : plus de familles). Sinon : les correspondances,
 * fréquents d'abord, par ordre alphabétique.
 */
const cleRecherche = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\./g, ',');
function chercherMateriaux(liste, texte) {
  const mots = cleRecherche(texte).split(/\s+/).filter(Boolean);
  if (!mots.length) return groupesMateriaux(liste);
  const trouves = liste.filter(x => { const n = cleRecherche(x.materiau); return mots.every(m => n.includes(m)); })
    .sort((a, b) => (b.frequent ? 1 : 0) - (a.frequent ? 1 : 0) || triAlpha(a.materiau, b.materiau));
  return trouves.length ? [{ libelle: `${trouves.length} matériau${trouves.length > 1 ? 'x' : ''}`, materiaux: trouves }] : [];
}
/** Liste des résultats sous le champ de recherche ; les matériaux déjà sur le chantier sont grisés. */
function resultatsMateriaux(liste, texte, pris) {
  const groupes = chercherMateriaux(liste, texte);
  if (!groupes.length) return `<p class="discret aucun">Aucun matériau ne contient « ${esc(String(texte).trim())} ».</p>`;
  return groupes.map(g => `<p class="groupe">${esc(g.libelle)}</p>${g.materiaux.map(x => pris.includes(x.materiau)
    ? `<button type="button" class="resultat" disabled>${esc(x.materiau)} <span class="discret">— déjà sur ce chantier</span></button>`
    : `<button type="button" class="resultat" data-choix="${esc(x.materiau)}">${esc(x.materiau)}</button>`).join('')}`).join('');
}

/**
 * Petites vignettes (≈ 10 Ko) des BL envoyés depuis ce téléphone, pour que la case d'un BL déjà envoyé
 * ne soit pas grise. La photo en grand se demande au serveur en touchant la case (version 48).
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

/**
 * Photo en plein écran (version 48). « charger » renvoie l'image (data URL). Toucher la photo passe de
 * « tout l'écran » à la taille réelle, que l'on parcourt du doigt ; « × » ou le retour du téléphone ferme.
 */
/**
 * `deplacer` (version 52, facultatif) : { id, date, actuel, modifiable, apres(chantier) } — une liste « Chantier de ce BL »
 * sous la photo, pour le chef du chantier et le bureau ; changer de chantier range le BL sous l'autre chantier.
 * Version 57 : `modifiable` faux (jour bouclé) grise la liste (« Jour bouclé »), comme dans « Mes BL » ; un rangement
 * refusé par le serveur remet le BL sous son chantier d'origine (titre et rapport).
 */
function voirPhoto(titre, charger, deplacer) {
  const voile = document.createElement('div');
  voile.className = 'visionneuse';
  voile.setAttribute('role', 'dialog');
  voile.setAttribute('aria-modal', 'true');
  voile.innerHTML = `
    <div class="visionneuse-tete"><span>${esc(nomCourt(titre))}</span>
      <button type="button" class="icone-btn" aria-label="Fermer" data-fermer>×</button></div>
    <div class="visionneuse-corps"><p class="discret">Chargement…</p></div>
    ${deplacer ? '<div class="visionneuse-pied"><label for="blChantier">Chantier de ce BL</label><div class="bl-infos" id="blDeplacer"><select disabled><option>Chargement…</option></select></div></div>' : ''}`;
  document.body.appendChild(voile);
  if (deplacer) {
    // Version 55 : même mécanique que « Mes BL » : liste, « Ranger ici », file d'attente, état affiché ici.
    const zone = voile.querySelector('#blDeplacer');
    const bl = { id: deplacer.id, chantier: deplacer.actuel };
    let chantiers = null;
    const dessinerChoix = () => {
      if (!document.body.contains(voile) || !chantiers) return;
      zone.innerHTML = champDeplacementBl(bl, 0, chantiers, !!deplacer.modifiable);
      const sel = zone.querySelector('select'), bouton = zone.querySelector('[data-bl-ranger]');
      sel.onchange = () => { bouton.hidden = sel.value === chantierAffiche(bl); };
      bouton.onclick = async () => {
        bouton.hidden = true;
        const vers = sel.value, origine = chantierAffiche(bl);
        const titre = voile.querySelector('.visionneuse-tete span');
        titre.textContent = nomCourt(vers);
        deplacer.apres(vers);                       // le rapport montre tout de suite le BL sous son nouveau chantier
        await deplacerBlFiable(bl.id, vers);
        // Version 57 : refus du serveur (jour bouclé, droits…) — le BL revient sous son chantier d'origine.
        const etat = etatsDeplacement()[bl.id];
        if (etat && etat.etat === 'echec') {
          if (document.body.contains(voile)) titre.textContent = nomCourt(origine);
          deplacer.apres(origine);
        }
      };
    };
    const avant = surDeplacement;
    surDeplacement = () => { dessinerChoix(); if (avant) avant(); };
    voile.addEventListener('fermeture', () => { surDeplacement = avant; });
    appel('bl_gars', { date: deplacer.date }).then(r => { chantiers = r.chantiers; dessinerChoix(); },
      () => { zone.innerHTML = `<select disabled><option>${esc(nomCourt(deplacer.actuel))}</option></select>`; });
  }
  const fermer = () => { voile.dispatchEvent(new Event('fermeture')); voile.remove(); window.removeEventListener('popstate', surRetour); };
  const surRetour = () => fermer();
  // Le bouton retour du téléphone ferme la photo sans quitter le rapport.
  history.pushState({ visionneuse: true }, '');
  window.addEventListener('popstate', surRetour);
  voile.querySelector('[data-fermer]').onclick = () => history.back();
  const corps = voile.querySelector('.visionneuse-corps');
  charger().then(src => {
    if (!document.body.contains(voile)) return;
    corps.innerHTML = `<img src="${src}" alt="Bon de livraison">`;
    const img = corps.querySelector('img');
    img.onclick = () => corps.classList.toggle('taille-reelle');
  }, err => {
    if (!document.body.contains(voile)) return;
    corps.innerHTML = `<p class="erreur-champ">${esc(err.message || 'Photo indisponible.')}</p>`;
  });
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
      libelle: c.libelle, client: c.client, commune: c.commune, remarques: c.remarques || '', hors: !!c.hors, declarePar: c.declarePar || [],
      avancement: c.avancement.map(x => ({ ...x })), materiaux: c.materiaux.map(x => ({ ...x })),
      bl: c.bl, photos: [],
    })),
    ouvert: 0,
  };
  const unites = Object.fromEntries(d.listeMateriaux.map(m => [m.materiau, m.unite]));
  const moiRapport = (stock.lire('session') || {}).personne;
  const nouveauChef = !auNomDe && d.bloc && (d.bloc.deFait || (d.bloc.remplacant && d.bloc.remplacant === moiRapport));

  // Version 62 : présentation des tâches et matériaux (ligne « déjà + aujourd'hui = total », curseur deux couleurs).
  const nombre = x => String(Math.round(Number(x) * 1000) / 1000).replace('.', ',');
  const valeurDuJour = q => { const t = String(q ?? '').trim(); if (!t) return null; const n = Number(t.replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const aSaisi = q => String(q ?? '').trim() !== '';
  const estFinie = t => !!t.avant && t.avant.mode !== 'QUANTITE' && Number(t.avant.pourcentage) >= 100 && !t.duJour && !t.rouverte;
  // Intitulé des colonnes, une fois au-dessus de la liste.
  const enteteAujourdhui = () => '<div class="eq-tete"><span>Déjà</span><span></span><span>Aujourd\'hui</span><span></span><span>Total</span></div>';
  // Total = cumul d'avant + quantité du jour lisible ; « — » sans saisie. Nombres sans unité : l'unité est dans le champ du jour.
  const texteTotal = (cumul, q) => { const n = valeurDuJour(q); return n === null ? '—' : nombre(Number(cumul) + n); };
  // « 26,75 au 01/10 + [ 20 m3 ] = 46,75 » : la date reste attachée au cumul d'avant.
  const ligneEq = (cumul, dateAvant, q, champ) => `
          <div class="eq">
            <span class="deja" data-cumul="${esc(String(cumul))}"><b>${esc(nombre(cumul))}</b><small>au ${dateCourte(dateAvant)}</small></span>
            <span class="op">+</span>${champ}<span class="op">=</span>
            <span class="somme${valeurDuJour(q) === null ? ' vide' : ''}">${texteTotal(cumul, q)}</span>
          </div>`;
  const champQteMat = (i, k, m) => `<div class="qte"><input type="text" inputmode="decimal" aria-label="Quantité utilisée aujourd'hui" value="${esc(m.quantite === undefined || m.quantite === null ? '' : String(m.quantite))}" data-ch="${i}" data-mat="${k}" data-k="quantite"><span class="unite-fixe">${esc(m.unite || '')}</span></div>`;
  const ligneQteNouveau = (i, k, m) => `<div class="qte-ligne"><span class="tag-nouveau">Nouveau</span>${champQteMat(i, k, m)}</div>`;
  const pisteCurseur = (v, avant) => {
    const bas = Math.min(v, avant), haut = Math.max(v, avant), milieu = v >= avant ? 'var(--jaune)' : 'var(--rouge-moyen)';
    return `linear-gradient(90deg, var(--encre) 0 ${bas}%, ${milieu} ${bas}% ${haut}%, var(--creux) ${haut}% 100%)`;
  };
  const texteEcart = (v, avant, connue) => !connue || v === avant ? '' : `${v > avant ? '+' : '−'}${Math.abs(v - avant)} %`;
  const legendeJour = (v, avant) => v === avant ? '' : `<i class="${v > avant ? 'l-plus' : 'l-moins'}"></i>${v > avant ? "aujourd'hui" : 'en moins'}`;

  const sectionChantier = (c, i) => `
    <section class="bloc rapport-chantier">
      <div class="bloc-titre">${esc(nomCourt(c.libelle))}</div>
      ${c.hors ? `<p class="discret">Hors planning — déclaré par ${esc(c.declarePar.join(', '))}.</p>` : ''}
      <h2>Avancement</h2>
      <p class="discret aide-avancement">Les tâches déjà commencées sont reprises.</p>
      ${(() => {
        // Version 62 : les tâches terminées (100 %, rien ce jour-là, pas rouvertes) sont regroupées sur une ligne repliable.
        const finies = c.avancement.map((t, k) => ({ t, k })).filter(({ t }) => estFinie(t));
        if (!finies.length) return '';
        return `
        <details class="taches-finies" data-finies="${i}"${c.finiesOuvertes ? ' open' : ''}>
          <summary>✓ ${finies.length} tâche${finies.length > 1 ? 's' : ''} terminée${finies.length > 1 ? 's' : ''}</summary>
          ${finies.map(({ t, k }) => `
          <div class="tache-finie" data-tache-finie="${i}-${k}">
            <span><span class="nom">${esc(t.tache)}</span> <span class="discret">· le ${dateCourte(t.avant.date)}</span></span>
            <button class="btn-lien" type="button" data-rouvrir="${i}-${k}">Rouvrir</button>
          </div>`).join('')}
        </details>`;
      })()}
      ${(() => {
        let enteteAuj = false;                      // l'intitulé « Aujourd'hui » une seule fois, au-dessus de la première tâche connue en quantité
        return c.avancement.map((t, k) => {
        // Version 57 : une tâche connue (déclarée un jour d'avant) garde son nom et son mode.
        // Version 62 : connue en quantité → nom, cumul « déjà », quantité du jour à droite (unité fixe) ; en % → curseur deux couleurs.
        if (estFinie(t)) return '';
        const connue = !!t.avant;
        const suppr = `<button class="suppr" type="button" data-suppr-av="${i}-${k}" aria-label="Retirer la tâche">×</button>`;
        const nouvelle = connue ? '' : `
          <div class="cherche"><input type="text" aria-label="Tâche" value="${esc(t.tache)}" data-ch="${i}" data-av="${k}" data-k="tache" placeholder="Nom de la tâche, ex. bicouche">${suppr}</div>
          <div class="choix" style="--n:2">
            <button type="button" data-mode="${i}-${k}" data-v="POURCENTAGE" aria-pressed="${t.mode !== 'QUANTITE'}">% du total</button>
            <button type="button" data-mode="${i}-${k}" data-v="QUANTITE" aria-pressed="${t.mode === 'QUANTITE'}">Quantité du jour</button>
          </div>`;
        if (t.mode === 'QUANTITE') {
          const champ = `<input type="text" inputmode="decimal" aria-label="Quantité faite aujourd'hui" value="${esc(t.quantite ?? '')}" data-ch="${i}" data-av="${k}" data-k="quantite">`;
          if (connue) {
            const tete = enteteAuj ? '' : enteteAujourdhui(); enteteAuj = true;
            return `${tete}
        <div class="ligne ligne-cumul${aSaisi(t.quantite) ? ' saisie' : ''}">
          <span class="nom">${esc(t.tache)}</span>${ligneEq(t.avant.cumul, t.avant.date, t.quantite,
            `<div class="qte">${champ}<span class="unite-fixe">${esc(t.unite || t.avant.unite || '')}</span></div>`)}
        </div>`;
          }
          return `
        <div class="ligne tache-nouvelle${aSaisi(t.quantite) ? ' saisie' : ''}">
          ${nouvelle}
          <div class="qte-ligne"><span class="sous">Fait aujourd'hui</span>
            <div class="qte-unite"><div class="qte">${champ}</div>
              <select aria-label="Unité" data-ch="${i}" data-av="${k}" data-k="unite">${['m2', 'ml', 'm3', 't', 'un'].map(u => `<option ${u === (t.unite || 'm2') ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
          </div>
        </div>`;
        }
        const v = Number(t.pourcentage) || 0, avant = connue ? Number(t.avant.pourcentage) || 0 : 0;
        return `
        <div class="ligne tache-pct${connue ? '' : ' tache-nouvelle'}${v !== avant ? ' saisie' : ''}" data-avant="${avant}" data-connue="${connue ? 1 : ''}">
          ${nouvelle}
          <div class="pct-tete">${connue ? `<span class="nom">${esc(t.tache)}</span>` : '<span class="sous">Où en est la tâche, au total</span>'}
            <span class="pct-val"><b class="valeur">${v} %</b><small class="ecart${v < avant ? ' moins' : ''}">${texteEcart(v, avant, connue)}</small></span></div>
          <input type="range" class="av" min="0" max="100" step="5" value="${v}" data-ch="${i}" data-av="${k}" data-k="pourcentage" aria-label="Avancement en pourcent" style="--piste:${pisteCurseur(v, avant)}">
          ${connue ? `<div class="legende"><span><i class="l-avant"></i>${avant} % le ${dateCourte(t.avant.date)}</span><span class="l-jour">${legendeJour(v, avant)}</span></div>` : ''}
        </div>`; }).join(''); })()}
      <button class="btn btn-ajout" type="button" data-ajout-tache="${i}">${ICONES.plus} Ajouter une tâche</button>

      <h2>Matériaux utilisés</h2>
      <p class="discret aide-avancement">Ne remplis que ce qui a servi aujourd'hui.</p>
      ${c.materiaux.some(m => m.avant) ? enteteAujourdhui() : ''}
      ${c.materiaux.map((m, k) => {
        // Version 58 : un matériau déjà déclaré sur ce chantier garde son nom et son unité (celle du référentiel), sans « × ».
        // Version 62 : « déjà + aujourd'hui = total » sur la ligne, l'unité dans le champ du jour.
        const suppr = `<button class="suppr" type="button" data-suppr-mat="${i}-${k}" aria-label="Retirer le matériau">×</button>`;
        if (m.avant) return `
        <div class="ligne ligne-cumul materiau-repris${aSaisi(m.quantite) ? ' saisie' : ''}">
          <span class="nom">${esc(m.materiau)}</span>${ligneEq(m.avant.cumul, m.avant.date, m.quantite, champQteMat(i, k, m))}
        </div>`;
        if (m.inactif) return `
        <div class="ligne">
          <div class="ligne-tete"><span>${esc(m.materiau)} : ${esc(String(m.quantite))} ${esc(m.unite || '')}</span>${suppr}</div>
          <span class="erreur-champ">N'est plus dans la liste des matériaux : retire-le.</span>
        </div>`;
        // Version 61 : un matériau nouveau se cherche en tapant un morceau de son nom ; la ligne ajoutée arrive vide.
        // Version 62 : la quantité n'apparaît qu'une fois le matériau choisi.
        return `
        <div class="ligne materiau-nouveau${m.materiau && aSaisi(m.quantite) ? ' saisie' : ''}">
          <div class="cherche">
            <input type="search" autocomplete="off" enterkeyhint="search" aria-label="Matériau" placeholder="Matériau : tape un morceau du nom"
              value="${esc(m.materiau || m.recherche || '')}" data-cherche="${i}-${k}"${m.materiau ? ' data-choisi="1"' : ''}>
            ${suppr}
          </div>
          <div class="resultats" data-resultats="${i}-${k}" hidden></div>
          ${m.materiau ? ligneQteNouveau(i, k, m) : ''}
        </div>`; }).join('')}
      <button class="btn btn-ajout" type="button" data-ajout-mat="${i}">${ICONES.plus} Ajouter un matériau</button>

      <h2>Bons de livraison</h2>
      <div class="photos">
        ${c.bl.map((b, k) => {
          const vu = b.vignette || apercusBl(date, c.libelle)[k];       // version 55 : vignette gardée par le serveur
          return `<button type="button" class="vignette" data-voir="${i}-${k}" aria-label="Voir le bon de livraison" ${vu ? `style="background-image:url('${vu}')"` : ''}>${vu ? '' : '<span class="voir">Toucher pour voir</span>'}<em>Envoyé</em></button>`;
        }).join('')}
        ${c.photos.map((ph, k) => `<button type="button" class="vignette ${ph.etat}" ${ph.image ? `data-voir-local="${i}-${k}"` : 'disabled'} aria-label="Voir la photo" ${ph.apercu ? `style="background-image:url('${ph.apercu}')"` : ''}>
          <em>${{ prep: 'Préparation…', envoi: 'Envoi…', ok: 'Envoyé', attente: 'En attente', echec: 'Échec' }[ph.etat]}</em></button>`).join('')}
        <label class="prendre">${ICONES.photo}Photo<input type="file" accept="image/*" capture="environment" data-photo="${i}"></label>
      </div>

      <div class="champ"><label for="rem${i}">Remarques sur ce chantier</label>
        <textarea id="rem${i}" data-ch="${i}" data-k="remarques" placeholder="Ex. sous-traitant, engin loué, 4,5 m3 de 10/14 redescendus au dépôt">${esc(c.remarques)}</textarea></div>
    </section>`;

  // Version 55 : sous « Repas payés », les repas « Restaurant » déclarés par l'équipe à cette heure (information, sans blocage).
  const texteRepasEquipe = () => {
    const r = d.repasEquipe;
    const complet = r.saisies >= r.attendues;
    const base = `Déclarés « Restaurant » par l'équipe : <b>${r.declares}</b> (${r.saisies} journée${r.saisies > 1 ? 's' : ''} saisie${r.saisies > 1 ? 's' : ''} sur ${r.attendues})`;
    if (!complet) return `${base}.`;
    return e.repasPayes === r.declares ? `${base} : ça correspond.` : `${base} : <b>ça ne correspond pas</b>.`;
  };
  const dessiner = () => {
    const y = window.scrollY;
    const envoye = !!(d.rapport && d.rapport.statut === 'ENVOYE');
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="history.back()">${ICONES.retour}</button>
        <div><h1>Rapport de chantier</h1><p class="discret">${esc(dateLongue(date))}${auNomDe ? ` — au nom de ${esc(auNomDe)}` : ''}</p></div>
      </div>
      ${nouveauChef && !d.verrouille ? `<div class="alerte jaune">${ICONES.attention}<span>${d.bloc.remplacant ? `Tu remplaces <b>${esc(d.bloc.responsable)}</b> aujourd'hui.` : 'Tu es le chef de ce chantier aujourd\'hui.'}
        <b>Obligatoire :</b> le nombre de repas payés au restaurant (0 si personne n'y est allé), puis « Envoyer le rapport ». <b>Si tu peux :</b> l'avancement, les matériaux, les photos de bons de livraison et les remarques de chaque chantier.</span></div>` : ''}
      ${d.verrouille ? `<div class="alerte jaune">${ICONES.attention}<span>Ce jour est bouclé : le rapport ne se modifie plus. Adresse-toi au bureau.</span></div>`
        : envoye ? `<div class="alerte vert">${ICONES.ok}<span>Rapport envoyé. Tu peux le compléter et le renvoyer autant de fois que nécessaire.</span></div>`
        : `<div class="alerte jaune">${ICONES.attention}<span>Rapport pas encore envoyé. Le bouton en bas l'envoie, même s'il n'y a que les repas.</span></div>`}

      <section class="bloc">
        <h2>Restaurant et repas</h2>
        <p class="discret">Pour toute la journée, tous chantiers confondus.</p>
        <div class="champ"><label for="resto" class="sous">Nom</label><input id="resto" type="text" value="${esc(e.restaurant)}"></div>
        <div class="ligne-tete"><span>Repas payés</span>
          <div class="pas"><button type="button" id="moins" aria-label="Un repas de moins">−</button><output id="nbRepas">${e.repasPayes}</output><button type="button" id="plus" aria-label="Un repas de plus">+</button></div>
        </div>
        ${d.repasEquipe ? `<p class="discret" id="repasEquipe">${texteRepasEquipe()}</p>` : ''}
      </section>

      ${e.chantiers.length > 1 ? `<div class="choix" style="--n:${e.chantiers.length}">
        ${e.chantiers.map((c, i) => `<button type="button" data-onglet="${i}" aria-pressed="${e.ouvert === i}">${esc(nomCourt(c.libelle).split(' / ')[0])}</button>`).join('')}
      </div>` : ''}
      ${e.chantiers.length ? sectionChantier(e.chantiers[e.ouvert], e.ouvert)
        : '<section class="bloc"><p class="discret">Aucun chantier au planning pour cette journée.</p></section>'}

      <p class="erreur-champ" id="erreur" role="alert"></p>
      ${d.verrouille ? '' : `<div class="pied"><button class="btn btn-principal" type="button" id="envoyer">${envoye ? 'Renvoyer le rapport' : 'Envoyer le rapport'}</button>
        ${auNomDe && (d.rapport || d.chantiers.some(c => c.avancement.some(t => t.duJour) || c.materiaux.some(m => m.duJour) || c.remarques)) ? '<button class="option" type="button" id="effacerRapport">Effacer le rapport</button>' : ''}</div>`}`;

    // Version 62 : liseré « saisi » et total (déjà + aujourd'hui) mis à jour pendant la frappe, sans redessiner.
    const majCumul = (ligne, q) => {
      ligne.classList.toggle('saisie', aSaisi(q));
      const deja = ligne.querySelector('.deja'), total = ligne.querySelector('.somme');
      if (deja && total) { total.textContent = texteTotal(deja.dataset.cumul, q); total.classList.toggle('vide', valeurDuJour(q) === null); }
    };
    const brancherMat = el => el.oninput = el.onchange = () => {
      const c = e.chantiers[+el.dataset.ch], m = c.materiaux[+el.dataset.mat];
      m[el.dataset.k] = el.value;
      if (el.dataset.k === 'quantite') majCumul(el.closest('.ligne'), el.value);
    };
    $('#resto').oninput = ev => { e.restaurant = ev.target.value; };
    const majRepas = () => { $('#nbRepas').textContent = e.repasPayes; if ($('#repasEquipe')) $('#repasEquipe').innerHTML = texteRepasEquipe(); };
    $('#moins').onclick = () => { e.repasPayes = Math.max(0, e.repasPayes - 1); majRepas(); };
    $('#plus').onclick = () => { e.repasPayes = Math.min(20, e.repasPayes + 1); majRepas(); };
    $$('[data-onglet]').forEach(b => b.onclick = () => { e.ouvert = +b.dataset.onglet; dessiner(); });

    $$('[data-av]').forEach(el => el.oninput = () => {
      const c = e.chantiers[+el.dataset.ch], t = c.avancement[+el.dataset.av];
      t[el.dataset.k] = el.dataset.k === 'pourcentage' ? Number(el.value) : el.value;
      const ligne = el.closest('.ligne');
      if (el.dataset.k === 'quantite') { majCumul(ligne, el.value); return; }
      if (el.dataset.k !== 'pourcentage') return;
      // On met à jour la ligne à la main : redessiner couperait le glissement en cours.
      // Version 62 : nombre, écart avec l'état d'avant, piste deux couleurs, légende et liseré.
      const v = Number(el.value), avant = Number(ligne.dataset.avant) || 0, connue = !!ligne.dataset.connue;
      ligne.querySelector('.valeur').textContent = `${v} %`;
      const ecart = ligne.querySelector('.ecart'); ecart.textContent = texteEcart(v, avant, connue); ecart.classList.toggle('moins', v < avant);
      el.style.setProperty('--piste', pisteCurseur(v, avant));
      const l = ligne.querySelector('.l-jour'); if (l) l.innerHTML = legendeJour(v, avant);
      ligne.classList.toggle('saisie', v !== avant);
    });
    $$('[data-finies]').forEach(el => el.ontoggle = () => { e.chantiers[+el.dataset.finies].finiesOuvertes = el.open; });
    // Version 61 : recherche d'un matériau nouveau. Taper efface le choix précédent ; toucher un résultat le choisit ;
    // en quittant le champ, un nom tapé en entier (au sens de la recherche) est retenu tel quel.
    const choisirMateriau = (m, nom) => { m.materiau = nom; m.unite = unites[nom] || ''; delete m.recherche; };
    $$('[data-cherche]').forEach(el => {
      const [i, k] = el.dataset.cherche.split('-').map(Number);
      const c = e.chantiers[i], m = c.materiaux[k];
      const boite = $(`[data-resultats="${i}-${k}"]`);
      const montrer = () => {
        const pris = c.materiaux.filter((x, n) => n !== k && x.materiau).map(x => x.materiau);
        boite.innerHTML = resultatsMateriaux(d.listeMateriaux, m.materiau ? '' : el.value, pris);
        boite.hidden = false;
        boite.querySelectorAll('[data-choix]').forEach(b => {
          b.onmousedown = ev => ev.preventDefault();          // garder le champ actif jusqu'au choix
          b.onclick = () => { choisirMateriau(m, b.dataset.choix); dessiner(); const q = $(`[data-ch="${i}"][data-mat="${k}"][data-k="quantite"]`); if (q) q.focus(); };
        });
      };
      el.onfocus = () => { if (m.materiau) el.select(); montrer(); };
      el.oninput = () => {
        // Version 62 : retaper efface le choix ET la quantité, et la ligne de quantité disparaît.
        if (m.materiau) {
          m.materiau = ''; m.unite = ''; m.quantite = ''; delete el.dataset.choisi;
          const ligne = el.closest('.materiau-nouveau'), q = ligne.querySelector('.qte-ligne');
          if (q) q.remove();
          ligne.classList.remove('saisie');
        }
        m.recherche = el.value;
        montrer();
      };
      // Un léger délai : sur certains téléphones, le champ perd la main avant que le toucher d'un résultat soit compté.
      el.onblur = () => setTimeout(() => {
        if (!el.isConnected) return;                           // écran redessiné entre-temps (résultat choisi)
        boite.hidden = true;
        if (m.materiau) return;
        const cle = t => cleRecherche(t).replace(/\s+/g, ' ').trim();
        const exact = d.listeMateriaux.find(x => cle(x.materiau) === cle(el.value));
        if (exact && !c.materiaux.some((x, n) => n !== k && x.materiau === exact.materiau)) {
          choisirMateriau(m, exact.materiau);                  // sur place, sans redessiner : le champ suivant garde la main
          el.value = exact.materiau; el.dataset.choisi = '1';
          // Version 62 : la ligne de quantité apparaît ici, la quantité repartant de vide.
          m.quantite = '';
          el.closest('.materiau-nouveau').insertAdjacentHTML('beforeend', ligneQteNouveau(i, k, m));
          brancherMat($(`[data-ch="${i}"][data-mat="${k}"][data-k="quantite"]`));
        }
      }, 150);
    });
    $$('[data-mat]').forEach(brancherMat);
    $$('[data-k="remarques"]').forEach(el => el.oninput = () => { e.chantiers[+el.dataset.ch].remarques = el.value; });
    $$('[data-mode]').forEach(b => b.onclick = () => {
      const [i, k] = b.dataset.mode.split('-').map(Number);
      e.chantiers[i].avancement[k].mode = b.dataset.v; dessiner();
    });
    $$('[data-suppr-av]').forEach(b => b.onclick = () => {
      const [i, k] = b.dataset.supprAv.split('-').map(Number);
      e.chantiers[i].avancement.splice(k, 1); dessiner();
    });
    $$('[data-rouvrir]').forEach(b => b.onclick = () => {
      const [i, k] = b.dataset.rouvrir.split('-').map(Number);
      e.chantiers[i].avancement[k].rouverte = true; dessiner();
    });
    $$('[data-suppr-mat]').forEach(b => b.onclick = () => {
      const [i, k] = b.dataset.supprMat.split('-').map(Number);
      e.chantiers[i].materiaux.splice(k, 1); dessiner();
    });
    $$('[data-ajout-tache]').forEach(b => b.onclick = () => {
      e.chantiers[+b.dataset.ajoutTache].avancement.push({ tache: '', pourcentage: 0, mode: 'POURCENTAGE' }); dessiner();
    });
    $$('[data-ajout-mat]').forEach(b => b.onclick = () => {
      // Version 61 : la ligne arrive vide, le champ de recherche ouvert (Fréquents puis familles) ; plus de matériau imposé.
      const i = +b.dataset.ajoutMat, c = e.chantiers[i];
      c.materiaux.push({ materiau: '', quantite: '', unite: '' }); dessiner();
      const champ = $(`[data-cherche="${i}-${c.materiaux.length - 1}"]`); if (champ) champ.focus();
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
        ph.apercu = apercu; ph.image = image; ph.etat = 'envoi'; redessiner();
        // Une photo = un envoi : si le réseau coupe, on ne perd pas tout le rapport.
        // Version 55 : la vignette part avec la photo, pour que les autres (chef, bureau) la voient.
        const r = await envoyer('ajouter_bl', { date, auNomDe, chantier: c.libelle, image, apercu }, `Photo de BL — ${c.libelle}`);
        ph.etat = r.enAttente ? 'attente' : 'ok';
        if (!r.enAttente) garderApercu(date, c.libelle, apercu);
        toast(r.enAttente ? 'Photo gardée, elle partira avec le réseau.' : 'Photo envoyée.');
      } catch (err) {
        ph.etat = 'echec';
        toast(`Photo non envoyée : ${err.message}`);
      }
      redessiner();
    });
    // Version 48 : un BL envoyé s'ouvre en grand (photo lue dans Drive par le serveur) ; une photo pas
    // encore partie, depuis le téléphone.
    $$('[data-voir]').forEach(b => b.onclick = () => {
      const [ci, k] = b.dataset.voir.split('-').map(Number);
      const bl = e.chantiers[ci].bl[k];
      voirPhoto(e.chantiers[ci].libelle, () => appel('photo_bl', { date, auNomDe, id: bl.id }).then(r => r.image), {
        id: bl.id, date, actuel: e.chantiers[ci].libelle,
        modifiable: !d.verrouille,                 // version 57 : jour bouclé, liste grisée (« Jour bouclé »)
        // Version 52 : le BL change de chantier ; sous un autre chantier de ce rapport, il y passe, sinon il le quitte.
        apres: chantier => {
          e.chantiers.forEach(c => { c.bl = c.bl.filter(x => x !== bl); });
          const dest = e.chantiers.find(c => c.libelle === chantier);
          if (dest) dest.bl.push(bl);
          if (toujoursIci()) dessiner();
        },
      });
    });
    $$('[data-voir-local]').forEach(b => b.onclick = () => {
      const [ci, k] = b.dataset.voirLocal.split('-').map(Number);
      const c = e.chantiers[ci];
      voirPhoto(c.libelle, () => Promise.resolve(c.photos[k].image));
    });
    if ($('#envoyer')) $('#envoyer').onclick = soumettre;
    // Version 55 : le bureau efface un rapport (jour chômé après une saisie partielle, rapport fait par erreur).
    if ($('#effacerRapport')) $('#effacerRapport').onclick = async () => {
      const ok = await confirmer('Effacer le rapport ?', `Restaurant, repas, avancement, matériaux et remarques du rapport de ${auNomDe} seront supprimés (gardés au journal). Les BL et les journées ne sont pas touchés.`, 'Effacer');
      if (!ok) return;
      try {
        await appel('bureau_effacer_rapport', { date, responsable: auNomDe });
        oublierJour(date);
        toast('Rapport effacé.');
        aller(apresCorrectionBureau(date));
      } catch (err) { $('#erreur').textContent = err.message; }
    };
    // Lecture seule : on garde les onglets des chantiers, les photos et le retour, tout le reste est grisé.
    if (d.verrouille) {
      $$('#app input, #app select, #app textarea, #app button:not([data-onglet]):not(.retour):not([data-voir]):not([data-voir-local])').forEach(x => { x.disabled = true; });
      $$('#app .prendre, #app .btn-ajout, #app .suppr').forEach(x => { x.hidden = true; });
    }
    window.scrollTo(0, y);
  };

  const soumettre = async () => {
    for (const c of e.chantiers) {
      const vide = c.avancement.find(t => !String(t.tache).trim());
      if (vide) { e.ouvert = e.chantiers.indexOf(c); dessiner(); $('#erreur').textContent = `${c.libelle} : donne un nom à chaque tâche, ou retire-la.`; return; }
      // Version 57 : une tâche connue en quantité peut rester vide (rien fait ce jour-là) ; une nouvelle, non.
      const sansQuantite = c.avancement.find(t => t.mode === 'QUANTITE' && !t.avant && !(Number(String(t.quantite).replace(',', '.')) > 0));
      if (sansQuantite) { e.ouvert = e.chantiers.indexOf(c); dessiner(); $('#erreur').textContent = `${c.libelle} : indique la quantité faite pour « ${sansQuantite.tache} ».`; return; }
      const cles = c.avancement.map(t => String(t.tache).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim());
      const double = cles.find((x, n) => cles.indexOf(x) !== n);
      if (double) { e.ouvert = e.chantiers.indexOf(c); dessiner(); $('#erreur').textContent = `${c.libelle} : la tâche « ${c.avancement[cles.indexOf(double)].tache} » est en double.`; return; }
      // Version 58 : un matériau repris peut rester vide (rien utilisé ce jour-là) ; un nouveau, non ; pas de doublon.
      const inactif = c.materiaux.find(m => m.inactif);
      if (inactif) { e.ouvert = e.chantiers.indexOf(c); dessiner(); $('#erreur').textContent = `${c.libelle} : « ${inactif.materiau} » n'est plus dans la liste des matériaux : retire-le.`; return; }
      // Version 61 : une ligne nouvelle sans matériau ni quantité est ignorée ; avec une quantité, il faut le matériau.
      const aQte = m => String(m.quantite === undefined || m.quantite === null ? '' : m.quantite).trim() !== '';
      c.materiaux = c.materiaux.filter(m => m.avant || m.materiau || aQte(m));
      const sansNom = c.materiaux.find(m => !m.avant && !m.materiau);
      if (sansNom) { e.ouvert = e.chantiers.indexOf(c); dessiner(); $('#erreur').textContent = `${c.libelle} : choisis le matériau de chaque ligne, ou retire-la.`; return; }
      const sansQte = c.materiaux.find(m => !m.avant && !(Number(String(m.quantite).replace(',', '.')) > 0));
      if (sansQte) { e.ouvert = e.chantiers.indexOf(c); dessiner(); $('#erreur').textContent = `${c.libelle} : indique la quantité de chaque nouveau matériau, ou retire-le.`; return; }
      const noms = c.materiaux.map(m => String(m.materiau).trim());
      const doublon = noms.find((x, n) => noms.indexOf(x) !== n);
      if (doublon) { e.ouvert = e.chantiers.indexOf(c); dessiner(); $('#erreur').textContent = `${c.libelle} : « ${doublon} » est déjà dans la liste : complète sa ligne.`; return; }
    }
    const bouton = $('#envoyer'); bouton.disabled = true; bouton.textContent = 'Envoi…';
    try {
      const r = await envoyer('enregistrer_rapport', {
        date, auNomDe, restaurant: e.restaurant.trim(), repasPayes: e.repasPayes,
        chantiers: e.chantiers.map(c => ({
          libelle: c.libelle, remarques: c.remarques.trim(),
          avancement: c.avancement.map(t => ({ tache: t.tache, mode: t.mode, pourcentage: t.pourcentage, quantite: t.quantite, unite: t.unite })),
          materiaux: c.materiaux.map(m => ({ materiau: m.materiau, quantite: String(m.quantite === undefined || m.quantite === null ? '' : m.quantite).replace(',', '.') })),
        })),
      }, `Rapport du ${dateLongue(date)}`);
      if (!r.enAttente) majChef(date, { rapportEnvoye: true });
      oublierJour(date);
      toast(r.enAttente ? 'Rapport gardé, il partira avec le réseau.' : 'Rapport envoyé.');
      aller(auNomDe ? apresCorrectionBureau(date) : accueilPerso());
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
  const aValiderStatut = s => s === 'SAISIE';
  // Remplaçant ou chef de fait : sa propre journée est validée par le bureau, pas par lui.
  const moiParBureau = !!(d.remplace || d.chefDeFait);
  const role = () => (d.remplace ? ' <span class="discret">(remplaçant)</span>' : ' <span class="discret">(chef)</span>');

  const carte = m => {
    const j = m.journee;
    if (!j && m.justification) return `
      <section class="bloc"><div class="ligne-tete"><span>${esc(m.personne)}${m.estMoi ? role() : m.personne === d.bloc.responsable && d.remplace ? ' <span class="discret">(chef, absent)</span>' : ''}</span><span class="pastille">${m.justification.chome ? 'Chômé' : 'Absent'}</span></div>
        <p class="discret">${esc(messageAbsence(m.justification))}</p></section>`;
    if (!j && m.estMoi) return `
      <section class="bloc"><div class="ligne-tete"><span>${esc(m.personne)}${role()}</span><span class="pastille rouge">Pas saisie</span></div>
        <p class="discret">Ta propre journée n'est pas encore saisie.</p>
        <button class="btn btn-principal btn-petit" type="button" onclick="aller('/saisie/${date}')">Saisir ma journée</button></section>`;
    if (!j) return `
      <section class="bloc"><div class="ligne-tete"><span>${esc(m.personne)}</span><span class="pastille rouge">Pas saisie</span></div>
        <p class="discret">Prévu au planning sur ce chantier, aucune journée reçue.</p>
        <button class="btn btn-clair btn-petit" type="button" data-saisir="${esc(m.personne)}">Saisir sa journée</button></section>`;
    // Version 46 : sa propre journée (chef de fait, remplaçant), pas encore validée par le bureau : il n'a rien à y faire.
    const pastille = j.parBureau ? ['Validée bureau', 'vert']
      : m.estMoi && moiParBureau && aValiderStatut(j.statut) ? ['Attente bureau', '']
      : ({ SAISIE: ['À valider', 'attente'], VALIDEE_CHEF: ['Validée', 'vert'],
        VALIDEE_BUREAU: ['Validée bureau', 'vert'], EXPORTEE: ['Validée bureau', 'vert'] }[j.statut] || [j.statut, '']);
    const aValider = !j.parBureau && aValiderStatut(j.statut) && !(m.estMoi && moiParBureau);
    // Validée par le bureau : plus de bouton, le chef doit savoir à qui s'adresser.
    const bureau = m.estMoi && moiParBureau && !j.parBureau ? `<p class="discret">${aValiderStatut(j.statut) ? 'Ta journée sera validée par le bureau.' : 'Ta journée est validée.'}</p>${j.modifiable ? `<button class="btn btn-clair btn-petit" type="button" onclick="aller('/saisie/${date}')">Corriger ma journée</button>` : ''}`
      : j.parBureau ? `<p class="alerte jaune mini">${ICONES.attention}<span>${m.estMoi ? 'Ta journée a été validée' : 'Validée'} par le bureau : pour toute modification, adresse-toi au bureau.</span></p>` : '';
    return `
      <section class="bloc" ${aValider ? 'style="border:2px solid var(--jaune)"' : ''}>
        <div class="ligne-tete"><span>${esc(m.personne)}${m.estMoi ? role() : ''}${m.interimaire ? ' <span class="discret">(intérim)</span>' : ''}${m.origine ? ` <span class="discret">(${esc(m.origine)})</span>` : ''}</span>
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
    const aValider = d.membres.filter(m => m.journee && aValiderStatut(m.journee.statut) && !(m.estMoi && moiParBureau) && !m.journee.parBureau);
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="aller(accueilPerso())">${ICONES.retour}</button>
        <div><h1>Valider mon équipe</h1><p class="discret">${esc(libellesChantiers(d.bloc).map(nomCourt).join(' + '))} — ${esc(dateLongue(date))}</p></div>
      </div>
      ${d.chefDeFait ? `<div class="alerte jaune">${ICONES.attention}<span>Personne n'était prévu sur ces chantiers : tu en es le chef aujourd'hui. Ta propre journée est validée par le bureau.</span></div>` : ''}
      ${d.remplace ? `<div class="alerte jaune">${ICONES.attention}<span>Tu remplaces <b>${esc(d.remplace)}</b> (absent). Ta propre journée est validée par le bureau.</span></div>` : ''}
      ${d.membres.map(carte).join('')}
      ${(d.partis || []).map(x => `<section class="bloc"><div class="ligne-tete"><span>${esc(x.personne)}</span><span class="pastille">Parti</span></div>
        <p class="discret">${x.seul ? "Prévu avec toi ce matin, il est parti sur un chantier hors planning : il en est le chef (rapport), sa journée est validée par le bureau."
          : `Prévu avec toi ce matin, il a travaillé avec l'équipe de ${esc(x.chez || '—')} : c'est ce chef qui valide sa journée.`}</p></section>`).join('')}
      ${d.repas.payes === null ? `<div class="alerte jaune">${ICONES.attention}<span>Rapport de chantier pas encore envoyé : les repas ne peuvent pas être contrôlés.</span></div>`
        : d.repas.ecart ? `<div class="alerte rouge">${ICONES.attention}<span><b>Repas :</b> ${d.repas.payes} payés au rapport, ${d.repas.equipe} déclarés par l'équipe.</span></div>`
        : `<div class="alerte vert">${ICONES.ok}<span>Repas : ${d.repas.payes} payés, ${d.repas.equipe} déclarés. Ça correspond.</span></div>`}
      <p class="erreur-champ" id="erreur" role="alert"></p>
      <div class="pied">
        ${d.enPaie ? `<div class="alerte jaune">${ICONES.attention}<span>Ce jour est bouclé : plus de saisie, d'ajout ni de modification du rapport. Adresse-toi au bureau.</span></div>`
          : `<div class="duo"><button class="btn btn-ajout btn-petit" type="button" onclick="aller('/chef-ajout/${date}')" ${(d.disponibles || []).length ? '' : 'disabled'}>${ICONES.plus} Ajouter un gars</button>
            <button class="btn btn-ajout btn-petit" type="button" onclick="aller('/interimaire/${date}')">${ICONES.plus} Ajouter un intérimaire</button></div>`}
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

/** « Ajouter un gars » : le chef choisit quelqu'un qui n'a rien saisi aujourd'hui, puis saisit sa journée. */
ROUTES['chef-ajout'] = async function (date) {
  date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : aujourdhui();
  const toujoursIci = ecranCourant();
  chargement();
  let d;
  try { d = await appel('equipe', { date }); } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;
  APP().innerHTML = `
    <div class="entete">
      <button class="retour" type="button" aria-label="Retour" onclick="history.back()">${ICONES.retour}</button>
      <div><h1>Ajouter un gars</h1><p class="discret">${esc(dateLongue(date))}</p></div>
    </div>
    <section class="bloc">
      <div class="champ"><label for="qui">Qui a travaillé avec toi ?</label>
        <select id="qui"><option value="">Choisir…</option>
          ${(d.disponibles || []).map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
        </select></div>
      <p class="discret">Seuls ceux qui n'ont encore rien saisi aujourd'hui sont proposés. Tu saisis sa journée, sur tes chantiers, et elle est validée à ton nom.</p>
    </section>
    <div class="pied"><button class="btn btn-principal" type="button" id="continuer" disabled>Continuer vers sa journée</button></div>`;
  $('#qui').onchange = () => { $('#continuer').disabled = !$('#qui').value; };
  $('#continuer').onclick = () => aller(`/chef-journee/${date}/${encodeURIComponent($('#qui').value)}/ajout`);
};

ROUTES['chef-journee'] = async function (param) {
  const toujoursIci = ecranCourant();
  const [date, personneEncodee, mode] = String(param || '').split('/');
  const personne = decodeURIComponent(personneEncodee || '');
  const ajout = mode === 'ajout';        // « Ajouter un gars » : il rejoint l'équipe, sur les chantiers du chef
  chargement();
  let ref, d;
  try {
    ref = await referentiels();
    d = await appel('equipe', { date });
  } catch (err) { if (toujoursIci()) erreurEcran(err, 'La correction a besoin du réseau.'); return; }
  if (!toujoursIci()) return;

  const m = ajout ? { personne, journee: null } : d.membres.find(x => x.personne === personne);
  if (m && m.interimaire) return aller(`/interimaire/${date}/-/${encodeURIComponent(personne)}`);
  if (!m) { toast(`${personne} n'est pas dans ton équipe ce jour-là.`); return aller('/equipe/' + date); }
  // Pas de journée reçue : le chef la saisit à la place du gars, avec les chantiers et horaires habituels du jour.
  const nouvelle = !m.journee;
  if (!nouvelle && m.journee.statut !== 'SAISIE') {
    toast("Journée validée : dévalide-la d'abord pour la corriger."); return aller('/equipe/' + date);
  }
  const e = etatInitial(date, m.journee, d.bloc);
  const possibles = libellesChantiers(d.bloc);
  if (ajout) { e.chantiers = possibles.length === 1 ? [possibles[0]] : []; e.lieuEmbauche = e.chantiers[0] || ''; }
  const idEnvoi = uuid();          // un enregistrement relancé après une coupure n'est pas compté deux fois

  const dessiner = () => {
    const y = window.scrollY;
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="aller('/equipe/${date}')">${ICONES.retour}</button>
        <div><h1>${esc(personne)}</h1><p class="discret">${esc(dateLongue(date))} — ${ajout ? 'ajouté à ton équipe' : nouvelle ? 'saisie' : 'correction'} par le chef</p></div>
      </div>
      <div class="alerte jaune">${ICONES.attention}<span>Une fois enregistrée, la journée est validée à ton nom${ajout ? ' et il rejoint ton équipe pour la journée' : ''}.</span></div>
      ${formulaireJournee(e, ref, false, ajout ? { chantiersPossibles: possibles } : {})}
      <div class="pied"><button class="btn btn-principal" type="button" id="envoyer">Enregistrer et valider</button></div>`;
    brancherFormulaire(e, dessiner);
    $('#envoyer').onclick = async () => {
      const probleme = controler(e, false);
      if (probleme) { $('#erreur').textContent = probleme; $('#erreur').scrollIntoView({ block: 'center' }); return; }
      const b = $('#envoyer'); b.disabled = true; b.textContent = 'Enregistrement…';
      try {
        await appel('chef_journee', Object.assign({ personne }, donneesJournee(e), ajout ? { ajout: true } : {}), idEnvoi);
        oublierJour(date);
        toast(ajout ? `${personne} ajouté à ton équipe.` : nouvelle ? 'Journée saisie et validée.' : 'Journée corrigée et validée.');
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
    const avertir = () => {
      const m = existant ? '' : messageDejaPersonne(e.nomInterimaire, !!auNomDe);
      $('#avertNom').textContent = m;
      // Faute de frappe probable : un simple avertissement, la saisie reste possible (version 40).
      $('#procheNom').textContent = !existant && !m ? avertissementNomProche(e.nomInterimaire, !!auNomDe) : '';
      return m;
    };
    $('#nomInterimaire').addEventListener('input', avertir); avertir();
    $('#envoyer').onclick = async () => {
      const deja = avertir();
      if (deja) { $('#nomInterimaire').scrollIntoView({ block: 'center' }); return; }
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
  SAISIE: ['Saisie', 'attente'], VALIDEE_CHEF: ['Validée chef', 'vert'],
  VALIDEE_BUREAU: ['Validée bureau', 'vert'], EXPORTEE: ['Envoyée en paie', 'vert'],
};

/**
 * Bande de jours défilable : au doigt, le défilement horizontal natif ; à la souris, on la fait
 * glisser en maintenant le clic. Un glissement ne compte pas comme un choix de jour.
 */
let recentrerBande = () => {};
window.addEventListener('resize', () => recentrerBande());
let glissement = null;                    // { bande, x, gauche, glisse } pendant un glissement à la souris
window.addEventListener('pointermove', ev => {
  if (!glissement) return;
  const dx = ev.clientX - glissement.x;
  if (Math.abs(dx) > 5) glissement.glisse = true;
  glissement.bande.scrollLeft = glissement.gauche - dx;
});
window.addEventListener('pointerup', () => { if (glissement) setTimeout(() => { glissement = null; }, 0); });

function brancherBande(bande, choisir) {
  if (!bande) return;
  const actif = bande.querySelector('[aria-current="true"]');
  // Centré après la mise en page (polices comprises), sinon la position calculée est fausse.
  const centrer = () => { if (actif && !glissement) bande.scrollLeft = actif.offsetLeft - bande.offsetLeft - (bande.clientWidth - actif.clientWidth) / 2; };
  centrer(); requestAnimationFrame(centrer);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(centrer);
  recentrerBande = () => { if (document.body.contains(bande)) centrer(); };     // téléphone tourné, fenêtre redimensionnée
  bande.onpointerdown = ev => {
    if (ev.pointerType === 'mouse') glissement = { bande, x: ev.clientX, gauche: bande.scrollLeft, glisse: false };
  };
  bande.querySelectorAll('[data-jour-bureau]').forEach(b => b.onclick = ev => {
    if (glissement && glissement.glisse) { ev.preventDefault(); return; }
    choisir(b.dataset.jourBureau);
  });
}
function apresCorrectionBureau(date) {
  return '/bureau/' + date;
}

/** États de paie d'un jour (voir etatsJours côté serveur) : libellé court de la bande et classe. */
// Version 36 : rouge = un problème ; jaune = tout est réglé, le bureau doit agir (valider) ; bleu = prêt, rien
// à faire ; vert pâle = envoyé en paie (version 46) ; gris clair = traité hors appli, qui s'efface.
const ETATS_JOUR = {
  REGLER: ['', 'regler'], A_COCHER: ['→ valider', 'avalider'], ENVOI: ['✓ prêt', 'envoi'], ENVOYE: ['envoyé', 'envoye-paie'],
  HORS_APPLI: ['hors appli', 'fini'], EN_COURS: ['en cours', 'en-cours'], AVENIR: ['—', 'avenir'], VIDE: ['·', 'vide'],
  HORS_CONTROLE: ['·', 'vide'],
};
const heuresTexte = mn => `${Math.floor(mn / 60)} h${mn % 60 ? ' ' + String(mn % 60).padStart(2, '0') : ''}`;
// Version 50 : les absences (congés, maladie, jours chômés…) partent aussi au Suivi RH.
const chiffresJour = j => `${j.journees} journée${j.journees > 1 ? 's' : ''}${j.minutes ? `, ${heuresTexte(j.minutes)}` : ''}${j.absences ? `, ${j.absences} absence${j.absences > 1 ? 's' : ''}` : ''}`;

/** Actions du bureau sur la paie d'un jour entier (version 35). Renvoie vrai si c'est fait. */
async function paieJour(date, action, commentaire) {
  try {
    await appel('bureau_paie_jour', { date, action, commentaire });
    oublierJour(date);
    toast({ COCHER: 'Journée validée pour la paie.', RETIRER: "Jour retiré de l'envoi : il se corrige de nouveau, puis se revalide.",
      HORS_APPLI: 'Jour marqué traité hors appli.', ANNULER_HORS_APPLI: 'Le jour est de nouveau à traiter dans l\'appli.' }[action]);
    return true;
  } catch (err) { toast(err.message); return false; }
}

ROUTES.bureau = async function (date) {
  const toujoursIci = ecranCourant();
  date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : aujourdhui();
  chargement();
  let d;
  try { d = await appel('bureau_jour', { date }); } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;

  let justifOuvert = null;             // personne dont le formulaire « Justifier » est déplié
  let horsAppliOuvert = false;          // formulaire « traité hors appli » déplié
  let chomeOuvert = false;              // formulaire « jour chômé » déplié
  let ctl = d.controles;                // relu à chaque dessin : d est redemandé après chaque action
  const etatJour = () => d.jour || { etat: 'VIDE', points: 0, journees: 0, minutes: 0 };
  const verrou = () => ['ENVOI', 'ENVOYE', 'HORS_APPLI', 'HORS_CONTROLE'].includes(etatJour().etat);   // v52 : avant la mise en service, lecture seule
  const pointsDe = nom => ctl.duJour.filter(c => c.personne === nom);
  const textePoints = nom => pointsDe(nom)
    .map(c => `<p class="point-controle ${c.cat}">${c.cat === 'corriger' ? '⚠' : '•'} ${esc(c.titre.split(' — ')[0])}</p>`).join('');
  /** Quitter l'écran en retenant où l'on était : au retour, la même ligne, surlignée (point 1 de la v35). */
  const partir = (chemin, personne) => { stock.ecrire('retourBureau', { date, personne: personne || '', y: window.scrollY }); aller(chemin); };

  /** L'état d'une journée, pour sa couleur : à traiter, justifiée, validée, dans l'envoi, envoyée. */
  const etatLigne = x => {
    const j = x.journee, e = etatJour().etat;
    if (e === 'HORS_APPLI') return ['justifiee', 'Hors appli'];
    if (x.exportee || e === 'ENVOYE') return j ? ['envoyee', 'Envoyée'] : (x.justification ? ['justifiee', 'Justifiée'] : ['justifiee', '—']);
    if (!j) return x.justification ? ['justifiee', 'Justifiée'] : ['traiter', 'Pas saisie'];
    if (j.statut === 'SAISIE') return ['traiter', 'À valider'];
    if (pointsDe(x.personne).some(c => c.cat === 'corriger')) return ['traiter', 'À corriger'];
    if (e === 'ENVOI') return ['envoi', "Dans l'envoi"];
    return ['validee', j.parBureau ? 'Validée bureau' : 'Validée chef'];
  };

  const carte = (x, c) => {
    const j = x.journee;
    const [etat, libelle] = etatLigne(x);
    const nomAffiche = `${esc(x.personne)}${x.auPlanning ? '' : ' <span class="discret">(hors planning)</span>'}${c && c.remplacant === x.personne ? ' <span class="discret">(remplaçant)</span>' : ''}${c && x.personne === c.responsable && !c.deFait ? ' <span class="discret">(chef)</span>' : ''}`;
    if (!j && !x.justification && justifOuvert === x.personne) {
      const autres = c ? c.journees.filter(y => !y.journee && !y.justification && y.personne !== x.personne) : [];
      const avecRapport = false;          // version 37 : le rapport ne se justifie plus (il n'est exigé que si l'équipe a travaillé)
      return `
      <div class="ligne e-traiter" data-ligne="${esc(x.personne)}">
        <div class="ligne-tete"><span>${esc(x.personne)}</span><span class="pastille p-traiter">Pas saisie</span></div>
        <div class="choix" style="--n:2">${d.motifs.filter(m => !(x.salarieRh && m === 'Retiré du planning')).map(m => `<button type="button" data-motif="${esc(m)}">${esc(m)}</button>`).join('')}</div>
        <input type="text" id="commentaire" placeholder="Commentaire (facultatif)" maxlength="300">
        ${autres.length || avecRapport ? `<label class="case"><input type="checkbox" id="toutChantier">
          Tout le chantier : ${[autres.length ? `${autres.length} autre${autres.length > 1 ? 's' : ''} sans saisie` : '', avecRapport ? 'le rapport' : ''].filter(Boolean).join(' et ')}</label>` : ''}
        <div class="duo"><button class="btn btn-clair btn-petit" type="button" data-fermer-justif>Annuler</button>
          <button class="btn btn-principal btn-petit" type="button" data-enregistrer-justif="${esc(x.personne)}" data-chef="${esc(c ? c.responsable : '')}" disabled>Enregistrer</button></div>
      </div>`;
    }
    const modifierAttr = x.interimaire ? `data-modifier-interim="${esc(x.personne)}" data-chef="${esc(x.responsable || '')}"` : `data-modifier="${esc(x.personne)}"`;
    let actions = '';
    if (!verrou() && !x.exportee) {
      if (!j && x.justification) actions = `<button class="option" type="button" data-annuler-justif="${esc(x.justification.type)}|${esc(x.justification.cible)}">
          ${x.justification.type === 'JOUR_NON_TRAVAILLE' ? 'Annuler le jour chômé (tout le monde)' : 'Annuler la justification'}</button>`;
      else if (!j) actions = `<button class="btn btn-principal btn-petit" type="button" ${modifierAttr}>Saisir</button>
          <button class="btn btn-sombre btn-petit" type="button" data-justifier="${esc(x.personne)}">Justifier…</button>`;
      else if (j.statut === 'SAISIE') actions = `<button class="btn btn-vert btn-petit" type="button" data-valider-chef="${esc(x.personne)}">Valider</button>
          <button class="option" type="button" ${modifierAttr}>Corriger</button>`;
      else if (etat === 'traiter') actions = `<button class="btn btn-principal btn-petit" type="button" ${modifierAttr}>Corriger</button>`;
      else actions = `<button class="option" type="button" ${modifierAttr}>Corriger</button>`;
    }
    return `
      <div class="ligne e-${etat}" data-ligne="${esc(x.personne)}">
        <div class="ligne-tete"><span>${nomAffiche}</span><span class="pastille p-${etat}">${esc(libelle)}</span></div>
        ${j ? `<p class="heures">${esc(j.hEmbauche)}–${esc(j.hPause)} · ${esc(j.hReprise)}–${esc(j.hDebauche)} · <b>${esc(j.total)}</b>
               <span class="discret">— ${esc([j.trajet, { AUCUN: 'sans repas', PANIER: 'panier', RESTAURANT: 'restaurant' }[j.repas], j.zone ? 'zone ' + j.zone : 'pas de zone'].filter(Boolean).join(', '))}</span>
               ${j.repartition ? `<br><span class="discret">Heures : ${esc(j.repartition.split(' ; ').map(nomCourt).join(' ; '))}</span>` : ''}</p>`
          : x.justification ? `<p class="heures">${x.justification.type === 'JOUR_NON_TRAVAILLE' ? 'Jour chômé' : 'Justifiée'} : ${esc(x.justification.motif)}</p>` : ''}
        ${x.sansOngletRh ? '<p class="discret mention-rh">Pas d\'onglet RH : heures non reportées dans le Suivi RH</p>' : ''}
        ${textePoints(x.personne)}
        ${actions ? `<div class="actions">${actions}</div>` : ''}
      </div>`;
  };

  /** Un chantier : son rapport, son équipe (et le remplaçant d'un chef absent). La paie se coche par jour, en tête. */
  const carteChantier = c => {
    const manquantes = c.journees.filter(x => !x.journee && !x.justification).length;
    // Version 39 : pas de rapport à montrer un jour traité hors appli (masqué, pas supprimé), ni pour une équipe
    // dont personne n'a travaillé (il n'est alors pas exigé).
    const horsAppli = etatJour().etat === 'HORS_APPLI';
    const aTravaille = c.journees.some(x => x.journee);
    const montrerRapport = !horsAppli && (c.rapport.envoye || aTravaille);
    const rapportAction = !verrou() && !horsAppli && !c.rapport.envoye;
    return `
      <section class="bloc">
        <div class="bloc-titre">${esc(c.villes.map(nomCourt).join(' + '))}</div>
        <div class="ligne-tete">
          <span class="discret">Chef : ${esc(c.responsable || '—')}${c.deFait ? ' (chef de fait)' : c.chefAbsent ? ' (absent)' : ''}</span>
          ${montrerRapport ? `<span class="pastille ${c.rapport.envoye ? 'vert' : 'rouge'}">Rapport ${c.rapport.envoye ? 'envoyé' : 'manquant'}</span>` : ''}
        </div>
        ${c.chefAbsent ? (c.candidatsRemplacant.length ? `<div class="champ remplacant"><label for="remp-${esc(c.responsable)}">Remplaçant (rapport et validation de l'équipe)</label>
            <select id="remp-${esc(c.responsable)}" data-remplacant="${esc(c.responsable)}" ${verrou() ? 'disabled' : ''}>${c.remplacant ? '' : '<option value="" selected disabled>Remplaçant à choisir…</option>'}${c.candidatsRemplacant.map(n => `<option ${n === c.remplacant ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>`
          : '<p class="discret">Chef absent : personne de l\'équipe n\'a encore saisi sa journée, pas de remplaçant.</p>') : ''}
        ${(c.horsPlanning || []).map(h => `<p class="discret">+ ${esc(nomCourt(h.libelle))} : hors planning, déclaré par ${esc(h.declarePar.join(', '))}.</p>`).join('')}
        ${!montrerRapport ? '' : c.rapport.ecartRepas ? `<div class="alerte rouge">${ICONES.attention}<span><b>Repas :</b> ${esc(String(c.rapport.repasPayes))} payés au rapport, ${c.rapport.repasDeclares} déclarés par l'équipe.</span></div>`
          : (c.rapport.envoye ? `<p class="discret">Repas : ${esc(String(c.rapport.repasPayes))} payés, ${c.rapport.repasDeclares} déclarés.</p>` : '')}
        ${c.journees.map(x => carte(x, c)).join('')}
        <div class="actions">
          ${!montrerRapport ? '' : c.rapport.envoye
            ? `<button class="option" type="button" data-rapport="${esc(c.responsable || '')}">Rapport : ${esc(c.rapport.restaurant || 'sans restaurant')}, ${esc(String(c.rapport.repasPayes))} repas, ${c.rapport.nbBl} BL</button>`
            : rapportAction ? `<button class="btn btn-principal btn-petit" type="button" data-rapport="${esc(c.responsable || '')}">Remplir le rapport</button>` : ''}
          ${!montrerRapport && rapportAction && c.responsable ? `<button class="option" type="button" data-rapport="${esc(c.responsable)}">Saisir le rapport</button>` : ''}
          ${c.responsable && !verrou() ? `<button class="option" type="button" data-ajout-interim="${esc(c.responsable)}">+ Ajouter un intérimaire</button>` : ''}
        </div>
      </section>`;
  };

  /**
   * En tête du jour (version 37) : un résumé de l'état de la journée et les seules actions du niveau jour
   * (valider pour la paie, jour chômé, hors appli, retirer de l'envoi). Les points se règlent dans les
   * chantiers en dessous, là où ils sont.
   */
  const bandeauJour = () => {
    const j = etatJour();
    const lignes = [...d.chantiers.flatMap(c => c.journees), ...d.horsChantier];
    const nb = f => lignes.filter(f).length;
    const aValiderChef = x => x.journee && x.journee.statut === 'SAISIE';
    const n = {
      chantiers: d.chantiers.length,
      validees: nb(x => x.journee && !aValiderChef(x)),
      aValider: nb(aValiderChef),
      sansSaisie: nb(x => !x.journee && !x.justification),
      justifiees: nb(x => !x.journee && x.justification),
      rapports: d.chantiers.filter(c => !c.rapport.envoye && c.journees.some(x => x.journee)).length,
      repas: d.chantiers.filter(c => c.rapport.ecartRepas).length,
      autres: (d.points || []).filter(p => ['SANS_ONGLET_RH', 'ZONE_INCONNUE'].includes(p.type)).length,
      minutes: lignes.reduce((m, x) => m + (x.journee ? (minutes(x.journee.total) || 0) : 0), 0),
    };
    const caseR = (lib, v, ko, ok) => `<div class="case-r ${ko && v ? 'ko' : ok && v ? 'ok' : ''}">${lib}<b>${v}</b></div>`;
    const resume = j.etat === 'REGLER' ? [
      caseR('Chantiers', n.chantiers), caseR('Validées', n.validees, false, true),
      caseR('Sans saisie', n.sansSaisie, true), caseR('À valider (chef)', n.aValider, true),
      caseR('Justifiées', n.justifiees), caseR('Rapports manquants', n.rapports, true),
      caseR('Écart de repas', n.repas, true), n.autres ? caseR('Autres points', n.autres, true) : caseR('Heures saisies', heuresTexte(n.minutes)),
    ] : ['A_COCHER', 'ENVOI', 'ENVOYE', 'HORS_APPLI', 'HORS_CONTROLE'].includes(j.etat) ? [
      caseR('Chantiers', n.chantiers), caseR('Journées', lignes.filter(x => x.journee).length),
      caseR('Justifiées', n.justifiees), caseR('Heures', heuresTexte(n.minutes)),
    ] : [];
    const verrouille = ['ENVOI', 'ENVOYE', 'HORS_APPLI', 'HORS_CONTROLE'].includes(j.etat);
    const chomeJustif = (d.justifies || []).find(x => x.type === 'JOUR_NON_TRAVAILLE');
    const motifsForm = (liste, attr) => `<div class="choix" style="--n:2">${liste.map(m => `<button type="button" ${attr}="${esc(m)}">${esc(m)}</button>`).join('')}</div>
      <input type="text" id="commentaireJour" placeholder="Commentaire (facultatif)" maxlength="300">`;
    // Actions du jour, en liens discrets (ou leur petit formulaire une fois ouvert).
    const actions = [];
    if (chomeJustif && !verrouille) actions.push(`<button class="option" type="button" data-annuler-justif="JOUR_NON_TRAVAILLE|">Annuler le jour chômé</button>`);
    if (!chomeJustif && d.planningTrouve && !verrouille && !['AVENIR', 'EN_COURS'].includes(j.etat)) {
      actions.push(chomeOuvert ? `<div class="form-jour"><b>Jour chômé (férié, pont…)</b>${motifsForm(d.motifsJour, 'data-motif-jour')}
          <div class="duo"><button class="btn btn-clair btn-petit" type="button" data-chome="fermer">Annuler</button>
          <button class="btn btn-sombre btn-petit" type="button" data-chome="ok" disabled>Déclarer le jour chômé</button></div></div>`
        : `<button class="option" type="button" data-chome="ouvrir">Déclarer jour chômé</button>`);
    }
    if (['REGLER', 'A_COCHER'].includes(j.etat)) {
      actions.push(horsAppliOuvert ? `<div class="form-jour"><b>Traité hors appli</b><input type="text" id="commentaireHorsAppli" placeholder="Pourquoi ? (ex. saisi à la main dans le Suivi RH)" maxlength="300">
          <div class="duo"><button class="btn btn-clair btn-petit" type="button" data-hors-appli="fermer">Annuler</button>
          <button class="btn btn-sombre btn-petit" type="button" data-hors-appli="ok">Marquer traité hors appli</button></div></div>`
        : `<button class="option" type="button" data-hors-appli="ouvrir">Marquer traité hors appli</button>`);
    }
    if (j.etat === 'ENVOI') actions.push(`<button class="option" type="button" data-paie="RETIRER">Retirer le jour de l'envoi</button>`);
    if (j.etat === 'HORS_APPLI') actions.push(`<button class="option" type="button" data-paie="ANNULER_HORS_APPLI">Annuler : traiter ce jour dans l'appli</button>`);
    const [couleur, etiquette] = {
      REGLER: ['rouge', `${j.points} point${j.points > 1 ? 's' : ''} à régler`], A_COCHER: ['jaune', '→ à valider'],
      ENVOI: ['bleu', "✓ prêt, dans l'envoi"], ENVOYE: ['vert', 'Envoyé'], HORS_APPLI: ['gris', 'Traité hors appli'],
      EN_COURS: ['gris', 'En cours'], AVENIR: ['gris', 'À venir'], VIDE: ['gris', 'Rien à traiter'],
      HORS_CONTROLE: ['gris', 'Avant la mise en service'],
    }[j.etat] || ['gris', ''];
    const texte = {
      ENVOI: `<p class="discret">Verrouillé : plus de saisie ni de rapport ce jour-là.${j.points ? ` <b>Retenu : ${j.points} point(s) à corriger.</b>` : ''}</p>`,
      HORS_APPLI: `<p>${esc(j.horsAppli)}</p>`,
      EN_COURS: `<p class="discret">Contrôlée à partir de ${esc(String(((stock.lire('ref') || {}).parametres || {}).controlesHeure || 18))} h (réglage CONTROLES_HEURE).</p>`,
      VIDE: '<p class="discret">Rien de saisi ni d\'attendu ce jour-là.</p>',
      HORS_CONTROLE: '<p class="discret">Jour antérieur à la mise en service (CONTROLES_DEPUIS) : lecture seule, il se traite hors appli.</p>',
    }[j.etat] || '';
    return `<div class="bandeau-jour ${couleur}">
      <div class="haut"><h2>${esc(dateLongue(date))}</h2>${etiquette ? `<span class="etat ${couleur}">${esc(etiquette)}</span>` : ''}</div>
      ${chomeJustif ? `<p class="chome-etat">Jour chômé : ${esc(chomeJustif.justification)}</p>` : ''}
      ${(d.comptesRendus || []).length ? `<details class="cr-details"><summary>Compte rendu de l'envoi au Suivi RH${d.comptesRendus.length > 1 ? ` (${d.comptesRendus.length} envois)` : ''}</summary>
        ${d.comptesRendus.slice().reverse().map(c => htmlCompteRenduJour(c, false)).join('')}</details>` : ''}
      ${ctl.duJour.filter(c => c.type === 'CHOME_AVEC_SAISIES').map(c => `<p class="chome-etat" data-point="CHOME_AVEC_SAISIES">${ICONES.attention} <b>${esc(c.titre)}</b> — ${esc(c.detail)}</p>`).join('')}
      ${texte}
      ${resume.length ? `<div class="resume-jour">${resume.join('')}</div>` : ''}
      ${j.etat === 'REGLER' ? `<button class="btn btn-petit" type="button" disabled>Valider la journée pour la paie</button>
        <p class="indice">Réglez les points dans les chantiers ci-dessous ↓</p>` : ''}
      ${j.etat === 'A_COCHER' ? '<button class="btn btn-principal btn-petit" type="button" data-paie="COCHER">Valider la journée pour la paie</button>' : ''}
      ${actions.length ? `<div class="actions-jour">${actions.join('')}</div>` : ''}
    </div>`;
  };

  const dessiner = () => {
    ctl = d.controles;
    const P = ctl.paie;
    APP().innerHTML = `
      <div class="entete">
        <img class="embleme" src="embleme.png" alt="" aria-hidden="true">
        <div><h1>Écran bureau</h1><p class="discret">${esc(dateLongue(date))}</p></div>
        <button class="icone-btn" type="button" aria-label="Se déconnecter" id="sortir">${ICONES.sortie}</button>
      </div>

      ${d.referentiels ? `<button type="button" class="alerte orange alerte-bouton" id="referentiels">${ICONES.attention}<span><b>${d.referentiels} problème${d.referentiels > 1 ? 's' : ''} dans le planning</b> (nom ou chantier inconnu, personne sans code…) — Voir</span></button>` : ''}
      <!-- La chaîne de la paie, par jour entier : à régler → à valider → dans l'envoi. -->
      <div class="chaine">
        <button type="button" class="etape rouge" data-liste-paie="REGLER"><b>${P.regler.jours}</b><span>jour${P.regler.jours > 1 ? 's' : ''} à régler<br>(${P.regler.points} point${P.regler.points > 1 ? 's' : ''})</span></button>
        <div class="fleche">›</div>
        <button type="button" class="etape jaune" data-liste-paie="A_COCHER"><b>${P.aCocher.jours}</b><span>jour${P.aCocher.jours > 1 ? 's' : ''} à valider</span></button>
        <div class="fleche">›</div>
        <button type="button" class="etape bleu" data-liste-paie="ENVOI"><b>${P.envoi.jours}</b><span>jour${P.envoi.jours > 1 ? 's' : ''} dans l'envoi</span></button>
      </div>
      <!-- Quatre semaines, du lundi au dimanche : faire glisser pour remonter le temps. -->
      <div class="bande-jours" id="bande">
        ${ctl.jours.map(j => { const [lib0, cls0] = ETATS_JOUR[j.etat] || ['·', 'vide'];
          // Version 51 : un jour chômé (férié, pont…) se voit dans la bande, même à venir : son motif, fond hachuré.
          const chome = j.chome && ['AVENIR', 'VIDE', 'EN_COURS', 'HORS_CONTROLE'].includes(j.etat);
          const [lib, cls] = chome ? [j.chome, 'chome'] : [lib0, cls0];
          // Version 54 : --col = colonne du jour (lundi 1 … dimanche 7), pour la bande en calendrier sur ordinateur.
          // Version 55 : un jour d'avant la mise en service (HORS_CONTROLE) ne se sélectionne plus dans la bande.
          const ferme = j.etat === 'HORS_CONTROLE' && j.date !== date;
          return `<button type="button" data-jour-bureau="${j.date}" aria-current="${j.date === date}" ${ferme ? 'disabled title="Avant la mise en service : se traite hors appli"' : j.chome ? `title="Jour chômé : ${esc(j.chome)}"` : ''} style="--col:${(new Date(j.date + 'T12:00:00Z').getUTCDay() + 6) % 7 + 1}"
            class="${cls} ${j.weekend ? 'weekend' : ''} ${new Date(j.date + 'T12:00:00Z').getUTCDay() === 1 ? 'lundi' : ''}">
            <small>${esc(jourCourt(j.date))}</small><b>${Number(j.date.slice(8))}</b>${j.etat === 'REGLER' ? `<span class="badge">${j.points}</span>` : esc(lib)}</button>`; }).join('')}
      </div>
      <div class="leg-bande"><span><i class="l-regler"></i>à régler</span><span><i class="l-avalider"></i>à valider</span><span><i class="l-envoi"></i>prêt, dans l'envoi</span><span><i class="l-envoye-paie"></i>envoyé</span><span><i class="l-fini"></i>hors appli</span><span><i class="l-chome"></i>chômé</span></div>

      ${bandeauJour()}

      <div class="cartes-chantiers">${d.chantiers.length ? d.chantiers.map(carteChantier).join('')
        : '<section class="bloc"><p class="discret">Aucun chantier ce jour-là.</p></section>'}</div>

      ${d.horsChantier.length ? `<h2>Sans équipe</h2><div class="cartes-chantiers">${d.horsChantier.map(x => `<section class="bloc">${carte(x)}</section>`).join('')}</div>` : ''}
      ${(d.blSansEquipe || []).length ? `<div class="alerte gris" id="blSansEquipe">${ICONES.photo}<span>${d.blSansEquipe.length} BL envoyé${d.blSansEquipe.length > 1 ? 's' : ''} ce jour-là pour un chantier qu'aucune équipe ne mène : ${esc([...new Set(d.blSansEquipe.map(nomCourt))].join(', '))}. Ils sont dans l'onglet BL et dans le dossier Drive du chantier. <button class="lien" type="button" data-bl-recents>Voir les BL récents</button></span></div>` : ''}
      ${verrou() ? '' : `<div class="duo">
        <button class="btn btn-ajout btn-petit" type="button" id="saisirPour">${ICONES.plus} Saisir pour quelqu'un</button>
        <button class="btn btn-ajout btn-petit" type="button" id="effacer">Effacer une journée saisie</button>
      </div>`}
      ${verrou() ? '' : '<button class="btn btn-ajout btn-petit" type="button" id="absencesPrevues">Absences prévues (congés, maladie, fériés…)</button>'}
      <button class="btn btn-ajout btn-petit" type="button" id="blRecents" data-bl-recents>BL récents (tous les bons de livraison)</button>

      <div class="pied">
        <button type="button" class="version" onclick="aller('/diagnostic')">Version ${esc(VERSION_APPLI)}</button>
      </div>`;

    $$('[data-modifier]').forEach(b => b.onclick = () => partir(`/bureau-journee/${date}/${encodeURIComponent(b.dataset.modifier)}`, b.dataset.modifier));
    $$('[data-ajout-interim]').forEach(b => b.onclick = () => partir(`/interimaire/${date}/${encodeURIComponent(b.dataset.ajoutInterim)}`));
    $$('[data-modifier-interim]').forEach(b => b.onclick = () => partir(`/interimaire/${date}/${encodeURIComponent(b.dataset.chef || '-')}/${encodeURIComponent(b.dataset.modifierInterim)}`, b.dataset.modifierInterim));
    $$('[data-rapport]').forEach(b => b.onclick = () => partir(`/rapport/${date}/${encodeURIComponent(b.dataset.rapport)}`));
    if ($('#saisirPour')) $('#saisirPour').onclick = () => partir('/bureau-ajout/' + date);
    if ($('#effacer')) $('#effacer').onclick = () => partir('/bureau-supprimer/' + date);
    // Version 51 : l'écran s'ouvre sur le jour affiché ; pas d'absence prévue depuis un jour clos (bouton masqué).
    if ($('#absencesPrevues')) $('#absencesPrevues').onclick = () => partir('/absences/' + date);
    $$('[data-bl-recents]').forEach(b => b.onclick = () => partir('/bl-bureau/' + date));
    $$('[data-valider-chef]').forEach(b => b.onclick = () => agir({ date, quoi: 'CHEF', personnes: [b.dataset.validerChef] }));
    $('#sortir').onclick = demanderDeconnexion;
    $$('[data-justifier]').forEach(b => b.onclick = () => { justifOuvert = b.dataset.justifier; dessiner(); });
    $$('[data-fermer-justif]').forEach(b => b.onclick = () => { justifOuvert = null; dessiner(); });
    $$('[data-motif]').forEach(b => b.onclick = () => {
      $$('[data-motif]').forEach(x => x.setAttribute('aria-pressed', x === b));
      $('[data-enregistrer-justif]').disabled = false;
    });
    $$('[data-enregistrer-justif]').forEach(b => b.onclick = async () => {
      const personne = b.dataset.enregistrerJustif, chef = b.dataset.chef;
      const c = d.chantiers.find(x => x.responsable === chef);
      const elements = [{ type: 'JOURNEE_MANQUANTE', cible: personne }];
      if ($('#toutChantier') && $('#toutChantier').checked && c) {
        c.journees.filter(y => !y.journee && !y.justification && y.personne !== personne).forEach(y => elements.push({ type: 'JOURNEE_MANQUANTE', cible: y.personne }));
      }
      const motif = $('[data-motif][aria-pressed="true"]').dataset.motif;
      $$('button').forEach(x => { x.disabled = true; });
      try {
        await appel('bureau_justifier', { date, elements, motif, commentaire: $('#commentaire').value });
        justifOuvert = null;
        d = await appel('bureau_jour', { date });
        toast(elements.length > 1 ? `${elements.length} points justifiés.` : 'Justifié.');
      } catch (err) { toast(err.message); }
      if (toujoursIci()) dessiner();
    });
    brancherBande($('#bande'), jourChoisi => aller('/bureau/' + jourChoisi));
    $$('[data-annuler-justif]').forEach(b => b.onclick = async () => {
      const [type, cible] = b.dataset.annulerJustif.split('|');
      $$('button').forEach(x => { x.disabled = true; });
      try {
        await appel('bureau_justifier', { date, elements: [{ type, cible }], annuler: true });
        d = await appel('bureau_jour', { date });
        oublierJour(date);
        toast(type === 'JOURNEE_MANQUANTE' ? 'Justification annulée : la journée est de nouveau attendue.' : 'Justification annulée.');
      } catch (err) { toast(err.message); }
      if (toujoursIci()) dessiner();
    });
    if ($('#referentiels')) $('#referentiels').onclick = () => aller('/referentiels');
    // Jour chômé : les personnes sans saisie sont justifiées d'un coup ; les temps saisis restent.
    $$('[data-chome]').forEach(b => b.onclick = async () => {
      const quoi = b.dataset.chome;
      if (quoi !== 'ok') { chomeOuvert = quoi === 'ouvrir'; return dessiner(); }
      const motif = $('[data-motif-jour][aria-pressed="true"]').dataset.motifJour;
      const commentaire = $('#commentaireJour').value;
      const saisies = d.chantiers.reduce((n, c) => n + c.journees.filter(x => x.journee).length, 0) + d.horsChantier.filter(x => x.journee).length;
      if (saisies && !(await confirmer('Déclarer ce jour chômé ?',
        `${saisies} journée${saisies > 1 ? 's sont saisies' : ' est saisie'} ce jour-là : elle${saisies > 1 ? 's' : ''} ne ${saisies > 1 ? 'sont' : 'est'} pas effacée${saisies > 1 ? 's' : ''} et ${saisies > 1 ? 'restent' : 'reste'} à valider normalement. Seules les personnes sans saisie seront justifiées.`,
        'Déclarer chômé'))) return;
      $$('button').forEach(x => { x.disabled = true; });
      try {
        await appel('bureau_justifier', { date, elements: [{ type: 'JOUR_NON_TRAVAILLE', cible: '' }], motif, commentaire });
        chomeOuvert = false;
        d = await appel('bureau_jour', { date });
        oublierJour(date);
        toast('Jour déclaré chômé.');
      } catch (err) { toast(err.message); }
      if (toujoursIci()) dessiner();
    });
    $$('[data-motif-jour]').forEach(b => b.onclick = () => {
      $$('[data-motif-jour]').forEach(x => x.setAttribute('aria-pressed', x === b));
      $('[data-chome="ok"]').disabled = false;
    });
    $$('[data-liste-paie]').forEach(b => b.onclick = () => aller('/paie/' + b.dataset.listePaie));
    $$('[data-paie]').forEach(b => b.onclick = async () => {
      if (b.dataset.paie === 'RETIRER' && !(await confirmer("Retirer ce jour de l'envoi ?", 'Il pourra de nouveau être modifié, puis devra être revalidé pour la paie.', 'Retirer'))) return;
      $$('button').forEach(x => { x.disabled = true; });
      if (await paieJour(date, b.dataset.paie)) d = await appel('bureau_jour', { date }).catch(() => d);
      if (toujoursIci()) dessiner();
    });
    $$('[data-hors-appli]').forEach(b => b.onclick = async () => {
      if (b.dataset.horsAppli !== 'ok') { horsAppliOuvert = b.dataset.horsAppli === 'ouvrir'; return dessiner(); }
      const commentaire = $('#commentaireHorsAppli').value;
      $$('button').forEach(x => { x.disabled = true; });
      if (await paieJour(date, 'HORS_APPLI', commentaire)) { horsAppliOuvert = false; d = await appel('bureau_jour', { date }).catch(() => d); }
      if (toujoursIci()) dessiner();
    });
    $$('[data-remplacant]').forEach(sel => sel.onchange = async () => {
      try {
        await appel('bureau_remplacant', { date, chef: sel.dataset.remplacant, remplacant: sel.value });
        d = await appel('bureau_jour', { date });
        toast(`${sel.value} remplace ${sel.dataset.remplacant}.`);
      } catch (err) { toast(err.message); }
      if (toujoursIci()) dessiner();
    });
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

  dessiner();
  // Retour d'une journée ou d'un rapport ouvert d'ici : on retrouve la même ligne (point 1 de la v35).
  const retour = stock.lire('retourBureau');
  if (retour && retour.date === date) {
    stock.effacer('retourBureau');
    const ligne = retour.personne ? [...document.querySelectorAll('[data-ligne]')].find(x => x.dataset.ligne === retour.personne) : null;
    const placer = () => {
      if (ligne) { ligne.scrollIntoView({ block: 'center' }); ligne.classList.add('surligne'); } else window.scrollTo(0, retour.y || 0);
    };
    placer(); requestAnimationFrame(placer);
  }
};

/**
 * Compte rendu de l'envoi d'un jour dans le Suivi RH (version 51) : date en titre, puis ce qui est écrit et ce
 * qui reste à reprendre à la main. Affiché après l'envoi et, ensuite, sur l'écran bureau de ce jour.
 */
function htmlCompteRenduJour(c, avecDate) {
  const liste = (titre, l, classe) => l && l.length ? `<p class="${classe || ''}"><b>${esc(titre)}</b></p><ul class="points">${l.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const rien = !['conflits', 'remplacements', 'aCompleter', 'ignorees'].some(k => (c[k] || []).length);
  const quand = String(c.quand || '');
  return `<div class="cr-jour" data-cr="${esc(c.date)}">
    ${avecDate ? `<p class="cr-date">${esc(dateLongue(c.date))}</p>` : ''}
    <p class="discret">Envoyé le ${esc(quand.slice(8, 10))}/${esc(quand.slice(5, 7))} à ${esc(quand.slice(11, 16))}${c.par ? ` par ${esc(c.par)}` : ''} :
      ${c.journees} journée${c.journees > 1 ? 's' : ''}, ${c.absences} absence${c.absences > 1 ? 's' : ''}${c.horsSuivi ? `, ${c.horsSuivi} hors Suivi RH` : ''}.</p>
    ${rien ? '<p class="discret">Rien à reprendre à la main.</p>' : ''}
    ${liste('Conflits : code déjà saisi dans le Suivi RH, rien d\'écrit', c.conflits, 'rouge')}
    ${liste('Jours travaillés écrits sur un code prévu', c.remplacements)}
    ${liste('À compléter à la main (rien dans l\'appli ce jour-là)', c.aCompleter)}
    ${liste('Non écrites', c.ignorees, 'rouge')}
  </div>`;
}

/** Version 59 : le bloc rentabilité du compte rendu de l'envoi (fichiers créés, lignes écrites, matériaux sans prix, échecs). */
function htmlCompteRenduRenta(x) {
  if (!x) return '';
  if (!x.actif) return `<p class="discret">Rentabilité : ${esc(x.message || 'inactive')}</p>`;
  const n = (v, mot) => `${v} ${mot}${v > 1 ? 's' : ''}`;
  const rien = !x.journees && !x.materiaux && !x.bl && !x.avancement && !(x.fichiersCrees || []).length;
  const echecs = x.echecs || [], sansPrix = x.sansPrix || [];
  return `<div class="cr-renta">
    <p><b>Rentabilité</b> : ${rien ? 'rien à écrire' : `${n(x.journees, 'ligne')} d'heures, ${n(x.materiaux, 'matériau')}, ${n(x.bl, 'BL')}, ${n(x.avancement, 'avancement')} écrits dans les fichiers de rentabilité`}${x.reste ? ` — ${n(x.reste, 'journée')} en attente du prochain envoi` : ''}.</p>
    ${(x.fichiersCrees || []).length ? `<p><b>Fichiers créés</b></p><ul class="points">${x.fichiersCrees.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${sansPrix.length ? `<p><b>Matériaux sans prix</b> (à compléter dans la colonne PU de l'onglet MATERIAUX du planning, et dans le fichier du chantier)</p><ul class="points">${sansPrix.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
    ${echecs.length ? `<p class="rouge"><b>Rentabilité non écrite</b> (repartira au prochain envoi)</p><ul class="points">${echecs.map(e => `<li><b>${esc(e.chantier)}</b> : ${esc(e.erreur)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

/** Les jours d'une étape de la chaîne de paie (« complets, à cocher » ou « dans l'envoi »), toutes dates confondues. */
ROUTES.paie = async function (etape) {
  const toujoursIci = ecranCourant();
  etape = ['ENVOI', 'REGLER'].includes(etape) ? etape : 'A_COCHER';
  const cle = { ENVOI: 'envoi', REGLER: 'regler', A_COCHER: 'aCocher' }[etape];
  chargement();
  let d;
  try { d = await appel('bureau_jour', { date: aujourdhui() }); } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;
  const recharger = async () => { d = await appel('bureau_jour', { date: aujourdhui() }).catch(() => d); };
  // Compte rendu du dernier envoi dans le Suivi RH : un bloc par jour envoyé (version 51), gardé aussi sur le jour.
  let compteRendu = null;
  const blocCompteRendu = r => {
    if (!r) return '';
    const non = (r.nonEnvoyes || []);
    return `<section class="bloc" id="compteRendu"><div class="bloc-titre">Compte rendu de l'envoi</div>
      <p>${r.ecrites} journée${r.ecrites > 1 ? 's' : ''} et ${r.absences || 0} absence${(r.absences || 0) > 1 ? 's' : ''} écrites dans le Suivi RH.</p>
      ${(r.jours || []).map(c => htmlCompteRenduJour(c, true)).join('')}
      ${non.length ? `<p class="rouge"><b>Jours non envoyés (point à corriger)</b></p><ul class="points">${non.map(x => `<li><b>${esc(dateLongue(x.date))}</b> : ${esc(x.texte)}</li>`).join('')}</ul>` : ''}
      ${htmlCompteRenduRenta(r.renta)}
    </section>`;
  };
  const dessiner = () => {
    const P = d.controles.paie[cle];
    const titre = { ENVOI: "Dans l'envoi", REGLER: 'Jours à régler', A_COCHER: 'Jours à valider' }[etape];
    const resume = etape === 'REGLER' ? `${P.jours} jour${P.jours > 1 ? 's' : ''} — ${P.points} point${P.points > 1 ? 's' : ''} à corriger`
      : `${P.jours} jour${P.jours > 1 ? 's' : ''} — ${chiffresJour(P)}`;
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="aller('/bureau')">${ICONES.retour}</button>
        <div><h1>${titre}</h1><p class="discret">${esc(resume)}</p></div>
      </div>
      ${P.liste.length ? P.liste.map(j => `
        <section class="bloc">
          <div class="bloc-titre">${esc(dateLongue(j.date))}</div>
          ${etape === 'REGLER'
            ? `<div class="resume-ligne rouge"><span>${j.points} point${j.points > 1 ? 's' : ''} à corriger</span></div>
               <ul class="points">${(j.titres || []).map(t => `<li>${esc(t)}</li>`).join('')}${j.points > (j.titres || []).length ? `<li>…</li>` : ''}</ul>`
            : `<div class="resume-ligne ${etape === 'ENVOI' ? 'bleu' : 'jaune'}"><span>${esc(chiffresJour(j))}</span>${j.points ? `<b class="rouge">${j.points} point(s)</b>` : ''}</div>`}
          <div class="actions">
            ${etape === 'A_COCHER' ? `<button class="btn btn-principal btn-petit" type="button" data-cocher="${j.date}">Valider la journée pour la paie</button>` : ''}
            <button class="${etape === 'REGLER' ? 'btn btn-principal btn-petit' : 'option'}" type="button" data-ouvrir-jour="${j.date}">${etape === 'REGLER' ? 'Régler ce jour' : 'Ouvrir le jour'}</button>
            ${etape === 'ENVOI' ? `<button class="option" type="button" data-retirer="${j.date}">Retirer de l'envoi</button>` : ''}
          </div>
        </section>`).join('') : `<section class="bloc"><p class="discret">Aucun jour ici pour l'instant.</p></section>`}
      ${etape === 'ENVOI' ? blocCompteRendu(compteRendu) : ''}
      ${etape === 'ENVOI' ? `<button class="btn ${P.jours ? 'btn-principal' : 'btn-sombre'}" type="button" id="importer" ${P.jours ? '' : 'disabled'}>
          Envoyer dans le Suivi RH${P.jours ? ` (${P.jours} jour${P.jours > 1 ? 's' : ''})` : ''}</button>` : ''}`;
    $$('[data-ouvrir-jour]').forEach(b => b.onclick = () => aller('/bureau/' + b.dataset.ouvrirJour));
    $$('[data-cocher]').forEach(b => b.onclick = async () => {
      $$('button').forEach(x => { x.disabled = true; });
      if (await paieJour(b.dataset.cocher, 'COCHER')) await recharger();
      if (toujoursIci()) dessiner();
    });
    $$('[data-retirer]').forEach(b => b.onclick = async () => {
      if (!(await confirmer("Retirer ce jour de l'envoi ?", 'Il pourra de nouveau être modifié, puis devra être revalidé pour la paie.', 'Retirer'))) return;
      $$('button').forEach(x => { x.disabled = true; });
      if (await paieJour(b.dataset.retirer, 'RETIRER')) await recharger();
      if (toujoursIci()) dessiner();
    });
    // L'envoi dans le Suivi RH se fait d'ici, sous la liste de ce qui partira (version 36).
    if ($('#importer')) $('#importer').onclick = async () => {
      const Q = d.controles.paie.envoi;
      if (!(await confirmer('Envoyer dans le Suivi RH ?', `${Q.jours} jour${Q.jours > 1 ? 's' : ''} : ${chiffresJour(Q)}.`, 'Envoyer'))) return;
      const b = $('#importer'); b.disabled = true; b.textContent = 'Envoi…';
      try {
        const r = await appel('bureau_import');
        await recharger();
        toast(`${r.ecrites} journée(s) et ${r.absences || 0} absence(s) écrites dans le Suivi RH${r.horsSuivi ? `, ${r.horsSuivi} hors Suivi RH` : ''}.`);
        compteRendu = r;
      } catch (err) { toast(err.message); }
      if (toujoursIci()) dessiner();
    };
  };
  dessiner();
};

/**
 * Problèmes du planning et de ses référentiels (nom ou chantier inconnu, personne sans code, planning du
 * jour introuvable). Pas de justification : ils disparaissent quand le planning est corrigé (version 36).
 */
ROUTES.referentiels = async function () {
  const toujoursIci = ecranCourant();
  chargement();
  let d;
  try { d = await appel('bureau_controles'); } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;
  const liste = d.controles.filter(c => c.cat === 'referentiel' && !c.justification);
  APP().innerHTML = `
    <div class="entete">
      <button class="retour" type="button" aria-label="Retour" onclick="aller('/bureau')">${ICONES.retour}</button>
      <div><h1>Problèmes du planning</h1><p class="discret">${liste.length} à corriger dans le planning ou ses onglets</p></div>
    </div>
    <p class="discret">Ils disparaissent d'eux-mêmes une fois corrigés dans le planning (pris en compte sous 30 minutes).</p>
    ${liste.length ? liste.map(c => `
      <div class="ctl referentiel" data-controle="${esc(c.id)}">
        <div class="t">${esc(c.titre)}</div>
        <div class="d">${esc(dateLongue(c.date))} — ${esc(c.detail || '')}</div>
        ${c.aide ? `<div class="d aide">À faire : ${esc(c.aide)}</div>` : ''}
      </div>`).join('') : `<div class="alerte vert">${ICONES.ok}<span>Aucun problème dans le planning.</span></div>`}`;
};

// ---------------------------------------------------------------------------
// Écrans : le bureau ajoute quelqu'un dans une équipe, ou supprime une journée saisie par erreur
// ---------------------------------------------------------------------------

ROUTES['bureau-ajout'] = async function (date) {
  date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : aujourdhui();
  const toujoursIci = ecranCourant();
  chargement();
  let d;
  try { d = await appel('bureau_jour', { date }); } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;
  // Version 37 : seulement ceux qui ne sont pas au planning du jour — les autres se saisissent depuis leur chantier.
  const lignesJour = [...d.chantiers.flatMap(c => c.journees), ...d.horsChantier];
  const saisis = new Set(lignesJour.filter(x => x.journee).map(x => x.personne));
  const auPlanning = new Set(lignesJour.filter(x => x.auPlanning).map(x => x.personne));
  const proposes = d.personnesConnues.filter(n => !auPlanning.has(n));
  APP().innerHTML = `
    <div class="entete">
      <button class="retour" type="button" aria-label="Retour" onclick="history.back()">${ICONES.retour}</button>
      <div><h1>Saisir pour quelqu'un</h1><p class="discret">${esc(dateLongue(date))}</p></div>
    </div>
    <section class="bloc">
      <div class="champ"><label for="qui">Qui ? <span class="discret">(personnes qui ne sont pas au planning du jour)</span></label>
        <select id="qui"><option value="">Choisir…</option>
          ${proposes.map(n => `<option value="${esc(n)}" ${saisis.has(n) ? 'disabled' : ''}>${esc(n)}${saisis.has(n) ? ' — déjà saisie' : ''}</option>`).join('')}
        </select></div>
      <div class="champ"><label for="chef">Où a-t-il travaillé ?</label>
        <select id="chef"><option value="">Choisir…</option>
          ${d.chantiers.filter(c => c.responsable).map(c => `<option value="${esc(c.responsable)}">Avec l'équipe de ${esc(c.responsable)} — ${esc(c.villes.map(nomCourt).join(' + '))}</option>`).join('')}
          <option value="~">Sur un chantier hors planning (il en sera le chef)</option>
        </select></div>
      <p class="discret">Avec une équipe : ses chantiers et ses repas comptent avec ceux de ce chef. Les gars au planning se saisissent depuis leur chantier, sur l'écran bureau.</p>
    </section>
    <p class="erreur-champ" id="erreur" role="alert"></p>
    <div class="pied"><button class="btn btn-principal" type="button" id="continuer" disabled>Continuer vers sa journée</button></div>`;
  const maj = () => { $('#continuer').disabled = !($('#qui').value && $('#chef').value); };
  $('#qui').onchange = maj; $('#chef').onchange = maj;
  $('#continuer').onclick = () => aller(`/bureau-journee/${date}/${encodeURIComponent($('#qui').value)}/${encodeURIComponent($('#chef').value)}`);
};

ROUTES['bureau-supprimer'] = async function (date) {
  date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : aujourdhui();
  const toujoursIci = ecranCourant();
  chargement();
  let d;
  try { d = await appel('bureau_jour', { date }); } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;
  // Les journées déjà envoyées au Suivi RH ne se suppriment pas. Version 50 : celles des chefs, si (chef malade
  // qui a saisi quand même : sans cela, impossible de justifier son absence et de nommer un remplaçant).
  const lignes = [...d.chantiers.flatMap(c => c.journees.map(x => ({ ...x, equipe: c.responsable }))), ...d.horsChantier.map(x => ({ ...x, equipe: '' }))]
    .filter(x => x.journee && !x.exportee);
  let choisi = null, confirmer = false;
  // Après l'effacement de la journée d'un chef : 'question' → 'motif' → 'remplacant'.
  let etape = null, chef = null, motif = null, candidats = [];
  const aller_bureau = () => aller('/bureau/' + date);
  const dessinerSuite = () => {
    const tete = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="history.back()">${ICONES.retour}</button>
        <div><h1>Chef absent</h1><p class="discret">${esc(dateLongue(date))}</p></div>
      </div>`;
    if (etape === 'question') APP().innerHTML = `${tete}
      <div class="alerte vert">${ICONES.ok}<span>Journée de <b>${esc(chef.personne)}</b> effacée. Justifier son absence et nommer un remplaçant ?</span></div>
      <div class="pied"><div class="duo"><button class="btn btn-clair" type="button" id="plusTard">Plus tard</button>
        <button class="btn btn-principal" type="button" id="oui">Oui</button></div></div>`;
    else if (etape === 'motif') APP().innerHTML = `${tete}
      <section class="bloc"><p><b>Motif de l'absence de ${esc(chef.personne)}</b></p>
        <div class="choix" style="--n:2">${d.motifs.filter(m => !(chef.salarieRh && m === 'Retiré du planning')).map(m => `<button type="button" data-motif="${esc(m)}" aria-pressed="${m === motif}">${esc(m)}</button>`).join('')}</div></section>
      <div class="pied"><div class="duo"><button class="btn btn-clair" type="button" id="plusTard">Plus tard</button>
        <button class="btn btn-principal" type="button" id="justifier" ${motif ? '' : 'disabled'}>Justifier</button></div></div>`;
    else APP().innerHTML = `${tete}
      <section class="bloc"><p><b>Qui remplace ${esc(chef.personne)} ?</b></p>
        ${candidats.length ? `<div class="coches">${candidats.map(n => `<label class="case"><input type="radio" name="remplacant" value="${esc(n)}"> ${esc(n)}</label>`).join('')}</div>
        <p class="discret">Sans choix, le premier de l'équipe qui envoie sa journée le remplace.</p>`
          : '<p class="discret">Personne dans son équipe ne peut le remplacer ce jour-là.</p>'}</section>
      <div class="pied"><div class="duo"><button class="btn btn-clair" type="button" id="plusTard">Plus tard</button>
        <button class="btn btn-principal" type="button" id="nommer" disabled>Nommer</button></div></div>`;
    $('#plusTard').onclick = aller_bureau;
    if ($('#oui')) $('#oui').onclick = () => { etape = 'motif'; dessinerSuite(); };
    $$('[data-motif]').forEach(b => b.onclick = () => { motif = b.dataset.motif; dessinerSuite(); });
    if ($('#justifier')) $('#justifier').onclick = async () => {
      $$('button').forEach(b => { b.disabled = true; });
      try {
        await appel('bureau_justifier', { date, elements: [{ type: 'JOURNEE_MANQUANTE', cible: chef.personne }], motif, commentaire: '' });
        const frais = await appel('bureau_jour', { date });
        const c = frais.chantiers.find(x => x.responsable === chef.personne && x.chefAbsent);
        candidats = c ? c.candidatsRemplacant : [];
        oublierJour(date);
        toast('Absence justifiée.');
        etape = 'remplacant';
      } catch (err) { toast(err.message); }
      if (toujoursIci()) dessinerSuite();
    };
    $$('input[name="remplacant"]').forEach(r => r.onchange = () => { $('#nommer').disabled = false; });
    if ($('#nommer')) $('#nommer').onclick = async () => {
      const r = $('input[name="remplacant"]:checked');
      $$('button').forEach(b => { b.disabled = true; });
      try {
        await appel('bureau_remplacant', { date, chef: chef.personne, remplacant: r.value });
        toast(`${r.value} remplace ${chef.personne}.`);
        return aller_bureau();
      } catch (err) { toast(err.message); }
      if (toujoursIci()) dessinerSuite();
    };
  };
  const dessiner = () => {
    const x = lignes.find(y => y.personne === choisi);
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="history.back()">${ICONES.retour}</button>
        <div><h1>Effacer une journée saisie</h1><p class="discret">${esc(dateLongue(date))}</p></div>
      </div>
      ${lignes.length ? `<section class="bloc"><p class="discret">Remet la journée à zéro : saisie par erreur, mauvaise équipe, doublon, chef absent qui a saisi quand même. Pour quelqu'un qui ne devait pas être au planning, efface d'abord sa saisie, puis justifie son absence.</p>
        <div class="coches">${lignes.map(y => `<label class="case"><input type="radio" name="qui" value="${esc(y.personne)}" ${y.personne === choisi ? 'checked' : ''}>
          ${esc(y.personne)}${y.estChef ? ' <span class="discret">(chef)</span>' : ''} <span class="discret">— ${esc(y.journee.hEmbauche)}–${esc(y.journee.hDebauche)}${y.equipe ? `, équipe de ${esc(y.equipe)}` : ', hors équipe'}</span></label>`).join('')}</div></section>`
        : '<section class="bloc"><p class="discret">Aucune journée à effacer ce jour-là.</p></section>'}
      ${x && confirmer ? `<div class="alerte rouge">${ICONES.attention}<span>Effacer définitivement la saisie de <b>${esc(x.personne)}</b> du ${esc(dateLongue(date).toLowerCase())} ?
        ${x.auPlanning ? ' Il est au planning : sa journée redevient attendue. Il pourra la ressaisir, ou tu pourras justifier son absence.' : ''}</span></div>` : ''}
      <div class="pied">
        ${x && confirmer ? `<div class="duo"><button class="btn btn-clair" type="button" id="annuler">Annuler</button>
          <button class="btn btn-rouge" type="button" id="confirmer">Confirmer l'effacement</button></div>`
          : `<button class="btn btn-rouge" type="button" id="supprimer" ${x ? '' : 'disabled'}>${x ? `Effacer la journée de ${esc(x.personne)}` : 'Choisir une personne'}</button>`}
      </div>`;
    $$('input[name="qui"]').forEach(r => r.onchange = () => { choisi = r.value; confirmer = false; dessiner(); });
    if ($('#supprimer')) $('#supprimer').onclick = () => { confirmer = true; dessiner(); };
    if ($('#annuler')) $('#annuler').onclick = () => { confirmer = false; dessiner(); };
    if ($('#confirmer')) $('#confirmer').onclick = async () => {
      $$('button').forEach(b => { b.disabled = true; });
      try {
        await appel('bureau_supprimer', { date, personne: choisi });
        oublierJour(date);
        // Version 50 : le chef du planning effacé → proposer tout de suite de justifier son absence et de le remplacer.
        if (x.estChef) { chef = x; etape = 'question'; return dessinerSuite(); }
        toast(`Journée de ${choisi} effacée.`);
        aller_bureau();
      } catch (err) { toast(err.message); confirmer = false; dessiner(); }
    };
  };
  dessiner();
};

/**
 * Absences prévues (version 50) : congés, maladie, formation… d'une personne, ou jour chômé pour tout le monde
 * (férié, pont / RTT, intempéries), déclarés d'avance, du … au … (jours du lundi au vendredi seulement).
 */
/**
 * Écran « BL récents » du bureau (version 55) : tous les BL des 10 derniers jours, groupés par jour, avec vignette,
 * auteur et heure ; toucher la vignette ouvre la photo ; « Chantier de ce BL » + « Ranger ici » la range ailleurs.
 */
ROUTES['bl-bureau'] = async function (param) {
  const toujoursIci = ecranCourant();
  const retour = /^\d{4}-\d{2}-\d{2}$/.test(param || '') ? param : aujourdhui();
  let d = stock.lire('blBureau');
  const dessiner = () => {
    const jours = d ? [...new Set(d.bl.map(b => b.date))] : [];
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="aller('/bureau/' + '${retour}')">${ICONES.retour}</button>
        <div><h1>BL récents</h1><p class="discret">Tous les bons de livraison des 10 derniers jours</p></div>
      </div>
      ${!d ? '<section class="bloc"><p class="discret">Chargement…</p></section>'
        : !d.bl.length ? '<section class="bloc"><p class="discret">Aucun BL depuis 10 jours.</p></section>'
        : jours.map(j => `<section class="bloc"><h2>${esc(dateLongue(j))}</h2>
          ${d.bl.map((b, k) => b.date !== j ? '' : `
            <div class="bl-ligne">
              <button type="button" class="bl-vignette" data-bl-voir="${k}" aria-label="Voir le bon de livraison"${b.vignette ? ` style="background-image:url('${b.vignette}')"` : ''}>${b.vignette ? '' : '<span class="voir">Voir</span>'}</button>
              <div class="bl-infos"><span class="sous">${esc(b.auteur || '—')}${b.ajoute ? ` · ${esc(String(b.ajoute).slice(11, 16))}` : ''}</span>
                ${champDeplacementBl(b, k, d.chantiers, b.modifiable)}
                ${b.modifiable ? `<button class="option" type="button" data-bl-suppr="${k}">Supprimer ce BL</button>` : ''}</div>
            </div>`).join('')}</section>`).join('')}`;
    if (!d) return;
    brancherDeplacementBl(d.bl);
    $$('[data-bl-voir]').forEach(v => v.onclick = () => {
      const b = d.bl[+v.dataset.blVoir];
      voirPhoto(chantierAffiche(b), () => appel('photo_bl', { date: b.date, id: b.id }).then(r => r.image));
    });
    // Version 55 : suppression d'un BL par le bureau, avec confirmation.
    $$('[data-bl-suppr]').forEach(x => x.onclick = async () => {
      const b = d.bl[+x.dataset.blSuppr];
      const ok = await confirmer('Supprimer ce BL ?', `Suppression définitive : le BL de ${b.auteur || '—'} (${nomCourt(chantierAffiche(b))}, ${dateLongue(b.date)}) disparaît de l'appli et sa photo est supprimée de Drive. Impossible de revenir en arrière.`, 'Supprimer');
      if (!ok) return;
      x.disabled = true;
      try {
        await appel('supprimer_bl', { id: b.id });
        d.bl = d.bl.filter(y => y !== b); stock.ecrire('blBureau', d);
        toast('BL supprimé.');
      } catch (err) { toast(err.message); }
      if (toujoursIci()) dessiner();
    });
  };
  surDeplacement = () => { if (toujoursIci()) dessiner(); };
  dessiner();
  try {
    const r = await appel('bl_bureau', {});
    d = r; stock.ecrire('blBureau', r);
  } catch (err) {
    if (!toujoursIci()) return;
    if (!d) { erreurEcran(err, "Les BL récents ont besoin du réseau."); return; }
    toast(err.message);
  }
  if (toujoursIci()) dessiner();
};

ROUTES.absences = async function (param) {
  const toujoursIci = ecranCourant();
  const jourInitial = /^\d{4}-\d{2}-\d{2}$/.test(param || '') ? param : aujourdhui();
  chargement();
  let d;
  try { d = await appel('bureau_absences', { action: 'lister' }); } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;
  const f = { tous: false, personne: '', du: jourInitial, au: jourInitial, motif: '', commentaire: '' };
  const jj = x => `${x.slice(8, 10)}/${x.slice(5, 7)}`;
  const dessiner = () => {
    const p = d.personnes.find(x => x.libelle === f.personne);
    const motifs = f.tous ? d.motifsJour : d.motifs.filter(m => !(p && p.salarieRh && m === 'Retiré du planning'));
    if (!motifs.includes(f.motif)) f.motif = '';
    const pret = f.motif && f.du && f.au && (f.tous || f.personne);
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="aller('/bureau/' + '${jourInitial}')">${ICONES.retour}</button>
        <div><h1>Absences prévues</h1><p class="discret">Congés, maladie, formation, fériés… déclarés d'avance</p></div>
      </div>
      <section class="bloc">
        <div class="choix" style="--n:2">
          <button type="button" data-pour="un" aria-pressed="${!f.tous}">Une personne</button>
          <button type="button" data-pour="tous" aria-pressed="${f.tous}">Tout le monde</button>
        </div>
        ${f.tous ? '' : `<label class="champ">Personne<select id="absPersonne"><option value="">Choisir…</option>
          ${d.personnes.map(x => `<option ${x.libelle === f.personne ? 'selected' : ''}>${esc(x.libelle)}</option>`).join('')}</select></label>`}
        <div class="duo"><label class="champ">Du<input type="date" id="absDu" value="${esc(f.du)}"></label>
          <label class="champ">Au<input type="date" id="absAu" value="${esc(f.au)}"></label></div>
        <p class="discret">Seuls les jours du lundi au vendredi sont enregistrés.</p>
        <div class="choix" style="--n:2">${motifs.map(m => `<button type="button" data-motif-abs="${esc(m)}" aria-pressed="${m === f.motif}">${esc(m)}</button>`).join('')}</div>
        <input type="text" id="absCommentaire" placeholder="Commentaire (facultatif)" maxlength="300" value="${esc(f.commentaire)}">
        <button class="btn btn-principal" type="button" id="absEnregistrer" ${pret ? '' : 'disabled'}>Enregistrer</button>
      </section>
      <h2>Absences déclarées</h2>
      ${d.absences.length ? d.absences.map((g, i) => `
        <section class="bloc" data-absence="${i}">
          <div class="ligne-tete"><span>${g.type === 'JOUR_NON_TRAVAILLE' ? 'Tout le monde' : esc(g.personne)} — ${esc(g.motif)}</span>
            <span class="pastille">${g.envoye ? 'Envoyée' : g.boucle ? 'Bouclée' : g.type === 'JOUR_NON_TRAVAILLE' ? 'Chômé' : 'Justifiée'}</span></div>
          <p class="discret">${g.du === g.au ? `le ${jj(g.du)}` : `du ${jj(g.du)} au ${jj(g.au)} (${g.jours.length} j)`}</p>
          ${g.boucle || g.envoye ? '' : `<button class="option" type="button" data-annuler-abs="${i}">Annuler</button>`}
        </section>`).join('') : '<section class="bloc"><p class="discret">Aucune absence déclarée depuis 30 jours ni à venir.</p></section>'}`;
    const lire = () => {
      if ($('#absPersonne')) f.personne = $('#absPersonne').value;
      f.du = $('#absDu').value; f.au = $('#absAu').value; f.commentaire = $('#absCommentaire').value;
    };
    $$('[data-pour]').forEach(b => b.onclick = () => { lire(); f.tous = b.dataset.pour === 'tous'; dessiner(); });
    if ($('#absPersonne')) $('#absPersonne').onchange = () => { lire(); dessiner(); };
    ['#absDu', '#absAu'].forEach(s => { $(s).onchange = () => { lire(); if (f.au < f.du) f.au = f.du; dessiner(); }; });
    $$('[data-motif-abs]').forEach(b => b.onclick = () => { lire(); f.motif = b.dataset.motifAbs; dessiner(); });
    $('#absEnregistrer').onclick = async () => {
      lire();
      $$('button').forEach(b => { b.disabled = true; });
      try {
        const r = await appel('bureau_absences', { action: 'ajouter', personne: f.tous ? '' : f.personne, du: f.du, au: f.au, motif: f.motif, commentaire: f.commentaire });
        toast(`${r.jours} jour${r.jours > 1 ? 's' : ''} enregistré${r.jours > 1 ? 's' : ''}.`);
        Object.assign(f, { motif: '', commentaire: '' });
        d = await appel('bureau_absences', { action: 'lister' });
      } catch (err) { toast(err.message); }
      if (toujoursIci()) dessiner();
    };
    $$('[data-annuler-abs]').forEach(b => b.onclick = async () => {
      const g = d.absences[Number(b.dataset.annulerAbs)];
      if (!(await confirmer("Annuler cette absence ?", `${g.type === 'JOUR_NON_TRAVAILLE' ? 'Tout le monde' : g.personne} — ${g.motif}, ${g.jours.length} jour${g.jours.length > 1 ? 's' : ''}.`, 'Annuler l\'absence'))) return;
      $$('button').forEach(x => { x.disabled = true; });
      try {
        await appel('bureau_absences', { action: 'annuler', lignes: g.jours.map(date => ({ type: g.type, cible: g.personne, date })) });
        g.jours.forEach(oublierJour);
        toast('Absence annulée.');
        d = await appel('bureau_absences', { action: 'lister' });
      } catch (err) { toast(err.message); }
      if (toujoursIci()) dessiner();
    });
  };
  dessiner();
};

ROUTES['bureau-journee'] = async function (param) {
  const toujoursIci = ecranCourant();
  const [date, personneEncodee, chefEncode] = String(param || '').split('/');
  const personne = decodeURIComponent(personneEncodee || '');
  // Ajout par « Saisir pour quelqu'un » : l'équipe choisie ('-' = aucune) ; absent pour une correction.
  // '~' : sur un chantier hors planning — pas d'équipe imposée, elle se déduit de ses chantiers (chef de fait).
  const horsPlanning = chefEncode === '~';
  const chefChoisi = chefEncode === undefined || horsPlanning ? undefined : (chefEncode === '-' ? '' : decodeURIComponent(chefEncode));
  chargement();
  let ref, d;
  try {
    ref = await referentiels();
    d = await appel('bureau_jour', { date });
  } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;

  const toutes = [...d.chantiers.flatMap(c => c.journees), ...d.horsChantier];
  const ligne = toutes.find(x => x.personne === personne);
  const chantier = chefChoisi !== undefined ? d.chantiers.find(c => c.responsable === chefChoisi)
    : d.chantiers.find(c => c.journees.some(x => x.personne === personne));
  const e = etatInitial(date, ligne && ligne.journee, chantier ? { lieux: chantier.villes } : null);
  // Version 45 : ce que fera « Laisser ouverte », selon la personne.
  const menePar = d.chantiers.find(c => (c.deFait && c.responsable === personne) || c.remplacant === personne);
  const phraseOuverte = (ligne && ligne.estChef) ? "Laisser ouverte : validée d'office à son nom, il pourra la corriger."
    : (menePar || horsPlanning) ? 'Laisser ouverte : elle restera à valider par le bureau, il pourra la corriger.'
    : (ligne && ligne.interimaire) ? 'Laisser ouverte : son chef la validera.'
    : 'Laisser ouverte : son chef la validera, elle reste corrigeable.';

  const dessiner = () => {
    const y = window.scrollY;
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="history.back()">${ICONES.retour}</button>
        <div><h1>${esc(personne)}</h1><p class="discret">${esc(dateLongue(date))} — saisie par le bureau${chefChoisi ? `, équipe de ${esc(chefChoisi)}` : horsPlanning ? ', chantier hors planning' : chefChoisi === '' ? ', sans équipe' : ''}</p></div>
      </div>
      ${formulaireJournee(e, ref, false)}
      <div class="pied">
        <div class="duo"><button class="btn btn-principal" type="button" id="envoyer">Validation bureau</button>
          <button class="btn btn-clair" type="button" id="ouverte">Laisser ouverte</button></div>
        <p class="discret mini-aide" id="aideOuverte">${esc(phraseOuverte)}</p>
      </div>`;
    brancherFormulaire(e, dessiner);
    const envoyer = async valider => {
      const probleme = controler(e, false);
      if (probleme) { $('#erreur').textContent = probleme; return; }
      const b = valider ? $('#envoyer') : $('#ouverte'); const texte = b.textContent;
      $('#envoyer').disabled = $('#ouverte').disabled = true; b.textContent = 'Enregistrement…';
      try {
        await appel('bureau_journee', Object.assign({ personne, valider }, donneesJournee(e), chefChoisi !== undefined ? { chef: chefChoisi } : {}));
        oublierJour(date);
        toast(valider ? 'Journée enregistrée et validée par le bureau.' : 'Journée enregistrée, laissée ouverte.');
        aller(apresCorrectionBureau(date));
      } catch (err) { $('#envoyer').disabled = $('#ouverte').disabled = false; b.textContent = texte; $('#erreur').textContent = err.message; }
    };
    $('#envoyer').onclick = () => envoyer(true);
    $('#ouverte').onclick = () => envoyer(false);
    window.scrollTo(0, y);
  };
  dessiner();
};

// ---------------------------------------------------------------------------
// Écran : diagnostic. Le bureau l'ouvre par son bouton « Version » ; les gars et les chefs, qui n'ont plus
// ce bouton (version 48), par un appui long sur l'emblème de l'accueil, si le bureau le leur demande.
// ---------------------------------------------------------------------------

/** Appui maintenu 2 secondes sur un élément ; un glissement du doigt (défilement) l'annule. */
function appuiLong(el, action) {
  if (!el) return;
  let minuterie = null, depart = null;
  const annuler = () => { clearTimeout(minuterie); minuterie = null; };
  el.addEventListener('pointerdown', ev => {
    depart = [ev.clientX, ev.clientY];
    annuler();
    minuterie = setTimeout(() => { minuterie = null; action(); }, 2000);
  });
  el.addEventListener('pointermove', ev => {
    if (minuterie && depart && Math.hypot(ev.clientX - depart[0], ev.clientY - depart[1]) > 10) annuler();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.addEventListener(t, annuler));
  el.addEventListener('contextmenu', ev => ev.preventDefault());    // pas de menu « Enregistrer l'image »
}

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
