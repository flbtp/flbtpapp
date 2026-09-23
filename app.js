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
const VERSION_APPLI = '20';

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
      const err = new HorsReseau(`Le serveur a renvoyé une erreur ${rep.status}.`);
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
  stock.effacer('accueil');
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
  SAISIE: ['Envoyée', 'saisie'], SIGNALEE: ['À corriger', 'signalee'], VALIDEE_CHEF: ['Validée', 'ok'],
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
  const lignes = [];
  if (c.aValider) lignes.push(`<b>${c.aValider} journée${c.aValider > 1 ? 's' : ''} à valider.</b>`);
  const autres = c.manquants.filter(n => n !== moi);
  if (c.manquants.includes(moi)) lignes.push("Ta propre journée n'est pas encore saisie.");
  if (autres.length) lignes.push(`Pas encore saisie : ${esc(autres.join(', '))}.`);
  if (!c.rapportEnvoye) lignes.push('Rapport de chantier pas encore envoyé.');
  const rienAFaire = !lignes.length;
  if (rienAFaire) lignes.push(`Équipe validée (${c.validees}) et rapport envoyé. Rien à faire.`);

  return `
    <div class="alerte ${rienAFaire ? 'vert' : (c.aValider ? 'jaune' : 'rouge')}">
      ${rienAFaire ? ICONES.ok : ICONES.attention}<span>${lignes.join('<br>')}</span>
    </div>
    <div class="duo">
      <button class="btn ${c.rapportEnvoye ? 'btn-sombre' : 'btn-principal'} btn-petit" type="button" onclick="aller('/rapport/${a.date}')">Rapport de chantier</button>
      <button class="btn ${c.aValider ? 'btn-principal' : 'btn-sombre'} btn-petit" type="button" onclick="aller('/equipe/${a.date}')">Valider mon équipe${c.aValider ? ` (${c.aValider})` : ''}</button>
    </div>`;
}

