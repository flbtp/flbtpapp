# Application FLBTP — mise en ligne

Durée : 15 minutes. L'application est un simple dossier de fichiers, hébergé gratuitement par GitHub Pages.

---

## 0. D'abord, mettre à jour le serveur

Deux fichiers du serveur ont changé depuis l'installation, pour afficher le prénom (« Bonjour Benoit ») : **Planning** et **Auth**.

1. Dans l'éditeur Apps Script, remplacer le contenu de ces deux fichiers par les nouvelles versions, puis enregistrer.
2. **Déployer › Gérer les déploiements › crayon › Version : Nouvelle version › Déployer.**

L'URL `/exec` ne change pas.

## 1. Créer le dépôt

Connecté à GitHub avec le compte rapportsflbtp@gmail.com :

1. **New repository**. Nom : `flbtp`. Visibilité : **Public** — GitHub Pages est gratuit pour les dépôts publics.
2. Cocher **Add a README file**, puis **Create repository**.

Public ne pose pas de problème : les fichiers ne contiennent aucun secret. L'adresse du serveur y figure, mais le serveur n'accepte rien sans nom et code valides, et les codes sont dans le fichier de données, pas ici.

## 2. Déposer les fichiers

1. Dans le dépôt : **Add file › Upload files**.
2. Glisser **tous les fichiers** du dossier `appli` (pas le dossier lui-même) : `index.html`, `app.js`, `styles.css`, `config.js`, `sw.js`, `manifest.webmanifest` et les trois images `.png`.
3. **Commit changes**.

## 3. Activer la publication

1. **Settings › Pages**.
2. Source : **Deploy from a branch**. Branche : **main**, dossier **/ (root)**. **Save**.
3. Attendre une à deux minutes, puis recharger la page : l'adresse s'affiche en haut, du type `https://<nom-du-compte>.github.io/flbtp/`.

C'est l'adresse à donner aux gars.

---

## 4. Premier essai, sur ton téléphone

1. Ouvrir l'adresse.
2. Choisir un nom, puis taper son code (onglet CODES du fichier « FLBTP - Données appli »).
3. L'écran d'accueil doit afficher le chantier prévu ce jour-là dans « test pj26 ».

Pour tester les écrans du chef, se connecter avec le premier nom d'un bloc du planning du jour.

**Attention, ce sont les vraies personnes du planning** : les saisies de test apparaissent dans le fichier de données. On videra les onglets JOURNEES, RAPPORTS, AVANCEMENT, MATERIAUX, BL, ALERTES et JOURNAL (sauf la ligne d'en-tête) avant la mise en service.

## 5. Installer l'application sur un téléphone

- **Android (Chrome)** : menu ⋮ › **Installer l'application** ou **Ajouter à l'écran d'accueil**.
- **iPhone** : ouvrir l'adresse **dans Safari** (pas Chrome), bouton Partager › **Sur l'écran d'accueil**.

L'icône FLBTP apparaît comme une vraie application, qui s'ouvre en plein écran et fonctionne sans réseau une fois installée.

---

## Mettre à jour l'application plus tard

1. **Dans `app.js`, augmenter `VERSION_APPLI`** en haut du fichier (`'5'` → `'6'`).
2. Déposer les fichiers modifiés dans le dépôt (Upload files, ils remplacent les anciens).

Le numéro s'affiche en bas de l'accueil et de l'écran de connexion. Pour vérifier qu'un téléphone a bien la nouvelle version : fermer complètement l'application, la rouvrir avec du réseau, regarder le numéro. GitHub peut mettre jusqu'à 10 minutes à servir les nouveaux fichiers.

## Changer d'adresse de serveur

Seulement si un nouveau déploiement a été créé (et non une nouvelle version) : modifier la ligne de `config.js`, déposer le fichier, augmenter `VERSION_APPLI`.
