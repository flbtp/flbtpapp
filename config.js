// Adresse du serveur.
// Serveur actuel : Cloudflare Worker (rapide, sans redirection).
const SERVEUR = 'https://flbtp-serveur.rapportsflbtp.workers.dev';

// Repli, en cas de souci avec Cloudflare : remettre l'ancien serveur Apps Script.
// Il reste déployé et continue d'assurer le dépôt des photos dans Drive.
// const SERVEUR = 'https://script.google.com/macros/s/AKfycbzhQ1kTNWXuOdAf5ANujQ1n6S2OdblSs__YmeBg50-K0jAfRhbKxkjDYVIGcb2lz4c_MA/exec';