function dessinerAccueil(a, session) {
  const j = a.journee;
  const refus = stock.lire('refus', []);
  const bloc = a.bloc;

  let action;
  if (!j) action = `<button class="btn btn-principal" type="button" onclick="aller('/saisie/${a.date}')">Saisir ma journée</button>`;
  else if (j.statut === 'SIGNALEE') action = `<div class="alerte rouge">${ICONES.attention}<span><b>Ton chef demande une correction :</b> ${esc(j.signalement)}</span></div>
    <button class="btn btn-principal" type="button" onclick="aller('/saisie/${a.date}')">Corriger ma journée</button>`;
  else if (j.enAttente) action = `<div class="alerte jaune">${ICONES.horloge}<span>Journée gardée sur ton téléphone : ${esc(j.hEmbauche)}–${esc(j.hPause)} · ${esc(j.hReprise)}–${esc(j.hDebauche)}. Elle partira dès que possible.</span></div>`;
  else if (j.modifiable) action = `<div class="alerte vert">${ICONES.ok}<span>Journée envoyée : ${esc(j.hEmbauche)}–${esc(j.hPause)} · ${esc(j.hReprise)}–${esc(j.hDebauche)}</span></div>
    <button class="btn btn-clair btn-petit" type="button" onclick="aller('/saisie/${a.date}')">Corriger ma journée</button>`;
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
        <div><div class="chantier">${esc(libellesChantiers(bloc).map(nomCourt).join(' + '))}</div>
          <p class="discret">${esc([bloc.client, bloc.taches].filter(Boolean).join(' — '))}</p></div>
        <div class="pastilles"><span class="pastille">Chef : ${esc(bloc.responsable)}</span></div>
        <div class="sep"><span class="sous">Équipe</span><p>${esc(bloc.equipe.join(', '))}</p></div>
      </section>`
      : `<section class="bloc"><p>${a.planningTrouve ? "Tu n'es pas au planning aujourd'hui." : "Le planning du jour n'est pas encore disponible."}</p>
         <p class="discret">Si tu as travaillé, saisis quand même ta journée.</p></section>`}
    ${action}
    ${a.estResponsable ? resumeChef(a, session.personne) : ''}
    ${a.estBureau ? `<button class="btn btn-clair btn-petit" type="button" onclick="aller('/bureau/${a.date}')">Écran bureau</button>` : ''}
    <div class="pied">
      <span class="sous">Ma semaine</span>
      <div class="semaine">
        ${a.semaine.map(s => {
          const [lib, cls] = LIBELLES_STATUT[s.statut] || ['—', ''];
          const cliquable = ['NON_SAISIE', 'SIGNALEE', 'SAISIE'].includes(s.statut);
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

/** Horaires les plus courants : proposés par défaut, toujours modifiables. */
const HORAIRES_HABITUELS = { hEmbauche: '08:00', hPause: '12:00', hReprise: '13:30', hDebauche: '17:30' };

function etatInitial(date, journee, bloc) {
  const j = journee || {};
  const chantiers = j.chantiers && j.chantiers.length ? j.chantiers : ((bloc && bloc.lieux) || []);
  return {
    date,
    chantiers: [...chantiers],
    lieuEmbauche: j.lieuEmbauche || chantiers[0] || '',
    parts: (() => {
      const p = {};
      String((j.repartition) || '').split(' ; ').filter(Boolean).forEach(x => {
        const i = x.lastIndexOf(':');
        if (i > 0) p[x.slice(0, i)] = Number(x.slice(i + 1)) || 0;
      });
      return p;
    })(),
    hEmbauche: j.hEmbauche || HORAIRES_HABITUELS.hEmbauche,
    hPause: j.hPause || HORAIRES_HABITUELS.hPause,
    hReprise: j.hReprise || HORAIRES_HABITUELS.hReprise,
    hDebauche: j.hDebauche || HORAIRES_HABITUELS.hDebauche,
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

function choix(nom, options, valeur, n) {
  return `<div class="choix" style="--n:${n || options.length}" role="group">
    ${options.map(([v, lib]) => `<button type="button" data-choix="${nom}" data-v="${esc(v)}" aria-pressed="${String(valeur) === String(v)}">${esc(lib)}</button>`).join('')}
  </div>`;
}

function formulaireJournee(e, ref, interimaire) {
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
        <input id="nomInterimaire" type="text" autocomplete="off" value="${esc(e.nomInterimaire)}" data-champ="nomInterimaire"></div>
      <div class="champ"><label for="agence">Agence</label>
        <input id="agence" type="text" autocomplete="off" value="${esc(e.agence)}" data-champ="agence" placeholder="Randstad, Adéquat, Temporis…"></div>
    </section>` : ''}

    <section class="bloc">
      <div class="champ">
        <span class="etiquette">${e.chantiers.length > 1 ? 'Chantiers' : 'Chantier'}</span>
        <div class="chips">${e.chantiers.map(c => `<span class="chip">${esc(nomCourt(c))}<button type="button" data-retirer="${esc(c)}" aria-label="Retirer ${esc(c)}">×</button></span>`).join('') || '<span class="discret">Aucun chantier choisi</span>'}</div>
        <select id="ajoutChantier" aria-label="Ajouter un chantier">
          <option value="">+ Ajouter un chantier</option>
          ${chantiers.filter(c => !e.chantiers.includes(c.libelle)).map(c => `<option>${esc(c.libelle)}</option>`).join('')}
        </select>
      </div>
      <div class="champ">
        <label for="lieuEmbauche">Où as-tu embauché ?</label>
        <select id="lieuEmbauche" data-champ="lieuEmbauche">
          ${e.lieuEmbauche ? '' : '<option value="">Choisir…</option>'}
          ${e.chantiers.length ? `<optgroup label="Sur le chantier">${e.chantiers.map(c => `<option ${c === e.lieuEmbauche ? 'selected' : ''}>${esc(c)}</option>`).join('')}</optgroup>` : ''}
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
              <output class="${parts[i] < 0 ? 'erreur-champ' : ''}">${duree(Math.max(0, parts[i]))}</output>
              ${dernier ? '' : `<button type="button" data-part="${i}" data-sens="1" aria-label="Plus un quart d'heure">+</button>`}
            </div>
          </div>
          ${dernier ? '<p class="discret">Le reste de la journée.</p>' : ''}
        </div>`;
      }).join('')}
      ${partsMinutes(e, total).some(m => m < 0) ? `<p class="erreur-champ">Tu as réparti plus que ta journée : enlève du temps ailleurs.</p>` : ''}
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
          ${autreDuree || e.tachesSuppMin === 'autre' ? `<input type="number" inputmode="numeric" min="1" max="240" aria-label="Durée en minutes" placeholder="Minutes" value="${autreDuree ? esc(e.tachesSuppMin) : ''}" data-champ="tachesSuppMinAutre">` : ''}
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
      const t = $('#total');
      if (t) {
        const [a, b, c, d] = [e.hEmbauche, e.hPause, e.hReprise, e.hDebauche].map(minutes);
        t.textContent = [a, b, c, d].some(x => x === null) || !(a < b && b <= c && c < d) ? '—' : duree((b - a) + (d - c));
      }
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
  if ((b - a) + (d - c) > 12 * 60) return 'Plus de 12 heures dans la journée : vérifie les horaires.';
  if (!e.trajet) return 'Choisis le trajet.';
  if (e.avecTaches === null) return 'Indique si tu as fait des tâches avant le chantier.';
  if (e.avecTaches) {
    if (!e.tachesSupp.trim()) return 'Décris la tâche avant chantier.';
    const m = Number(e.tachesSuppMin);
    if (!(m > 0 && m <= 240)) return 'Indique la durée de la tâche (en minutes).';
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
      ${a && a.journee && a.journee.statut === 'SIGNALEE' ? `<div class="alerte rouge">${ICONES.attention}<span><b>À corriger :</b> ${esc(a.journee.signalement)}</span></div>` : ''}
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
      stock.ecrire('dernierEnvoi', { etat: e, enAttente: !!r.enAttente });
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
    if (acc.date === date) acc.journee = journee;
    acc.semaine = (acc.semaine || []).map(s => (s.date === date ? { ...s, statut: 'SAISIE' } : s));
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
        : 'Ton chef la validera ce soir.'}</p>
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
        ${Array.from({ length: c.blEnvoyes }).map(() => '<div class="vignette"><em>Envoyé</em></div>').join('')}
        ${c.photos.map(ph => `<div class="vignette" style="background-image:url('${ph.apercu}')"><em>${ph.enAttente ? 'En attente' : 'Envoyé'}</em></div>`).join('')}
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
      toast('Préparation de la photo…');
      try {
        const image = await redimensionner(f);
        // Une photo = un envoi : si le réseau coupe, on ne perd pas tout le rapport.
        const r = await envoyer('ajouter_bl', { date, auNomDe, chantier: c.libelle, image }, `Photo de BL — ${c.libelle}`);
        c.photos.push({ apercu: image, enAttente: !!r.enAttente });
        toast(r.enAttente ? 'Photo gardée, elle partira avec le réseau.' : 'Photo envoyée.');
        dessiner();
      } catch (err) { toast(err.message); }
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
      aller(auNomDe ? '/bureau/' + date : '/accueil');
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
  const signalement = {};

  const carte = m => {
    const j = m.journee;
    if (!j && m.estMoi) return `
      <section class="bloc"><div class="ligne-tete"><span>${esc(m.personne)} <span class="discret">(toi)</span></span><span class="pastille rouge">Pas saisie</span></div>
        <p class="discret">Ta propre journée n'est pas encore saisie.</p>
        <button class="btn btn-principal btn-petit" type="button" onclick="aller('/saisie/${date}')">Saisir ma journée</button></section>`;
    if (!j) return `
      <section class="bloc"><div class="ligne-tete"><span>${esc(m.personne)}</span><span class="pastille rouge">Pas saisie</span></div>
        <p class="discret">Prévu au planning sur ce chantier, aucune journée reçue.</p></section>`;
    const pastille = { SAISIE: ['À valider', 'attente'], SIGNALEE: ['Signalée', 'rouge'], VALIDEE_CHEF: ['Validée', 'vert'],
      VALIDEE_BUREAU: ['Validée bureau', 'vert'], EXPORTEE: ['Validée bureau', 'vert'] }[j.statut] || [j.statut, ''];
    const aValider = j.statut === 'SAISIE';
    return `
      <section class="bloc" ${aValider ? 'style="border:2px solid var(--jaune)"' : ''}>
        <div class="ligne-tete"><span>${esc(m.personne)}${m.estMoi ? ' <span class="discret">(toi)</span>' : ''}${m.interimaire ? ' <span class="discret">(intérim)</span>' : ''}</span>
          <span class="pastille ${pastille[1]}">${esc(pastille[0])}</span></div>
        <p>${esc(j.hEmbauche)}–${esc(j.hPause)} · ${esc(j.hReprise)}–${esc(j.hDebauche)} · <b>${esc(j.total)}</b></p>
        <p class="discret">${esc([j.trajet, j.tachesSuppMin ? `${j.tachesSuppMin} min ${j.tachesSupp}` : '', { AUCUN: 'Pas de repas', PANIER: 'Panier', RESTAURANT: 'Restaurant' }[j.repas]].filter(Boolean).join(' — '))}</p>
        ${j.statut === 'SIGNALEE' ? `<p class="discret">Motif : ${esc(j.signalement)}</p>` : ''}
        ${aValider ? (signalement[m.personne] !== undefined ? `
          <div class="champ"><label for="motif-${esc(m.personne)}" class="sous">Qu'est-ce qui ne va pas ?</label>
            <input type="text" id="motif-${esc(m.personne)}" value="${esc(signalement[m.personne])}" data-motif="${esc(m.personne)}" placeholder="Ex. débauche à 16 h 30, pas 17 h"></div>
          <div class="duo"><button class="btn btn-clair btn-petit" type="button" data-annuler="${esc(m.personne)}">Annuler</button>
            <button class="btn btn-rouge btn-petit" type="button" data-envoyer-signal="${esc(m.personne)}">Signaler</button></div>`
          : `<div class="duo"><button class="btn btn-rouge btn-petit" type="button" data-signaler="${esc(m.personne)}">Signaler</button>
            <button class="btn btn-vert btn-petit" type="button" data-valider="${esc(m.personne)}">Valider</button></div>`) : ''}
      </section>`;
  };

  const dessiner = () => {
    const aValider = d.membres.filter(m => m.journee && m.journee.statut === 'SAISIE');
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
    $$('[data-signaler]').forEach(b => b.onclick = () => { signalement[b.dataset.signaler] = ''; dessiner(); });
    $$('[data-annuler]').forEach(b => b.onclick = () => { delete signalement[b.dataset.annuler]; dessiner(); });
    $$('[data-motif]').forEach(i => i.oninput = () => { signalement[i.dataset.motif] = i.value; });
    $$('[data-envoyer-signal]').forEach(b => b.onclick = () => {
      const p = b.dataset.envoyerSignal;
      if (!String(signalement[p] || '').trim()) { $('#erreur').textContent = 'Indique ce qui ne va pas.'; return; }
      decider([p], 'SIGNALER', signalement[p].trim());
    });
    $('#toutValider').onclick = () => decider(aValider.map(m => m.personne), 'VALIDER');
  };

  const decider = async (personnes, decision, motif) => {
    $$('button').forEach(b => { b.disabled = true; });
    try {
      for (const p of personnes) await appel('valider', { date, personne: p, decision, motif });
      delete signalement[personnes[0]];
      d = await appel('equipe', { date });
      majChef(date, {
        aValider: d.membres.filter(m => m.journee && m.journee.statut === 'SAISIE').length,
        manquants: d.manquants,
        validees: d.membres.filter(m => m.journee && m.journee.statut !== 'SAISIE').length,
      });
      oublierJour(date);
      toast(decision === 'VALIDER' ? (personnes.length > 1 ? 'Journées validées.' : 'Journée validée.') : 'Signalement envoyé.');
    } catch (err) {
      toast(err instanceof HorsReseau ? 'Pas de réseau : réessaie quand ça capte.' : err.message);
    }
    if (toujoursIci()) dessiner();
  };
  dessiner();
};

// ---------------------------------------------------------------------------
// Écran : ajouter un intérimaire (responsable du bloc)
// ---------------------------------------------------------------------------

ROUTES.interimaire = async function (date) {
  date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : aujourdhui();
  const toujoursIci = ecranCourant();
  chargement();
  let ref, a = jourGarde(date);
  try {
    ref = await referentiels();
    if (!a) { a = await appel('accueil', { date }); a._recu = Date.now(); garderJour(a); }
  } catch (err) { if (toujoursIci()) erreurEcran(err); return; }
  if (!toujoursIci()) return;
  const e = etatInitial(date, null, a.bloc);
  const dessiner = () => {
    const y = window.scrollY;
    APP().innerHTML = `
      <div class="entete">
        <button class="retour" type="button" aria-label="Retour" onclick="history.back()">${ICONES.retour}</button>
        <div><h1>Journée d'un intérimaire</h1><p class="discret">${esc(dateLongue(date))} — tu la saisis et la valides pour lui</p></div>
      </div>
      ${formulaireJournee(e, ref, true)}
      <div class="pied"><button class="btn btn-principal" type="button" id="envoyer">Enregistrer sa journée</button></div>`;
    brancherFormulaire(e, dessiner);
    $('#envoyer').onclick = async () => {
      const probleme = controler(e, true);
      if (probleme) { $('#erreur').textContent = probleme; $('#erreur').scrollIntoView({ block: 'center' }); return; }
      const bouton = $('#envoyer'); bouton.disabled = true; bouton.textContent = 'Envoi…';
      try {
        const r = await envoyer('enregistrer_interimaire', donneesJournee(e), `Intérimaire ${e.nomInterimaire}`);
        oublierJour(date);
        toast(r.enAttente ? 'Gardée, partira avec le réseau.' : 'Journée enregistrée.');
        aller('/equipe/' + date);
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
  SAISIE: ['Saisie', 'attente'], SIGNALEE: ['Signalée', 'rouge'], VALIDEE_CHEF: ['Validée chef', 'vert'],
  VALIDEE_BUREAU: ['Validée bureau', 'vert'], EXPORTEE: ['Envoyée en paie', 'vert'],
};

ROUTES.bureau = async function (date) {
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
               ${j.repartition ? `<br><span class="discret">Heures réparties : ${esc(j.repartition.split(' ; ').map(nomCourt).join(' ; '))}</span>` : ''}</p>` : ''}
        ${x.exportee ? '<p class="discret">Déjà envoyée au Suivi RH.</p>' : `
          <div class="duo">
            <button class="btn btn-clair btn-petit" type="button" data-modifier="${esc(x.personne)}">${j ? 'Corriger' : 'Saisir'}</button>
            ${!j ? ''
              : (j.statut === 'SAISIE' || j.statut === 'SIGNALEE')
                ? `<button class="btn btn-vert btn-petit" type="button" data-valider-chef="${esc(x.personne)}">Valider</button>`
                : `<button class="btn btn-petit ${x.valideBureau ? 'btn-clair' : 'btn-principal'}" type="button" data-bureau="${esc(x.personne)}" data-valeur="${x.valideBureau ? 'non' : 'oui'}">${x.valideBureau ? 'Retirer de l\'envoi' : 'Bon pour la paie'}</button>`}
          </div>`}
      </div>`;
  };

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
        <p class="discret">${c.journees.length} personne${c.journees.length > 1 ? 's' : ''}${manquantes ? ` · ${manquantes} sans saisie` : ''}${aValider ? ` · ${aValider} à valider` : ''}</p>
        ${c.journees.map(carte).join('')}
        <button class="btn btn-clair btn-petit" type="button" onclick="aller('/rapport/${date}/${encodeURIComponent(c.responsable || '')}')">
          ${c.rapport.envoye ? `Rapport : ${esc(c.rapport.restaurant || 'sans restaurant')}, ${esc(String(c.rapport.repasPayes))} repas, ${c.rapport.nbBl} BL` : 'Remplir le rapport'}</button>
        ${prets.length ? `<button class="btn btn-principal btn-petit" type="button" data-chantier="${esc(prets.join('|'))}">Tout le chantier bon pour la paie (${prets.length})</button>` : ''}
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

      ${d.alertes.length ? `<div class="alerte rouge">${ICONES.attention}<span><b>${d.alertes.length} alerte${d.alertes.length > 1 ? 's' : ''} :</b><br>
        ${d.alertes.slice(0, 6).map(a => `${esc(a.date)} · ${esc(a.type.toLowerCase().replace(/_/g, ' '))}${a.personne ? ' — ' + esc(a.personne) : ''}`).join('<br>')}</span></div>` : ''}

      ${d.chantiers.length ? d.chantiers.map(carteChantier).join('')
        : '<section class="bloc"><p class="discret">Aucun chantier au planning ce jour-là.</p></section>'}

      ${d.horsChantier.length ? `<h2>Hors chantier</h2>${d.horsChantier.map(x => `<section class="bloc">${carte(x)}</section>`).join('')}` : ''}
      <button class="btn btn-ajout" type="button" id="ajouter">${ICONES.plus} Saisir pour quelqu'un d'autre</button>

      <div class="pied">
        <div class="alerte ${d.aImporter ? 'jaune' : 'vert'}">${d.aImporter ? ICONES.horloge : ICONES.ok}<span>
          ${d.aImporter ? `<b>${d.aImporter} journée${d.aImporter > 1 ? 's' : ''}</b> prête${d.aImporter > 1 ? 's' : ''} à partir dans le Suivi RH, toutes dates confondues.`
            : 'Rien en attente d\'envoi dans le Suivi RH.'}</span></div>
        <button class="btn ${d.aImporter ? 'btn-principal' : 'btn-sombre'}" type="button" id="importer" ${d.aImporter ? '' : 'disabled'}>Envoyer dans le Suivi RH</button>
      </div>`;

    $$('[data-modifier]').forEach(b => b.onclick = () => aller(`/bureau-journee/${date}/${encodeURIComponent(b.dataset.modifier)}`));
    $$('[data-valider-chef]').forEach(b => b.onclick = () => agir({ date, quoi: 'CHEF', personnes: [b.dataset.validerChef] }));
    $$('[data-bureau]').forEach(b => b.onclick = () => agir({ date, quoi: 'BUREAU', valeur: b.dataset.valeur === 'oui', personnes: [b.dataset.bureau] }));
    $$('[data-chantier]').forEach(b => b.onclick = () => agir({ date, quoi: 'BUREAU', valeur: true, personnes: b.dataset.chantier.split('|') }));
    $('#ajouter').onclick = () => {
      const nom = prompt('Nom de la personne, tel qu\'il apparaît au planning :\n\n' + d.personnesConnues.join(', '));
      if (nom && d.personnesConnues.includes(nom.trim().toUpperCase())) aller(`/bureau-journee/${date}/${encodeURIComponent(nom.trim().toUpperCase())}`);
      else if (nom) toast('Nom inconnu. Reprends-le exactement comme au planning.');
    };
    $('#importer').onclick = importer;
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
      toast(`${r.ecrites} journée(s) écrite(s) dans le Suivi RH.`);
      if (r.ignorees && r.ignorees.length) alert('Non envoyées :\n\n' + r.ignorees.join('\n'));
    } catch (err) { toast(err.message); }
    if (toujoursIci()) dessiner();
  };

  dessiner();
};

/** Saisie ou correction d'une journée par le bureau, pour n'importe qui. */
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
        aller('/bureau/' + date);
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
